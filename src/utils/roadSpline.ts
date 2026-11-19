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
 * Control points defining a winding golden-hour countryside highway
 * climbing gradually toward a scenic mountain overlook at the sunset horizon.
 */
const CONTROL_POINTS: [number, number, number][] = [
  [0, 0.0, 26],      // Approach behind Start Line
  [0, 0.25, -24],    // Start Line straightaway (0% - 15%)
  [13, 1.4, -84],    // Sweeping right entry
  [-9, 2.9, -148],   // Gentle left bend past Mile 1 (PrimeFitness on right)
  [-32, 4.4, -214],  // Valley crest
  [-12, 6.2, -278],  // Sweeping right ridge past Mile 2 (Azzule AI on left)
  [20, 7.8, -342],   // Foothill curve
  [4, 9.0, -404],    // Sunset turn past Mile 3 (Pulsar 3D on right)
  [-15, 10.0, -452], // Level overlook entry
  [-18, 10.0, -492], // Destination Overlook pull-off facing sunset vista
];

export const roadCurve = new THREE.CatmullRomCurve3(
  CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  false,
  'catmullrom',
  0.5,
);

export const ROAD_TOTAL_LENGTH = roadCurve.getLength();

const LUT_COUNT = 500;
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

/**
 * Sample smoothly interpolated frame along the highway spline.
 */
export function getRoadFrameAt(t: number): {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
} {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const point = roadCurve.getPointAt(clamped);
  const tangent = roadCurve.getTangentAt(clamped).normalize();
  const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
  return { point, tangent, right, up };
}

/**
 * Computes signed horizontal curvature along the spline at t.
 * Positive = turning right; Negative = turning left.
 */
export function getRoadCurvatureAt(t: number): number {
  const delta = 0.012;
  const t0 = THREE.MathUtils.clamp(t - delta, 0, 1);
  const t1 = THREE.MathUtils.clamp(t + delta, 0, 1);
  const tan0 = roadCurve.getTangentAt(t0);
  const tan1 = roadCurve.getTangentAt(t1);
  const right = new THREE.Vector3().crossVectors(tan0, WORLD_UP).normalize();
  const dTan = new THREE.Vector3().subVectors(tan1, tan0);
  const signedTurn = dTan.dot(right);
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
export function getTerrainHeight(x: number, z: number): number {
  const { sample, distSq, signedLateral } = findNearestRoadSample(x, z);
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
