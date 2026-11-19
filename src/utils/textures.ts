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
  map.repeat.set(1, 56);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(1, 56);
  roughnessMap.anisotropy = 8;

  return { map, roughnessMap };
}

/**
 * Creates a crisp procedural UI preview texture for a project billboard
 * as an immediate fallback whenever an external WebP capture is missing or replaced.
 */
export function createFallbackProjectTexture(waypoint: WaypointConfig): THREE.CanvasTexture {
  const width = 1280;
  const height = 768;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Background slate gradient
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0f141e');
  bg.addColorStop(1, '#181e2c');
  ctx.fillStyle = bg;
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
  ctx.fillRect(48, 42, width - 96, 56);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.strokeRect(48, 42, width - 96, 56);

  // Traffic lights
  ['#f87171', '#fbbf24', '#34d399'].forEach((c, idx) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(82 + idx * 24, 70, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // Mile badge & title
  ctx.fillStyle = waypoint.accentColor;
  ctx.font = '600 22px monospace';
  ctx.fillText(`${waypoint.mileNumber} // ARCHITECTURE PREVIEW`, 64, 158);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 44px sans-serif';
  ctx.fillText(waypoint.title, 64, 218);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 24px sans-serif';
  ctx.fillText(waypoint.subtitle, 64, 260);

  // Mock dashboard cards
  const cardColors = ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.05)'];
  for (let i = 0; i < 3; i++) {
    const cx = 64 + i * 392;
    ctx.fillStyle = cardColors[i];
    ctx.fillRect(cx, 310, 368, 250);
    ctx.strokeStyle = i === 0 ? waypoint.accentColor : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = i === 0 ? 2 : 1;
    ctx.strokeRect(cx, 310, 368, 250);

    // Chart bars
    ctx.fillStyle = waypoint.accentColor;
    for (let b = 0; b < 7; b++) {
      const barH = 42 + ((i * 37 + b * 29) % 120);
      ctx.fillRect(cx + 32 + b * 44, 520 - barH, 24, barH);
    }
  }

  // Tech pills row
  let pillX = 64;
  ctx.font = '500 20px monospace';
  waypoint.techStack.slice(0, 5).forEach((tech) => {
    const w = ctx.measureText(tech).width + 36;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(pillX, 620, w, 44);
    ctx.strokeStyle = waypoint.accentColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pillX, 620, w, 44);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(tech, pillX + 18, 649);
    pillX += w + 16;
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
