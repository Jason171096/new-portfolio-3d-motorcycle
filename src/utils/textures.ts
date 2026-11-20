import * as THREE from 'three';
import type { WaypointConfig } from '../data/waypoints';

/**
 * Generates seamless tileable asphalt diffuse + roughness textures on an offscreen canvas.
 */
export function createAsphaltTextures(): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base dark weathered slate asphalt
  ctx.fillStyle = '#25272d';
  ctx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#c8c8c8';
  rCtx.fillRect(0, 0, size, size);

  // Subtle darker tire-track wear along left/right lane centers
  const drawTrack = (cx: number) => {
    const grad = ctx.createLinearGradient(cx - 56, 0, cx + 56, 0);
    grad.addColorStop(0, 'rgba(18, 20, 24, 0)');
    grad.addColorStop(0.5, 'rgba(14, 15, 19, 0.36)');
    grad.addColorStop(1, 'rgba(18, 20, 24, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 56, 0, 112, size);

    const rGrad = rCtx.createLinearGradient(cx - 56, 0, cx + 56, 0);
    rGrad.addColorStop(0, 'rgba(130, 130, 130, 0)');
    rGrad.addColorStop(0.5, 'rgba(95, 95, 95, 0.45)');
    rGrad.addColorStop(1, 'rgba(130, 130, 130, 0)');
    rCtx.fillStyle = rGrad;
    rCtx.fillRect(cx - 56, 0, 112, size);
  };

  drawTrack(size * 0.28);
  drawTrack(size * 0.72);

  // Deterministic pseudo-random mineral aggregate speckle
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 24000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const tone = Math.floor(26 + rand() * 34);
    const alpha = 0.28 + rand() * 0.35;
    const speckSize = rand() > 0.85 ? 2 : 1;
    ctx.fillStyle = `rgba(${tone}, ${tone + 1}, ${tone + 4}, ${alpha})`;
    ctx.fillRect(x, y, speckSize, speckSize);

    const rTone = Math.floor(150 + rand() * 85);
    rCtx.fillStyle = `rgba(${rTone}, ${rTone}, ${rTone}, 0.35)`;
    rCtx.fillRect(x, y, speckSize, speckSize);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 76);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(1, 76);
  roughnessMap.anisotropy = 8;

  return { map, roughnessMap };
}

const fallbackDataUrlCache = new Map<string, string>();

/**
 * Draws a crisp procedural UI preview canvas for a project waypoint
 * used whenever an external `/assets/projects/*.webp` capture is missing on disk.
 */
function renderFallbackProjectCanvas(waypoint: WaypointConfig): HTMLCanvasElement {
  const width = 1280;
  const height = 768;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Deterministic seed per waypoint ID so each missing screenshot has distinct chart/card telemetry
  let hash = 2166136261;
  for (let i = 0; i < waypoint.id.length; i++) {
    hash ^= waypoint.id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const seedOffset = Math.abs(hash) % 97;

  // Background slate gradient with subtle accent glow
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0d121c');
  bg.addColorStop(1, '#171d2c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.82, 160, 20, width * 0.82, 160, 480);
  glow.addColorStop(0, `${waypoint.accentColor}2e`);
  glow.addColorStop(1, 'rgba(13, 18, 28, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Subtle architectural grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Top browser chrome bar
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(48, 38, width - 96, 54);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.strokeRect(48, 38, width - 96, 54);

  // Traffic lights
  ['#f87171', '#fbbf24', '#34d399'].forEach((c, idx) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(82 + idx * 24, 65, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // Address bar pill
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.fillRect(184, 49, 440, 32);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.strokeRect(184, 49, 440, 32);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 16px monospace';
  ctx.fillText(`https://jasonmartinez.dev/projects/${waypoint.id}`, 202, 70);

  // Mile badge & title (auto-scaled so longer project titles never clip)
  ctx.fillStyle = waypoint.accentColor;
  ctx.font = '600 21px monospace';
  ctx.fillText(`${waypoint.mileNumber} // ARCHITECTURE PREVIEW`, 64, 146);

  ctx.fillStyle = '#f8fafc';
  const maxTitleWidth = width - 128;
  let titleFontSize = 42;
  ctx.font = `700 ${titleFontSize}px sans-serif`;
  while (ctx.measureText(waypoint.title).width > maxTitleWidth && titleFontSize > 28) {
    titleFontSize -= 2;
    ctx.font = `700 ${titleFontSize}px sans-serif`;
  }
  ctx.fillText(waypoint.title, 64, 202, maxTitleWidth);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 23px sans-serif';
  ctx.fillText(waypoint.subtitle, 64, 244, maxTitleWidth);

  // Mock dashboard telemetry & workflow cards
  const cardLabels = ['LIVE TELEMETRY', 'THROUGHPUT & LATENCY', 'PIPELINE STATUS'];
  for (let i = 0; i < 3; i++) {
    const cx = 64 + i * 392;
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.065)' : 'rgba(255,255,255,0.045)';
    ctx.fillRect(cx, 290, 368, 272);
    ctx.strokeStyle = i === 0 ? waypoint.accentColor : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = i === 0 ? 2 : 1;
    ctx.strokeRect(cx, 290, 368, 272);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 15px monospace';
    ctx.fillText(cardLabels[i], cx + 26, 326);

    if (i === 1) {
      // Trend line & area plot for middle card
      ctx.strokeStyle = waypoint.accentColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let p = 0; p < 8; p++) {
        const px = cx + 28 + p * 44;
        const py = 505 - ((seedOffset * 13 + p * 37 + (p % 2) * 35) % 115);
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 32px monospace';
      ctx.fillText(`${94 + (seedOffset % 6)}.${(seedOffset * 3) % 9}% SLA`, cx + 26, 374);
    } else if (i === 2) {
      // Structured workflow nodes for right card
      const nodes = waypoint.techStack.slice(0, 3);
      nodes.forEach((node, nIdx) => {
        const ny = 352 + nIdx * 62;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(cx + 26, ny, 316, 44);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx + 26, ny, 316, 44);

        ctx.fillStyle = waypoint.accentColor;
        ctx.beginPath();
        ctx.arc(cx + 48, ny + 22, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '500 18px monospace';
        ctx.fillText(node, cx + 66, ny + 28, 250);
      });
    } else {
      // Chart bars for primary card
      ctx.fillStyle = waypoint.accentColor;
      for (let b = 0; b < 7; b++) {
        const barH = 44 + ((seedOffset * 11 + b * 29) % 130);
        ctx.fillRect(cx + 32 + b * 44, 526 - barH, 24, barH);
      }
    }
  }

  // Tech pills row
  let pillX = 64;
  let pillY = 616;
  ctx.font = '500 19px monospace';
  waypoint.techStack.slice(0, 5).forEach((tech) => {
    const w = ctx.measureText(tech).width + 34;
    if (pillX + w > width - 64) {
      pillX = 64;
      pillY += 54;
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(pillX, pillY, w, 42);
    ctx.strokeStyle = waypoint.accentColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pillX, pillY, w, 42);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(tech, pillX + 17, pillY + 27);
    pillX += w + 14;
  });

  return canvas;
}

/**
 * Creates a crisp procedural Three.js texture for a project billboard
 * as an immediate fallback whenever an external WebP capture is missing or loading.
 */
export function createFallbackProjectTexture(waypoint: WaypointConfig): THREE.CanvasTexture {
  const canvas = renderFallbackProjectCanvas(waypoint);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates and caches a data URL for the procedural UI preview so HUD thumbnails
 * and lightboxes never display a broken image when a WebP capture is absent on disk.
 */
export function createFallbackProjectDataUrl(waypoint: WaypointConfig): string {
  const cached = fallbackDataUrlCache.get(waypoint.id);
  if (cached) return cached;
  const dataUrl = renderFallbackProjectCanvas(waypoint).toDataURL('image/png');
  fallbackDataUrlCache.set(waypoint.id, dataUrl);
  return dataUrl;
}
