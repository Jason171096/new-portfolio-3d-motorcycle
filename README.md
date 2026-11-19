# Jason Martinez (`jasonmartinez.dev`) — Interactive 3D Highway Portfolio

An interactive 3D WebGL scrollytelling highway portfolio built for **Jason Martinez**, a Backend, Cloud, and AI Software Engineer specializing in **C#, SQL, Java, cloud infrastructure, and AI integrations**.

Scrolling drives a stylized **Bajaj Pulsar N250** naked streetfighter motorcycle along a winding golden-hour countryside highway (`CatmullRomCurve3`). Along the route, architectural roadside billboards and synchronized glassmorphic HUD cards display Jason's featured engineering projects before arriving at a scenic sunset mountain overlook.

---

## Tech Stack

- **Framework:** React 18, TypeScript, Vite, Tailwind CSS
- **3D & WebGL:** Three.js, `@react-three/fiber`, `@react-three/drei`
- **Scroll & Animation:** GSAP (`ScrollTrigger`) + `lenis` momentum-based smooth scrolling

---

## Deliverable Architecture

| File | Responsibility |
| :--- | :--- |
| [`src/App.tsx`](src/App.tsx) | Initializes `Lenis` smooth scrolling, binds GSAP `ScrollTrigger` (`0%` to `100%`) to the virtual highway scroll track, manages reduced-motion preferences, and coordinates the 3D scene and HUD. |
| [`src/Scene.tsx`](src/Scene.tsx) | Hosts the R3F `<Canvas>` and `<ChaseCameraRig />`, positioning a smooth-damped third-person chase camera behind the motorcycle that dynamically shifts framing toward approaching roadside displays and adapts for mobile viewports. |
| [`src/RoadAndTerrain.tsx`](src/RoadAndTerrain.tsx) | Generates the winding asphalt highway along a `CatmullRomCurve3` spline with dashed center markings, cat-eye reflectors, reflective W-beam guardrails, rolling golden-green hills, distant mountain silhouettes, instanced pine/oak trees (`InstancedMesh`), a custom GLSL sunset sky dome, and `fogExp2` horizon atmosphere. |
| [`src/Motorcycle.tsx`](src/Motorcycle.tsx) | Procedural naked sport motorcycle inspired by the **Bajaj Pulsar N250** (Brooklyn Charcoal tank shrouds, bi-functional LED projector headlight with volumetric beam cone, spinning alloy wheels with brake rotors, and crystalline ruby LED tail light). Syncs wheel rotation to scroll velocity and banks realistically into curves based on road spline curvature. Includes `modelUrl` prop & `useCustomMotorcycleModel` hook to swap in a custom `.glb` asset. |
| [`src/ProjectWaypoints.tsx`](src/ProjectWaypoints.tsx) | Contains the strongly-typed `PROJECT_WAYPOINTS` configuration array and renders the 3D cantilevered roadside billboards, Mile 0.0 highway gantry, and Mile 4.0 Destination Overlook pavilion. |
| [`src/HUD.tsx`](src/HUD.tsx) | Minimalist viewport HUD featuring the top-left `JM` monogram, top-right clickable waypoint route bar, bottom-right live odometer/velocity/bank-angle gauge, and synchronized glassmorphic project cards. |
| [`src/roadSpline.ts`](src/roadSpline.ts) | Deterministic `CatmullRomCurve3` highway spline math, gravity-leveled coordinate frames, signed horizontal curvature calculation, and procedural terrain elevation grading. |

---

## Customizing Assets & Adding Projects

### 1. Dropping in High-Resolution Project Screenshots
Place high-resolution `.webp` captures (`>= 400x250`) at the following paths in `public/assets/projects/`:
- `public/assets/projects/primefitness.webp`
- `public/assets/projects/azzule-ai.webp`
- `public/assets/projects/pulsar-3d.webp`

Both the 3D roadside billboards and the glassmorphic HUD cards automatically hot-swap from their built-in high-DPI canvas mockups to your `.webp` files as soon as they are present.

### 2. Swapping in a Custom `.glb` Motorcycle Model
Pass the `customMotorcycleModelUrl` prop to `<Scene />` (or `modelUrl` directly to `<Motorcycle />`):
```tsx
<Scene
  scrollProgressRef={scrollProgressRef}
  telemetryRef={telemetryRef}
  customMotorcycleModelUrl="/assets/models/pulsar-n250.glb"
/>
```

### 3. Adding Future Projects
Append a new `ProjectWaypointConfig` entry to `PROJECT_WAYPOINTS` in [`src/ProjectWaypoints.tsx`](src/ProjectWaypoints.tsx) and a corresponding milestone button in `ROUTE_SECTIONS`.
