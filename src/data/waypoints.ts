export type WaypointKind = 'intro' | 'project' | 'overlook';

export interface ProjectLink {
  label: string;
  url: string;
  external?: boolean;
}

export interface CameraBias {
  /** Additional local camera offset relative to bike frame [right, up, back] */
  offset: [number, number, number];
  /** Look-at target shift relative to bike position [right, up, forward] */
  lookOffset: [number, number, number];
}

export interface WaypointConfig {
  id: string;
  kind: WaypointKind;
  mileNumber: string;
  navLabel: string;
  /** Scroll range [start, end] in normalized 0..1 progress where this milestone is active */
  range: [number, number];
  /** Ideal spline t (0..1) to jump to when selecting this waypoint from the HUD */
  jumpProgress: number;
  /** Spline t (0..1) where the 3D roadside display structure is placed (for project waypoints) */
  anchorT?: number;
  /** Which side of the road the 3D billboard sits on */
  side?: 'left' | 'right';
  /** Lateral distance from road centerline in world units */
  lateralOffset?: number;
  /** Camera framing adjustments when riding through this milestone */
  cameraBias: CameraBias;
  title: string;
  subtitle: string;
  role?: string;
  summary: string;
  techStack: string[];
  highlights: string[];
  /** Path to screenshot texture (relative to public/) */
  imagePath?: string;
  /** Accent hex color used for 3D glassmorphic bezel and HUD highlight */
  accentColor: string;
  links?: ProjectLink[];
}

export interface ContactDestination {
  domain: string;
  email: string;
  github: string;
  linkedin: string;
  location: string;
  availability: string;
}

export const CONTACT_INFO: ContactDestination = {
  domain: 'jasonmartinez.dev',
  email: 'hello@jasonmartinez.dev',
  github: 'https://github.com/jasonmartinez',
  linkedin: 'https://linkedin.com/in/jasonmartinez',
  location: 'California, USA',
  availability: 'Open to Senior Backend, Cloud & AI Systems roles',
};

/**
 * Central waypoint registry.
 * To add a future portfolio project, append a new 'project' entry with a non-overlapping
 * scroll range and spline `anchorT`, then drop its WebP screenshot into `public/assets/projects/`.
 */
export const PORTFOLIO_WAYPOINTS: WaypointConfig[] = [
  {
    id: 'start-line',
    kind: 'intro',
    mileNumber: 'MILE 00',
    navLabel: 'Start',
    range: [0.0, 0.15],
    jumpProgress: 0.0,
    cameraBias: {
      offset: [-1.25, 0.18, 0.35],
      lookOffset: [-0.95, 0.18, 2.0],
    },
    title: 'Jason Martinez',
    subtitle: 'Backend, Cloud & AI Systems Engineer',
    summary:
      'Architecting resilient distributed APIs, cloud-native data pipelines, and applied AI workflows with C#, SQL, Java, and modern infrastructure.',
    techStack: ['C# / .NET', 'SQL / PostgreSQL', 'Java', 'Google Cloud', 'AI Integrations'],
    highlights: [
      'High-throughput backend APIs & multi-tenant cloud services',
      'Automated compliance & LLM document ingestion pipelines',
      'End-to-end systems from PostgreSQL schemas to 3D interfaces',
    ],
    accentColor: '#ffbe6b',
  },
  {
    id: 'primefitness',
    kind: 'project',
    mileNumber: 'MILE 01',
    navLabel: 'PrimeFitness',
    range: [0.2, 0.45],
    jumpProgress: 0.31,
    anchorT: 0.345,
    side: 'right',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [-1.1, 0.35, 0.4],
      lookOffset: [2.3, 0.95, 5.2],
    },
    title: 'PrimeFitness POS & Gym Management',
    subtitle: 'Full-Stack SaaS Dashboard & Desktop Point-of-Sale',
    role: 'Lead Systems & Full-Stack Architect',
    summary:
      'Full-stack gym management and point-of-sale platform built with ASP.NET Core Minimal APIs, Google Cloud Run, Neon PostgreSQL, Stripe integration, and Electron.',
    techStack: [
      'C# / ASP.NET Core',
      'Minimal APIs',
      'Google Cloud Run',
      'Neon PostgreSQL',
      'Stripe',
      'Electron',
    ],
    highlights: [
      'Sub-50ms check-in & barcode POS register running offline-first via Electron',
      'Serverless container scaling on Google Cloud Run backed by pooled Neon PostgreSQL',
      'Automated recurring membership billing, webhooks, and terminal reconciliation with Stripe',
    ],
    imagePath: '/assets/projects/primefitness.webp',
    accentColor: '#38bdf8',
    links: [
      { label: 'Architecture Case Study', url: 'https://jasonmartinez.dev/#primefitness', external: true },
      { label: 'GitHub', url: 'https://github.com/jasonmartinez', external: true },
    ],
  },
  {
    id: 'azzule-ai',
    kind: 'project',
    mileNumber: 'MILE 02',
    navLabel: 'Azzule AI',
    range: [0.5, 0.7],
    jumpProgress: 0.59,
    anchorT: 0.625,
    side: 'left',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [1.1, 0.35, 0.4],
      lookOffset: [-2.3, 0.95, 5.2],
    },
    title: 'Azzule Systems — AI Regulatory Document Pipeline',
    subtitle: 'Enterprise Supply-Chain & Food-Safety Intelligence',
    role: 'Backend & AI Integration Engineer',
    summary:
      'Automated regulatory document ingestion and food-safety compliance workflows built with C#, SQL, and AI integrations.',
    techStack: ['C#', 'SQL Server', 'AI / LLM Pipelines', 'Document Extraction', 'Cloud Workflows'],
    highlights: [
      'Structured extraction of multi-format audit certificates and lab test PDFs',
      'Deterministic SQL compliance validation rules paired with AI confidence scoring',
      'Audit-ready lineage tracking across global agricultural supply-chain entities',
    ],
    imagePath: '/assets/projects/azzule-ai.webp',
    accentColor: '#34d399',
    links: [
      { label: 'Workflow Overview', url: 'https://jasonmartinez.dev/#azzule-ai', external: true },
    ],
  },
  {
    id: 'pulsar-3d',
    kind: 'project',
    mileNumber: 'MILE 03',
    navLabel: 'Pulsar 3D',
    range: [0.75, 0.9],
    jumpProgress: 0.815,
    anchorT: 0.845,
    side: 'right',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [-1.05, 0.35, 0.4],
      lookOffset: [2.2, 0.95, 5.0],
    },
    title: 'Bajaj Pulsar N250 3D WebGL Visualizer',
    subtitle: 'Interactive Component-Inspection Showcase',
    role: 'Creative WebGL & Frontend Engineer',
    summary:
      'Interactive 3D WebGL scrollytelling visualizer built with React, Three.js, GSAP ScrollTrigger, and Lenis.',
    techStack: ['React', 'TypeScript', 'Three.js', 'GSAP ScrollTrigger', 'Lenis'],
    highlights: [
      'Smooth scroll-synchronized camera choreography and exploded mechanical views',
      'Physically based metallic shaders with golden-hour studio environment reflections',
      'Zero-jank 60fps rendering budget with instanced geometry and damped kinematics',
    ],
    imagePath: '/assets/projects/pulsar-3d.webp',
    accentColor: '#fb923c',
    links: [
      { label: 'Live Experience', url: 'https://jasonmartinez.dev/#pulsar-3d', external: true },
      { label: 'Source Repo', url: 'https://github.com/jasonmartinez', external: true },
    ],
  },
  {
    id: 'overlook',
    kind: 'overlook',
    mileNumber: 'OVERLOOK',
    navLabel: 'Contact',
    range: [0.92, 1.0],
    jumpProgress: 0.995,
    cameraBias: {
      offset: [-2.2, 0.45, -0.75],
      lookOffset: [-0.85, 0.35, 4.8],
    },
    title: 'Destination Overlook',
    subtitle: 'Let’s Build Resilient Systems Together',
    summary:
      'Reached the summit pull-off. Reach out directly to collaborate on backend architecture, cloud migrations, or applied AI engineering.',
    techStack: ['jasonmartinez.dev', 'C# / .NET', 'Java', 'SQL', 'Cloud & AI'],
    highlights: [
      'Direct engineering collaboration — backend, cloud infrastructure, and AI workflows',
      'Available for full-time senior roles and select technical advisory engagements',
    ],
    accentColor: '#ffbe6b',
  },
];

export const PROJECT_WAYPOINTS = PORTFOLIO_WAYPOINTS.filter(
  (w): w is WaypointConfig & { kind: 'project'; anchorT: number; imagePath: string } =>
    w.kind === 'project' && typeof w.anchorT === 'number' && typeof w.imagePath === 'string',
);
