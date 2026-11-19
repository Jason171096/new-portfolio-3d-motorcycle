import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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

/**
 * Detailed 17-inch multi-spoke sport motorcycle wheel with brake rotor & grooved tire.
 */
function SportWheel({
  width = 0.14,
  isRear = false,
}: {
  width?: number;
  isRear?: boolean;
}) {
  const spokeAngles = [0, 1, 2, 3, 4].map((i) => (i * Math.PI * 2) / 5);

  return (
    <group>
      {/* Tire profile */}
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <torusGeometry args={[WHEEL_RADIUS - 0.068, 0.068, 16, 36]} />
        <meshStandardMaterial color="#17191e" roughness={0.86} metalness={0.08} />
      </mesh>

      {/* Outer rim barrel */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[WHEEL_RADIUS - 0.112, WHEEL_RADIUS - 0.112, width * 0.85, 28, 1, true]} />
        <meshStandardMaterial color="#20242c" metalness={0.78} roughness={0.32} side={THREE.DoubleSide} />
      </mesh>

      {/* Subtle crimson/amber rim stripe */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[width * 0.36, 0, 0]}>
        <ringGeometry args={[WHEEL_RADIUS - 0.118, WHEEL_RADIUS - 0.108, 32]} />
        <meshStandardMaterial color="#dc2626" emissive="#991b1b" emissiveIntensity={0.45} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-width * 0.36, 0, 0]}>
        <ringGeometry args={[WHEEL_RADIUS - 0.118, WHEEL_RADIUS - 0.108, 32]} />
        <meshStandardMaterial color="#dc2626" emissive="#991b1b" emissiveIntensity={0.45} side={THREE.DoubleSide} />
      </mesh>

      {/* Center hub */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, width * 0.92, 16]} />
        <meshStandardMaterial color="#2b303a" metalness={0.82} roughness={0.28} />
      </mesh>

      {/* Twin-split 5 Y-spokes */}
      {spokeAngles.map((angle, idx) => (
        <group key={idx} rotation={[angle, 0, 0]}>
          <mesh position={[0, 0.102, 0.015]} rotation={[0.16, 0, 0]} castShadow>
            <boxGeometry args={[0.022, 0.195, 0.018]} />
            <meshStandardMaterial color="#262b35" metalness={0.78} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.102, -0.015]} rotation={[-0.16, 0, 0]} castShadow>
            <boxGeometry args={[0.022, 0.195, 0.018]} />
            <meshStandardMaterial color="#262b35" metalness={0.78} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Steel brake disc rotor */}
      <mesh
        rotation={[0, 0, Math.PI / 2]}
        position={[isRear ? -width * 0.56 : width * 0.58, 0, 0]}
      >
        <cylinderGeometry args={[isRear ? 0.13 : 0.165, isRear ? 0.13 : 0.165, 0.01, 24]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.88} roughness={0.22} />
      </mesh>
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
 * Procedural Bajaj Pulsar N250-inspired naked streetfighter geometry.
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

  return (
    <group>
      {/* Rear Wheel */}
      <group
        ref={(el) => {
          rearWheelRef.current = el;
        }}
        position={[0, WHEEL_RADIUS, -0.68]}
      >
        <SportWheel width={0.16} isRear />
      </group>

      {/* Front Wheel */}
      <group
        ref={(el) => {
          frontWheelRef.current = el;
        }}
        position={[0, WHEEL_RADIUS, 0.72]}
      >
        <SportWheel width={0.125} />
      </group>

      {/* Rear Tire Hugger & Swingarm */}
      <mesh position={[0, 0.34, -0.44]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.21, 0.055, 0.56]} />
        <meshStandardMaterial color="#262a33" metalness={0.65} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.58, -0.76]} rotation={[-0.65, 0, 0]} castShadow>
        <boxGeometry args={[0.19, 0.03, 0.28]} />
        <meshStandardMaterial color="#181a20" roughness={0.7} />
      </mesh>

      {/* Tubular Engine Cradle & Ribbed Crankcase */}
      <group position={[0, 0.42, 0.04]}>
        <mesh castShadow>
          <boxGeometry args={[0.27, 0.32, 0.42]} />
          <meshStandardMaterial color="#20242b" metalness={0.68} roughness={0.44} />
        </mesh>
        {/* Signature Pulsar bronze-gold clutch cover */}
        <mesh position={[-0.145, -0.04, -0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.095, 0.095, 0.04, 18]} />
          <meshStandardMaterial color="#8f6c43" metalness={0.78} roughness={0.32} />
        </mesh>
        <mesh position={[0.142, -0.04, 0.01]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.035, 16]} />
          <meshStandardMaterial color="#7b5e3b" metalness={0.78} roughness={0.34} />
        </mesh>
        {/* Underbelly spoiler / cowl */}
        <mesh position={[0, -0.17, 0.09]} rotation={[0.24, 0, 0]} castShadow>
          <boxGeometry args={[0.24, 0.11, 0.38]} />
          <meshStandardMaterial color="#17191f" metalness={0.45} roughness={0.42} />
        </mesh>
      </group>

      {/* Upswept Stubby Exhaust Muffler (right side: -X) */}
      <group position={[-0.17, 0.36, -0.34]} rotation={[-0.22, -0.08, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.056, 0.044, 0.5, 14]} />
          <meshStandardMaterial color="#1b1d22" metalness={0.62} roughness={0.38} />
        </mesh>
        {/* Brushed aluminum heat shield */}
        <mesh position={[-0.035, 0.01, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.036, 0.036, 0.28, 10, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#a1a7b3" metalness={0.85} roughness={0.25} />
        </mesh>
      </group>

      {/* Main Perimeter Frame Spars */}
      <mesh position={[0.13, 0.64, 0.08]} rotation={[-0.28, 0, 0]} castShadow>
        <boxGeometry args={[0.032, 0.055, 0.68]} />
        <meshStandardMaterial color="#2a2e38" metalness={0.72} roughness={0.32} />
      </mesh>
      <mesh position={[-0.13, 0.64, 0.08]} rotation={[-0.28, 0, 0]} castShadow>
        <boxGeometry args={[0.032, 0.055, 0.68]} />
        <meshStandardMaterial color="#2a2e38" metalness={0.72} roughness={0.32} />
      </mesh>

      {/* Sculpted Metallic Charcoal Fuel Tank & Forward N250 Shrouds */}
      <group position={[0, 0.84, 0.15]}>
        {/* Upper tank shell */}
        <mesh rotation={[0.12, 0, 0]} scale={[1.0, 0.72, 1.38]} castShadow>
          <sphereGeometry args={[0.195, 20, 16]} />
          <meshStandardMaterial color="#1c2028" metalness={0.82} roughness={0.22} />
        </mesh>
        {/* Center matte tank spine pad */}
        <mesh position={[0, 0.12, -0.03]} rotation={[0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.09, 0.035, 0.36]} />
          <meshStandardMaterial color="#121419" roughness={0.75} />
        </mesh>
        {/* Angular left & right tank shrouds */}
        <mesh position={[0.155, -0.055, 0.14]} rotation={[0.35, -0.22, -0.18]} castShadow>
          <boxGeometry args={[0.055, 0.22, 0.34]} />
          <meshStandardMaterial color="#292e39" metalness={0.76} roughness={0.28} />
        </mesh>
        <mesh position={[-0.155, -0.055, 0.14]} rotation={[0.35, 0.22, 0.18]} castShadow>
          <boxGeometry args={[0.055, 0.22, 0.34]} />
          <meshStandardMaterial color="#292e39" metalness={0.76} roughness={0.28} />
        </mesh>
        {/* Crimson streetfighter shroud accent stripes */}
        <mesh position={[0.184, -0.04, 0.15]} rotation={[0.35, -0.22, -0.18]}>
          <boxGeometry args={[0.01, 0.032, 0.26]} />
          <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.45} />
        </mesh>
        <mesh position={[-0.184, -0.04, 0.15]} rotation={[0.35, 0.22, 0.18]}>
          <boxGeometry args={[0.01, 0.032, 0.26]} />
          <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.45} />
        </mesh>
      </group>

      {/* Split Rider + Pillion Seat & Upswept Tail Section */}
      <group position={[0, 0.77, -0.34]}>
        {/* Rider seat */}
        <mesh position={[0, -0.02, 0.08]} rotation={[-0.08, 0, 0]} castShadow>
          <boxGeometry args={[0.25, 0.075, 0.34]} />
          <meshStandardMaterial color="#15171c" roughness={0.85} />
        </mesh>
        {/* Stepped pillion seat */}
        <mesh position={[0, 0.075, -0.22]} rotation={[-0.2, 0, 0]} castShadow>
          <boxGeometry args={[0.2, 0.07, 0.26]} />
          <meshStandardMaterial color="#181b21" roughness={0.82} />
        </mesh>
        {/* Sharp side tail cowls */}
        <mesh position={[0.105, 0.035, -0.2]} rotation={[-0.24, -0.14, 0]} castShadow>
          <boxGeometry args={[0.05, 0.11, 0.44]} />
          <meshStandardMaterial color="#232832" metalness={0.72} roughness={0.28} />
        </mesh>
        <mesh position={[-0.105, 0.035, -0.2]} rotation={[-0.24, 0.14, 0]} castShadow>
          <boxGeometry args={[0.05, 0.11, 0.44]} />
          <meshStandardMaterial color="#232832" metalness={0.72} roughness={0.28} />
        </mesh>
        {/* Split-ruby Pulsar signature LED tail light */}
        <mesh position={[0.045, 0.055, -0.435]} rotation={[-0.35, 0, -0.12]}>
          <boxGeometry args={[0.048, 0.035, 0.03]} />
          <meshStandardMaterial
            ref={(mat) => {
              tailGlowRef.current = mat;
            }}
            color="#ff3b3b"
            emissive="#ef4444"
            emissiveIntensity={2.2}
          />
        </mesh>
        <mesh position={[-0.045, 0.055, -0.435]} rotation={[-0.35, 0, 0.12]}>
          <boxGeometry args={[0.048, 0.035, 0.03]} />
          <meshStandardMaterial
            color="#ff3b3b"
            emissive="#ef4444"
            emissiveIntensity={2.2}
          />
        </mesh>
        {/* Rear license plate tail tidy */}
        <mesh position={[0, -0.09, -0.48]} rotation={[-0.58, 0, 0]} castShadow>
          <boxGeometry args={[0.13, 0.17, 0.015]} />
          <meshStandardMaterial color="#1e222a" roughness={0.6} />
        </mesh>
      </group>

      {/* Front Telescopic Forks, Fender & Streetfighter Steering Assembly */}
      <group position={[0, 0.72, 0.48]} rotation={[-0.38, 0, 0]}>
        {/* Left & Right fork tubes */}
        <mesh position={[0.105, -0.05, 0]} castShadow>
          <cylinderGeometry args={[0.024, 0.022, 0.78, 12]} />
          <meshStandardMaterial color="#373c47" metalness={0.84} roughness={0.22} />
        </mesh>
        <mesh position={[-0.105, -0.05, 0]} castShadow>
          <cylinderGeometry args={[0.024, 0.022, 0.78, 12]} />
          <meshStandardMaterial color="#373c47" metalness={0.84} roughness={0.22} />
        </mesh>
        {/* Anodized lower sliders */}
        <mesh position={[0.105, -0.26, 0]}>
          <cylinderGeometry args={[0.029, 0.029, 0.34, 12]} />
          <meshStandardMaterial color="#191b20" metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[-0.105, -0.26, 0]}>
          <cylinderGeometry args={[0.029, 0.029, 0.34, 12]} />
          <meshStandardMaterial color="#191b20" metalness={0.65} roughness={0.35} />
        </mesh>

        {/* Front Fender */}
        <mesh position={[0, -0.21, 0.08]} rotation={[0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.15, 0.035, 0.34]} />
          <meshStandardMaterial color="#1e222a" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Streetfighter Handlebars & Instrument Pod */}
        <group position={[0, 0.31, -0.02]} rotation={[0.38, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, 0.72, 12]} />
            <meshStandardMaterial color="#272a32" metalness={0.8} roughness={0.28} />
          </mesh>
          {/* Left/Right Grips */}
          <mesh position={[0.31, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.021, 0.021, 0.14, 10]} />
            <meshStandardMaterial color="#111216" roughness={0.9} />
          </mesh>
          <mesh position={[-0.31, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.021, 0.021, 0.14, 10]} />
            <meshStandardMaterial color="#111216" roughness={0.9} />
          </mesh>
          {/* Angled Rear-View Mirrors */}
          <mesh position={[0.25, 0.075, 0.03]} rotation={[0, 0, -0.35]}>
            <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
            <meshStandardMaterial color="#1f232a" metalness={0.7} />
          </mesh>
          <mesh position={[0.3, 0.13, 0.03]} rotation={[0.1, -0.25, 0]}>
            <boxGeometry args={[0.11, 0.06, 0.018]} />
            <meshStandardMaterial color="#1a1d24" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[-0.25, 0.075, 0.03]} rotation={[0, 0, 0.35]}>
            <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
            <meshStandardMaterial color="#1f232a" metalness={0.7} />
          </mesh>
          <mesh position={[-0.3, 0.13, 0.03]} rotation={[0.1, 0.25, 0]}>
            <boxGeometry args={[0.11, 0.06, 0.018]} />
            <meshStandardMaterial color="#1a1d24" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Illuminated digital tachometer cluster */}
          <mesh position={[0, 0.03, 0.08]} rotation={[-0.75, 0, 0]}>
            <boxGeometry args={[0.14, 0.075, 0.025]} />
            <meshStandardMaterial color="#0f172a" emissive="#38bdf8" emissiveIntensity={0.75} />
          </mesh>
        </group>

        {/* Sharp Streetfighter Bi-Functional LED Projector Headlight Cowl */}
        <group position={[0, 0.13, 0.15]} rotation={[0.38, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.21, 0.2, 0.22]} />
            <meshStandardMaterial color="#1d212a" metalness={0.78} roughness={0.25} />
          </mesh>
          {/* Central LED projector eye */}
          <mesh position={[0, -0.01, 0.105]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.044, 0.044, 0.03, 18]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#fff2cc"
              emissiveIntensity={2.8}
            />
          </mesh>
          {/* Twin wolf-eye DRL eyebrows */}
          <mesh position={[0.062, 0.048, 0.105]} rotation={[0, 0.18, -0.28]}>
            <boxGeometry args={[0.075, 0.016, 0.02]} />
            <meshStandardMaterial color="#fffbeb" emissive="#fde68a" emissiveIntensity={2.4} />
          </mesh>
          <mesh position={[-0.062, 0.048, 0.105]} rotation={[0, -0.18, 0.28]}>
            <boxGeometry args={[0.075, 0.016, 0.02]} />
            <meshStandardMaterial color="#fffbeb" emissive="#fde68a" emissiveIntensity={2.4} />
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
      tailGlowRef.current.emissiveIntensity = tState.isBraking ? 4.4 : 2.1;
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
