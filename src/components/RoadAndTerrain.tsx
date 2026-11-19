import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic spatial 3D hash returning [-1, 1] strictly from vertex position
 * so coincident vertices across shared faces displace identically without seams.
 */
function spatialNoise3D(x: number, y: number, z: number, seed: number): number {
  const dot = x * 12.9898 + y * 78.233 + z * 37.719 + seed * 19.31;
  const s = Math.sin(dot) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Computes terrain surface normal via finite differences around (x, z).
 */
function getTerrainNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const eps = 0.45;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return out.set(hL - hR, 2 * eps, hD - hU).normalize();
}

/**
 * Creates a procedural 64x64 radial alpha gradient CanvasTexture for soft dark-olive tree contact shadows.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size * 0.5;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, 'rgba(22, 29, 15, 0.72)');
  grad.addColorStop(0.42, 'rgba(26, 34, 18, 0.42)');
  grad.addColorStop(0.78, 'rgba(30, 38, 20, 0.12)');
  grad.addColorStop(1.0, 'rgba(30, 38, 20, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a displaced low-poly icosahedron geometry for organic oak crowns, bushes, and rocks.
 */
function buildDisplacedIcosahedronGeometry(
  radius: number,
  detail: number,
  jitterAmp: number,
  seed: number,
  verticalSquash = 1.0,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    const n1 = spatialNoise3D(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), seed);
    const n2 = spatialNoise3D(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50), seed + 7.1);
    const radialOffset = (n1 * 0.68 + n2 * 0.32) * jitterAmp;
    const newR = Math.max(radius * 0.45, len + radialOffset);

    pos.setXYZ(i, nx * newR, ny * newR * verticalSquash, nz * newR);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an organic pine foliage cone tier with subtle radial & vertical vertex noise.
 * Uses CylinderGeometry with a tiny non-zero top radius (0.025) so all intermediate
 * height-segment quads remain watertight across Three.js r169.
 */
function buildOrganicPineTierGeometry(
  radius: number,
  height: number,
  radialSegments: number,
  heightSegments: number,
  noiseAmp: number,
  seed: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.025, radius, height, radialSegments, heightSegments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const halfH = height * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const radialDist = Math.hypot(x, z);
    // Keep top apex tip & bottom center cap aligned cleanly
    if (radialDist < 0.04 || y > halfH - 0.05) continue;

    const rx = Math.round(x * 100);
    const ry = Math.round(y * 100);
    const rz = Math.round(z * 100);

    const nRad = spatialNoise3D(rx, ry, rz, seed);
    const nVert = spatialNoise3D(rx, ry, rz, seed + 13.7);
    const heightFrac = THREE.MathUtils.clamp((halfH - y) / height, 0, 1);

    const radialScale = 1 + nRad * noiseAmp * (0.45 + 0.55 * heightFrac);
    const yOffset = nVert * noiseAmp * 0.48 * heightFrac;

    pos.setXYZ(i, x * radialScale, y + yOffset, z * radialScale);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a single BufferGeometry consisting of 3 crossed low-poly grass blades
 * anchored at y = 0 with flared tips for root clutter and roadside tufts.
 */
function buildCrossedGrassTuftGeometry(): THREE.BufferGeometry {
  const bladeSpecs = [
    { angle: 0, width: 0.24, height: 0.58, lean: 0.06 },
    { angle: Math.PI / 3, width: 0.22, height: 0.64, lean: 0.09 },
    { angle: (Math.PI * 2) / 3, width: 0.21, height: 0.52, lean: 0.05 },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  bladeSpecs.forEach((spec, idx) => {
    const cos = Math.cos(spec.angle);
    const sin = Math.sin(spec.angle);
    const hw = spec.width * 0.5;
    const tw = hw * 0.22; // Tapered grass blade tip
    const lx = cos;
    const lz = sin;
    // Slight outward normal lean
    const nx = -sin;
    const nz = cos;
    const leanX = nx * spec.lean;
    const leanZ = nz * spec.lean;

    const vBase = idx * 4;
    // Bottom-left, Bottom-right, Top-right, Top-left
    positions.push(
      -lx * hw, 0, -lz * hw,
      lx * hw, 0, lz * hw,
      lx * tw + leanX, spec.height, lz * tw + leanZ,
      -lx * tw + leanX, spec.height, -lz * tw + leanZ,
    );

    for (let k = 0; k < 4; k++) {
      normals.push(nx * 0.35, 0.94, nz * 0.35);
    }

    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Creates a MeshStandardMaterial augmented via `onBeforeCompile` with:
 * - Subtle per-instance wind sway weighted by local vertex height
 * - Warm golden-hour rim backlighting facing the setting sun
 */
function createFoliageWindRimMaterial({
  timeUniform,
  sunDirUniform,
  windAmp,
  windBaseY,
  windTopY,
  rimStrength,
  roughness = 0.86,
  side = THREE.FrontSide,
}: {
  timeUniform: { value: number };
  sunDirUniform: { value: THREE.Vector3 };
  windAmp: number;
  windBaseY: number;
  windTopY: number;
  rimStrength: number;
  roughness?: number;
  side?: THREE.Side;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness,
    metalness: 0.02,
    side,
  });

  mat.customProgramCacheKey = () =>
    `foliage-wind-rim-${windAmp}-${windBaseY}-${windTopY}-${rimStrength}-${side}`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uSunDir = sunDirUniform;
    shader.uniforms.uWindAmp = { value: windAmp };
    shader.uniforms.uWindBaseY = { value: windBaseY };
    shader.uniforms.uWindTopY = { value: windTopY };
    shader.uniforms.uRimStrength = { value: rimStrength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uWindAmp;
uniform float uWindBaseY;
uniform float uWindTopY;
varying vec3 vWorldPosFoliage;
varying vec3 vWorldNormalFoliage;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 instOrigin = vec3(0.0);
#ifdef USE_INSTANCING
  instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#endif
float windPhase = instOrigin.x * 0.37 + instOrigin.z * 0.29;
float windGust = sin(uTime * 1.45 + windPhase) * 0.65 + sin(uTime * 2.8 + windPhase * 1.6) * 0.35;
float heightMask = smoothstep(uWindBaseY, uWindTopY, position.y);
transformed.x += windGust * heightMask * uWindAmp;
transformed.z += cos(uTime * 1.18 + windPhase * 1.25) * heightMask * uWindAmp * 0.55;

vec4 customWorldPos = vec4(transformed, 1.0);
vec3 customWorldNorm = objectNormal;
#ifdef USE_INSTANCING
  customWorldPos = instanceMatrix * customWorldPos;
  customWorldNorm = mat3(instanceMatrix) * customWorldNorm;
#endif
customWorldPos = modelMatrix * customWorldPos;
vWorldPosFoliage = customWorldPos.xyz;
vWorldNormalFoliage = normalize(mat3(modelMatrix) * customWorldNorm);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDir;
uniform float uRimStrength;
varying vec3 vWorldPosFoliage;
varying vec3 vWorldNormalFoliage;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 viewDirW = normalize(cameraPosition - vWorldPosFoliage);
vec3 normW = normalize(vWorldNormalFoliage);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) normW = -normW;
#endif
float fresnelRim = pow(1.0 - max(dot(normW, viewDirW), 0.0), 2.5);
float sunBacklight = pow(max(dot(-viewDirW, normalize(uSunDir)), 0.0), 1.9);
float sunFacing = max(dot(normW, normalize(uSunDir)) * 0.5 + 0.5, 0.0);
vec3 goldenRim = vec3(1.0, 0.72, 0.33) * fresnelRim * (0.28 + 0.85 * sunBacklight) * sunFacing * uRimStrength;
outgoingLight += goldenRim;
#include <opaque_fragment>`,
      );
  };

  return mat;
}

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
    positions[base] = cx;
    positions[base + 1] = cy + 0.42;
    positions[base + 2] = cz;
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

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  scaleXZ: number;
  scaleY: number;
  rotY: number;
  tiltX: number;
  tiltZ: number;
  tone: number;
  amberWeight: number;
}

interface ClutterPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  tone: number;
}

/**
 * Builds vertex-colored rolling countryside terrain geometry at mount time:
 * - Dusty gravel shoulder within 2m of the road edge
 * - Darker pine-needle / humus soil within 3m of tree trunks
 * - Warm golden grass across elevated hills
 */
function buildTerrainGeometry(trees: TreePlacement[]): THREE.BufferGeometry {
  const widthX = 360;
  const minZ = -630;
  const maxZ = 65;
  const depthZ = maxZ - minZ;
  const segX = 180;
  const segZ = 220;

  const geo = new THREE.PlaneGeometry(widthX, depthZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-6, 0, (minZ + maxZ) * 0.5);

  // Build spatial hash grid (6m cells) for O(1) tree-trunk proximity lookup
  const cellSize = 6.0;
  const treeGrid = new Map<string, TreePlacement[]>();
  for (const tree of trees) {
    const cx = Math.floor(tree.x / cellSize);
    const cz = Math.floor(tree.z / cellSize);
    const key = `${cx},${cz}`;
    const bucket = treeGrid.get(key);
    if (bucket) {
      bucket.push(tree);
    } else {
      treeGrid.set(key, [tree]);
    }
  }

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const valleyOlive = new THREE.Color('#4d6433');
  const warmGoldenGrass = new THREE.Color('#bc9543');
  const sunlitMeadow = new THREE.Color('#8e7f3c');
  const dustyGravel = new THREE.Color('#7f6f58');
  const pineNeedleSoil = new THREE.Color('#272b1b');
  const duskRidge = new THREE.Color('#404148');
  const tmpColor = new THREE.Color();

  const treeMaxRadiusSq = 3.2 * 3.2;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getTerrainHeight(x, z);
    pos.setY(i, y);

    const { sample, distSq } = findNearestRoadSample(x, z);
    const dist = Math.sqrt(distSq);
    const roadEdgeDist = Math.max(0, dist - ROAD_HALF_WIDTH);
    const relElev = y - sample.point.y;

    // 1. Base valley olive blended with warm golden grass on higher hills & sun-facing patches
    const sunPatch =
      0.5 + 0.5 * Math.sin(x * 0.045 + z * 0.03) * Math.cos(x * 0.02 - z * 0.04);
    const hillFactor = smoothstep(0.6, 11.5, relElev);

    tmpColor.copy(valleyOlive).lerp(sunlitMeadow, sunPatch * 0.55);
    tmpColor.lerp(warmGoldenGrass, hillFactor * 0.78);

    // 2. Darker pine-needle / forest-floor soil within 3m of any tree trunk
    const gcx = Math.floor(x / cellSize);
    const gcz = Math.floor(z / cellSize);
    let minTreeDistSq = treeMaxRadiusSq;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = treeGrid.get(`${gcx + dx},${gcz + dz}`);
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const t = bucket[b];
          const tx = x - t.x;
          const tz = z - t.z;
          const d2 = tx * tx + tz * tz;
          if (d2 < minTreeDistSq) minTreeDistSq = d2;
        }
      }
    }

    if (minTreeDistSq < treeMaxRadiusSq) {
      const treeDist = Math.sqrt(minTreeDistSq);
      const needleBlend = 1 - smoothstep(0.5, 3.1, treeDist);
      tmpColor.lerp(pineNeedleSoil, needleBlend * 0.85);
    }

    // 3. Dusty gravel shoulder within 2m of road edge (feathered smoothly out to 3.6m)
    if (roadEdgeDist < 3.6) {
      const gravelBlend = 1 - smoothstep(1.8, 3.6, roadEdgeDist);
      tmpColor.lerp(dustyGravel, gravelBlend * 0.9);
    }

    // 4. Cool dusk tint on distant perimeter mountain flanks
    if (dist > 75 || z < -515) {
      const ridgeBlend = THREE.MathUtils.clamp(Math.max(dist - 75, -515 - z) / 65, 0, 0.75);
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
      const angle = THREE.MathUtils.lerp(-Math.PI * 0.96, -Math.PI * 0.04, i / ridgeArcCount);
      const x = Math.cos(angle) * layer.radius;
      const z = layer.zCenter + Math.sin(angle) * layer.radius * 0.85;

      const harmonic =
        Math.abs(Math.sin(i * 0.24 + layerIdx * 1.7)) * 0.55 +
        Math.abs(Math.cos(i * 0.53 + layerIdx * 0.9)) * 0.3 +
        Math.abs(Math.sin(i * 1.15)) * 0.15;

      const peakY = layer.baseY + harmonic * layer.peakAmp;

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

/**
 * Picks an organic foliage shade interpolating deep pine, olive, and warm autumn amber.
 */
function sampleFoliageShade(
  out: THREE.Color,
  tone: number,
  amberWeight: number,
  isOak: boolean,
): THREE.Color {
  const deepPine = new THREE.Color('#1d3a24');
  const oliveFoliage = new THREE.Color('#4f6831');
  const autumnAmber = new THREE.Color('#bd782b');

  if (isOak) {
    out.copy(oliveFoliage).lerp(deepPine, (1 - tone) * 0.32);
    out.lerp(autumnAmber, smoothstep(0.25, 0.95, amberWeight) * 0.88);
  } else {
    out.copy(deepPine).lerp(oliveFoliage, tone * 0.85);
    if (amberWeight > 0.72) {
      out.lerp(autumnAmber, (amberWeight - 0.72) * 1.45);
    }
  }
  return out;
}

export function RoadAndTerrain() {
  const skyUniforms = useMemo(
    () => ({
      uSunDirection: { value: SUN_DIRECTION.clone() },
    }),
    [],
  );

  // Shared GPU wind & rim-light uniforms updated cleanly inside useFrame
  const timeUniform = useMemo(() => ({ value: 0 }), []);
  const sunDirUniform = useMemo(() => ({ value: SUN_DIRECTION.clone() }), []);

  const reducedMotionRef = useRef<boolean>(
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useFrame(({ clock }) => {
    timeUniform.value = reducedMotionRef.current ? 0 : clock.elapsedTime;
  });

  const asphaltTextures = useMemo(() => createAsphaltTextures(), []);
  const contactShadowTexture = useMemo(() => createContactShadowTexture(), []);
  const contactShadowGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);
  const mountainGeo = useMemo(() => buildMountainRidgeGeometry(), []);

  // Organic procedural geometries for trees, root clutter, and grass
  const pineLowGeo = useMemo(() => buildOrganicPineTierGeometry(1.95, 3.1, 9, 3, 0.22, 11), []);
  const pineMidGeo = useMemo(() => buildOrganicPineTierGeometry(1.5, 2.65, 9, 3, 0.18, 23), []);
  const pineTopGeo = useMemo(() => buildOrganicPineTierGeometry(1.02, 2.2, 8, 2, 0.14, 37), []);
  const oakCanopyMainGeo = useMemo(
    () => buildDisplacedIcosahedronGeometry(1.8, 1, 0.34, 73, 0.86),
    [],
  );
  const oakCanopySubGeo = useMemo(
    () => buildDisplacedIcosahedronGeometry(1.36, 1, 0.28, 97, 0.84),
    [],
  );
  const crossedGrassGeo = useMemo(() => buildCrossedGrassTuftGeometry(), []);
  const rootBushGeo = useMemo(
    () => buildDisplacedIcosahedronGeometry(0.46, 1, 0.14, 17, 0.74),
    [],
  );
  const rootRockGeo = useMemo(
    () => buildDisplacedIcosahedronGeometry(0.36, 0, 0.12, 31, 0.68),
    [],
  );

  // Wind-swaying + golden-hour sun-rim materials via onBeforeCompile
  const pineFoliageMat = useMemo(
    () =>
      createFoliageWindRimMaterial({
        timeUniform,
        sunDirUniform,
        windAmp: 0.085,
        windBaseY: -1.4,
        windTopY: 1.5,
        rimStrength: 0.55,
        roughness: 0.86,
      }),
    [sunDirUniform, timeUniform],
  );

  const oakFoliageMat = useMemo(
    () =>
      createFoliageWindRimMaterial({
        timeUniform,
        sunDirUniform,
        windAmp: 0.105,
        windBaseY: -1.4,
        windTopY: 1.6,
        rimStrength: 0.65,
        roughness: 0.85,
      }),
    [sunDirUniform, timeUniform],
  );

  const grassMat = useMemo(
    () =>
      createFoliageWindRimMaterial({
        timeUniform,
        sunDirUniform,
        windAmp: 0.095,
        windBaseY: 0.02,
        windTopY: 0.62,
        rimStrength: 0.72,
        roughness: 0.82,
        side: THREE.DoubleSide,
      }),
    [sunDirUniform, timeUniform],
  );

  const bushMat = useMemo(
    () =>
      createFoliageWindRimMaterial({
        timeUniform,
        sunDirUniform,
        windAmp: 0.055,
        windBaseY: -0.35,
        windTopY: 0.42,
        rimStrength: 0.62,
        roughness: 0.88,
      }),
    [sunDirUniform, timeUniform],
  );

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

  const dashCount = Math.floor(ROAD_TOTAL_LENGTH / 7.2);
  const dashRef = useRef<THREE.InstancedMesh>(null);

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

  const billboardExclusionZones = useMemo(() => {
    return PROJECT_WAYPOINTS.map((wp) => {
      const frame = getRoadFrameAt(wp.anchorT);
      const sideSign = wp.side === 'left' ? -1 : 1;
      const lateral = (wp.lateralOffset ?? 9.8) * sideSign;
      const bx = frame.point.x + frame.right.x * lateral;
      const bz = frame.point.z + frame.right.z * lateral;
      const approachFrame = getRoadFrameAt(Math.max(0, wp.anchorT - 0.04));
      return { bx, bz, ax: approachFrame.point.x, az: approachFrame.point.z };
    });
  }, []);

  // Deterministic placement for Pines, Oaks, Root Clutter (Grass/Bushes/Rocks), & Roadside Details
  const {
    pines,
    oaks,
    allTrees,
    boulders,
    grassTufts,
    rootGrass,
    rootBushes,
    rootRocks,
  } = useMemo(() => {
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
        const midX = (zone.bx + zone.ax) * 0.5;
        const midZ = (zone.bz + zone.az) * 0.5;
        if (Math.hypot(x - midX, z - midZ) < 13.5) return false;
      }
      return true;
    };

    const pineList: TreePlacement[] = [];
    const oakList: TreePlacement[] = [];
    const boulderList: ClutterPlacement[] = [];
    const grassList: ClutterPlacement[] = [];

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
      const baseScale = 0.78 + rand() * 0.85;
      pineList.push({
        x,
        y,
        z,
        scale: baseScale,
        scaleXZ: baseScale * (0.88 + rand() * 0.26),
        scaleY: baseScale * (0.9 + rand() * 0.28),
        rotY: rand() * Math.PI * 2,
        tiltX: (rand() - 0.5) * 0.06,
        tiltZ: (rand() - 0.5) * 0.06,
        tone: rand(),
        amberWeight: rand(),
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
      const baseScale = 0.74 + rand() * 0.74;
      oakList.push({
        x,
        y,
        z,
        scale: baseScale,
        scaleXZ: baseScale * (0.86 + rand() * 0.32),
        scaleY: baseScale * (0.88 + rand() * 0.26),
        rotY: rand() * Math.PI * 2,
        tiltX: (rand() - 0.5) * 0.07,
        tiltZ: (rand() - 0.5) * 0.07,
        tone: rand(),
        amberWeight: rand(),
      });
    }

    // Root clutter: scatter 5-8 radial points around every tree across 3 InstancedMesh batches
    const combinedTrees = [...pineList, ...oakList];
    const rGrassList: ClutterPlacement[] = [];
    const rBushList: ClutterPlacement[] = [];
    const rRockList: ClutterPlacement[] = [];

    for (const tree of combinedTrees) {
      const clutterCount = 5 + Math.floor(rand() * 4); // 5..8 points per tree
      for (let cIdx = 0; cIdx < clutterCount; cIdx++) {
        const angle = (cIdx / clutterCount) * Math.PI * 2 + (rand() - 0.5) * 0.9;
        const radius = (0.95 + rand() * 2.25) * tree.scale;
        const cx = tree.x + Math.cos(angle) * radius;
        const cz = tree.z + Math.sin(angle) * radius;

        const { distSq } = findNearestRoadSample(cx, cz);
        if (Math.sqrt(distSq) < ROAD_HALF_WIDTH + 2.4) continue;
        if (Math.hypot(cx - OVERLOOK_CENTER.x, cz - OVERLOOK_CENTER.z) < OVERLOOK_RADIUS + 2.5) {
          continue;
        }

        const cy = getTerrainHeight(cx, cz);
        const roll = rand();
        if (roll < 0.52) {
          rGrassList.push({
            x: cx,
            y: cy,
            z: cz,
            scale: 0.75 + rand() * 0.85,
            rotY: rand() * Math.PI * 2,
            tone: rand(),
          });
        } else if (roll < 0.78) {
          rBushList.push({
            x: cx,
            y: cy,
            z: cz,
            scale: 0.65 + rand() * 0.85,
            rotY: rand() * Math.PI * 2,
            tone: rand(),
          });
        } else {
          rRockList.push({
            x: cx,
            y: cy,
            z: cz,
            scale: 0.55 + rand() * 0.95,
            rotY: rand() * Math.PI * 2,
            tone: rand(),
          });
        }
      }
    }

    attempts = 0;
    while (boulderList.length < 140 && attempts < 1400) {
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
        y: getTerrainHeight(x, z) - 0.14,
        z,
        scale: 0.45 + rand() * 1.05,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    attempts = 0;
    while (grassList.length < 420 && attempts < 2200) {
      attempts++;
      const t = 0.02 + rand() * 0.93;
      const { point, right } = getRoadFrameAt(t);
      const side = rand() > 0.5 ? 1 : -1;
      const lateral = ROAD_HALF_WIDTH + 2.2 + rand() * 18;
      const x = point.x + right.x * lateral * side + (rand() - 0.5) * 2;
      const z = point.z + right.z * lateral * side + (rand() - 0.5) * 2;
      if (!isClearOfStructures(x, z, ROAD_HALF_WIDTH + 2.1)) continue;
      grassList.push({
        x,
        y: getTerrainHeight(x, z),
        z,
        scale: 0.72 + rand() * 0.85,
        rotY: rand() * Math.PI * 2,
        tone: rand(),
      });
    }

    return {
      pines: pineList,
      oaks: oakList,
      allTrees: combinedTrees,
      boulders: boulderList,
      grassTufts: grassList,
      rootGrass: rGrassList,
      rootBushes: rBushList,
      rootRocks: rRockList,
    };
  }, [billboardExclusionZones]);

  // Build vertex-colored terrain mesh using tree trunk spatial positions
  const terrainGeo = useMemo(() => buildTerrainGeometry(allTrees), [allTrees]);

  // Instanced refs
  const pineTrunkRef = useRef<THREE.InstancedMesh>(null);
  const pineLowRef = useRef<THREE.InstancedMesh>(null);
  const pineMidRef = useRef<THREE.InstancedMesh>(null);
  const pineTopRef = useRef<THREE.InstancedMesh>(null);

  const oakTrunkRef = useRef<THREE.InstancedMesh>(null);
  const oakCanopyMainRef = useRef<THREE.InstancedMesh>(null);
  const oakCanopySubRef = useRef<THREE.InstancedMesh>(null);

  const contactShadowRef = useRef<THREE.InstancedMesh>(null);
  const rootGrassRef = useRef<THREE.InstancedMesh>(null);
  const rootBushRef = useRef<THREE.InstancedMesh>(null);
  const rootRockRef = useRef<THREE.InstancedMesh>(null);

  const boulderRef = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);

  // Dispose procedural GPU assets cleanly on unmount
  useEffect(() => {
    return () => {
      asphaltTextures.map.dispose();
      asphaltTextures.roughnessMap.dispose();
      contactShadowTexture.dispose();
      contactShadowGeo.dispose();
      terrainGeo.dispose();
      mountainGeo.dispose();
      roadGeo.dispose();
      shoulderGeo.dispose();
      leftFogLineGeo.dispose();
      rightFogLineGeo.dispose();
      guardrailSpans.forEach((s) => s.geo.dispose());
      pineLowGeo.dispose();
      pineMidGeo.dispose();
      pineTopGeo.dispose();
      oakCanopyMainGeo.dispose();
      oakCanopySubGeo.dispose();
      crossedGrassGeo.dispose();
      rootBushGeo.dispose();
      rootRockGeo.dispose();
      pineFoliageMat.dispose();
      oakFoliageMat.dispose();
      grassMat.dispose();
      bushMat.dispose();
    };
  }, [
    asphaltTextures,
    bushMat,
    contactShadowGeo,
    contactShadowTexture,
    crossedGrassGeo,
    grassMat,
    guardrailSpans,
    leftFogLineGeo,
    mountainGeo,
    oakCanopyMainGeo,
    oakCanopySubGeo,
    oakFoliageMat,
    pineFoliageMat,
    pineLowGeo,
    pineMidGeo,
    pineTopGeo,
    rightFogLineGeo,
    roadGeo,
    rootBushGeo,
    rootRockGeo,
    shoulderGeo,
    terrainGeo,
  ]);

  // Populate all static InstancedMeshes once at mount
  useEffect(() => {
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const terrainNormal = new THREE.Vector3();
    const slopeQuat = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();

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

    // 3. Organic Pine Trees (randomized Y rotation, non-uniform scale, deep-pine -> olive -> amber shades)
    if (pineTrunkRef.current && pineLowRef.current && pineMidRef.current && pineTopRef.current) {
      pines.forEach((tree, i) => {
        const sxz = tree.scaleXZ;
        const sy = tree.scaleY;
        dummy.rotation.set(tree.tiltX, tree.rotY, tree.tiltZ);

        dummy.position.set(tree.x, tree.y + 1.4 * sy, tree.z);
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        pineTrunkRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 3.4 * sy, tree.z);
        dummy.updateMatrix();
        pineLowRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.rotation.set(tree.tiltX, tree.rotY + 0.55, tree.tiltZ);
        dummy.position.set(tree.x, tree.y + 5.1 * sy, tree.z);
        dummy.updateMatrix();
        pineMidRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.rotation.set(tree.tiltX, tree.rotY + 1.1, tree.tiltZ);
        dummy.position.set(tree.x, tree.y + 6.6 * sy, tree.z);
        dummy.updateMatrix();
        pineTopRef.current!.setMatrixAt(i, dummy.matrix);

        sampleFoliageShade(c, tree.tone, tree.amberWeight, false);
        pineLowRef.current!.setColorAt(i, c);
        pineMidRef.current!.setColorAt(i, c.clone().offsetHSL(0.008, 0.03, 0.035));
        pineTopRef.current!.setColorAt(i, c.clone().offsetHSL(0.015, 0.04, 0.065));
      });
      [pineTrunkRef, pineLowRef, pineMidRef, pineTopRef].forEach((ref) => {
        if (ref.current) {
          ref.current.instanceMatrix.needsUpdate = true;
          if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
        }
      });
    }

    // 4. Organic Oak Trees (displaced icosahedron crowns + deep-olive -> autumn amber variation)
    if (oakTrunkRef.current && oakCanopyMainRef.current && oakCanopySubRef.current) {
      oaks.forEach((tree, i) => {
        const sxz = tree.scaleXZ;
        const sy = tree.scaleY;
        dummy.rotation.set(tree.tiltX, tree.rotY, tree.tiltZ);

        dummy.position.set(tree.x, tree.y + 1.25 * sy, tree.z);
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        oakTrunkRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tree.x, tree.y + 3.65 * sy, tree.z);
        dummy.scale.set(sxz * 1.12, sy * 0.96, sxz * 1.06);
        dummy.updateMatrix();
        oakCanopyMainRef.current!.setMatrixAt(i, dummy.matrix);

        dummy.rotation.set(tree.tiltX, tree.rotY + 1.35, tree.tiltZ);
        dummy.position.set(
          tree.x + Math.cos(tree.rotY) * 1.05 * sxz,
          tree.y + 3.2 * sy,
          tree.z + Math.sin(tree.rotY) * 1.05 * sxz,
        );
        dummy.scale.set(sxz * 0.82, sy * 0.76, sxz * 0.8);
        dummy.updateMatrix();
        oakCanopySubRef.current!.setMatrixAt(i, dummy.matrix);

        sampleFoliageShade(c, tree.tone, tree.amberWeight, true);
        oakCanopyMainRef.current!.setColorAt(i, c);
        oakCanopySubRef.current!.setColorAt(i, c.clone().offsetHSL(-0.015, 0.04, 0.04));
      });
      [oakTrunkRef, oakCanopyMainRef, oakCanopySubRef].forEach((ref) => {
        if (ref.current) {
          ref.current.instanceMatrix.needsUpdate = true;
          if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
        }
      });
    }

    // 5. Tree Contact Shadows aligned cleanly to terrain surface normal beneath every trunk
    if (contactShadowRef.current) {
      allTrees.forEach((tree, i) => {
        getTerrainNormal(tree.x, tree.z, terrainNormal);
        slopeQuat.setFromUnitVectors(upAxis, terrainNormal);
        yawQuat.setFromAxisAngle(upAxis, tree.rotY);
        dummy.quaternion.copy(slopeQuat).multiply(yawQuat);

        // Offset slightly along terrain normal so contact shadow never sinks into sloping terrain
        dummy.position.set(
          tree.x + terrainNormal.x * 0.06,
          tree.y + terrainNormal.y * 0.06,
          tree.z + terrainNormal.z * 0.06,
        );
        const shadowSpan = (i < pines.length ? 4.5 : 5.0) * tree.scaleXZ;
        dummy.scale.set(shadowSpan, 1, shadowSpan);
        dummy.updateMatrix();
        contactShadowRef.current!.setMatrixAt(i, dummy.matrix);
      });
      contactShadowRef.current.instanceMatrix.needsUpdate = true;
    }

    // 6. Root Clutter Batch A: Crossed low-poly grass tufts
    if (rootGrassRef.current) {
      rootGrass.forEach((g, i) => {
        getTerrainNormal(g.x, g.z, terrainNormal);
        terrainNormal.lerp(upAxis, 0.55).normalize();
        slopeQuat.setFromUnitVectors(upAxis, terrainNormal);
        yawQuat.setFromAxisAngle(upAxis, g.rotY);
        dummy.quaternion.copy(slopeQuat).multiply(yawQuat);
        dummy.position.set(g.x, g.y - 0.02, g.z);
        dummy.scale.set(g.scale, g.scale * (0.85 + g.tone * 0.45), g.scale);
        dummy.updateMatrix();
        rootGrassRef.current!.setMatrixAt(i, dummy.matrix);

        c.set('#445c2c').lerp(new THREE.Color('#a4863c'), g.tone);
        rootGrassRef.current!.setColorAt(i, c);
      });
      rootGrassRef.current.instanceMatrix.needsUpdate = true;
      if (rootGrassRef.current.instanceColor) rootGrassRef.current.instanceColor.needsUpdate = true;
    }

    // 7. Root Clutter Batch B: Small displaced-icosahedron bushes
    if (rootBushRef.current) {
      rootBushes.forEach((b, i) => {
        dummy.position.set(b.x, b.y + 0.12 * b.scale, b.z);
        dummy.rotation.set((b.tone - 0.5) * 0.22, b.rotY, (0.5 - b.tone) * 0.22);
        dummy.scale.set(b.scale * 1.15, b.scale * 0.78, b.scale * 1.1);
        dummy.updateMatrix();
        rootBushRef.current!.setMatrixAt(i, dummy.matrix);

        sampleFoliageShade(c, b.tone, b.tone * 0.9, b.tone > 0.55);
        rootBushRef.current!.setColorAt(i, c);
      });
      rootBushRef.current.instanceMatrix.needsUpdate = true;
      if (rootBushRef.current.instanceColor) rootBushRef.current.instanceColor.needsUpdate = true;
    }

    // 8. Root Clutter Batch C: Low-poly rocks partially embedded in the ground
    if (rootRockRef.current) {
      rootRocks.forEach((r, i) => {
        getTerrainNormal(r.x, r.z, terrainNormal);
        dummy.position.set(
          r.x - terrainNormal.x * 0.1 * r.scale,
          r.y - 0.12 * r.scale,
          r.z - terrainNormal.z * 0.1 * r.scale,
        );
        dummy.rotation.set(r.tone * 0.8, r.rotY, (1 - r.tone) * 0.6);
        dummy.scale.set(r.scale * 1.25, r.scale * 0.68, r.scale * 1.05);
        dummy.updateMatrix();
        rootRockRef.current!.setMatrixAt(i, dummy.matrix);

        c.set('#4c4b45').lerp(new THREE.Color('#6f6659'), r.tone);
        rootRockRef.current!.setColorAt(i, c);
      });
      rootRockRef.current.instanceMatrix.needsUpdate = true;
      if (rootRockRef.current.instanceColor) rootRockRef.current.instanceColor.needsUpdate = true;
    }

    // 9. Roadside boulders
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

    // 10. Roadside crossed grass tufts
    if (grassRef.current) {
      grassTufts.forEach((g, i) => {
        getTerrainNormal(g.x, g.z, terrainNormal);
        terrainNormal.lerp(upAxis, 0.6).normalize();
        slopeQuat.setFromUnitVectors(upAxis, terrainNormal);
        yawQuat.setFromAxisAngle(upAxis, g.rotY);
        dummy.quaternion.copy(slopeQuat).multiply(yawQuat);
        dummy.position.set(g.x, g.y - 0.02, g.z);
        dummy.scale.set(g.scale * 1.1, g.scale * (0.85 + g.tone * 0.4), g.scale * 1.1);
        dummy.updateMatrix();
        grassRef.current!.setMatrixAt(i, dummy.matrix);

        c.set('#526935').lerp(new THREE.Color('#b69242'), g.tone);
        grassRef.current!.setColorAt(i, c);
      });
      grassRef.current.instanceMatrix.needsUpdate = true;
      if (grassRef.current.instanceColor) grassRef.current.instanceColor.needsUpdate = true;
    }
  }, [
    allTrees,
    boulders,
    dashCount,
    grassTufts,
    guardrailPostData,
    oaks,
    pines,
    rootBushes,
    rootGrass,
    rootRocks,
  ]);

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

      {/* Rolling vertex-colored hills (gravel shoulder, dark pine soil, golden grass) */}
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors={true} roughness={0.95} metalness={0.02} />
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
          <meshStandardMaterial color="#2b2d34" roughness={0.85} metalness={0.1} />
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

      {/* Soft dark-olive contact shadows aligned to terrain normal beneath every tree trunk */}
      <instancedMesh
        ref={contactShadowRef}
        geometry={contactShadowGeo}
        args={[undefined, undefined, allTrees.length]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          map={contactShadowTexture}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </instancedMesh>

      {/* Instanced Organic Pine Trees */}
      <instancedMesh ref={pineTrunkRef} args={[undefined, undefined, pines.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.16, 0.28, 2.9, 7]} />
        <meshStandardMaterial color="#4a3728" roughness={0.92} />
      </instancedMesh>
      <instancedMesh
        ref={pineLowRef}
        geometry={pineLowGeo}
        material={pineFoliageMat}
        args={[undefined, undefined, pines.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={pineMidRef}
        geometry={pineMidGeo}
        material={pineFoliageMat}
        args={[undefined, undefined, pines.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={pineTopRef}
        geometry={pineTopGeo}
        material={pineFoliageMat}
        args={[undefined, undefined, pines.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* Instanced Organic Oak Trees (displaced icosahedrons with wind & rim light) */}
      <instancedMesh ref={oakTrunkRef} args={[undefined, undefined, oaks.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.2, 0.34, 2.6, 7]} />
        <meshStandardMaterial color="#4f3b2b" roughness={0.92} />
      </instancedMesh>
      <instancedMesh
        ref={oakCanopyMainRef}
        geometry={oakCanopyMainGeo}
        material={oakFoliageMat}
        args={[undefined, undefined, oaks.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={oakCanopySubRef}
        geometry={oakCanopySubGeo}
        material={oakFoliageMat}
        args={[undefined, undefined, oaks.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* Root Clutter Batch 1: Crossed low-poly grass tufts */}
      {rootGrass.length > 0 && (
        <instancedMesh
          ref={rootGrassRef}
          geometry={crossedGrassGeo}
          material={grassMat}
          args={[undefined, undefined, rootGrass.length]}
          frustumCulled={false}
        />
      )}

      {/* Root Clutter Batch 2: Small displaced-icosahedron bushes */}
      {rootBushes.length > 0 && (
        <instancedMesh
          ref={rootBushRef}
          geometry={rootBushGeo}
          material={bushMat}
          args={[undefined, undefined, rootBushes.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      )}

      {/* Root Clutter Batch 3: Low-poly rocks partially embedded in ground */}
      {rootRocks.length > 0 && (
        <instancedMesh
          ref={rootRockRef}
          geometry={rootRockGeo}
          args={[undefined, undefined, rootRocks.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <meshStandardMaterial roughness={0.93} metalness={0.04} />
        </instancedMesh>
      )}

      {/* Roadside Boulders */}
      <instancedMesh ref={boulderRef} args={[undefined, undefined, boulders.length]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial roughness={0.92} />
      </instancedMesh>

      {/* Roadside Crossed Grass Tufts */}
      <instancedMesh
        ref={grassRef}
        geometry={crossedGrassGeo}
        material={grassMat}
        args={[undefined, undefined, grassTufts.length]}
        frustumCulled={false}
      />
    </group>
  );
}
