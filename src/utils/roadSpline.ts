import * as THREE from 'three';

export interface SplineSample {
  t: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export const ROAD_WIDTH = 8.4;
export const ROAD_HALF_WIDTH = ROAD_WIDTH * 0.5;
export const SHOULDER_WIDTH = 2.0;

/**
 * Control points defining an extended winding golden-hour countryside highway (~35% longer)
 * climbing gradually across 5 alternating project milestones toward a scenic mountain overlook.
 */
const CONTROL_POINTS: [number, number, number][] = [
  [0, 0.0, 26],       // Approach behind Start Line
  [0, 0.25, -26],     // Start Line straightaway (0% - 10%)
  [13, 1.4, -90],     // Gentle right entry
  [-4, 3.0, -162],    // Gentle left curve past Mile 1 (PrimeFitness on right)
  [-28, 4.7, -234],   // Valley bend
  [-10, 6.4, -300],   // Gentle right curve past Mile 2 (Azzule AI on left)
  [18, 8.0, -366],    // Ridge sweep
  [4, 9.5, -434],     // Gentle left turn past Mile 3 (VW Credit on right)
  [-22, 10.9, -502],  // Mid-highland curve past Mile 4 (OhhFiles on left)
  [8, 12.1, -568],    // Foothill curve past Mile 5 (MediGer on right)
  [-8, 13.2, -628],   // Level overlook entry
  [-17, 13.2, -677],  // Destination Overlook pull-off facing sunset vista
];

export const roadCurve = new THREE.CatmullRomCurve3(
  CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  false,
  'catmullrom',
  0.5,
);

export const ROAD_TOTAL_LENGTH = roadCurve.getLength();

const LUT_COUNT = 700;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const ROAD_SAMPLES: SplineSample[] = Array.from({ length: LUT_COUNT + 1 }, (_, i) => {
  const t = i / LUT_COUNT;
  const point = roadCurve.getPointAt(t);
  const tangent = roadCurve.getTangentAt(t).normalize();
  const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
  return { t, point, tangent, right, up };
});

/** World-space position of the Destination Overlook scenic plaza */
export const OVERLOOK_T = 0.968;
export const OVERLOOK_CENTER = roadCurve.getPointAt(OVERLOOK_T);
export const OVERLOOK_TANGENT = roadCurve.getTangentAt(OVERLOOK_T).normalize();
export const OVERLOOK_RADIUS = 16.5;

/** Sun direction sitting low above the sunset horizon beyond the Destination Overlook */
export const SUN_DIRECTION = new THREE.Vector3(-0.28, 0.145, -0.948).normalize();

export interface RoadFrame {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

const _curvTan0 = new THREE.Vector3();
const _curvTan1 = new THREE.Vector3();
const _curvRight = new THREE.Vector3();
const _curvDiff = new THREE.Vector3();

function sampleTangentFromLut(t: number, out: THREE.Vector3): THREE.Vector3 {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const f = clamped * LUT_COUNT;
  const i0 = Math.min(LUT_COUNT - 1, Math.floor(f));
  const alpha = f - i0;
  return out
    .copy(ROAD_SAMPLES[i0].tangent)
    .lerp(ROAD_SAMPLES[i0 + 1].tangent, alpha)
    .normalize();
}

/**
 * Sample smoothly interpolated frame along the highway spline via O(1) LUT lookup.
 * Pass `out` inside hot per-frame loops (`useFrame`) to avoid Vector3 allocations.
 */
export function getRoadFrameAt(t: number, out?: RoadFrame): RoadFrame {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const f = clamped * LUT_COUNT;
  const i0 = Math.min(LUT_COUNT - 1, Math.floor(f));
  const alpha = f - i0;

  const s0 = ROAD_SAMPLES[i0];
  const s1 = ROAD_SAMPLES[i0 + 1];

  const target: RoadFrame = out ?? {
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };

  target.point.copy(s0.point).lerp(s1.point, alpha);
  target.tangent.copy(s0.tangent).lerp(s1.tangent, alpha).normalize();
  target.right.crossVectors(target.tangent, WORLD_UP).normalize();
  target.up.crossVectors(target.right, target.tangent).normalize();

  return target;
}

/**
 * Computes signed horizontal curvature along the spline at t using zero-allocation LUT lookups.
 * Positive = turning right; Negative = turning left.
 */
export function getRoadCurvatureAt(t: number): number {
  const delta = 0.012;
  const t0 = THREE.MathUtils.clamp(t - delta, 0, 1);
  const t1 = THREE.MathUtils.clamp(t + delta, 0, 1);
  sampleTangentFromLut(t0, _curvTan0);
  sampleTangentFromLut(t1, _curvTan1);
  _curvRight.crossVectors(_curvTan0, WORLD_UP).normalize();
  _curvDiff.subVectors(_curvTan1, _curvTan0);
  const signedTurn = _curvDiff.dot(_curvRight);
  const arcStep = Math.max(0.001, (t1 - t0) * ROAD_TOTAL_LENGTH);
  return signedTurn / arcStep;
}

/**
 * Maps raw scroll progress (0..1) to motorcycle spline coordinate t (0.04..0.972),
 * including smooth deceleration into a parked stance at the Destination Overlook (92%..100%).
 */
export function scrollProgressToBikeT(progress: number): number {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const startT = 0.045;
  const overlookEntryP = 0.92;
  const overlookEntryT = 0.915;
  const parkedT = 0.968;

  if (p <= overlookEntryP) {
    const u = p / overlookEntryP;
    return THREE.MathUtils.lerp(startT, overlookEntryT, u);
  }

  // Smooth ease-out deceleration onto the overlook pull-off
  const u = (p - overlookEntryP) / (1 - overlookEntryP);
  const eased = 1 - Math.pow(1 - u, 2.35);
  return THREE.MathUtils.lerp(overlookEntryT, parkedT, eased);
}

/**
 * Finds the nearest road sample to a given world XZ coordinate.
 */
export function findNearestRoadSample(x: number, z: number): {
  sample: SplineSample;
  distSq: number;
  signedLateral: number;
} {
  let bestIndex = 0;
  let bestDistSq = Infinity;

  // Coarse step first for fast terrain baking
  for (let i = 0; i < ROAD_SAMPLES.length; i += 4) {
    const p = ROAD_SAMPLES[i].point;
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestIndex = i;
    }
  }

  // Fine local refinement around best coarse sample
  const start = Math.max(0, bestIndex - 4);
  const end = Math.min(ROAD_SAMPLES.length - 1, bestIndex + 4);
  for (let i = start; i <= end; i++) {
    const p = ROAD_SAMPLES[i].point;
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestIndex = i;
    }
  }

  const sample = ROAD_SAMPLES[bestIndex];
  const dx = x - sample.point.x;
  const dz = z - sample.point.z;
  const signedLateral = dx * sample.right.x + dz * sample.right.z;

  return { sample, distSq: bestDistSq, signedLateral };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Multi-layered procedural rolling countryside hill height at world (x, z),
 * seamlessly carved along the highway corridor and flattened at the Destination Overlook.
 */
export function getTerrainHeight(
  x: number,
  z: number,
  nearest?: ReturnType<typeof findNearestRoadSample>,
): number {
  const { sample, distSq, signedLateral } = nearest ?? findNearestRoadSample(x, z);
  const dist = Math.sqrt(distSq);

  // Rolling countryside waves + larger distant hillside swells
  const rollingHills =
    Math.sin(x * 0.032 + z * 0.018) * 3.4 +
    Math.cos(x * 0.019 - z * 0.025) * 4.2 +
    Math.sin(x * 0.065 + z * 0.052) * 1.15;

  // Gentle rise as distance from road increases (valley framing)
  const valleyWall = Math.max(0, dist - 22) * 0.22;
  const ridgeSwell =
    Math.sin(x * 0.011 + 1.1) * Math.cos(z * 0.013) * Math.min(18, Math.max(0, dist - 28) * 0.32);

  // Asymmetric cliff drop-off on the far side of the mountain overlook
  const overlookDx = x - OVERLOOK_CENTER.x;
  const overlookDz = z - OVERLOOK_CENTER.z;
  const overlookDist = Math.hypot(overlookDx, overlookDz);

  // Beyond the overlook end, drop gracefully into a scenic golden valley canyon!
  const canyonDrop = z < OVERLOOK_CENTER.z - 14 ? smoothstep(OVERLOOK_CENTER.z - 14, OVERLOOK_CENTER.z - 75, z) * -22 : 0;

  // Bias slight embankment height outside curves
  const rawHillHeight = sample.point.y + rollingHills + valleyWall + ridgeSwell + canyonDrop;

  // Flatten highway corridor cleanly so terrain never clips asphalt
  const flatHalf = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
  const blendOuter = flatHalf + 15.5;
  const roadBlend = smoothstep(flatHalf, blendOuter, dist);

  // Keep slight berm beside road cut except at overlook terrace
  const roadBedY = sample.point.y - 0.08;
  let height = THREE.MathUtils.lerp(roadBedY, rawHillHeight, roadBlend);

  // Flatten circular scenic terrace at Destination Overlook
  if (overlookDist < OVERLOOK_RADIUS + 10) {
    const terraceBlend = 1 - smoothstep(OVERLOOK_RADIUS - 1.5, OVERLOOK_RADIUS + 10, overlookDist);
    // Keep right edge dropping away slightly for cliff vista feel
    const vistaDrop = Math.max(0, signedLateral - 8) * 0.12;
    height = THREE.MathUtils.lerp(height, OVERLOOK_CENTER.y - 0.08 - vistaDrop, terraceBlend);
  }

  return height;
}
