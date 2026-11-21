import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  PORTFOLIO_WAYPOINTS,
  TOTAL_ROUTE_MILES,
  type WaypointConfig,
} from '../data/waypoints';
import {
  ROAD_TOTAL_LENGTH,
  SUN_DIRECTION,
  getRoadCurvatureAt,
  getRoadFrameAt,
  scrollProgressToBikeT,
  type RoadFrame,
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
 * Lead fade begins slightly before `range[0]` so the camera smoothly biases toward upcoming billboards.
 */
function getWaypointWeight(progress: number, wp: WaypointConfig): number {
  const [start, end] = wp.range;
  const leadFade = wp.kind === 'overlook' ? 0.035 : 0.022;
  const trailFade = wp.kind === 'overlook' ? 0.02 : 0.014;
  if (progress < start - leadFade || progress > end + trailFade) return 0;
  if (progress < start) return smoothstep(start - leadFade, start, progress);
  if (progress > end) return 1 - smoothstep(end, end + trailFade, progress);
  return 1;
}

const RigAndWorld = React.memo(function RigAndWorld({
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
  const lastTelemetryRef = useRef<{
    waypointId: string | null;
    percent: number;
    miles: number;
    speedMph: number;
  }>({
    waypointId: null,
    percent: -1,
    miles: -1,
    speedMph: -1,
  });

  const sunLightRef = useRef<THREE.DirectionalLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  const initialFrame = useMemo(() => getRoadFrameAt(scrollProgressToBikeT(0)), []);
  const overlookSunDir = useMemo(() => {
    const endFwd = getRoadFrameAt(1.0).tangent.clone().setY(0).normalize();
    return new THREE.Vector3(endFwd.x, 0.092, endFwd.z).normalize();
  }, []);
  const blendedSunDir = useMemo(() => new THREE.Vector3().copy(SUN_DIRECTION), []);

  const telemetryRef = useRef<MotorcycleTelemetry>({
    position: initialFrame.point.clone(),
    tangent: initialFrame.tangent.clone(),
    sunDirection: SUN_DIRECTION.clone(),
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

  // Persistent scratch & local-frame camera state to avoid per-frame allocations & world-space curve lag
  const frameScratch = useMemo<RoadFrame>(
    () => ({
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
    }),
    [],
  );
  const bikePosScratch = useMemo(() => new THREE.Vector3(), []);
  const currentLookAt = useMemo(() => new THREE.Vector3(), []);
  const dampedCamLocalRef = useRef({ right: 0, up: 0, back: 0 });
  const dampedLookLocalRef = useRef({ right: 0, up: 0, forward: 0 });
  const initializedCamRef = useRef(false);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const targetProgress = THREE.MathUtils.clamp(scrollProgressRef.current, 0, 1);

    // Snap directly to initial deep-linked / restored scroll position on first frame
    if (!initializedCamRef.current) {
      smoothedProgressRef.current = targetProgress;
      prevBikeTRef.current = scrollProgressToBikeT(targetProgress);
    }

    // 1. Snappy damping (16.0) smooths discrete wheel ticks without lagging behind Lenis
    const prevProgress = smoothedProgressRef.current;
    if (reducedMotion || !initializedCamRef.current) {
      smoothedProgressRef.current = targetProgress;
    } else {
      smoothedProgressRef.current = THREE.MathUtils.damp(
        smoothedProgressRef.current,
        targetProgress,
        16.0,
        dt,
      );
    }

    const p = smoothedProgressRef.current;
    const progressDelta = p - prevProgress;

    // 2. Evaluate motorcycle spline position & displacement via zero-alloc LUT
    const bikeT = scrollProgressToBikeT(p);
    const bikeTDelta = bikeT - prevBikeTRef.current;
    prevBikeTRef.current = bikeT;

    const deltaDistance = bikeTDelta * ROAD_TOTAL_LENGTH;
    const instantSpeed = dt > 0.0001 ? Math.abs(deltaDistance) / dt : 0;
    velocityRef.current = THREE.MathUtils.damp(velocityRef.current, instantSpeed, 9.0, dt);

    const frame = getRoadFrameAt(bikeT, frameScratch);
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
    leanRef.current = THREE.MathUtils.damp(leanRef.current, targetLean, 9.0, dt);

    // Braking dive when decelerating onto the Destination Overlook (91%..98.5%)
    const isOverlookBraking = p > 0.91 && p < 0.985 && Math.abs(progressDelta) > 0.00006;
    const targetPitch = reducedMotion
      ? 0
      : isOverlookBraking
        ? 0.045
        : -THREE.MathUtils.clamp(progressDelta * 18, -0.025, 0.04);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, targetPitch, 8.0, dt);

    // Smoothly pull toward the right overlook edge & angle slightly right for a dynamic rear 3/4 view
    const overlookParkFactor = smoothstep(0.92, 0.992, p);
    const yawOffset = overlookParkFactor * -0.21;

    // Place motorcycle neatly in right lane, pulling onto the overlook turnout edge at 92%–100%
    const laneShift = THREE.MathUtils.lerp(0.65, 1.7, overlookParkFactor);
    const bikePos = bikePosScratch.copy(frame.point).addScaledVector(frame.right, laneShift);

    // Smoothly align key sun direction toward the Overlook sunset saddle
    blendedSunDir.copy(SUN_DIRECTION).lerp(overlookSunDir, overlookParkFactor).normalize();

    const tState = telemetryRef.current;
    tState.position.copy(bikePos);
    tState.tangent.copy(frame.tangent);
    tState.sunDirection.copy(blendedSunDir);
    tState.leanAngle = leanRef.current;
    tState.pitchAngle = pitchRef.current;
    tState.yawOffset = yawOffset;
    tState.deltaDistance = deltaDistance;
    tState.speedNormalized = THREE.MathUtils.clamp(velocityRef.current / 42, 0, 1);
    tState.isBraking = isOverlookBraking || p >= 0.92;

    // 4. Keep directional sunset shadow frustum centered around the motorcycle
    if (sunLightRef.current) {
      sunTarget.position.copy(bikePos);
      sunTarget.updateMatrixWorld();
      sunLightRef.current.position
        .copy(bikePos)
        .addScaledVector(blendedSunDir, 52);
    }

    // 5. Responsive camera framing & dynamic waypoint bias (damped in local bike coordinates)
    const aspect = size.width / Math.max(1, size.height);
    const isMobile = size.width < 768 || aspect < 1.0;

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = isMobile ? 56 : 45;
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
      if (w > 0.001 && wp.kind !== 'overlook') {
        const lateralScale = isMobile ? 0.52 : 1.0;
        // Subtly bias chase camera lateral offset toward the active billboard side when approaching a milestone
        const billboardApproachBias =
          wp.kind === 'project' && wp.side
            ? (wp.side === 'right' ? 0.16 : -0.22) * w * lateralScale
            : 0;

        biasRight += wp.cameraBias.offset[0] * w * lateralScale + billboardApproachBias;
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

    // Overlook composition: camera behind & slightly left of bike so bike rests lower-right,
    // glowing sunset aligns down the road center, and left viewport stays clear for Contact HUD
    const overlookCamBlend = smoothstep(0.895, 0.985, p);
    const overlookCamRight = isMobile ? -0.85 : -1.76;
    const overlookCamUp = isMobile ? 2.65 : 2.28;
    const overlookCamBack = isMobile ? 6.85 : 5.45;
    const overlookLookRight = isMobile ? -0.65 : -1.7;
    const overlookLookUp = isMobile ? 0.95 : 1.28;
    const overlookLookForward = isMobile ? 10.0 : 11.2;

    const goalCamRight = THREE.MathUtils.lerp(
      rawChaseRight + threeQuarterChaseOffset + swayX,
      overlookCamRight,
      overlookCamBlend,
    );
    const goalCamUp = THREE.MathUtils.lerp(baseUp + biasUp, overlookCamUp, overlookCamBlend);
    const goalCamBack = THREE.MathUtils.lerp(baseBack + biasBack, overlookCamBack, overlookCamBlend);

    const goalLookRight = THREE.MathUtils.lerp(lookRight, overlookLookRight, overlookCamBlend);
    const goalLookUp = THREE.MathUtils.lerp(1.05 + lookUp, overlookLookUp, overlookCamBlend);
    const goalLookForward = THREE.MathUtils.lerp(
      6.4 + lookForward,
      overlookLookForward,
      overlookCamBlend,
    );

    if (!initializedCamRef.current) {
      dampedCamLocalRef.current.right = goalCamRight;
      dampedCamLocalRef.current.up = goalCamUp;
      dampedCamLocalRef.current.back = goalCamBack;
      dampedLookLocalRef.current.right = goalLookRight;
      dampedLookLocalRef.current.up = goalLookUp;
      dampedLookLocalRef.current.forward = goalLookForward;
      initializedCamRef.current = true;
    } else {
      const offsetDamp = reducedMotion ? 22 : 10.5;
      dampedCamLocalRef.current.right = THREE.MathUtils.damp(
        dampedCamLocalRef.current.right,
        goalCamRight,
        offsetDamp,
        dt,
      );
      dampedCamLocalRef.current.up = THREE.MathUtils.damp(
        dampedCamLocalRef.current.up,
        goalCamUp,
        offsetDamp,
        dt,
      );
      dampedCamLocalRef.current.back = THREE.MathUtils.damp(
        dampedCamLocalRef.current.back,
        goalCamBack,
        offsetDamp,
        dt,
      );

      dampedLookLocalRef.current.right = THREE.MathUtils.damp(
        dampedLookLocalRef.current.right,
        goalLookRight,
        offsetDamp + 1.5,
        dt,
      );
      dampedLookLocalRef.current.up = THREE.MathUtils.damp(
        dampedLookLocalRef.current.up,
        goalLookUp,
        offsetDamp + 1.5,
        dt,
      );
      dampedLookLocalRef.current.forward = THREE.MathUtils.damp(
        dampedLookLocalRef.current.forward,
        goalLookForward,
        offsetDamp + 1.5,
        dt,
      );
    }

    camera.position
      .copy(bikePos)
      .addScaledVector(frame.right, dampedCamLocalRef.current.right)
      .addScaledVector(frame.tangent, -dampedCamLocalRef.current.back);
    camera.position.y += dampedCamLocalRef.current.up;

    currentLookAt
      .copy(bikePos)
      .addScaledVector(frame.right, dampedLookLocalRef.current.right)
      .addScaledVector(frame.tangent, dampedLookLocalRef.current.forward);
    currentLookAt.y += dampedLookLocalRef.current.up;
    camera.lookAt(currentLookAt);

    // 6. Emit HUD telemetry only when visible HUD values change (zero React work when idle)
    const waypointId = activeWaypoint?.id ?? null;
    const elapsed = clock.elapsedTime;
    const percent = Math.round(p * 100);
    const miles = Number((p * TOTAL_ROUTE_MILES).toFixed(2));
    const cruisingMph =
      p >= 0.985
        ? 0
        : Math.min(72, Math.round(velocityRef.current * 1.65));

    const prev = lastTelemetryRef.current;
    const hasVisualChange =
      prev.waypointId !== waypointId ||
      prev.percent !== percent ||
      prev.miles !== miles ||
      prev.speedMph !== cruisingMph;

    if (
      hasVisualChange &&
      (elapsed - lastHudEmitRef.current > 0.048 || waypointId !== prev.waypointId)
    ) {
      lastHudEmitRef.current = elapsed;
      prev.waypointId = waypointId;
      prev.percent = percent;
      prev.miles = miles;
      prev.speedMph = cruisingMph;

      onTelemetryUpdate({
        progress: p,
        miles,
        speedMph: cruisingMph,
        activeWaypoint,
      });
    }
  });

  return (
    <>
      <fogExp2 attach="fog" args={['#f0b868', 0.00175]} />

      {/* Warm golden-hour ambient + hemisphere sky/earth bounce */}
      <ambientLight intensity={0.38} color="#ffdba8" />
      <hemisphereLight args={['#ffca7e', '#4b3621', 1.05]} />

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
        intensity={2.6}
        color="#ffbe6b"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={5}
        shadow-camera-far={105}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-bias={-0.0005}
      />

      {/* Subtle warm-neutral fill light from behind camera */}
      <directionalLight position={[18, 14, 30]} intensity={0.36} color="#bba392" />

      <RoadAndTerrain />
      <ProjectWaypoints progressRef={smoothedProgressRef} reducedMotion={reducedMotion} />
      <Motorcycle modelUrl={motorcycleModelUrl} telemetryRef={telemetryRef} />
    </>
  );
});

export const Scene = React.memo(function Scene(props: SceneProps) {
  return (
    <div className="fixed inset-0 z-0 h-screen w-screen overflow-hidden bg-[#101218]">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: 45, near: 0.15, far: 1600 }}
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
});
