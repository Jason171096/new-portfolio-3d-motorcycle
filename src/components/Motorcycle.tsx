import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WHEEL_RADIUS = 0.32;

export interface MotorcycleTelemetry {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  leanAngle: number;
  pitchAngle: number;
  yawOffset: number;
  /** Signed travel displacement delta in world meters this frame */
  deltaDistance: number;
  /** Normalized speed 0..1 for subtle idle/vibration & brake-light intensity */
  speedNormalized: number;
  isBraking: boolean;
  reducedMotion: boolean;
}

export interface MotorcycleProps {
  /**
   * Optional path or URL to a custom `.glb` / `.gltf` 3D motorcycle asset.
   * When omitted (or if loading fails), the built-in procedural Bajaj Pulsar N250
   * streetfighter model renders automatically.
   *
   * Example:
   * `<Motorcycle modelUrl="/assets/models/pulsar-n250.glb" ... />`
   */
  modelUrl?: string;
  /** Optional node names inside a custom `.glb` for front/rear wheel spin synchronization */
  wheelNodeNames?: {
    front?: string;
    rear?: string;
  };
  /** Shared mutable telemetry ref updated at 60fps by Scene.tsx */
  telemetryRef: React.MutableRefObject<MotorcycleTelemetry>;
}

interface BoundaryState {
  hasError: boolean;
}

class GlbFallbackBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Custom `.glb` model adapter hook & wrapper.
 * Automatically clones the GLTF scene, enables shadow casting, and resolves
 * front/rear wheel meshes for scroll-velocity-synchronized rotation.
 */
function CustomGlbMotorcycle({
  modelUrl,
  wheelNodeNames,
  frontWheelRef,
  rearWheelRef,
}: {
  modelUrl: string;
  wheelNodeNames?: { front?: string; rear?: string };
  frontWheelRef: React.MutableRefObject<THREE.Group | null>;
  rearWheelRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const gltf = useGLTF(modelUrl);

  const clonedScene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return root;
  }, [gltf.scene]);

  useEffect(() => {
    const frontName = wheelNodeNames?.front ?? 'FrontWheel';
    const rearName = wheelNodeNames?.rear ?? 'RearWheel';
    const frontObj = clonedScene.getObjectByName(frontName);
    const rearObj = clonedScene.getObjectByName(rearName);
    if (frontObj) frontWheelRef.current = frontObj as THREE.Group;
    if (rearObj) rearWheelRef.current = rearObj as THREE.Group;
  }, [clonedScene, frontWheelRef, rearWheelRef, wheelNodeNames]);

  return <primitive object={clonedScene} />;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes high-precision (0.1mm hash) area-weighted creased vertex normals so curved
 * automotive surfaces shade smoothly while sharp fairing body lines remain crisp.
 */
function applyCreasedSmoothNormals(
  geometry: THREE.BufferGeometry,
  creaseAngleDeg = 46,
): THREE.BufferGeometry {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const triCount = Math.floor(posAttr.count / 3);
  const cosThreshold = Math.cos(THREE.MathUtils.degToRad(creaseAngleDeg));
  const hashScale = 1e4; // 0.1mm precision to preserve tight bevel rings

  const hashPos = (x: number, y: number, z: number) =>
    `${Math.round(x * hashScale)},${Math.round(y * hashScale)},${Math.round(z * hashScale)}`;

  interface TriFaceEntry {
    unitNormal: THREE.Vector3;
    weightedNormal: THREE.Vector3;
  }

  const faceEntries: TriFaceEntry[] = new Array(triCount);
  const vertexBuckets = new Map<string, TriFaceEntry[]>();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i3 = i * 3;
    a.fromBufferAttribute(posAttr, i3);
    b.fromBufferAttribute(posAttr, i3 + 1);
    c.fromBufferAttribute(posAttr, i3 + 2);

    cb.subVectors(c, b);
    ab.subVectors(a, b);
    const weighted = new THREE.Vector3().crossVectors(cb, ab);
    const len = weighted.length();
    const unit = len > 1e-10 ? weighted.clone().divideScalar(len) : new THREE.Vector3(0, 1, 0);

    const entry: TriFaceEntry = { unitNormal: unit, weightedNormal: weighted };
    faceEntries[i] = entry;

    for (let k = 0; k < 3; k++) {
      const idx = i3 + k;
      const key = hashPos(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
      let bucket = vertexBuckets.get(key);
      if (!bucket) {
        bucket = [];
        vertexBuckets.set(key, bucket);
      }
      bucket.push(entry);
    }
  }

  const normalArray = new Float32Array(posAttr.count * 3);
  const accum = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i3 = i * 3;
    const face = faceEntries[i];
    for (let k = 0; k < 3; k++) {
      const idx = i3 + k;
      const key = hashPos(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
      const neighbors = vertexBuckets.get(key)!;
      accum.set(0, 0, 0);
      for (let n = 0; n < neighbors.length; n++) {
        const other = neighbors[n];
        if (face.unitNormal.dot(other.unitNormal) >= cosThreshold) {
          accum.add(other.weightedNormal);
        }
      }
      if (accum.lengthSq() > 1e-14) {
        accum.normalize();
      } else {
        accum.copy(face.unitNormal);
      }
      normalArray[idx * 3] = accum.x;
      normalArray[idx * 3 + 1] = accum.y;
      normalArray[idx * 3 + 2] = accum.z;
    }
  }

  geo.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  geo.deleteAttribute('uv');
  const indexed = mergeVertices(geo, 1e-4);
  if (geo !== geometry) geo.dispose();
  geometry.dispose();
  return indexed;
}

/**
 * Welds all coincident vertices for fully organic curved parts (fuel tank, seats)
 * and computes continuous vertex normals.
 */
function applyFullySmoothNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  const welded = mergeVertices(geometry, 1e-4);
  welded.computeVertexNormals();
  geometry.dispose();
  return welded;
}

type ExtrudeAxisMode = 'side' | 'front';

interface SculptedExtrudeOptions {
  depth: number;
  bevelSize?: number;
  bevelThickness?: number;
  bevelSegments?: number;
  curveSegments?: number;
  axisMode?: ExtrudeAxisMode;
  creaseAngleDeg?: number;
  fullySmooth?: boolean;
  deform?: (pos: THREE.BufferAttribute) => void;
}

/**
 * Extrudes a 2D Shape with bevels, centers it along its extrusion axis,
 * maps side profiles directly into bike (Z_forward, Y_up, X_width), applies optional
 * 3D vertex sculpting, and computes smooth vertex normals.
 */
function buildSculptedExtrude(
  shape: THREE.Shape,
  {
    depth,
    bevelSize = 0.008,
    bevelThickness = 0.008,
    bevelSegments = 3,
    curveSegments = 18,
    axisMode = 'side',
    creaseAngleDeg = 46,
    fullySmooth = false,
    deform,
  }: SculptedExtrudeOptions,
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0 && bevelThickness > 0,
    bevelSize,
    bevelThickness,
    bevelSegments,
    curveSegments,
  });

  geo.translate(0, 0, -depth * 0.5);
  if (axisMode === 'side') {
    // Shape X -> Bike +Z (Forward), Shape Y -> Bike +Y (Up), Depth Z -> Bike X (Width)
    geo.rotateY(-Math.PI / 2);
  }

  if (deform) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    deform(pos);
    pos.needsUpdate = true;
  }

  return fullySmooth ? applyFullySmoothNormals(geo) : applyCreasedSmoothNormals(geo, creaseAngleDeg);
}

/**
 * Builds a TubeGeometry along a 3D curve with a continuous parametric radius profile.
 */
function buildTaperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radialSegments: number,
  radiusAtU: (u: number) => number,
): THREE.BufferGeometry {
  const geo = new THREE.TubeGeometry(curve, tubularSegments, 1, radialSegments, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const center = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const stride = radialSegments + 1;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    curve.getPointAt(u, center);
    const r = radiusAtU(u);
    for (let j = 0; j < stride; j++) {
      const idx = i * stride + j;
      offset.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, offset.x, offset.y, offset.z);
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an arc-curved beveled shell around an axle center in the bike (Z, Y) plane,
 * used for the contoured front fender and curved rear tire hugger.
 */
function buildWheelArcFender(
  centerZ: number,
  centerY: number,
  innerRadius: number,
  outerRadius: number,
  startDeg: number,
  endDeg: number,
  width: number,
  bevel = 0.004,
  taperEnds = true,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const steps = 20;
  const a0 = THREE.MathUtils.degToRad(startDeg);
  const a1 = THREE.MathUtils.degToRad(endDeg);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = THREE.MathUtils.lerp(a0, a1, t);
    const z = centerZ + Math.cos(a) * outerRadius;
    const y = centerY + Math.sin(a) * outerRadius;
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const a = THREE.MathUtils.lerp(a0, a1, t);
    const z = centerZ + Math.cos(a) * innerRadius;
    const y = centerY + Math.sin(a) * innerRadius;
    shape.lineTo(z, y);
  }
  shape.closePath();

  return buildSculptedExtrude(shape, {
    depth: width,
    bevelSize: bevel,
    bevelThickness: bevel * 1.2,
    bevelSegments: 3,
    curveSegments: 16,
    creaseAngleDeg: 52,
    deform: (pos) => {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const ang = Math.atan2(y - centerY, z - centerZ);
        const t = THREE.MathUtils.clamp((ang - a0) / (a1 - a0), 0, 1);
        const endTaper = taperEnds ? 0.72 + 0.28 * Math.sin(t * Math.PI) : 1;
        // Slight downward wrap on the lateral skirt edges
        const edgeDrop = Math.pow(Math.abs(x) / (width * 0.5 + bevel), 2) * 0.012;
        pos.setXYZ(i, x * endTaper, y - edgeDrop, z);
      }
    },
  });
}

/**
 * Detailed 17-inch Y-spoke sport motorcycle wheel with LatheGeometry rounded-shoulder tire,
 * stepped alloy rim barrel, ventilated steel brake disc, and rear sprocket.
 */
function SportWheel({
  width = 0.14,
  isRear = false,
}: {
  width?: number;
  isRear?: boolean;
}) {
  const geometries = useMemo(() => {
    const halfW = width * 0.5;

    // 1. Rounded-shoulder sport radial tire profile via SplineCurve -> LatheGeometry
    //    Lathe points go bottom (-halfW) -> top (+halfW) so surface normals face outward.
    const tireSpline = new THREE.SplineCurve([
      new THREE.Vector2(0.209, -halfW * 0.72),
      new THREE.Vector2(0.226, -halfW * 0.90),
      new THREE.Vector2(0.256, -halfW * 1.00),
      new THREE.Vector2(0.288, -halfW * (isRear ? 0.94 : 0.88)),
      new THREE.Vector2(0.309, -halfW * (isRear ? 0.68 : 0.60)),
      new THREE.Vector2(0.318, -halfW * 0.34),
      new THREE.Vector2(WHEEL_RADIUS, 0),
      new THREE.Vector2(0.318, halfW * 0.34),
      new THREE.Vector2(0.309, halfW * (isRear ? 0.68 : 0.60)),
      new THREE.Vector2(0.288, halfW * (isRear ? 0.94 : 0.88)),
      new THREE.Vector2(0.256, halfW * 1.00),
      new THREE.Vector2(0.226, halfW * 0.90),
      new THREE.Vector2(0.209, halfW * 0.72),
    ]);
    const tirePts = tireSpline.getPoints(30);
    const tireGeo = new THREE.LatheGeometry(tirePts, 48);
    tireGeo.rotateZ(Math.PI / 2);

    // 2. Closed-section stepped alloy rim barrel via LatheGeometry
    const rimPts = [
      new THREE.Vector2(0.212, -halfW * 0.73),
      new THREE.Vector2(0.217, -halfW * 0.75),
      new THREE.Vector2(0.217, -halfW * 0.65),
      new THREE.Vector2(0.200, -halfW * 0.56),
      new THREE.Vector2(0.195, 0),
      new THREE.Vector2(0.200, halfW * 0.56),
      new THREE.Vector2(0.217, halfW * 0.65),
      new THREE.Vector2(0.217, halfW * 0.75),
      new THREE.Vector2(0.212, halfW * 0.73),
      new THREE.Vector2(0.194, halfW * 0.69),
      new THREE.Vector2(0.189, 0),
      new THREE.Vector2(0.194, -halfW * 0.69),
      new THREE.Vector2(0.212, -halfW * 0.73),
    ];
    const rimGeo = new THREE.LatheGeometry(rimPts, 42);
    rimGeo.rotateZ(Math.PI / 2);

    // 3. Stepped center hub via LatheGeometry
    const hubPts = [
      new THREE.Vector2(0.024, -halfW * 0.92),
      new THREE.Vector2(0.056, -halfW * 0.84),
      new THREE.Vector2(0.052, -halfW * 0.34),
      new THREE.Vector2(0.045, 0),
      new THREE.Vector2(0.052, halfW * 0.34),
      new THREE.Vector2(0.056, halfW * 0.84),
      new THREE.Vector2(0.024, halfW * 0.92),
    ];
    const hubGeo = new THREE.LatheGeometry(hubPts, 24);
    hubGeo.rotateZ(Math.PI / 2);

    // 4. Sculpted cast-alloy Y-spoke (replicated 5x around X axle)
    const spokeShape = new THREE.Shape();
    spokeShape.moveTo(-0.011, 0.046);
    spokeShape.lineTo(-0.0085, 0.095);
    spokeShape.lineTo(-0.068, 0.198);
    spokeShape.lineTo(-0.049, 0.201);
    spokeShape.lineTo(-0.0055, 0.117);
    spokeShape.quadraticCurveTo(0, 0.109, 0.0055, 0.117);
    spokeShape.lineTo(0.049, 0.201);
    spokeShape.lineTo(0.068, 0.198);
    spokeShape.lineTo(0.0085, 0.095);
    spokeShape.lineTo(0.011, 0.046);
    spokeShape.closePath();

    const ySpokeGeo = buildSculptedExtrude(spokeShape, {
      depth: width * 0.24,
      bevelSize: 0.003,
      bevelThickness: 0.0035,
      bevelSegments: 2,
      curveSegments: 10,
      creaseAngleDeg: 40,
    });

    // 5. Ventilated brake disc rotor + anodized inner carrier star
    const rotorOuterR = isRear ? 0.125 : 0.155;
    const rotorInnerR = rotorOuterR * 0.66;
    const rotorShape = new THREE.Shape();
    rotorShape.absarc(0, 0, rotorOuterR, 0, Math.PI * 2, false);
    const centerHole = new THREE.Path();
    centerHole.absarc(0, 0, rotorInnerR, 0, Math.PI * 2, true);
    rotorShape.holes.push(centerHole);

    // Drilled cooling perforations
    const holeCount = 12;
    const holeRingR = THREE.MathUtils.lerp(rotorInnerR, rotorOuterR, 0.52);
    for (let i = 0; i < holeCount; i++) {
      const a = (i * Math.PI * 2) / holeCount;
      const vent = new THREE.Path();
      vent.absarc(Math.cos(a) * holeRingR, Math.sin(a) * holeRingR, 0.0045, 0, Math.PI * 2, true);
      rotorShape.holes.push(vent);
    }

    const rotorGeo = buildSculptedExtrude(rotorShape, {
      depth: 0.006,
      bevelSize: 0.001,
      bevelThickness: 0.001,
      bevelSegments: 1,
      curveSegments: 14,
      creaseAngleDeg: 40,
    });

    const carrierShape = new THREE.Shape();
    const carrierOuter = rotorInnerR + 0.005;
    const carrierInner = 0.036;
    carrierShape.absarc(0, 0, carrierOuter, 0, Math.PI * 2, false);
    const carrierBore = new THREE.Path();
    carrierBore.absarc(0, 0, carrierInner, 0, Math.PI * 2, true);
    carrierShape.holes.push(carrierBore);
    const cutoutCount = 5;
    const midCarrierR = (carrierOuter + carrierInner) * 0.52;
    for (let i = 0; i < cutoutCount; i++) {
      const a = (i * Math.PI * 2) / cutoutCount;
      const pocket = new THREE.Path();
      pocket.absarc(
        Math.cos(a) * midCarrierR,
        Math.sin(a) * midCarrierR,
        (carrierOuter - carrierInner) * 0.28,
        0,
        Math.PI * 2,
        true,
      );
      carrierShape.holes.push(pocket);
    }
    const carrierGeo = buildSculptedExtrude(carrierShape, {
      depth: 0.007,
      bevelSize: 0.0012,
      bevelThickness: 0.0012,
      bevelSegments: 1,
      curveSegments: 12,
      creaseAngleDeg: 40,
    });

    // 6. Optional rear drive sprocket on left side (+X)
    let sprocketGeo: THREE.BufferGeometry | null = null;
    if (isRear) {
      const spShape = new THREE.Shape();
      spShape.absarc(0, 0, 0.104, 0, Math.PI * 2, false);
      const spBore = new THREE.Path();
      spBore.absarc(0, 0, 0.044, 0, Math.PI * 2, true);
      spShape.holes.push(spBore);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const cutout = new THREE.Path();
        cutout.absarc(Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0.015, 0, Math.PI * 2, true);
        spShape.holes.push(cutout);
      }
      sprocketGeo = buildSculptedExtrude(spShape, {
        depth: 0.006,
        bevelSize: 0.001,
        bevelThickness: 0.001,
        bevelSegments: 1,
        curveSegments: 12,
        creaseAngleDeg: 40,
      });
    }

    return { tireGeo, rimGeo, hubGeo, ySpokeGeo, rotorGeo, carrierGeo, sprocketGeo };
  }, [width, isRear]);

  useEffect(() => {
    return () => {
      geometries.tireGeo.dispose();
      geometries.rimGeo.dispose();
      geometries.hubGeo.dispose();
      geometries.ySpokeGeo.dispose();
      geometries.rotorGeo.dispose();
      geometries.carrierGeo.dispose();
      geometries.sprocketGeo?.dispose();
    };
  }, [geometries]);

  const spokeAngles = [0, 1, 2, 3, 4].map((i) => (i * Math.PI * 2) / 5);
  const discX = isRear ? -width * 0.56 : width * 0.57;

  return (
    <group>
      {/* Rounded-shoulder LatheGeometry tire */}
      <mesh geometry={geometries.tireGeo} castShadow receiveShadow>
        <meshStandardMaterial color="#14161b" roughness={0.88} metalness={0.05} />
      </mesh>

      {/* Stepped alloy rim barrel */}
      <mesh geometry={geometries.rimGeo} castShadow>
        <meshStandardMaterial color="#20242c" metalness={0.82} roughness={0.28} />
      </mesh>

      {/* Crimson Pulsar rim pinstripe rings */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[width * 0.375, 0, 0]}>
        <ringGeometry args={[0.207, 0.214, 36]} />
        <meshStandardMaterial
          color="#dc2626"
          emissive="#7f1d1d"
          emissiveIntensity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-width * 0.375, 0, 0]}>
        <ringGeometry args={[0.207, 0.214, 36]} />
        <meshStandardMaterial
          color="#dc2626"
          emissive="#7f1d1d"
          emissiveIntensity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stepped hub */}
      <mesh geometry={geometries.hubGeo} castShadow>
        <meshStandardMaterial color="#2a303a" metalness={0.82} roughness={0.26} />
      </mesh>

      {/* 5 Split Y-spokes */}
      {spokeAngles.map((angle, idx) => (
        <mesh
          key={idx}
          geometry={geometries.ySpokeGeo}
          rotation={[angle, 0, 0]}
          castShadow
        >
          <meshStandardMaterial color="#252a34" metalness={0.8} roughness={0.28} />
        </mesh>
      ))}

      {/* Ventilated steel brake disc rotor & gunmetal carrier */}
      <mesh geometry={geometries.rotorGeo} position={[discX, 0, 0]} castShadow>
        <meshStandardMaterial color="#b4bcc8" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh geometry={geometries.carrierGeo} position={[discX * 0.96, 0, 0]}>
        <meshStandardMaterial color="#2c313b" metalness={0.78} roughness={0.32} />
      </mesh>

      {/* Rear sprocket on left side (+X) */}
      {geometries.sprocketGeo && (
        <mesh geometry={geometries.sprocketGeo} position={[width * 0.54, 0, 0]}>
          <meshStandardMaterial color="#343a46" metalness={0.82} roughness={0.32} />
        </mesh>
      )}
    </group>
  );
}

const BEAM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const BEAM_FRAGMENT_SHADER = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  void main() {
    vec3 viewDir = normalize(vViewPos);
    float edgeFade = pow(abs(dot(normalize(vViewNormal), viewDir)), 2.4);
    float distFade = pow(clamp(vUv.y, 0.0, 1.0), 1.85) * smoothstep(1.0, 0.9, vUv.y);
    float alpha = edgeFade * distFade * uIntensity;
    gl_FragColor = vec4(vec3(1.0, 0.90, 0.70), alpha);
  }
`;

/**
 * Procedural Bajaj Pulsar N250 naked streetfighter geometry constructed with
 * beveled ExtrudeGeometry, LatheGeometry, tapered TubeGeometry, and smooth vertex normals.
 */
function ProceduralPulsarN250({
  frontWheelRef,
  rearWheelRef,
  tailGlowRef,
  headlightTarget,
  telemetryRef,
}: {
  frontWheelRef: React.MutableRefObject<THREE.Group | null>;
  rearWheelRef: React.MutableRefObject<THREE.Group | null>;
  tailGlowRef: React.MutableRefObject<THREE.MeshStandardMaterial | null>;
  headlightTarget: THREE.Object3D;
  telemetryRef: React.MutableRefObject<MotorcycleTelemetry>;
}) {
  const beamUniforms = useMemo(
    () => ({
      uIntensity: { value: telemetryRef.current.reducedMotion ? 0.22 : 0.34 },
    }),
    [telemetryRef],
  );

  // Shared reactive brake/tail-light material so both vertical boomerang strips brighten together
  const tailGlowMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ff2e2e',
        emissive: '#ef4444',
        emissiveIntensity: 2.2,
        roughness: 0.18,
      }),
    [],
  );

  useEffect(() => {
    tailGlowRef.current = tailGlowMaterial;
    return () => {
      tailGlowRef.current = null;
      tailGlowMaterial.dispose();
    };
  }, [tailGlowMaterial, tailGlowRef]);

  const geos = useMemo(() => {
    // =========================================================================
    // 1. HIGH-ARCHED FUEL TANK WITH SHARP KNEE RECESSES & TANK SPINE
    // =========================================================================
    const tankShape = new THREE.Shape();
    tankShape.moveTo(-0.06, 0.725);
    tankShape.lineTo(-0.06, 0.79);
    tankShape.bezierCurveTo(0.02, 0.83, 0.10, 0.995, 0.195, 1.012);
    tankShape.bezierCurveTo(0.285, 1.015, 0.348, 0.955, 0.372, 0.875);
    tankShape.lineTo(0.345, 0.775);
    tankShape.bezierCurveTo(0.23, 0.735, 0.08, 0.71, -0.06, 0.725);
    tankShape.closePath();

    const fuelTank = buildSculptedExtrude(tankShape, {
      depth: 0.21,
      bevelSize: 0.026,
      bevelThickness: 0.072,
      bevelSegments: 6,
      curveSegments: 24,
      fullySmooth: true,
      deform: (pos) => {
        const zMin = -0.086;
        const zMax = 0.398;
        const yMin = 0.695;
        const yMax = 1.038;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          const u = THREE.MathUtils.clamp((z - zMin) / (zMax - zMin), 0, 1); // 0 rear -> 1 front
          const v = THREE.MathUtils.clamp((y - yMin) / (yMax - yMin), 0, 1); // 0 bottom -> 1 top

          // Muscular front shoulders tapering cleanly toward steering head
          const frontSwell = smoothstep(0.16, 0.76, u) * (1 - 0.36 * smoothstep(0.76, 1.0, u));
          // Sharp concave thigh/knee recesses along rear-lower flanks
          const kneeU = 1 - smoothstep(0.0, 0.56, u);
          const kneeV = Math.exp(-Math.pow((v - 0.36) / 0.34, 2));
          const kneePinch = 1 - 0.36 * kneeU * kneeV;
          // Gentle teardrop dome taper along upper spine
          const crownTaper = 1 - 0.18 * smoothstep(0.72, 1.0, v);

          const scaleX = (0.78 + 0.36 * frontSwell) * kneePinch * crownTaper;
          pos.setX(i, x * scaleX);
        }
      },
    });

    const spineShape = new THREE.Shape();
    spineShape.moveTo(-0.045, 0.79);
    spineShape.bezierCurveTo(0.03, 0.835, 0.105, 1.0, 0.195, 1.018);
    spineShape.bezierCurveTo(0.265, 1.018, 0.315, 0.98, 0.345, 0.925);
    spineShape.lineTo(0.325, 0.905);
    spineShape.bezierCurveTo(0.24, 0.975, 0.12, 0.96, -0.045, 0.775);
    spineShape.closePath();

    const tankSpinePad = buildSculptedExtrude(spineShape, {
      depth: 0.068,
      bevelSize: 0.005,
      bevelThickness: 0.008,
      bevelSegments: 2,
      curveSegments: 20,
      creaseAngleDeg: 50,
    });

    // Wide, forward-swept angular tank shrouds + thin crimson accent slash
    const shroudShape = new THREE.Shape();
    shroudShape.moveTo(0.065, 0.895);
    shroudShape.lineTo(0.245, 0.905);
    shroudShape.lineTo(0.435, 0.815);
    shroudShape.lineTo(0.50, 0.705);
    shroudShape.lineTo(0.425, 0.635);
    shroudShape.lineTo(0.265, 0.618);
    shroudShape.lineTo(0.222, 0.665);
    shroudShape.lineTo(0.172, 0.642);
    shroudShape.lineTo(0.112, 0.735);
    shroudShape.closePath();

    const tankShroud = buildSculptedExtrude(shroudShape, {
      depth: 0.026,
      bevelSize: 0.007,
      bevelThickness: 0.009,
      bevelSegments: 2,
      curveSegments: 12,
      creaseAngleDeg: 44,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          // Slight outward sculptural cheek bulge
          const midZ = 1 - smoothstep(0.08, 0.24, Math.abs(z - 0.28));
          const midY = 1 - smoothstep(0.06, 0.18, Math.abs(y - 0.77));
          const sign = x >= 0 ? 1 : -1;
          pos.setX(i, x + sign * 0.012 * midZ * midY);
        }
      },
    });
    tankShroud.translate(0, -0.77, -0.27);

    const shroudTrimShape = new THREE.Shape();
    shroudTrimShape.moveTo(0.135, 0.862);
    shroudTrimShape.lineTo(0.365, 0.818);
    shroudTrimShape.lineTo(0.472, 0.728);
    shroudTrimShape.lineTo(0.448, 0.71);
    shroudTrimShape.lineTo(0.352, 0.793);
    shroudTrimShape.lineTo(0.145, 0.842);
    shroudTrimShape.closePath();

    const shroudCrimsonTrim = buildSculptedExtrude(shroudTrimShape, {
      depth: 0.01,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      bevelSegments: 1,
      creaseAngleDeg: 40,
    });
    shroudCrimsonTrim.translate(0, -0.77, -0.27);

    // =========================================================================
    // 2. STEPPED RIDER/PILLION SEAT, TAIL COWLS, GRAB RAILS, HUGGER & FENDER
    // =========================================================================
    const riderSeatShape = new THREE.Shape();
    riderSeatShape.moveTo(-0.35, 0.768);
    riderSeatShape.lineTo(-0.35, 0.838);
    riderSeatShape.bezierCurveTo(-0.26, 0.785, -0.14, 0.762, -0.02, 0.795);
    riderSeatShape.lineTo(-0.02, 0.745);
    riderSeatShape.closePath();

    const riderSeat = buildSculptedExtrude(riderSeatShape, {
      depth: 0.20,
      bevelSize: 0.024,
      bevelThickness: 0.028,
      bevelSegments: 5,
      curveSegments: 18,
      fullySmooth: true,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const u = THREE.MathUtils.clamp((z + 0.374) / 0.378, 0, 1); // 0 rear bolster -> 1 tank nose
          // Narrow sharply into the tank waist while flaring softly at rider saddle
          const widthEnv = 0.94 + 0.16 * Math.sin(u * Math.PI * 0.85) - 0.38 * smoothstep(0.55, 1.0, u);
          pos.setX(i, x * widthEnv);
        }
      },
    });

    const pillionSeatShape = new THREE.Shape();
    pillionSeatShape.moveTo(-0.67, 0.885);
    pillionSeatShape.lineTo(-0.67, 0.928);
    pillionSeatShape.quadraticCurveTo(-0.51, 0.918, -0.365, 0.888);
    pillionSeatShape.lineTo(-0.365, 0.832);
    pillionSeatShape.closePath();

    const pillionSeat = buildSculptedExtrude(pillionSeatShape, {
      depth: 0.155,
      bevelSize: 0.022,
      bevelThickness: 0.024,
      bevelSegments: 5,
      curveSegments: 14,
      fullySmooth: true,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const u = THREE.MathUtils.clamp((z + 0.692) / 0.35, 0, 1); // 0 rear tip -> 1 front step
          const taper = THREE.MathUtils.lerp(0.60, 1.10, smoothstep(0.0, 0.92, u));
          pos.setX(i, x * taper);
        }
      },
    });

    const tailCowlShape = new THREE.Shape();
    tailCowlShape.moveTo(-0.795, 0.935);
    tailCowlShape.lineTo(-0.715, 0.945);
    tailCowlShape.lineTo(-0.335, 0.856);
    tailCowlShape.lineTo(-0.255, 0.762);
    tailCowlShape.lineTo(-0.37, 0.714);
    tailCowlShape.lineTo(-0.685, 0.818);
    tailCowlShape.lineTo(-0.795, 0.885);
    tailCowlShape.closePath();

    const tailCowl = buildSculptedExtrude(tailCowlShape, {
      depth: 0.026,
      bevelSize: 0.006,
      bevelThickness: 0.007,
      bevelSegments: 2,
      creaseAngleDeg: 45,
    });

    const tailTrimShape = new THREE.Shape();
    tailTrimShape.moveTo(-0.745, 0.918);
    tailTrimShape.lineTo(-0.425, 0.848);
    tailTrimShape.lineTo(-0.435, 0.832);
    tailTrimShape.lineTo(-0.75, 0.902);
    tailTrimShape.closePath();

    const tailCrimsonTrim = buildSculptedExtrude(tailTrimShape, {
      depth: 0.008,
      bevelSize: 0.0015,
      bevelThickness: 0.0015,
      bevelSegments: 1,
      creaseAngleDeg: 40,
    });

    const underTrayShape = new THREE.Shape();
    underTrayShape.moveTo(-0.78, 0.885);
    underTrayShape.lineTo(-0.66, 0.885);
    underTrayShape.lineTo(-0.34, 0.805);
    underTrayShape.lineTo(-0.24, 0.705);
    underTrayShape.lineTo(-0.35, 0.695);
    underTrayShape.lineTo(-0.67, 0.805);
    underTrayShape.lineTo(-0.78, 0.855);
    underTrayShape.closePath();

    const underTray = buildSculptedExtrude(underTrayShape, {
      depth: 0.14,
      bevelSize: 0.008,
      bevelThickness: 0.01,
      bevelSegments: 2,
      creaseAngleDeg: 50,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const u = THREE.MathUtils.clamp((z + 0.788) / 0.56, 0, 1);
          pos.setX(i, x * THREE.MathUtils.lerp(0.55, 1.15, u));
        }
      },
    });

    // Split rear grab rail (+X left side; mirror X for right side via scale={[-1, 1, 1]})
    const grabRailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.098, 0.858, -0.455),
      new THREE.Vector3(0.118, 0.908, -0.565),
      new THREE.Vector3(0.108, 0.94, -0.665),
      new THREE.Vector3(0.068, 0.955, -0.748),
    ]);
    const grabRail = buildTaperedTube(
      grabRailCurve,
      20,
      10,
      (u) => THREE.MathUtils.lerp(0.0135, 0.008, smoothstep(0.1, 1.0, u)),
    );

    // Curved rear tire hugger concentric around rear axle (0, 0.32, -0.68)
    const rearHugger = buildWheelArcFender(-0.68, WHEEL_RADIUS, 0.346, 0.358, 54, 126, 0.168, 0.004);

    // Rear hugger twin stay arms connecting down to swingarm
    const huggerStayShape = new THREE.Shape();
    huggerStayShape.moveTo(-0.56, 0.35);
    huggerStayShape.lineTo(-0.47, 0.595);
    huggerStayShape.lineTo(-0.505, 0.608);
    huggerStayShape.lineTo(-0.60, 0.35);
    huggerStayShape.closePath();
    const huggerStay = buildSculptedExtrude(huggerStayShape, {
      depth: 0.014,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      bevelSegments: 1,
    });

    // Rear license-plate fender bracket arm (clears rear tire at z=-0.90.. -1.03)
    const fenderArmShape = new THREE.Shape();
    fenderArmShape.moveTo(-0.735, 0.835);
    fenderArmShape.lineTo(-0.775, 0.838);
    fenderArmShape.lineTo(-1.01, 0.618);
    fenderArmShape.lineTo(-0.982, 0.592);
    fenderArmShape.closePath();
    const fenderBracketArm = buildSculptedExtrude(fenderArmShape, {
      depth: 0.044,
      bevelSize: 0.004,
      bevelThickness: 0.005,
      bevelSegments: 2,
      creaseAngleDeg: 45,
    });

    // =========================================================================
    // 3. THIN VERTICAL BOOMERANG LED TAILLIGHTS & WOLF-EYED PROJECTOR HEADLIGHT
    // =========================================================================
    // Left vertical boomerang LED strip (+X side; right side mirrors across X)
    const boomerangShape = new THREE.Shape();
    boomerangShape.moveTo(0.011, -0.042);
    boomerangShape.lineTo(0.022, -0.044);
    boomerangShape.lineTo(0.046, 0.004);
    boomerangShape.lineTo(0.056, 0.043);
    boomerangShape.lineTo(0.044, 0.045);
    boomerangShape.lineTo(0.034, 0.005);
    boomerangShape.closePath();

    const boomerangLed = buildSculptedExtrude(boomerangShape, {
      depth: 0.018,
      bevelSize: 0.002,
      bevelThickness: 0.0025,
      bevelSegments: 2,
      axisMode: 'front',
      creaseAngleDeg: 55,
    });

    // Compact angular wolf-eyed headlight cowl mask
    const headCowlShape = new THREE.Shape();
    headCowlShape.moveTo(-0.085, 0.065);
    headCowlShape.lineTo(0.045, 0.082);
    headCowlShape.lineTo(0.095, 0.012);
    headCowlShape.lineTo(0.105, -0.048);
    headCowlShape.lineTo(0.025, -0.095);
    headCowlShape.lineTo(-0.075, -0.078);
    headCowlShape.closePath();

    const headCowl = buildSculptedExtrude(headCowlShape, {
      depth: 0.165,
      bevelSize: 0.016,
      bevelThickness: 0.022,
      bevelSegments: 3,
      creaseAngleDeg: 46,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          // Taper forward nose cleanly around projector bezel
          const fwdT = THREE.MathUtils.clamp((z + 0.105) / 0.225, 0, 1);
          const topT = THREE.MathUtils.clamp((y + 0.11) / 0.21, 0, 1);
          const taper = THREE.MathUtils.lerp(1.06, 0.62, smoothstep(0.25, 1.0, fwdT)) * (1 - 0.16 * topT);
          pos.setX(i, x * taper);
        }
      },
    });

    // Convex LED projector dome lens via LatheGeometry (rim -> apex so normals face outward/+Z)
    const lensPts = [
      new THREE.Vector2(0.04, 0.0),
      new THREE.Vector2(0.038, 0.005),
      new THREE.Vector2(0.03, 0.015),
      new THREE.Vector2(0.016, 0.022),
      new THREE.Vector2(0.0, 0.024),
    ];
    const projectorLens = new THREE.LatheGeometry(lensPts, 24);
    projectorLens.rotateX(Math.PI / 2);

    // Wolf-eye DRL eyebrow strip (+X side; mirror X for -X)
    const drlShape = new THREE.Shape();
    drlShape.moveTo(0.022, 0.024);
    drlShape.lineTo(0.078, 0.056);
    drlShape.lineTo(0.088, 0.044);
    drlShape.lineTo(0.028, 0.012);
    drlShape.closePath();

    const wolfEyeDrl = buildSculptedExtrude(drlShape, {
      depth: 0.016,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      bevelSegments: 1,
      axisMode: 'front',
      creaseAngleDeg: 50,
    });

    // Small smoked flyscreen visor
    const visorShape = new THREE.Shape();
    visorShape.moveTo(-0.072, 0.0);
    visorShape.lineTo(-0.048, 0.105);
    visorShape.quadraticCurveTo(0.0, 0.122, 0.048, 0.105);
    visorShape.lineTo(0.072, 0.0);
    visorShape.quadraticCurveTo(0.0, 0.018, -0.072, 0.0);
    visorShape.closePath();

    const flyscreenVisor = buildSculptedExtrude(visorShape, {
      depth: 0.008,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      bevelSegments: 2,
      axisMode: 'front',
      creaseAngleDeg: 55,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          // Arch curvature across X
          const wrapZ = -Math.pow(x / 0.075, 2) * 0.022;
          pos.setXYZ(i, x, y, z + wrapZ);
        }
      },
    });

    // =========================================================================
    // 4. PERIMETER FRAME, GUNMETAL CRANKCASE, BELLY PAN & SPORT EXHAUST
    // =========================================================================
    const frameSparCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.055, 0.835, 0.435),
      new THREE.Vector3(0.142, 0.725, 0.22),
      new THREE.Vector3(0.138, 0.56, 0.02),
      new THREE.Vector3(0.125, 0.39, -0.18),
    ]);
    const frameSpar = buildTaperedTube(frameSparCurve, 18, 8, () => 0.019);

    const subframeUpperCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.118, 0.54, -0.18),
      new THREE.Vector3(0.105, 0.72, -0.44),
      new THREE.Vector3(0.075, 0.84, -0.66),
    ]);
    const subframeUpper = buildTaperedTube(subframeUpperCurve, 12, 8, () => 0.013);

    const subframeLowerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.122, 0.39, -0.18),
      new THREE.Vector3(0.108, 0.58, -0.34),
      new THREE.Vector3(0.095, 0.74, -0.49),
    ]);
    const subframeLower = buildTaperedTube(subframeLowerCurve, 10, 8, () => 0.011);

    // Gunmetal crankcase & gearbox lower housing
    const crankcaseShape = new THREE.Shape();
    crankcaseShape.moveTo(-0.185, 0.29);
    crankcaseShape.lineTo(-0.185, 0.44);
    crankcaseShape.lineTo(-0.04, 0.485);
    crankcaseShape.lineTo(0.175, 0.47);
    crankcaseShape.lineTo(0.205, 0.34);
    crankcaseShape.lineTo(0.125, 0.255);
    crankcaseShape.lineTo(-0.12, 0.255);
    crankcaseShape.closePath();

    const crankcaseBlock = buildSculptedExtrude(crankcaseShape, {
      depth: 0.225,
      bevelSize: 0.014,
      bevelThickness: 0.018,
      bevelSegments: 3,
      creaseAngleDeg: 46,
    });

    // Forward-canted cylinder barrel & valve head
    const cylinderShape = new THREE.Shape();
    cylinderShape.moveTo(-0.02, 0.455);
    cylinderShape.lineTo(0.045, 0.685);
    cylinderShape.lineTo(0.235, 0.655);
    cylinderShape.lineTo(0.185, 0.445);
    cylinderShape.closePath();

    const cylinderBlock = buildSculptedExtrude(cylinderShape, {
      depth: 0.17,
      bevelSize: 0.01,
      bevelThickness: 0.012,
      bevelSegments: 2,
      creaseAngleDeg: 40,
    });

    // Lathed Pulsar signature bronze-gold clutch cover (right) & stator cover (left)
    const clutchPts = [
      new THREE.Vector2(0.095, 0.0),
      new THREE.Vector2(0.095, 0.012),
      new THREE.Vector2(0.082, 0.028),
      new THREE.Vector2(0.048, 0.036),
      new THREE.Vector2(0.0, 0.036),
    ];
    const clutchCover = new THREE.LatheGeometry(clutchPts, 24);
    clutchCover.rotateZ(Math.PI / 2);

    const statorPts = [
      new THREE.Vector2(0.082, 0.0),
      new THREE.Vector2(0.082, 0.01),
      new THREE.Vector2(0.072, 0.024),
      new THREE.Vector2(0.042, 0.032),
      new THREE.Vector2(0.0, 0.032),
    ];
    const statorCover = new THREE.LatheGeometry(statorPts, 24);
    statorCover.rotateZ(-Math.PI / 2);

    // Swingarm beam (mirrored ±X)
    const swingarmShape = new THREE.Shape();
    swingarmShape.moveTo(-0.185, 0.395);
    swingarmShape.lineTo(-0.185, 0.34);
    swingarmShape.lineTo(-0.70, 0.30);
    swingarmShape.lineTo(-0.705, 0.342);
    swingarmShape.closePath();
    const swingarmBeam = buildSculptedExtrude(swingarmShape, {
      depth: 0.03,
      bevelSize: 0.005,
      bevelThickness: 0.005,
      bevelSegments: 2,
      creaseAngleDeg: 42,
    });

    // Angular lower belly pan cowl wing (mirrored ±X) + center keel + crimson slash
    const bellyPanWingShape = new THREE.Shape();
    bellyPanWingShape.moveTo(-0.14, 0.235);
    bellyPanWingShape.lineTo(-0.12, 0.305);
    bellyPanWingShape.lineTo(0.11, 0.355);
    bellyPanWingShape.lineTo(0.35, 0.31);
    bellyPanWingShape.lineTo(0.385, 0.255);
    bellyPanWingShape.lineTo(0.24, 0.195);
    bellyPanWingShape.lineTo(-0.08, 0.205);
    bellyPanWingShape.closePath();

    const bellyPanWing = buildSculptedExtrude(bellyPanWingShape, {
      depth: 0.024,
      bevelSize: 0.006,
      bevelThickness: 0.008,
      bevelSegments: 2,
      creaseAngleDeg: 44,
    });
    bellyPanWing.translate(0, -0.275, -0.12);

    const bellyTrimShape = new THREE.Shape();
    bellyTrimShape.moveTo(0.09, 0.326);
    bellyTrimShape.lineTo(0.33, 0.292);
    bellyTrimShape.lineTo(0.32, 0.275);
    bellyTrimShape.lineTo(0.085, 0.31);
    bellyTrimShape.closePath();
    const bellyCrimsonTrim = buildSculptedExtrude(bellyTrimShape, {
      depth: 0.008,
      bevelSize: 0.0015,
      bevelThickness: 0.0015,
      bevelSegments: 1,
      creaseAngleDeg: 40,
    });
    bellyCrimsonTrim.translate(0, -0.275, -0.12);

    // Exhaust header downpipe (TubeGeometry) from front cylinder port under belly to right collector
    const headerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, 0.565, 0.235),
      new THREE.Vector3(-0.055, 0.405, 0.325),
      new THREE.Vector3(-0.075, 0.235, 0.14),
      new THREE.Vector3(-0.115, 0.232, -0.09),
      new THREE.Vector3(-0.155, 0.278, -0.225),
    ]);
    const exhaustHeader = buildTaperedTube(
      headerCurve,
      26,
      10,
      (u) => THREE.MathUtils.lerp(0.019, 0.024, u),
    );

    // Angled brushed-silver sport exhaust muffler barrel (LatheGeometry) + tapered outlet cap
    const mufflerPts = [
      new THREE.Vector2(0.024, -0.22),
      new THREE.Vector2(0.044, -0.15),
      new THREE.Vector2(0.056, -0.11),
      new THREE.Vector2(0.058, 0.09),
      new THREE.Vector2(0.053, 0.16),
      new THREE.Vector2(0.036, 0.20),
    ];
    const mufflerCanister = new THREE.LatheGeometry(mufflerPts, 24);
    mufflerCanister.rotateX(-Math.PI / 2);

    const mufflerEndCapPts = [
      new THREE.Vector2(0.054, -0.02),
      new THREE.Vector2(0.046, 0.035),
      new THREE.Vector2(0.030, 0.065),
      new THREE.Vector2(0.018, 0.065),
      new THREE.Vector2(0.018, 0.02),
    ];
    const mufflerEndCap = new THREE.LatheGeometry(mufflerEndCapPts, 20);
    mufflerEndCap.rotateX(-Math.PI / 2);

    // Sculpted brushed-silver heat shield plate wrapping outer flank of muffler
    const heatShieldShape = new THREE.Shape();
    heatShieldShape.moveTo(-0.13, -0.035);
    heatShieldShape.lineTo(0.11, -0.028);
    heatShieldShape.lineTo(0.145, 0.022);
    heatShieldShape.lineTo(-0.11, 0.032);
    heatShieldShape.closePath();
    const mufflerHeatShield = buildSculptedExtrude(heatShieldShape, {
      depth: 0.018,
      bevelSize: 0.004,
      bevelThickness: 0.004,
      bevelSegments: 2,
      creaseAngleDeg: 45,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          // Wrap shield radially around muffler outer (-X) flank
          const curveX = Math.pow(y / 0.035, 2) * 0.011;
          pos.setXYZ(i, x + curveX, y, z);
        }
      },
    });

    // =========================================================================
    // 5. FRONT FENDER, TAPERED HANDLEBARS & SWEPT MIRRORS ON TUBEGEOMETRY STALKS
    // =========================================================================
    // Front fender centered around front axle in steering fork frame (0, -0.582, 0.028)
    const frontFender = buildWheelArcFender(0.028, -0.582, 0.346, 0.358, 52, 130, 0.128, 0.004);

    // Tapered streetfighter fat-bar handlebar via TubeGeometry
    const handlebarCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.355, 0.034, -0.052),
      new THREE.Vector3(-0.19, 0.024, -0.022),
      new THREE.Vector3(-0.075, 0.002, 0.0),
      new THREE.Vector3(0.075, 0.002, 0.0),
      new THREE.Vector3(0.19, 0.024, -0.022),
      new THREE.Vector3(0.355, 0.034, -0.052),
    ]);
    const taperedHandlebar = buildTaperedTube(handlebarCurve, 32, 12, (u) => {
      // Thick 17.5mm center clamp tapering smoothly to 12.5mm grip ends
      const distFromCenter = Math.abs(u - 0.5) * 2;
      return THREE.MathUtils.lerp(0.0175, 0.0125, smoothstep(0.14, 0.65, distFromCenter));
    });

    // Swept-back angular mirror stalk (+X left side; mirror X for -X right side)
    const mirrorStalkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.185, 0.026, -0.012),
      new THREE.Vector3(0.245, 0.088, -0.028),
      new THREE.Vector3(0.312, 0.142, -0.058),
    ]);
    const mirrorStalk = buildTaperedTube(
      mirrorStalkCurve,
      14,
      8,
      (u) => THREE.MathUtils.lerp(0.0072, 0.0052, u),
    );

    // Swept-back angular stealth mirror housing (+X left; mirror X for right)
    const mirrorShellShape = new THREE.Shape();
    mirrorShellShape.moveTo(-0.052, -0.024);
    mirrorShellShape.lineTo(0.028, -0.028);
    mirrorShellShape.lineTo(0.062, 0.008);
    mirrorShellShape.lineTo(0.044, 0.032);
    mirrorShellShape.lineTo(-0.046, 0.018);
    mirrorShellShape.closePath();

    const mirrorHousing = buildSculptedExtrude(mirrorShellShape, {
      depth: 0.016,
      bevelSize: 0.004,
      bevelThickness: 0.005,
      bevelSegments: 2,
      axisMode: 'front',
      creaseAngleDeg: 44,
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          // Slight aerodynamic wedge toward outer tip (+X)
          const tipT = smoothstep(-0.05, 0.06, x);
          pos.setZ(i, z - tipT * 0.012);
          pos.setY(i, y);
        }
      },
    });

    const mirrorGlassShape = new THREE.Shape();
    mirrorGlassShape.moveTo(-0.046, -0.019);
    mirrorGlassShape.lineTo(0.024, -0.022);
    mirrorGlassShape.lineTo(0.052, 0.007);
    mirrorGlassShape.lineTo(0.038, 0.026);
    mirrorGlassShape.lineTo(-0.041, 0.014);
    mirrorGlassShape.closePath();
    const mirrorGlass = buildSculptedExtrude(mirrorGlassShape, {
      depth: 0.003,
      bevelSize: 0.001,
      bevelThickness: 0.001,
      bevelSegments: 1,
      axisMode: 'front',
      deform: (pos) => {
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const tipT = smoothstep(-0.05, 0.06, x);
          pos.setZ(i, pos.getZ(i) - tipT * 0.012);
        }
      },
    });

    return {
      fuelTank,
      tankSpinePad,
      tankShroud,
      shroudCrimsonTrim,
      riderSeat,
      pillionSeat,
      tailCowl,
      tailCrimsonTrim,
      underTray,
      grabRail,
      rearHugger,
      huggerStay,
      fenderBracketArm,
      boomerangLed,
      headCowl,
      projectorLens,
      wolfEyeDrl,
      flyscreenVisor,
      frameSpar,
      subframeUpper,
      subframeLower,
      crankcaseBlock,
      cylinderBlock,
      clutchCover,
      statorCover,
      swingarmBeam,
      bellyPanWing,
      bellyCrimsonTrim,
      exhaustHeader,
      mufflerCanister,
      mufflerEndCap,
      mufflerHeatShield,
      frontFender,
      taperedHandlebar,
      mirrorStalk,
      mirrorHousing,
      mirrorGlass,
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(geos).forEach((g) => g.dispose());
    };
  }, [geos]);

  return (
    <group>
      {/* Rear Wheel (wider rounded-shoulder 130/70-17 tire) */}
      <group
        ref={(el) => {
          rearWheelRef.current = el;
        }}
        position={[0, WHEEL_RADIUS, -0.68]}
      >
        <SportWheel width={0.168} isRear />
      </group>

      {/* Front Wheel (100/80-17 tire) */}
      <group
        ref={(el) => {
          frontWheelRef.current = el;
        }}
        position={[0, WHEEL_RADIUS, 0.72]}
      >
        <SportWheel width={0.118} />
      </group>

      {/* ===================================================================== */}
      {/* CHASSIS, SWINGARM, MONOSHOCK & TIRE HUGGER                            */}
      {/* ===================================================================== */}
      {/* Perimeter Frame Spars & Rear Subframe Trellis */}
      <mesh geometry={geos.frameSpar} castShadow>
        <meshStandardMaterial color="#2a2f3a" metalness={0.76} roughness={0.32} />
      </mesh>
      <mesh geometry={geos.frameSpar} scale={[-1, 1, 1]} castShadow>
        <meshStandardMaterial color="#2a2f3a" metalness={0.76} roughness={0.32} />
      </mesh>
      <mesh geometry={geos.subframeUpper} castShadow>
        <meshStandardMaterial color="#242933" metalness={0.72} roughness={0.35} />
      </mesh>
      <mesh geometry={geos.subframeUpper} scale={[-1, 1, 1]} castShadow>
        <meshStandardMaterial color="#242933" metalness={0.72} roughness={0.35} />
      </mesh>
      <mesh geometry={geos.subframeLower} castShadow>
        <meshStandardMaterial color="#242933" metalness={0.72} roughness={0.35} />
      </mesh>
      <mesh geometry={geos.subframeLower} scale={[-1, 1, 1]} castShadow>
        <meshStandardMaterial color="#242933" metalness={0.72} roughness={0.35} />
      </mesh>

      {/* Tucked Nitrox Monoshock Coil */}
      <group position={[0, 0.50, -0.26]} rotation={[0.52, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.032, 0.032, 0.16, 12]} />
          <meshStandardMaterial color="#dc2626" metalness={0.45} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0.075, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.11, 10]} />
          <meshStandardMaterial color="#1b1e24" metalness={0.75} roughness={0.28} />
        </mesh>
      </group>

      {/* Twin-Sided Box Swingarm + Rear Brake Caliper */}
      <mesh geometry={geos.swingarmBeam} position={[0.105, 0, 0]} castShadow>
        <meshStandardMaterial color="#252a33" metalness={0.72} roughness={0.36} />
      </mesh>
      <mesh geometry={geos.swingarmBeam} position={[-0.105, 0, 0]} castShadow>
        <meshStandardMaterial color="#252a33" metalness={0.72} roughness={0.36} />
      </mesh>
      {/* Rear caliper clamping on right disc (-X) */}
      <mesh position={[-0.095, 0.415, -0.63]} rotation={[0.35, 0, 0]} castShadow>
        <boxGeometry args={[0.042, 0.062, 0.072]} />
        <meshStandardMaterial color="#373c47" metalness={0.78} roughness={0.3} />
      </mesh>

      {/* Curved Rear Tire Hugger & Swingarm Stays */}
      <mesh geometry={geos.rearHugger} castShadow receiveShadow>
        <meshStandardMaterial color="#161920" metalness={0.22} roughness={0.62} />
      </mesh>
      <mesh geometry={geos.huggerStay} position={[0.096, 0, 0]} castShadow>
        <meshStandardMaterial color="#1c2028" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh geometry={geos.huggerStay} position={[-0.096, 0, 0]} castShadow>
        <meshStandardMaterial color="#1c2028" metalness={0.35} roughness={0.5} />
      </mesh>

      {/* ===================================================================== */}
      {/* ENGINE CRANKCASE BLOCK, OIL COOLER, BELLY PAN & SPORT EXHAUST         */}
      {/* ===================================================================== */}
      {/* Gunmetal Crankcase & Cylinder Block */}
      <mesh geometry={geos.crankcaseBlock} castShadow receiveShadow>
        <meshStandardMaterial color="#2c323d" metalness={0.76} roughness={0.36} />
      </mesh>
      <mesh geometry={geos.cylinderBlock} castShadow>
        <meshStandardMaterial color="#252a33" metalness={0.72} roughness={0.42} />
      </mesh>
      {/* Cylinder head silver cam cover accent */}
      <mesh position={[0, 0.68, 0.135]} rotation={[0.18, 0, 0]} castShadow>
        <boxGeometry args={[0.16, 0.032, 0.18]} />
        <meshStandardMaterial color="#404754" metalness={0.78} roughness={0.3} />
      </mesh>
      {/* Pulsar Bronze-Gold Clutch Cover (-X right) & Stator Cover (+X left) */}
      <mesh geometry={geos.clutchCover} position={[-0.124, 0.35, -0.025]} castShadow>
        <meshStandardMaterial color="#916d43" metalness={0.82} roughness={0.28} />
      </mesh>
      <mesh geometry={geos.statorCover} position={[0.124, 0.36, 0.015]} castShadow>
        <meshStandardMaterial color="#7d5e3a" metalness={0.82} roughness={0.3} />
      </mesh>

      {/* Front Oil-Cooler Radiator tucked behind forks */}
      <group position={[0, 0.54, 0.335]} rotation={[0.16, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.20, 0.115, 0.036]} />
          <meshStandardMaterial color="#181b22" metalness={0.5} roughness={0.58} />
        </mesh>
        <mesh position={[0.105, 0, 0]}>
          <boxGeometry args={[0.018, 0.122, 0.042]} />
          <meshStandardMaterial color="#474e5c" metalness={0.8} roughness={0.28} />
        </mesh>
        <mesh position={[-0.105, 0, 0]}>
          <boxGeometry args={[0.018, 0.122, 0.042]} />
          <meshStandardMaterial color="#474e5c" metalness={0.8} roughness={0.28} />
        </mesh>
      </group>

      {/* Rider & Passenger Footpeg Brackets */}
      {([1, -1] as const).map((side) => (
        <group key={side}>
          {/* Rider rear-set bracket & peg */}
          <mesh position={[side * 0.145, 0.31, -0.14]} rotation={[0.25, 0, 0]} castShadow>
            <boxGeometry args={[0.018, 0.085, 0.12]} />
            <meshStandardMaterial color="#9aa3b2" metalness={0.84} roughness={0.26} />
          </mesh>
          <mesh position={[side * 0.195, 0.285, -0.14]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, 0.085, 8]} />
            <meshStandardMaterial color="#181b20" roughness={0.8} />
          </mesh>
          {/* Upswept passenger footpeg hanger */}
          <mesh position={[side * 0.145, 0.56, -0.37]} rotation={[-0.68, 0, 0]} castShadow>
            <boxGeometry args={[0.016, 0.036, 0.24]} />
            <meshStandardMaterial color="#8f98a6" metalness={0.82} roughness={0.28} />
          </mesh>
          <mesh position={[side * 0.185, 0.48, -0.45]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.011, 0.011, 0.07, 8]} />
            <meshStandardMaterial color="#232730" metalness={0.65} roughness={0.35} />
          </mesh>
        </group>
      ))}

      {/* Angular Lower Belly Pan Cowl */}
      <group>
        {([1, -1] as const).map((side) => (
          <group
            key={side}
            position={[side * 0.118, 0.275, 0.12]}
            rotation={[0, side * -0.08, side * -0.12]}
          >
            <mesh geometry={geos.bellyPanWing} castShadow>
              <meshPhysicalMaterial
                color="#202530"
                metalness={0.72}
                roughness={0.26}
                clearcoat={0.75}
                clearcoatRoughness={0.18}
              />
            </mesh>
            <mesh geometry={geos.bellyCrimsonTrim} position={[side * 0.016, 0, 0]}>
              <meshPhysicalMaterial
                color="#dc2626"
                emissive="#7f1d1d"
                emissiveIntensity={0.22}
                metalness={0.55}
                roughness={0.22}
                clearcoat={0.8}
              />
            </mesh>
          </group>
        ))}
        {/* Lower keel skid bridge */}
        <mesh position={[0, 0.215, 0.11]} rotation={[0.12, 0, 0]} castShadow>
          <boxGeometry args={[0.17, 0.025, 0.44]} />
          <meshStandardMaterial color="#15181e" roughness={0.62} metalness={0.25} />
        </mesh>
      </group>

      {/* Exhaust Header Pipe, Collector & Angled Brushed-Silver Sport Muffler (Right: -X) */}
      <mesh geometry={geos.exhaustHeader} castShadow>
        <meshStandardMaterial color="#746658" metalness={0.86} roughness={0.28} />
      </mesh>
      <mesh position={[-0.08, 0.25, -0.14]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.044, 0.044, 0.14, 12]} />
        <meshStandardMaterial color="#1c1f26" metalness={0.6} roughness={0.42} />
      </mesh>
      <group position={[-0.175, 0.375, -0.415]} rotation={[0.44, -0.06, 0]}>
        <mesh geometry={geos.mufflerCanister} castShadow>
          <meshStandardMaterial color="#c4cad6" metalness={0.9} roughness={0.22} />
        </mesh>
        <mesh geometry={geos.mufflerEndCap} position={[0, 0, -0.215]} castShadow>
          <meshStandardMaterial color="#181b21" metalness={0.55} roughness={0.38} />
        </mesh>
        <mesh
          geometry={geos.mufflerHeatShield}
          position={[-0.056, 0.004, 0.01]}
          castShadow
        >
          <meshStandardMaterial color="#d2d8e2" metalness={0.92} roughness={0.2} />
        </mesh>
        {/* Muffler strap clamp */}
        <mesh position={[0, 0, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.061, 0.061, 0.022, 18]} />
          <meshStandardMaterial color="#181b21" metalness={0.6} roughness={0.35} />
        </mesh>
      </group>

      {/* ===================================================================== */}
      {/* FUEL TANK & WIDE FORWARD-SWEPT ANGULAR SHROUDS                        */}
      {/* ===================================================================== */}
      <mesh geometry={geos.fuelTank} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#232834"
          metalness={0.76}
          roughness={0.24}
          clearcoat={0.82}
          clearcoatRoughness={0.14}
        />
      </mesh>
      <mesh geometry={geos.tankSpinePad} castShadow>
        <meshStandardMaterial color="#13161c" roughness={0.76} metalness={0.15} />
      </mesh>
      {/* Billet aluminum fuel filler cap */}
      <mesh position={[0, 1.022, 0.205]} rotation={[0.04, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.042, 0.012, 18]} />
        <meshStandardMaterial color="#8f97a6" metalness={0.88} roughness={0.22} />
      </mesh>

      {/* Wide Forward-Swept Angular Tank Shrouds & Crimson Trim */}
      <group>
        {([1, -1] as const).map((side) => (
          <group
            key={side}
            position={[side * 0.162, 0.77, 0.27]}
            rotation={[0.04, side * -0.18, side * -0.11]}
          >
            <mesh geometry={geos.tankShroud} castShadow receiveShadow>
              <meshPhysicalMaterial
                color="#262c38"
                metalness={0.76}
                roughness={0.24}
                clearcoat={0.8}
                clearcoatRoughness={0.15}
              />
            </mesh>
            <mesh geometry={geos.shroudCrimsonTrim} position={[side * 0.024, 0, 0]}>
              <meshPhysicalMaterial
                color="#dc2626"
                emissive="#7f1d1d"
                emissiveIntensity={0.28}
                metalness={0.55}
                roughness={0.2}
                clearcoat={0.85}
              />
            </mesh>
          </group>
        ))}

        {/* Dark recessed inner intake grille louver behind shrouds */}
        <mesh position={[0.132, 0.725, 0.30]} rotation={[0.25, -0.22, 0]}>
          <boxGeometry args={[0.025, 0.13, 0.14]} />
          <meshStandardMaterial color="#12141a" roughness={0.78} metalness={0.2} />
        </mesh>
        <mesh position={[-0.132, 0.725, 0.30]} rotation={[0.25, 0.22, 0]}>
          <boxGeometry args={[0.025, 0.13, 0.14]} />
          <meshStandardMaterial color="#12141a" roughness={0.78} metalness={0.2} />
        </mesh>
      </group>

      {/* ===================================================================== */}
      {/* STEPPED RIDER & PILLION SEAT, TAIL COWL, GRAB RAILS, BOOMERANG LEDS   */}
      {/* ===================================================================== */}
      <mesh geometry={geos.riderSeat} castShadow receiveShadow>
        <meshStandardMaterial color="#15181f" roughness={0.86} metalness={0.06} />
      </mesh>
      <mesh geometry={geos.pillionSeat} castShadow receiveShadow>
        <meshStandardMaterial color="#181b23" roughness={0.83} metalness={0.08} />
      </mesh>
      {/* Pillion grab strap */}
      <mesh position={[0, 0.916, -0.50]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.165, 0.012, 0.028]} />
        <meshStandardMaterial color="#101216" roughness={0.75} />
      </mesh>

      {/* Sharp Upswept Side Tail Cowls + Undertray */}
      <mesh
        geometry={geos.tailCowl}
        position={[0.172, 0, 0]}
        rotation={[0, 0.15, 0]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color="#232834"
          metalness={0.76}
          roughness={0.24}
          clearcoat={0.8}
          clearcoatRoughness={0.15}
        />
      </mesh>
      <mesh
        geometry={geos.tailCowl}
        position={[-0.172, 0, 0]}
        rotation={[0, -0.15, 0]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color="#232834"
          metalness={0.76}
          roughness={0.24}
          clearcoat={0.8}
          clearcoatRoughness={0.15}
        />
      </mesh>
      <mesh
        geometry={geos.tailCrimsonTrim}
        position={[0.19, 0, 0]}
        rotation={[0, 0.15, 0]}
      >
        <meshPhysicalMaterial
          color="#dc2626"
          emissive="#7f1d1d"
          emissiveIntensity={0.26}
          metalness={0.55}
          roughness={0.22}
          clearcoat={0.85}
        />
      </mesh>
      <mesh
        geometry={geos.tailCrimsonTrim}
        position={[-0.19, 0, 0]}
        rotation={[0, -0.15, 0]}
      >
        <meshPhysicalMaterial
          color="#dc2626"
          emissive="#7f1d1d"
          emissiveIntensity={0.26}
          metalness={0.55}
          roughness={0.22}
          clearcoat={0.85}
        />
      </mesh>
      <mesh geometry={geos.underTray} castShadow>
        <meshStandardMaterial color="#15181f" roughness={0.68} metalness={0.2} />
      </mesh>

      {/* Split Rear Grab Rails */}
      <mesh geometry={geos.grabRail} castShadow>
        <meshStandardMaterial color="#3c424f" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh geometry={geos.grabRail} scale={[-1, 1, 1]} castShadow>
        <meshStandardMaterial color="#3c424f" metalness={0.8} roughness={0.28} />
      </mesh>

      {/* Smoked Taillight Pocket & Twin Vertical Boomerang LED Emissive Strips */}
      <mesh position={[0, 0.892, -0.768]} rotation={[-0.28, 0, 0]}>
        <boxGeometry args={[0.106, 0.075, 0.036]} />
        <meshStandardMaterial color="#111318" roughness={0.4} metalness={0.35} />
      </mesh>
      <mesh
        geometry={geos.boomerangLed}
        material={tailGlowMaterial}
        position={[0, 0.892, -0.792]}
        rotation={[-0.28, 0, 0]}
      />
      <mesh
        geometry={geos.boomerangLed}
        material={tailGlowMaterial}
        position={[0, 0.892, -0.792]}
        rotation={[-0.28, 0, 0]}
        scale={[-1, 1, 1]}
      />

      {/* Rear License-Plate Fender Bracket, Reflector & Amber Turn Stalks */}
      <mesh geometry={geos.fenderBracketArm} castShadow>
        <meshStandardMaterial color="#1c2028" metalness={0.45} roughness={0.52} />
      </mesh>
      <group position={[0, 0.59, -0.995]} rotation={[-0.58, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.145, 0.105, 0.012]} />
          <meshStandardMaterial color="#1e222b" roughness={0.55} metalness={0.25} />
        </mesh>
        {/* Plate number border accent */}
        <mesh position={[0, 0, -0.008]}>
          <boxGeometry args={[0.125, 0.085, 0.004]} />
          <meshStandardMaterial color="#d4d8e0" roughness={0.42} metalness={0.2} />
        </mesh>
        {/* Lower crimson reflector */}
        <mesh position={[0, -0.068, -0.004]}>
          <boxGeometry args={[0.052, 0.014, 0.008]} />
          <meshStandardMaterial color="#dc2626" emissive="#991b1b" emissiveIntensity={0.4} />
        </mesh>
      </group>
      {/* Twin rear amber LED turn indicator stalks */}
      {([1, -1] as const).map((side) => (
        <group key={side} position={[side * 0.075, 0.695, -0.905]}>
          <mesh position={[side * 0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.006, 0.006, 0.045, 8]} />
            <meshStandardMaterial color="#181b20" roughness={0.6} />
          </mesh>
          <mesh position={[side * 0.042, 0, -0.005]}>
            <boxGeometry args={[0.028, 0.014, 0.016]} />
            <meshStandardMaterial color="#f59e0b" emissive="#d97706" emissiveIntensity={0.75} />
          </mesh>
        </group>
      ))}

      {/* ===================================================================== */}
      {/* FRONT TELECSOPIC FORKS, FENDER, WOLF-EYE HEADLAMP & COCKPIT           */}
      {/* ===================================================================== */}
      <group position={[0, 0.84, 0.457]} rotation={[-0.42, 0, 0]}>
        {/* Upper & Lower Billet Triple Clamps */}
        <mesh position={[0, 0.035, 0.014]} castShadow>
          <boxGeometry args={[0.235, 0.024, 0.072]} />
          <meshStandardMaterial color="#272c36" metalness={0.8} roughness={0.28} />
        </mesh>
        <mesh position={[0, -0.135, 0.016]} castShadow>
          <boxGeometry args={[0.235, 0.028, 0.076]} />
          <meshStandardMaterial color="#21252e" metalness={0.78} roughness={0.3} />
        </mesh>

        {/* Left & Right Fork Tubes & Sliders reaching Front Axle (0, -0.582, 0.028) */}
        <mesh position={[0.102, -0.12, 0.028]} castShadow>
          <cylinderGeometry args={[0.021, 0.02, 0.36, 14]} />
          <meshStandardMaterial color="#b4bcc8" metalness={0.9} roughness={0.18} />
        </mesh>
        <mesh position={[-0.102, -0.12, 0.028]} castShadow>
          <cylinderGeometry args={[0.021, 0.02, 0.36, 14]} />
          <meshStandardMaterial color="#b4bcc8" metalness={0.9} roughness={0.18} />
        </mesh>
        <mesh position={[0.102, -0.40, 0.028]} castShadow>
          <cylinderGeometry args={[0.029, 0.027, 0.40, 14]} />
          <meshStandardMaterial color="#1b1e25" metalness={0.68} roughness={0.34} />
        </mesh>
        <mesh position={[-0.102, -0.40, 0.028]} castShadow>
          <cylinderGeometry args={[0.029, 0.027, 0.40, 14]} />
          <meshStandardMaterial color="#1b1e25" metalness={0.68} roughness={0.34} />
        </mesh>

        {/* Stationary Front Brake Caliper clamping left (+X) 300mm rotor */}
        <mesh position={[0.075, -0.505, 0.145]} rotation={[0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.044, 0.072, 0.068]} />
          <meshStandardMaterial color="#3c424e" metalness={0.8} roughness={0.28} />
        </mesh>

        {/* Contoured Curved Front Fender */}
        <mesh geometry={geos.frontFender} castShadow receiveShadow>
          <meshPhysicalMaterial
            color="#222732"
            metalness={0.76}
            roughness={0.24}
            clearcoat={0.8}
            clearcoatRoughness={0.15}
          />
        </mesh>

        {/* Streetfighter Cockpit: Tapered Handlebars, Digital Cluster & TubeGeometry Mirrors */}
        <group position={[0, 0.062, -0.008]} rotation={[0.42, 0, 0]}>
          {/* Dual anodized bar risers */}
          <mesh position={[0.045, -0.012, 0]} castShadow>
            <cylinderGeometry args={[0.014, 0.016, 0.032, 10]} />
            <meshStandardMaterial color="#2e3440" metalness={0.82} roughness={0.28} />
          </mesh>
          <mesh position={[-0.045, -0.012, 0]} castShadow>
            <cylinderGeometry args={[0.014, 0.016, 0.032, 10]} />
            <meshStandardMaterial color="#2e3440" metalness={0.82} roughness={0.28} />
          </mesh>

          {/* Tapered TubeGeometry Handlebar */}
          <mesh geometry={geos.taperedHandlebar} castShadow>
            <meshStandardMaterial color="#282d37" metalness={0.84} roughness={0.26} />
          </mesh>

          {/* Grips, Bar-End Weights & Brake/Clutch Levers */}
          {([1, -1] as const).map((side) => (
            <group key={side}>
              <mesh
                position={[side * 0.29, 0.029, -0.038]}
                rotation={[0.04, side * 0.18, Math.PI / 2 - side * 0.07]}
              >
                <cylinderGeometry args={[0.0185, 0.0185, 0.125, 12]} />
                <meshStandardMaterial color="#111318" roughness={0.9} />
              </mesh>
              <mesh
                position={[side * 0.362, 0.035, -0.052]}
                rotation={[0.04, side * 0.18, Math.PI / 2 - side * 0.07]}
              >
                <cylinderGeometry args={[0.016, 0.016, 0.024, 12]} />
                <meshStandardMaterial color="#9ea7b6" metalness={0.88} roughness={0.22} />
              </mesh>
              {/* Hand lever */}
              <mesh
                position={[side * 0.255, 0.022, 0.015]}
                rotation={[0, side * -0.18, 0]}
              >
                <boxGeometry args={[0.115, 0.008, 0.014]} />
                <meshStandardMaterial color="#a6aebc" metalness={0.88} roughness={0.22} />
              </mesh>
            </group>
          ))}

          {/* Swept-Back Angular Mirrors on TubeGeometry Stalks */}
          <mesh geometry={geos.mirrorStalk} castShadow>
            <meshStandardMaterial color="#1f232b" metalness={0.74} roughness={0.32} />
          </mesh>
          <mesh geometry={geos.mirrorStalk} scale={[-1, 1, 1]} castShadow>
            <meshStandardMaterial color="#1f232b" metalness={0.74} roughness={0.32} />
          </mesh>

          <group position={[0.335, 0.148, -0.062]} rotation={[0.08, 0.32, 0.06]}>
            <mesh geometry={geos.mirrorHousing} castShadow>
              <meshStandardMaterial color="#1b1f27" metalness={0.62} roughness={0.32} />
            </mesh>
            <mesh geometry={geos.mirrorGlass} position={[0, 0, -0.0125]}>
              <meshStandardMaterial color="#94a3b8" metalness={0.96} roughness={0.08} />
            </mesh>
          </group>
          <group position={[-0.335, 0.148, -0.062]} rotation={[0.08, -0.32, -0.06]}>
            <mesh geometry={geos.mirrorHousing} scale={[-1, 1, 1]} castShadow>
              <meshStandardMaterial color="#1b1f27" metalness={0.62} roughness={0.32} />
            </mesh>
            <mesh geometry={geos.mirrorGlass} scale={[-1, 1, 1]} position={[0, 0, -0.0125]}>
              <meshStandardMaterial color="#94a3b8" metalness={0.96} roughness={0.08} />
            </mesh>
          </group>

          {/* Digital Infinity Tachometer Cluster */}
          <group position={[0, 0.025, 0.062]} rotation={[-0.78, 0, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.135, 0.072, 0.022]} />
              <meshStandardMaterial color="#14171f" roughness={0.48} metalness={0.4} />
            </mesh>
            <mesh position={[0, 0, -0.012]}>
              <planeGeometry args={[0.115, 0.052]} />
              <meshStandardMaterial
                color="#0c192c"
                emissive="#38bdf8"
                emissiveIntensity={0.85}
                roughness={0.2}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        </group>

        {/* Compact Wolf-Eyed Bi-Functional Projector Headlamp Cowl & Smoked Flyscreen Visor */}
        <group position={[0, -0.055, 0.125]} rotation={[0.42, 0, 0]}>
          <mesh geometry={geos.headCowl} castShadow>
            <meshPhysicalMaterial
              color="#212632"
              metalness={0.76}
              roughness={0.24}
              clearcoat={0.82}
              clearcoatRoughness={0.14}
            />
          </mesh>

          {/* Recessed Dark Projector Bezel */}
          <mesh position={[0, -0.012, 0.108]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.048, 0.044, 0.026, 22]} />
            <meshStandardMaterial color="#12141a" metalness={0.65} roughness={0.35} />
          </mesh>

          {/* Convex Bi-Functional LED Projector Eye */}
          <mesh geometry={geos.projectorLens} position={[0, -0.012, 0.112]}>
            <meshStandardMaterial
              color="#ffffff"
              emissive="#fff3cf"
              emissiveIntensity={2.9}
              roughness={0.1}
            />
          </mesh>

          {/* Twin Wolf-Eye LED DRL Eyebrows */}
          <mesh geometry={geos.wolfEyeDrl} position={[0, 0.004, 0.105]} rotation={[0, 0.28, 0]}>
            <meshStandardMaterial
              color="#fffbeb"
              emissive="#fde68a"
              emissiveIntensity={2.5}
            />
          </mesh>
          <mesh
            geometry={geos.wolfEyeDrl}
            position={[0, 0.004, 0.105]}
            rotation={[0, -0.28, 0]}
            scale={[-1, 1, 1]}
          >
            <meshStandardMaterial
              color="#fffbeb"
              emissive="#fde68a"
              emissiveIntensity={2.5}
            />
          </mesh>

          {/* Small Smoked Flyscreen Visor */}
          <mesh
            geometry={geos.flyscreenVisor}
            position={[0, 0.078, 0.032]}
            rotation={[-0.58, 0, 0]}
          >
            <meshPhysicalMaterial
              color="#0d121a"
              metalness={0.18}
              roughness={0.08}
              clearcoat={1.0}
              clearcoatRoughness={0.05}
              transparent
              opacity={0.78}
            />
          </mesh>

          {/* Subtle Volumetric Headlight Beam Cone with soft Fresnel + axial fade */}
          <mesh position={[0, -0.24, 3.35]} rotation={[-Math.PI / 2 - 0.075, 0, 0]}>
            <coneGeometry args={[1.35, 6.4, 32, 1, true]} />
            <shaderMaterial
              vertexShader={BEAM_VERTEX_SHADER}
              fragmentShader={BEAM_FRAGMENT_SHADER}
              uniforms={beamUniforms}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Warm SpotLight casting beam onto the asphalt ahead */}
          <spotLight
            position={[0, 0.02, 0.16]}
            target={headlightTarget}
            angle={0.48}
            penumbra={0.68}
            intensity={9.5}
            distance={26}
            decay={1.6}
            color="#ffe0a6"
          />
        </group>
      </group>
    </group>
  );
}

export function Motorcycle({ modelUrl, wheelNodeNames, telemetryRef }: MotorcycleProps) {
  const bikeGroupRef = useRef<THREE.Group>(null);
  const leanGroupRef = useRef<THREE.Group>(null);
  const frontWheelRef = useRef<THREE.Group | null>(null);
  const rearWheelRef = useRef<THREE.Group | null>(null);
  const tailGlowRef = useRef<THREE.MeshStandardMaterial | null>(null);

  const wheelAngleRef = useRef(0);
  const headlightTarget = useMemo(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, -0.45, 11.5);
    return obj;
  }, []);

  const basisMatrix = useMemo(() => new THREE.Matrix4(), []);
  const worldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const leftVec = useMemo(() => new THREE.Vector3(), []);
  const upVec = useMemo(() => new THREE.Vector3(), []);
  const forwardVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const tState = telemetryRef.current;
    if (!bikeGroupRef.current || !leanGroupRef.current) return;

    // 1. Align bike root to highway spline tangent & world position
    bikeGroupRef.current.position.copy(tState.position);

    forwardVec.copy(tState.tangent).normalize();
    leftVec.crossVectors(worldUp, forwardVec).normalize();
    upVec.crossVectors(forwardVec, leftVec).normalize();
    basisMatrix.makeBasis(leftVec, upVec, forwardVec);
    bikeGroupRef.current.quaternion.setFromRotationMatrix(basisMatrix);

    // Apply extra overlook park yaw angle cleanly around local Y
    if (Math.abs(tState.yawOffset) > 0.0001) {
      bikeGroupRef.current.rotateY(tState.yawOffset);
    }

    // 2. Apply realistic roll/banking into turns + pitch/brake dive + subtle engine vibration
    const vibrationY =
      tState.reducedMotion
        ? 0
        : Math.sin(clock.elapsedTime * (18 + tState.speedNormalized * 22)) *
          (0.0012 + tState.speedNormalized * 0.0022);

    leanGroupRef.current.position.y = vibrationY;
    leanGroupRef.current.rotation.z = tState.leanAngle;
    leanGroupRef.current.rotation.x = tState.pitchAngle;

    // 3. Synchronize wheel spin strictly to scroll travel displacement
    const angleDelta = tState.deltaDistance / WHEEL_RADIUS;
    wheelAngleRef.current += angleDelta;
    if (frontWheelRef.current) {
      frontWheelRef.current.rotation.x = wheelAngleRef.current;
    }
    if (rearWheelRef.current) {
      rearWheelRef.current.rotation.x = wheelAngleRef.current;
    }

    // 4. Brighten LED brake/tail light when decelerating into the Overlook
    if (tailGlowRef.current) {
      tailGlowRef.current.emissiveIntensity = tState.isBraking ? 4.8 : 2.2;
    }
  });

  const proceduralFallback = (
    <ProceduralPulsarN250
      frontWheelRef={frontWheelRef}
      rearWheelRef={rearWheelRef}
      tailGlowRef={tailGlowRef}
      headlightTarget={headlightTarget}
      telemetryRef={telemetryRef}
    />
  );

  return (
    <group ref={bikeGroupRef} name="hero-motorcycle">
      <primitive object={headlightTarget} />
      <group ref={leanGroupRef}>
        {modelUrl ? (
          <GlbFallbackBoundary fallback={proceduralFallback}>
            <Suspense fallback={proceduralFallback}>
              <CustomGlbMotorcycle
                modelUrl={modelUrl}
                wheelNodeNames={wheelNodeNames}
                frontWheelRef={frontWheelRef}
                rearWheelRef={rearWheelRef}
              />
            </Suspense>
          </GlbFallbackBoundary>
        ) : (
          proceduralFallback
        )}
      </group>
    </group>
  );
}
