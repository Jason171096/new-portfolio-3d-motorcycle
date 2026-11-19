import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PROJECT_WAYPOINTS } from '../data/waypoints';
import {
  OVERLOOK_CENTER,
  OVERLOOK_RADIUS,
  OVERLOOK_T,
  OVERLOOK_TANGENT,
  ROAD_HALF_WIDTH,
  ROAD_SAMPLES,
  ROAD_TOTAL_LENGTH,
  ROAD_WIDTH,
  SUN_DIRECTION,
  findNearestRoadSample,
  getRoadFrameAt,
  getTerrainHeight,
} from '../utils/roadSpline';
import { createAsphaltTextures } from '../utils/textures';

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSunDirection;
  varying vec3 vWorldDirection;

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float h = clamp(dir.y, -0.25, 1.0);

    vec3 nadirColor = vec3(0.11, 0.09, 0.12);
    vec3 horizonColor = vec3(0.99, 0.67, 0.38);
    vec3 midSkyColor = vec3(0.76, 0.42, 0.39);
    vec3 upperSkyColor = vec3(0.24, 0.27, 0.44);
    vec3 zenithColor = vec3(0.09, 0.13, 0.24);

    vec3 sky = mix(nadirColor, horizonColor, smoothstep(-0.12, 0.04, h));
    sky = mix(sky, midSkyColor, smoothstep(0.03, 0.22, h));
    sky = mix(sky, upperSkyColor, smoothstep(0.20, 0.50, h));
    sky = mix(sky, zenithColor, smoothstep(0.45, 0.92, h));

    // Sun glow + crisp golden-hour disc
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float wideHalo = pow(sunDot, 6.0) * 0.42;
    float tightHalo = pow(sunDot, 48.0) * 0.65;
    float sunDisc = smoothstep(0.9988, 0.9995, sunDot) * 2.2;

    vec3 sunTint = vec3(1.0, 0.84, 0.56);
    sky += sunTint * (wideHalo + tightHalo) + vec3(1.0, 0.95, 0.85) * sunDisc;

    // Subtle warm horizon haze band
    float horizonBand = exp(-abs(h) * 14.0) * 0.18;
    sky += vec3(1.0, 0.68, 0.38) * horizonBand;

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * Builds an extruded road ribbon BufferGeometry along ROAD_SAMPLES.
 */
function buildRoadRibbonGeometry(
  width: number,
  yOffset: number,
  uvTileY = 1,
): THREE.BufferGeometry {
  const count = ROAD_SAMPLES.length;
  const positions = new Float32Array(count * 2 * 3);
  const normals = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];

  const half = width * 0.5;

  for (let i = 0; i < count; i++) {
    const { point, right, up, t } = ROAD_SAMPLES[i];
    const lx = point.x - right.x * half;
    const ly = point.y - right.y * half + yOffset;
    const lz = point.z - right.z * half;

    const rx = point.x + right.x * half;
    const ry = point.y + right.y * half + yOffset;
    const rz = point.z + right.z * half;

    const base = i * 6;
    positions[base] = lx;
    positions[base + 1] = ly;
    positions[base + 2] = lz;
    positions[base + 3] = rx;
    positions[base + 4] = ry;
    positions[base + 5] = rz;

    normals[base] = up.x;
    normals[base + 1] = up.y;
    normals[base + 2] = up.z;
    normals[base + 3] = up.x;
    normals[base + 4] = up.y;
    normals[base + 5] = up.z;

    const uvBase = i * 4;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = t * uvTileY;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = t * uvTileY;

    if (i < count - 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a continuous vertical W-beam guardrail ribbon offset from road center.
 */
function buildGuardrailRibbon(
  side: -1 | 1,
  lateralDist: number,
  tStart: number,
  tEnd: number,
  segments: number,
): THREE.BufferGeometry {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const t = THREE.MathUtils.lerp(tStart, tEnd, u);
    const { point, right } = getRoadFrameAt(t);
    const cx = point.x + right.x * lateralDist * side;
    const cy = point.y;
    const cz = point.z + right.z * lateralDist * side;

    const base = i * 6;
    // Bottom edge of W-beam
    positions[base] = cx;
    positions[base + 1] = cy + 0.42;
    positions[base + 2] = cz;
    // Top edge of W-beam
    positions[base + 3] = cx;
    positions[base + 4] = cy + 0.78;
    positions[base + 5] = cz;

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds vertex-colored rolling countryside terrain geometry cleanly carved for the road.
 */
function buildTerrainGeometry(): THREE.BufferGeometry {
  const widthX = 360;
  const minZ = -630;
  const maxZ = 65;
  const depthZ = maxZ - minZ;
  const segX = 180;
  const segZ = 220;

  const geo = new THREE.PlaneGeometry(widthX, depthZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-6, 0, (minZ + maxZ) * 0.5);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const grassOlive = new THREE.Color('#5b733c');
  const goldenMeadow = new THREE.Color('#a48c46');
  const deepPine = new THREE.Color('#32442c');
  const shoulderEarth = new THREE.Color('#64543e');
  const duskRidge = new THREE.Color('#404148');
  const tmpColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getTerrainHeight(x, z);
    pos.setY(i, y);

    const { sample, distSq } = findNearestRoadSample(x, z);
    const dist = Math.sqrt(distSq);
    const relElev = y - sample.point.y;

    const sunPatch =
      0.5 + 0.5 * Math.sin(x * 0.045 + z * 0.03) * Math.cos(x * 0.02 - z * 0.04);

    tmpColor.copy(grassOlive).lerp(goldenMeadow, sunPatch * 0.72);
    if (relElev < 0.5) {
      tmpColor.lerp(deepPine, 0.38);
    }
    if (dist < ROAD_HALF_WIDTH + 6.5) {
      const shoulderFactor = 1 - THREE.MathUtils.clamp((dist - ROAD_HALF_WIDTH) / 6.5, 0, 1);
      tmpColor.lerp(shoulderEarth, shoulderFactor * 0.78);
    }
    if (dist > 75 || z < -515) {
      const ridgeBlend = THREE.MathUtils.clamp((Math.max(dist - 75, -515 - z)) / 65, 0, 0.75);
      tmpColor.lerp(duskRidge, ridgeBlend);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds distant stylized mountain silhouette rings framing the sunset horizon.
 */
function buildMountainRidgeGeometry(): THREE.BufferGeometry {
  const ridgeArcCount = 130;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const layers = [
    { radius: 340, baseY: -12, peakAmp: 62, zCenter: -340, color: new THREE.Color('#3b3344') },
    { radius: 440, baseY: -16, peakAmp: 95, zCenter: -390, color: new THREE.Color('#2c283b') },
  ];

  let vertexOffset = 0;

  layers.forEach((layer, layerIdx) => {
    for (let i = 0; i <= ridgeArcCount; i++) {
      // Semicircle sweeping behind the sunset overlook and along the side horizons
      const angle = THREE.MathUtils.lerp(-Math.PI * 0.96, -Math.PI * 0.04, i / ridgeArcCount);
      const x = Math.cos(angle) * layer.radius;
      const z = layer.zCenter + Math.sin(angle) * layer.radius * 0.85;

      const harmonic =
        Math.abs(Math.sin(i * 0.24 + layerIdx * 1.7)) * 0.55 +
        Math.abs(Math.cos(i * 0.53 + layerIdx * 0.9)) * 0.3 +
        Math.abs(Math.sin(i * 1.15)) * 0.15;

      const peakY = layer.baseY + harmonic * layer.peakAmp;

      // Bottom vertex & crest vertex
      positions.push(x, layer.baseY - 35, z);
      positions.push(x, peakY, z);

      colors.push(layer.color.r * 0.7, layer.color.g * 0.7, layer.color.b * 0.85);
      colors.push(
        Math.min(1, layer.color.r * 1.35 + 0.1),
        Math.min(1, layer.color.g * 1.15 + 0.06),
        layer.color.b * 1.05,
      );

      if (i < ridgeArcCount) {
        const a = vertexOffset + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
    vertexOffset += (ridgeArcCount + 1) * 2;
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  tone: number;
}

export function RoadAndTerrain() {
  const skyUniforms = useMemo(
    () => ({
      uSunDirection: { value: SUN_DIRECTION.clone() },
    }),
    [],
  );

  const asphaltTextures = useMemo(() => createAsphaltTextures(), []);
  const terrainGeo = useMemo(() => buildTerrainGeometry(), []);
  const mountainGeo = useMemo(() => buildMountainRidgeGeometry(), []);

  const roadGeo = useMemo(() => buildRoadRibbonGeometry(ROAD_WIDTH, 0.02, 1), []);
  const shoulderGeo = useMemo(() => buildRoadRibbonGeometry(ROAD_WIDTH + 3.1, -0.025, 1), []);
  const leftFogLineGeo = useMemo(() => {
    const count = ROAD_SAMPLES.length;
    const geo = buildRoadRibbonGeometry(0.14, 0.035, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const offset = -(ROAD_HALF_WIDTH - 0.36);
    for (let i = 0; i < count; i++) {
      const { right } = ROAD_SAMPLES[i];
      pos.setX(i * 2, pos.getX(i * 2) + right.x * offset);
      pos.setZ(i * 2, pos.getZ(i * 2) + right.z * offset);
      pos.setX(i * 2 + 1, pos.getX(i * 2 + 1) + right.x * offset);
      pos.setZ(i * 2 + 1, pos.getZ(i * 2 + 1) + right.z * offset);
    }
    pos.needsUpdate = true;
    return geo;
  }, []);

  const rightFogLineGeo = useMemo(() => {
    const count = ROAD_SAMPLES.length;
    const geo = buildRoadRibbonGeometry(0.14, 0.035, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const offset = ROAD_HALF_WIDTH - 0.36;
    for (let i = 0; i < count; i++) {
      const { right } = ROAD_SAMPLES[i];
      pos.setX(i * 2, pos.getX(i * 2) + right.x * offset);
      pos.setZ(i * 2, pos.getZ(i * 2) + right.z * offset);
      pos.setX(i * 2 + 1, pos.getX(i * 2 + 1) + right.x * offset);
      pos.setZ(i * 2 + 1, pos.getZ(i * 2 + 1) + right.z * offset);
    }
    pos.needsUpdate = true;
    return geo;
  }, []);

  const guardrailSpans = useMemo(
    () => [
      { side: 1 as const, geo: buildGuardrailRibbon(1, ROAD_HALF_WIDTH + 0.85, 0.12, 0.28, 70), tStart: 0.12, tEnd: 0.28 },
      { side: -1 as const, geo: buildGuardrailRibbon(-1, ROAD_HALF_WIDTH + 0.85, 0.25, 0.54, 95), tStart: 0.25, tEnd: 0.54 },
      { side: 1 as const, geo: buildGuardrailRibbon(1, ROAD_HALF_WIDTH + 0.85, 0.44, 0.77, 105), tStart: 0.44, tEnd: 0.77 },
      { side: -1 as const, geo: buildGuardrailRibbon(-1, ROAD_HALF_WIDTH + 0.85, 0.69, 0.91, 80), tStart: 0.69, tEnd: 0.91 },
    ],
    [],
  );

  // Dashed center highway stripes
  const dashCount = Math.floor(ROAD_TOTAL_LENGTH / 7.2);
  const dashRef = useRef<THREE.InstancedMesh>(null);

  // Guardrail posts & glowing amber delineators
  const guardrailPostData = useMemo(() => {
    const items: { pos: THREE.Vector3; rotY: number }[] = [];
    guardrailSpans.forEach((span) => {
      const spanLen = (span.tEnd - span.tStart) * ROAD_TOTAL_LENGTH;
      const steps = Math.max(4, Math.floor(spanLen / 3.5));
      for (let i = 0; i <= steps; i++) {
        const t = THREE.MathUtils.lerp(span.tStart, span.tEnd, i / steps);
        const { point, right, tangent } = getRoadFrameAt(t);
        const lateral = (ROAD_HALF_WIDTH + 0.85) * span.side;
        items.push({
          pos: new THREE.Vector3(
            point.x + right.x * lateral,
            point.y + 0.41,
            point.z + right.z * lateral,
          ),
          rotY: Math.atan2(tangent.x, tangent.z),
        });
      }
    });
    return items;
  }, [guardrailSpans]);

  const guardrailPostRef = useRef<THREE.InstancedMesh>(null);
  const delineatorRef = useRef<THREE.InstancedMesh>(null);

  // Precompute billboard exclusion anchors so no vegetation blocks project frames
  const billboardExclusionZones = useMemo(() => {
    return PROJECT_WAYPOINTS.map((wp) => {
      const frame = getRoadFrameAt(wp.anchorT);
      const sideSign = wp.side === 'left' ? -1 : 1;
      const lateral = (wp.lateralOffset ?? 9.8) * sideSign;
      const bx = frame.point.x + frame.right.x * lateral;
      const bz = frame.point.z + frame.right.z * lateral;
      // Approach sightline midpoint ~20 units prior along road
      const approachFrame = getRoadFrameAt(Math.max(0, wp.anchorT - 0.04));
      return { bx, bz, ax: approachFrame.point.x, az: approachFrame.point.z };
    });
  }, []);

  // Deterministic procedural placement for Pines, Oaks, Boulders, and Grass Tufts
  const { pines, oaks, boulders, grassTufts } = useMemo(() => {
    let seed = 4099;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const isClearOfStructures = (x: number, z: number, minRoadDist: number): boolean => {
      const { distSq } = findNearestRoadSample(x, z);
      if (Math.sqrt(distSq) < minRoadDist) return false;

      if (Math.hypot(x - OVERLOOK_CENTER.x, z - OVERLOOK_CENTER.z) < OVERLOOK_RADIUS + 4.5) {
        return false;
      }

      for (const zone of billboardExclusionZones) {
        if (Math.hypot(x - zone.bx, z - zone.bz) < 15.0) return false;
        // Keep sightline triangle between approaching lane and billboard clear
        const midX = (zone.bx + zone.ax) * 0.5;
        const midZ = (zone.bz + zone.az) * 0.5;
        if (Math.hypot(x - midX, z - midZ) < 13.5) return false;
      }
      return true;
    };

    const pineList: TreePlacement[] = [];
    const oakList: TreePlacement[] = [];
    const boulderList: TreePlacement[] = [];
    const grassList: TreePlacement[] = [];

    // Sample candidate spots along the corridor for natural countryside density
    let attempts = 0;
    while (pineList.length < 320 && attempts < 2600) {
      attempts++;
      const t = rand() * 0.95;
      const { point, right } = getRoadFrameAt(t);
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = 13.5 + Math.pow(rand(), 1.25) * 95;
      const x = point.x + right.x * lateral * side + (rand() - 0.5) * 8;
      const z = point.z + right.z * lateral * side + (rand() - 0.5) * 8;

      if (!isClearOfStructures(x, z, ROAD_HALF_WIDTH + 8.5)) continue;
      const y = getTerrainHeight(x, z);
      pineList.push({
        x,
        y,
        z,
        scale: 0.78 + rand() * 0.82,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    attempts = 0;
    while (oakList.length < 155 && attempts < 1800) {
      attempts++;
      const t = rand() * 0.92;
      const { point, right } = getRoadFrameAt(t);
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = 13.0 + Math.pow(rand(), 1.4) * 72;
      const x = point.x + right.x * lateral * side + (rand() - 0.5) * 6;
      const z = point.z + right.z * lateral * side + (rand() - 0.5) * 6;

      if (!isClearOfStructures(x, z, ROAD_HALF_WIDTH + 8.2)) continue;
      const y = getTerrainHeight(x, z);
      oakList.push({
        x,
        y,
        z,
        scale: 0.75 + rand() * 0.7,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    attempts = 0;
    while (boulderList.length < 160 && attempts < 1400) {
      attempts++;
      const t = 0.04 + rand() * 0.94;
      const { point, right } = getRoadFrameAt(t);
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = ROAD_HALF_WIDTH + 3.2 + rand() * 26;
      const x = point.x + right.x * lateral * side;
      const z = point.z + right.z * lateral * side;
      if (!isClearOfStructures(x, z, ROAD_HALF_WIDTH + 2.8)) continue;
      boulderList.push({
        x,
        y: getTerrainHeight(x, z) - 0.12,
        z,
        scale: 0.45 + rand() * 1.1,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    attempts = 0;
    while (grassList.length < 440 && attempts < 2200) {
      attempts++;
      const t = 0.02 + rand() * 0.93;
      const { point, right } = getRoadFrameAt(t);
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = ROAD_HALF_WIDTH + 2.0 + rand() * 18;
      const x = point.x + right.x * lateral * side + (rand() - 0.5) * 2;
      const z = point.z + right.z * lateral * side + (rand() - 0.5) * 2;
      if (!isClearOfStructures(x, z, ROAD_HALF_WIDTH + 1.8)) continue;
      grassList.push({
        x,
        y: getTerrainHeight(x, z),
        z,
        scale: 0.65 + rand() * 0.85,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    return { pines: pineList, oaks: oakList, boulders: boulderList, grassTufts: grassList };
  }, [billboardExclusionZones]);

  // Instanced refs for Pines, Oaks, Boulders, Grass
  const pineTrunkRef = useRef<THREE.InstancedMesh>(null);
  const pineLowRef = useRef<THREE.InstancedMesh>(null);
  const pineMidRef = useRef<THREE.InstancedMesh>(null);
  const pineTopRef = useRef<THREE.InstancedMesh>(null);

  const oakTrunkRef = useRef<THREE.InstancedMesh>(null);
  const oakCanopyMainRef = useRef<THREE.InstancedMesh>(null);
  const oakCanopySubRef = useRef<THREE.InstancedMesh>(null);

  const boulderRef = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);

  // Populate static InstancedMeshes once
  useEffect(() => {
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();

    // 1. Dashed center markings
    if (dashRef.current) {
      const lookTarget = new THREE.Vector3();
      for (let i = 0; i < dashCount; i++) {
        const t = (i + 0.5) / dashCount;
        if (t > OVERLOOK_T - 0.015) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          dashRef.current.setMatrixAt(i, dummy.matrix);
          continue;
        }
        const { point, tangent } = getRoadFrameAt(t);
        dummy.position.set(point.x, point.y + 0.036, point.z);
        lookTarget.copy(point).add(tangent);
        dummy.lookAt(lookTarget.x, lookTarget.y + 0.036, lookTarget.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashRef.current.setMatrixAt(i, dummy.matrix);
      }
      dashRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. Guardrail posts + reflective amber tabs
    if (guardrailPostRef.current && delineatorRef.current) {
      guardrailPostData.forEach((item, i) => {
        dummy.position.copy(item.pos);
        dummy.rotation.set(0, item.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        guardrailPostRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(item.pos.x, item.pos.y + 0.25, item.pos.z);
        dummy.updateMatrix();
        delineatorRef.current!.setMatrixAt(i, dummy.matrix);
      });
      guardrailPostRef.current.instanceMatrix.needsUpdate = true;
      delineatorRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. Pine trees
    if (pineTrunkRef.current && pineLowRef.current && pineMidRef.current && pineTopRef.current) {
      pines.forEach((tree, i) => {
        const s = tree.scale;
        dummy.rotation.set(0, tree.rotY, 0);

        dummy.position.set(tree.x, tree.y + 1.45 * s, tree.z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        pineTrunkRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 3.4 * s, tree.z);
        dummy.updateMatrix();
        pineLowRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 5.1 * s, tree.z);
        dummy.updateMatrix();
        pineMidRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 6.6 * s, tree.z);
        dummy.updateMatrix();
        pineTopRef.current!.setMatrixAt(i, dummy.matrix);

        c.set('#284029').lerp(new THREE.Color('#475d31'), tree.tone);
        pineLowRef.current!.setColorAt(i, c);
        pineMidRef.current!.setColorAt(i, c.clone().offsetHSL(0.01, 0.04, 0.04));
        pineTopRef.current!.setColorAt(i, c.clone().offsetHSL(0.02, 0.05, 0.07));
      });
      [pineTrunkRef, pineLowRef, pineMidRef, pineTopRef].forEach((ref) => {
        if (ref.current) {
          ref.current.instanceMatrix.needsUpdate = true;
          if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
        }
      });
    }

    // 4. Oak trees (golden-hour olive & amber foliage)
    if (oakTrunkRef.current && oakCanopyMainRef.current && oakCanopySubRef.current) {
      oaks.forEach((tree, i) => {
        const s = tree.scale;
        dummy.rotation.set(0, tree.rotY, 0);

        dummy.position.set(tree.x, tree.y + 1.3 * s, tree.z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        oakTrunkRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 3.7 * s, tree.z);
        dummy.scale.set(s * 1.15, s * 0.92, s * 1.1);
        dummy.updateMatrix();
        oakCanopyMainRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(
          tree.x + Math.cos(tree.rotY) * 1.05 * s,
          tree.y + 3.25 * s,
          tree.z + Math.sin(tree.rotY) * 1.05 * s,
        );
        dummy.scale.set(s * 0.8, s * 0.72, s * 0.8);
        dummy.updateMatrix();
        oakCanopySubRef.current!.setMatrixAt(i, dummy.matrix);

        c.set('#5e6b32').lerp(new THREE.Color('#9a7736'), tree.tone);
        oakCanopyMainRef.current!.setColorAt(i, c);
        oakCanopySubRef.current!.setColorAt(i, c.clone().offsetHSL(-0.02, 0.05, 0.05));
      });
      [oakTrunkRef, oakCanopyMainRef, oakCanopySubRef].forEach((ref) => {
        if (ref.current) {
          ref.current.instanceMatrix.needsUpdate = true;
          if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
        }
      });
    }

    // 5. Roadside boulders
    if (boulderRef.current) {
      boulders.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(b.tone * 0.6, b.rotY, b.tone * 0.4);
        dummy.scale.set(b.scale * 1.25, b.scale * 0.72, b.scale);
        dummy.updateMatrix();
        boulderRef.current!.setMatrixAt(i, dummy.matrix);
        c.set('#5a554e').lerp(new THREE.Color('#746a5c'), b.tone);
        boulderRef.current!.setColorAt(i, c);
      });
      boulderRef.current.instanceMatrix.needsUpdate = true;
      if (boulderRef.current.instanceColor) boulderRef.current.instanceColor.needsUpdate = true;
    }

    // 6. Low organic roadside shrubs / meadow tufts
    if (grassRef.current) {
      grassTufts.forEach((g, i) => {
        dummy.position.set(g.x, g.y + 0.14 * g.scale, g.z);
        dummy.rotation.set(0, g.rotY, 0);
        dummy.scale.set(g.scale * 1.15, g.scale * 0.48, g.scale * 1.05);
        dummy.updateMatrix();
        grassRef.current!.setMatrixAt(i, dummy.matrix);
        c.set('#556b38').lerp(new THREE.Color('#86793b'), g.tone);
        grassRef.current!.setColorAt(i, c);
      });
      grassRef.current.instanceMatrix.needsUpdate = true;
      if (grassRef.current.instanceColor) grassRef.current.instanceColor.needsUpdate = true;
    }
  }, [boulders, dashCount, grassTufts, guardrailPostData, oaks, pines]);

  const overlookYaw = useMemo(
    () => Math.atan2(OVERLOOK_TANGENT.x, OVERLOOK_TANGENT.z),
    [],
  );

  // Crescent perimeter bollards facing the sunset valley at the Destination Overlook
  const overlookBollards = useMemo(() => {
    const forward = OVERLOOK_TANGENT.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const posts: [number, number, number][] = [];
    const count = 13;
    for (let i = 0; i < count; i++) {
      const a = THREE.MathUtils.lerp(-Math.PI * 0.44, Math.PI * 0.44, i / (count - 1));
      const dir = forward
        .clone()
        .multiplyScalar(Math.cos(a))
        .add(right.clone().multiplyScalar(Math.sin(a)));
      const p = OVERLOOK_CENTER.clone().addScaledVector(dir, OVERLOOK_RADIUS - 1.3);
      posts.push([p.x, OVERLOOK_CENTER.y, p.z]);
    }
    return posts;
  }, []);

  return (
    <group name="countryside-environment">
      {/* Golden-hour atmospheric sky dome */}
      <mesh position={[0, 0, -240]} frustumCulled={false}>
        <sphereGeometry args={[920, 48, 32]} />
        <shaderMaterial
          vertexShader={SKY_VERTEX_SHADER}
          fragmentShader={SKY_FRAGMENT_SHADER}
          uniforms={skyUniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      {/* Rolling vertex-colored hills */}
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.02} />
      </mesh>

      {/* Distant sunset mountain silhouettes */}
      <mesh geometry={mountainGeo} frustumCulled={false}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>

      {/* Gravel shoulder bed */}
      <mesh geometry={shoulderGeo} receiveShadow>
        <meshStandardMaterial color="#584d41" roughness={0.96} metalness={0.04} />
      </mesh>

      {/* Asphalt highway surface */}
      <mesh geometry={roadGeo} receiveShadow>
        <meshStandardMaterial
          map={asphaltTextures.map}
          roughnessMap={asphaltTextures.roughnessMap}
          roughness={0.86}
          metalness={0.08}
        />
      </mesh>

      {/* White outer fog lines */}
      <mesh geometry={leftFogLineGeo}>
        <meshStandardMaterial color="#dcd9d0" roughness={0.7} />
      </mesh>
      <mesh geometry={rightFogLineGeo}>
        <meshStandardMaterial color="#dcd9d0" roughness={0.7} />
      </mesh>

      {/* Dashed amber center lane markings */}
      <instancedMesh ref={dashRef} args={[undefined, undefined, dashCount]} frustumCulled={false}>
        <boxGeometry args={[0.16, 0.015, 2.75]} />
        <meshStandardMaterial color="#eab308" emissive="#854d0e" emissiveIntensity={0.22} roughness={0.65} />
      </instancedMesh>

      {/* Reflective steel guardrails */}
      {guardrailSpans.map((span, idx) => (
        <mesh key={idx} geometry={span.geo} castShadow receiveShadow>
          <meshStandardMaterial
            color="#949aa4"
            metalness={0.72}
            roughness={0.34}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      <instancedMesh
        ref={guardrailPostRef}
        args={[undefined, undefined, guardrailPostData.length]}
        castShadow
        frustumCulled={false}
      >
        <boxGeometry args={[0.12, 0.82, 0.12]} />
        <meshStandardMaterial color="#575d68" metalness={0.68} roughness={0.42} />
      </instancedMesh>

      <instancedMesh
        ref={delineatorRef}
        args={[undefined, undefined, guardrailPostData.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.14, 0.09, 0.16]} />
        <meshStandardMaterial
          color="#fb923c"
          emissive="#f97316"
          emissiveIntensity={1.1}
          roughness={0.2}
        />
      </instancedMesh>

      {/* Destination Overlook Scenic Pull-Off Terrace */}
      <group position={[OVERLOOK_CENTER.x, OVERLOOK_CENTER.y, OVERLOOK_CENTER.z]}>
        {/* Paved overlook plaza seated flush under the level asphalt surface */}
        <mesh position={[0, -0.64, 0]} receiveShadow>
          <cylinderGeometry args={[OVERLOOK_RADIUS, OVERLOOK_RADIUS + 2.4, 1.28, 48]} />
          <meshStandardMaterial
            color="#2b2d34"
            roughness={0.85}
            metalness={0.1}
          />
        </mesh>
        {/* Architectural basalt trim ring */}
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <ringGeometry args={[OVERLOOK_RADIUS - 0.55, OVERLOOK_RADIUS, 48]} />
          <meshStandardMaterial color="#78716c" roughness={0.8} metalness={0.15} />
        </mesh>
        {/* Timber & steel architectural viewing bench */}
        <group position={[-6.5, 0.12, -5.5]} rotation={[0, overlookYaw + 0.5, 0]}>
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[2.6, 0.12, 0.72]} />
            <meshStandardMaterial color="#7c5338" roughness={0.75} />
          </mesh>
          <mesh position={[-1.0, 0.15, 0]} castShadow>
            <boxGeometry args={[0.14, 0.32, 0.62]} />
            <meshStandardMaterial color="#27272a" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[1.0, 0.15, 0]} castShadow>
            <boxGeometry args={[0.14, 0.32, 0.62]} />
            <meshStandardMaterial color="#27272a" metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
        {/* Warm golden sunset light bathing the overlook */}
        <pointLight position={[0, 3.8, -4]} color="#ffb35c" intensity={18} distance={34} decay={1.6} />
      </group>

      {/* Overlook rim architectural bollards */}
      {overlookBollards.map((pos, idx) => (
        <group key={idx} position={pos}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.11, 0.9, 10]} />
            <meshStandardMaterial color="#272932" metalness={0.65} roughness={0.38} />
          </mesh>
          <mesh position={[0, 0.86, 0]}>
            <cylinderGeometry args={[0.085, 0.085, 0.08, 10]} />
            <meshStandardMaterial
              color="#fed7aa"
              emissive="#fb923c"
              emissiveIntensity={1.4}
              roughness={0.2}
            />
          </mesh>
        </group>
      ))}

      {/* Instanced Pine Trees */}
      <instancedMesh ref={pineTrunkRef} args={[undefined, undefined, pines.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.16, 0.28, 2.9, 7]} />
        <meshStandardMaterial color="#4a3728" roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={pineLowRef} args={[undefined, undefined, pines.length]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[1.95, 3.1, 8]} />
        <meshStandardMaterial roughness={0.88} />
      </instancedMesh>
      <instancedMesh ref={pineMidRef} args={[undefined, undefined, pines.length]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[1.5, 2.65, 8]} />
        <meshStandardMaterial roughness={0.86} />
      </instancedMesh>
      <instancedMesh ref={pineTopRef} args={[undefined, undefined, pines.length]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[1.02, 2.2, 8]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>

      {/* Instanced Oak Trees */}
      <instancedMesh ref={oakTrunkRef} args={[undefined, undefined, oaks.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.2, 0.34, 2.6, 7]} />
        <meshStandardMaterial color="#4f3b2b" roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={oakCanopyMainRef} args={[undefined, undefined, oaks.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[1.85, 1]} />
        <meshStandardMaterial roughness={0.86} />
      </instancedMesh>
      <instancedMesh ref={oakCanopySubRef} args={[undefined, undefined, oaks.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[1.4, 1]} />
        <meshStandardMaterial roughness={0.88} />
      </instancedMesh>

      {/* Instanced Roadside Boulders */}
      <instancedMesh ref={boulderRef} args={[undefined, undefined, boulders.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial roughness={0.92} />
      </instancedMesh>

      {/* Instanced Low Countryside Shrubs & Meadow Tufts */}
      <instancedMesh ref={grassRef} args={[undefined, undefined, grassTufts.length]} frustumCulled={false}>
        <dodecahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial roughness={0.92} />
      </instancedMesh>
    </group>
  );
}
