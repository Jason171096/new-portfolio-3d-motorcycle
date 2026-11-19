import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PROJECT_WAYPOINTS, type WaypointConfig } from '../data/waypoints';
import { getRoadFrameAt, getTerrainHeight } from '../utils/roadSpline';
import { createFallbackProjectTexture } from '../utils/textures';

interface ProjectWaypointsProps {
  progressRef: React.MutableRefObject<number>;
  reducedMotion: boolean;
}

/**
 * Loads the project WebP screenshot texture from `/assets/projects/*.webp`,
 * immediately rendering a crisp procedural preview fallback until loaded (or if missing).
 */
function useProjectTexture(waypoint: WaypointConfig): THREE.Texture {
  const fallbackTexture = useMemo(() => createFallbackProjectTexture(waypoint), [waypoint]);
  const [texture, setTexture] = useState<THREE.Texture>(fallbackTexture);

  useEffect(() => {
    setTexture(fallbackTexture);
    if (!waypoint.imagePath) return;

    let cancelled = false;
    const loader = new THREE.TextureLoader();

    loader.load(
      waypoint.imagePath,
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 8;
        loaded.needsUpdate = true;
        setTexture(loaded);
      },
      undefined,
      () => {
        // Keep clean procedural preview fallback if capture file has not been dropped in yet
      },
    );

    return () => {
      cancelled = true;
    };
  }, [fallbackTexture, waypoint.imagePath]);

  useEffect(() => {
    return () => {
      fallbackTexture.dispose();
    };
  }, [fallbackTexture]);

  return texture;
}

function RoadsideBillboard({
  waypoint,
  progressRef,
  reducedMotion,
}: {
  waypoint: WaypointConfig & { anchorT: number; imagePath: string };
  progressRef: React.MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const screenTexture = useProjectTexture(waypoint);
  const floatGroupRef = useRef<THREE.Group>(null);
  const frameGlowMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const screenMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const beaconMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const activeLevelRef = useRef(0);

  const placement = useMemo(() => {
    const anchorFrame = getRoadFrameAt(waypoint.anchorT);
    const sideSign = waypoint.side === 'left' ? -1 : 1;
    const lateral = (waypoint.lateralOffset ?? 9.8) * sideSign;

    const bx = anchorFrame.point.x + anchorFrame.right.x * lateral;
    const bz = anchorFrame.point.z + anchorFrame.right.z * lateral;
    const by = getTerrainHeight(bx, bz);

    // Orient display face (+Z) cleanly toward the approaching rider & chase camera
    const approachT = Math.max(0.02, waypoint.anchorT - 0.068);
    const approachFrame = getRoadFrameAt(approachT);
    const dirToApproach = new THREE.Vector3(
      approachFrame.point.x - bx,
      0,
      approachFrame.point.z - bz,
    ).normalize();

    const yaw = Math.atan2(dirToApproach.x, dirToApproach.z);
    return {
      position: [bx, by, bz] as [number, number, number],
      yaw,
    };
  }, [waypoint.anchorT, waypoint.lateralOffset, waypoint.side]);

  const accentColor = useMemo(() => new THREE.Color(waypoint.accentColor), [waypoint.accentColor]);

  useFrame(({ clock }, delta) => {
    const p = progressRef.current;
    const [start, end] = waypoint.range;
    const pad = 0.045;

    let targetActive = 0;
    if (p >= start - pad && p <= end + pad) {
      if (p < start) {
        targetActive = (p - (start - pad)) / pad;
      } else if (p > end) {
        targetActive = 1 - (p - end) / pad;
      } else {
        targetActive = 1;
      }
    }

    const dampFactor = reducedMotion ? 1 : 1 - Math.exp(-6 * delta);
    activeLevelRef.current = THREE.MathUtils.lerp(activeLevelRef.current, targetActive, dampFactor);
    const active = activeLevelRef.current;

    if (floatGroupRef.current) {
      const hoverY = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 1.5 + waypoint.anchorT * 10) * 0.06 * active;
      floatGroupRef.current.position.y = 4.05 + hoverY;
    }

    if (frameGlowMatRef.current) {
      frameGlowMatRef.current.emissiveIntensity = 0.55 + active * 2.1;
    }
    if (screenMatRef.current) {
      screenMatRef.current.emissiveIntensity = 0.35 + active * 0.42;
    }
    if (beaconMatRef.current) {
      beaconMatRef.current.emissiveIntensity = 0.8 + active * 2.2;
    }
  });

  // Screen & frame dimensions (16:10 architectural widescreen display)
  const screenW = 8.4;
  const screenH = 5.1;

  return (
    <group position={placement.position} rotation={[0, placement.yaw, 0]} name={`billboard-${waypoint.id}`}>
      {/* Basalt / Architectural Concrete Foundation Plinth */}
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[5.4, 0.9, 1.8]} />
        <meshStandardMaterial color="#1f232b" roughness={0.85} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 0.22, 1.35]} />
        <meshStandardMaterial color="#343a46" roughness={0.62} metalness={0.42} />
      </mesh>

      {/* Twin Dark-Anodized Structural Steel Columns */}
      <mesh position={[-2.1, 2.55, -0.22]} castShadow>
        <boxGeometry args={[0.26, 3.6, 0.34]} />
        <meshStandardMaterial color="#181b22" metalness={0.78} roughness={0.32} />
      </mesh>
      <mesh position={[2.1, 2.55, -0.22]} castShadow>
        <boxGeometry args={[0.26, 3.6, 0.34]} />
        <meshStandardMaterial color="#181b22" metalness={0.78} roughness={0.32} />
      </mesh>
      {/* Horizontal structural crossbeam */}
      <mesh position={[0, 2.2, -0.26]} castShadow>
        <boxGeometry args={[4.8, 0.22, 0.22]} />
        <meshStandardMaterial color="#272c36" metalness={0.75} roughness={0.35} />
      </mesh>

      {/* Roadside Mile-Marker Pylon beside the foundation */}
      <group position={[waypoint.side === 'left' ? 3.3 : -3.3, 0, 0.65]}>
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[0.38, 2.1, 0.22]} />
          <meshStandardMaterial color="#171920" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.95, 0.12]}>
          <boxGeometry args={[0.3, 0.14, 0.04]} />
          <meshStandardMaterial
            ref={beaconMatRef}
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={1.1}
          />
        </mesh>
        <Text
          position={[0, 1.45, 0.125]}
          fontSize={0.22}
          color="#f8fafc"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.08}
        >
          {waypoint.mileNumber}
        </Text>
      </group>

      {/* Cantilevered Floating Glassmorphic Display Frame */}
      <group ref={floatGroupRef} position={[0, 4.05, 0.18]}>
        {/* Outer brushed aluminum backing cabinet */}
        <mesh position={[0, 0, -0.14]} castShadow receiveShadow>
          <boxGeometry args={[screenW + 0.54, screenH + 0.54, 0.18]} />
          <meshStandardMaterial color="#14171f" metalness={0.82} roughness={0.28} />
        </mesh>

        {/* Translucent frosted glassmorphic outer rim */}
        <mesh position={[0, 0, -0.02]}>
          <boxGeometry args={[screenW + 0.72, screenH + 0.72, 0.06]} />
          <meshPhysicalMaterial
            color="#d8e2f2"
            transparent
            opacity={0.24}
            roughness={0.18}
            metalness={0.1}
            transmission={0.35}
          />
        </mesh>

        {/* Glowing LED accent edge frame */}
        <mesh position={[0, (screenH + 0.58) * 0.5, 0.04]}>
          <boxGeometry args={[screenW + 0.56, 0.055, 0.05]} />
          <meshStandardMaterial
            ref={frameGlowMatRef}
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.8}
          />
        </mesh>
        <mesh position={[0, -(screenH + 0.58) * 0.5, 0.04]}>
          <boxGeometry args={[screenW + 0.56, 0.055, 0.05]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
        </mesh>

        {/* High-res Project UI Screenshot Canvas */}
        <mesh position={[0, 0, 0.03]}>
          <planeGeometry args={[screenW, screenH]} />
          <meshStandardMaterial
            ref={screenMatRef}
            map={screenTexture}
            emissiveMap={screenTexture}
            emissive="#ffffff"
            emissiveIntensity={0.45}
            roughness={0.32}
            metalness={0.06}
          />
        </mesh>

        {/* Floating architectural title bar above screen */}
        <group position={[0, screenH * 0.5 + 0.68, 0.04]}>
          <mesh>
            <boxGeometry args={[6.4, 0.58, 0.08]} />
            <meshStandardMaterial color="#0f1219" metalness={0.65} roughness={0.32} />
          </mesh>
          <Text
            position={[0, 0.01, 0.055]}
            fontSize={0.26}
            maxWidth={5.9}
            color="#f8fafc"
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.04}
          >
            {`${waypoint.mileNumber}  //  ${waypoint.title.toUpperCase()}`}
          </Text>
        </group>

        {/* Subtle warm uplight washing the frame */}
        <pointLight
          position={[0, -screenH * 0.45, 2.2]}
          color={waypoint.accentColor}
          intensity={3.5}
          distance={12}
          decay={1.8}
        />
      </group>
    </group>
  );
}

export function ProjectWaypoints({ progressRef, reducedMotion }: ProjectWaypointsProps) {
  return (
    <group name="project-waypoints">
      {PROJECT_WAYPOINTS.map((wp) => (
        <RoadsideBillboard
          key={wp.id}
          waypoint={wp}
          progressRef={progressRef}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
}
