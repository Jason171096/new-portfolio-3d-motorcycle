import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PORTFOLIO_WAYPOINTS, type WaypointConfig } from '../data/waypoints';
import {
  ROAD_TOTAL_LENGTH,
  SUN_DIRECTION,
  getRoadCurvatureAt,
  getRoadFrameAt,
  scrollProgressToBikeT,
} from '../utils/roadSpline';
import { Motorcycle, type MotorcycleTelemetry } from './Motorcycle';
import { ProjectWaypoints } from './ProjectWaypoints';
import { RoadAndTerrain } from './RoadAndTerrain';

export interface HudTelemetrySnapshot {
  progress: number;
  miles: number;
  speedMph: number;
  activeWaypoint: WaypointConfig | null;
}

interface SceneProps {
  /** Raw 0..1 vertical scroll progress updated by GSAP ScrollTrigger */
  scrollProgressRef: React.MutableRefObject<number>;
  /** Optional custom .glb motorcycle asset path */
  motorcycleModelUrl?: string;
  reducedMotion: boolean;
  onTelemetryUpdate: (snapshot: HudTelemetrySnapshot) => void;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes smooth 0..1 blend weights for each waypoint camera bias around its active window.
 */
function getWaypointWeight(progress: number, wp: WaypointConfig): number {
  const [start, end] = wp.range;
  const fade = wp.kind === 'overlook' ? 0.05 : 0.045;
  if (progress < start - fade || progress > end + fade) return 0;
  if (progress < start) return smoothstep(start - fade, start, progress);
  if (progress > end) return 1 - smoothstep(end, end + fade, progress);
  return 1;
}

function RigAndWorld({
  scrollProgressRef,
  motorcycleModelUrl,
  reducedMotion,
  onTelemetryUpdate,
}: SceneProps) {
  const { camera, size } = useThree();

  const smoothedProgressRef = useRef(0);
  const prevBikeTRef = useRef(scrollProgressToBikeT(0));
  const velocityRef = useRef(0);
  const leanRef = useRef(0);
  const pitchRef = useRef(0);
  const lastHudEmitRef = useRef(0);
  const lastReportedWaypointIdRef = useRef<string | null>(null);

  const sunLightRef = useRef<THREE.DirectionalLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  const initialFrame = useMemo(() => getRoadFrameAt(scrollProgressToBikeT(0)), []);

  const telemetryRef = useRef<MotorcycleTelemetry>({
    position: initialFrame.point.clone(),
    tangent: initialFrame.tangent.clone(),
    leanAngle: 0,
    pitchAngle: 0,
    yawOffset: 0,
    deltaDistance: 0,
    speedNormalized: 0,
    isBraking: false,
    reducedMotion,
  });

  // Keep reducedMotion synced inside mutable telemetry ref
  useEffect(() => {
    telemetryRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  // Persistent relative camera offset vectors to avoid per-frame allocations
  const camOffsetGoal = useMemo(() => new THREE.Vector3(), []);
  const lookOffsetGoal = useMemo(() => new THREE.Vector3(), []);
  const dampedCamOffset = useMemo(() => new THREE.Vector3(), []);
  const dampedLookOffset = useMemo(() => new THREE.Vector3(), []);
  const currentLookAt = useMemo(() => new THREE.Vector3(), []);
  const initializedCamRef = useRef(false);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const targetProgress = THREE.MathUtils.clamp(scrollProgressRef.current, 0, 1);

    // Snap directly to initial deep-linked / restored scroll position on first frame
    if (!initializedCamRef.current) {
      smoothedProgressRef.current = targetProgress;
      prevBikeTRef.current = scrollProgressToBikeT(targetProgress);
    }

    // 1. Frame-rate independent damping of scroll progress
    const prevProgress = smoothedProgressRef.current;
    if (reducedMotion || !initializedCamRef.current) {
      smoothedProgressRef.current = targetProgress;
    } else {
      smoothedProgressRef.current = THREE.MathUtils.damp(
        smoothedProgressRef.current,
        targetProgress,
        7.5,
        dt,
      );
    }

    const p = smoothedProgressRef.current;
    const progressDelta = p - prevProgress;

    // 2. Evaluate motorcycle spline position & displacement
    const bikeT = scrollProgressToBikeT(p);
    const bikeTDelta = bikeT - prevBikeTRef.current;
    prevBikeTRef.current = bikeT;

    const deltaDistance = bikeTDelta * ROAD_TOTAL_LENGTH;
    const instantSpeed = dt > 0.0001 ? Math.abs(deltaDistance) / dt : 0;
    velocityRef.current = THREE.MathUtils.damp(velocityRef.current, instantSpeed, 6.5, dt);

    const frame = getRoadFrameAt(bikeT);
    const curvature = getRoadCurvatureAt(bikeT);

    // 3. Motorcycle banking/roll proportional to road curvature & travel velocity
    const speedFactor = THREE.MathUtils.clamp(velocityRef.current / 28, 0, 1.35);
    const targetLean = reducedMotion
      ? THREE.MathUtils.clamp(-curvature * 8.5, -0.18, 0.18)
      : THREE.MathUtils.clamp(
          curvature * 24 * (0.25 + speedFactor * 0.85),
          -0.34,
          0.34,
        );
    leanRef.current = THREE.MathUtils.damp(leanRef.current, targetLean, 7.0, dt);

    // Braking dive when decelerating onto the Destination Overlook (91%..99%)
    const isOverlookBraking = p > 0.91 && p < 0.988 && Math.abs(progressDelta) > 0.00008;
    const targetPitch = reducedMotion
      ? 0
      : isOverlookBraking
        ? 0.045
        : -THREE.MathUtils.clamp(progressDelta * 18, -0.025, 0.04);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, targetPitch, 6.0, dt);

    // Slight scenic pull-off angle as motorcycle stops at the Overlook vista
    const overlookParkFactor = smoothstep(0.925, 0.99, p);
    const yawOffset = overlookParkFactor * -0.28;

    // Place motorcycle neatly in right-center lane, pulling onto overlook right-center pad at summit
    const laneShift = THREE.MathUtils.lerp(0.65, 1.15, overlookParkFactor);
    const bikePos = frame.point.clone().addScaledVector(frame.right, laneShift);

    const tState = telemetryRef.current;
    tState.position.copy(bikePos);
    tState.tangent.copy(frame.tangent);
    tState.leanAngle = leanRef.current;
    tState.pitchAngle = pitchRef.current;
    tState.yawOffset = yawOffset;
    tState.deltaDistance = deltaDistance;
    tState.speedNormalized = THREE.MathUtils.clamp(velocityRef.current / 42, 0, 1);
    tState.isBraking = isOverlookBraking || p >= 0.985;

    // 4. Keep directional sunset shadow frustum centered around the motorcycle
    if (sunLightRef.current) {
      sunTarget.position.copy(bikePos);
      sunTarget.updateMatrixWorld();
      sunLightRef.current.position
        .copy(bikePos)
        .addScaledVector(SUN_DIRECTION, 52);
    }

    // 5. Responsive camera framing & dynamic waypoint bias
    const aspect = size.width / Math.max(1, size.height);
    const isMobile = size.width < 768 || aspect < 1.0;

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = isMobile ? 54 : 45;
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 5, dt);
        camera.updateProjectionMatrix();
      }
    }

    // Accumulate blended waypoint camera bias
    let biasRight = 0;
    let biasUp = 0;
    let biasBack = 0;
    let lookRight = 0;
    let lookUp = 0;
    let lookForward = 0;
    let activeWaypoint: WaypointConfig | null = null;
    let highestWeight = 0;

    for (const wp of PORTFOLIO_WAYPOINTS) {
      const w = getWaypointWeight(p, wp);
      if (w > 0.001) {
        const lateralScale = isMobile ? 0.52 : 1.0;
        biasRight += wp.cameraBias.offset[0] * w * lateralScale;
        biasUp += wp.cameraBias.offset[1] * w;
        biasBack += wp.cameraBias.offset[2] * w;

        lookRight += wp.cameraBias.lookOffset[0] * w * lateralScale;
        lookUp += wp.cameraBias.lookOffset[1] * w;
        lookForward += wp.cameraBias.lookOffset[2] * w;
      }
      if (p >= wp.range[0] && p <= wp.range[1] && w >= highestWeight) {
        highestWeight = w;
        activeWaypoint = wp;
      }
    }

    const baseBack = isMobile ? 6.85 : 5.45;
    const baseUp = isMobile ? 2.55 : 2.1;
    const baseRight = isMobile ? 0.35 : 0.62;

    const rawChaseRight = baseRight + biasRight;
    // Add subtle ~0.4 horizontal offset toward whichever side frames the dynamic rear three-quarter angle
    const threeQuarterChaseOffset =
      (isMobile ? 0.28 : 0.4) * Math.tanh(rawChaseRight * 2.2);

    const swayX = reducedMotion
      ? 0
      : Math.sin(clock.elapsedTime * 0.9) * 0.05 * (1 - overlookParkFactor);

    camOffsetGoal
      .set(0, baseUp + biasUp, 0)
      .addScaledVector(frame.right, rawChaseRight + threeQuarterChaseOffset + swayX)
      .addScaledVector(frame.tangent, -(baseBack + biasBack));

    lookOffsetGoal
      .set(0, 1.05 + lookUp, 0)
      .addScaledVector(frame.right, lookRight)
      .addScaledVector(frame.tangent, 6.4 + lookForward);

    if (!initializedCamRef.current) {
      dampedCamOffset.copy(camOffsetGoal);
      dampedLookOffset.copy(lookOffsetGoal);
      initializedCamRef.current = true;
    } else {
      const offsetDamp = reducedMotion ? 18 : 6.0;
      dampedCamOffset.x = THREE.MathUtils.damp(dampedCamOffset.x, camOffsetGoal.x, offsetDamp, dt);
      dampedCamOffset.y = THREE.MathUtils.damp(dampedCamOffset.y, camOffsetGoal.y, offsetDamp, dt);
      dampedCamOffset.z = THREE.MathUtils.damp(dampedCamOffset.z, camOffsetGoal.z, offsetDamp, dt);

      dampedLookOffset.x = THREE.MathUtils.damp(dampedLookOffset.x, lookOffsetGoal.x, offsetDamp + 1.0, dt);
      dampedLookOffset.y = THREE.MathUtils.damp(dampedLookOffset.y, lookOffsetGoal.y, offsetDamp + 1.0, dt);
      dampedLookOffset.z = THREE.MathUtils.damp(dampedLookOffset.z, lookOffsetGoal.z, offsetDamp + 1.0, dt);
    }

    camera.position.copy(bikePos).add(dampedCamOffset);
    currentLookAt.copy(bikePos).add(dampedLookOffset);
    camera.lookAt(currentLookAt);

    // 6. Throttled HUD telemetry snapshot (~24Hz or immediate waypoint transition)
    const waypointId = activeWaypoint?.id ?? null;
    const elapsed = clock.elapsedTime;
    if (
      elapsed - lastHudEmitRef.current > 0.042 ||
      waypointId !== lastReportedWaypointIdRef.current
    ) {
      lastHudEmitRef.current = elapsed;
      lastReportedWaypointIdRef.current = waypointId;

      // Map scroll velocity smoothly to realistic cruising speed (0..68 MPH), 0 when parked
      const cruisingMph =
        p >= 0.985
          ? 0
          : Math.min(72, Math.round(velocityRef.current * 1.65));

      onTelemetryUpdate({
        progress: p,
        miles: Number((p * 3.5).toFixed(2)),
        speedMph: cruisingMph,
        activeWaypoint,
      });
    }
  });

  return (
    <>
      <fogExp2 attach="fog" args={['#de9f73', 0.0046]} />

      {/* Warm golden-hour ambient + hemisphere sky/earth bounce */}
      <ambientLight intensity={0.32} color="#ffd7b0" />
      <hemisphereLight args={['#ffbc82', '#313a29', 0.95]} />

      {/* Primary sunset directional light following the motorcycle for crisp local shadows */}
      <primitive object={sunTarget} />
      <directionalLight
        ref={sunLightRef}
        target={sunTarget}
        position={[
          initialFrame.point.x + SUN_DIRECTION.x * 52,
          initialFrame.point.y + SUN_DIRECTION.y * 52,
          initialFrame.point.z + SUN_DIRECTION.z * 52,
        ]}
        intensity={2.45}
        color="#ffbe78"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={5}
        shadow-camera-far={120}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-bias={-0.0004}
      />

      {/* Subtle cool twilight fill light from behind camera */}
      <directionalLight position={[18, 14, 30]} intensity={0.42} color="#8ba6d9" />

      <RoadAndTerrain />
      <ProjectWaypoints progressRef={smoothedProgressRef} reducedMotion={reducedMotion} />
      <Motorcycle modelUrl={motorcycleModelUrl} telemetryRef={telemetryRef} />
    </>
  );
}

export function Scene(props: SceneProps) {
  return (
    <div className="fixed inset-0 z-0 h-screen w-screen overflow-hidden bg-[#101218]">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.15, far: 1200 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.06,
        }}
      >
        <RigAndWorld {...props} />
      </Canvas>
    </div>
  );
}
