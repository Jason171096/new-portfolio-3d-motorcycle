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
  /** Compact badge label for viewports narrower than 768px (e.g. M1–M5) */
  shortLabel: string;
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
 * Single typed source of truth for all highway waypoints (Start Line, Miles 1–5, Destination Overlook).
 * Scene camera framing, 3D roadside billboards, guardrail cutouts, HUD route pills,
 * and odometer telemetry all derive dynamically from this array.
 */
export const PORTFOLIO_WAYPOINTS: WaypointConfig[] = [
  {
    id: 'start-line',
    kind: 'intro',
    mileNumber: 'MILE 00',
    navLabel: 'Start',
    shortLabel: '00',
    range: [0.0, 0.1],
    jumpProgress: 0.0,
    cameraBias: {
      offset: [-1.25, 0.18, 0.35],
      lookOffset: [-0.95, 0.18, 2.0],
    },
    title: 'Jason Martinez',
    subtitle: 'Backend, Cloud & AI Systems Engineer',
    summary:
      'Architecting resilient distributed APIs, cloud-native data pipelines, and applied AI workflows with C#, SQL, .NET, React, and modern cloud infrastructure.',
    techStack: ['C# / .NET', 'SQL / PostgreSQL', 'Azure & GCP', 'React', 'AI Integrations'],
    highlights: [
      'High-throughput backend APIs & multi-tenant cloud services',
      'Automated compliance & LLM document ingestion pipelines',
      'End-to-end systems from SQL schemas to responsive web portals',
    ],
    accentColor: '#ffbe6b',
  },
  {
    id: 'primefitness',
    kind: 'project',
    mileNumber: 'MILE 01',
    navLabel: 'PrimeFitness',
    shortLabel: 'M1',
    range: [0.12, 0.26],
    jumpProgress: 0.2,
    anchorT: 0.254,
    side: 'right',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [0.22, 0.35, 0.45],
      lookOffset: [1.4, 0.95, 5.2],
    },
    title: 'PrimeFitness POS & Gym Management',
    subtitle: 'Web Dashboard & Desktop Point-of-Sale Interface',
    role: 'Lead Systems & Full-Stack Architect',
    summary:
      'Full-stack gym management and point-of-sale platform built with ASP.NET Core Minimal APIs, Google Cloud Run, Neon PostgreSQL, Stripe integration, and Electron.',
    techStack: ['ASP.NET Core', 'Cloud Run', 'PostgreSQL', 'Stripe', 'Electron'],
    highlights: [
      'Sub-50ms member check-in & barcode POS register running offline-first via Electron',
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
    shortLabel: 'M2',
    range: [0.28, 0.42],
    jumpProgress: 0.36,
    anchorT: 0.405,
    side: 'left',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [-1.1, 0.35, 0.45],
      lookOffset: [-1.4, 0.95, 5.2],
    },
    title: 'Azzule Systems — AI-Powered Compliance Automation',
    subtitle: 'Enterprise Supply-Chain Compliance & Document Processing',
    role: 'Backend & AI Integration Engineer',
    summary:
      'Automated regulatory document ingestion and food-safety compliance workflows built with C#, SQL, and AI integrations.',
    techStack: ['C#', 'SQL', 'AI Integrations', 'Enterprise Compliance'],
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
    id: 'vw-credit',
    kind: 'project',
    mileNumber: 'MILE 03',
    navLabel: 'VW Credit',
    shortLabel: 'M3',
    range: [0.44, 0.58],
    jumpProgress: 0.52,
    anchorT: 0.556,
    side: 'right',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [0.22, 0.35, 0.45],
      lookOffset: [1.4, 0.95, 5.2],
    },
    title: 'Volkswagen México — Credit Risk Automation Engine',
    subtitle: 'Auto-Credit Evaluation & Credit Bureau API Workflow',
    role: 'Backend FinTech & Cloud Engineer',
    summary:
      'Engineered secure Credit Bureau integration APIs using ASP.NET and Azure, automating auto-credit evaluation workflows.',
    techStack: ['ASP.NET', 'Azure', 'Credit Bureau APIs', 'FinTech'],
    highlights: [
      'Encrypted ASP.NET middleware orchestrating real-time Credit Bureau risk pulls',
      'Automated underwriting decision rules cutting dealer credit approval latency',
      'Fault-tolerant Azure cloud deployment with strict audit logging and SLA monitoring',
    ],
    imagePath: '/assets/projects/vw-credit.webp',
    accentColor: '#60a5fa',
    links: [
      { label: 'Architecture Notes', url: 'https://jasonmartinez.dev/#vw-credit', external: true },
    ],
  },
  {
    id: 'ohhfiles',
    kind: 'project',
    mileNumber: 'MILE 04',
    navLabel: 'OhhFiles',
    shortLabel: 'M4',
    range: [0.6, 0.74],
    jumpProgress: 0.68,
    anchorT: 0.708,
    side: 'left',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [-1.1, 0.35, 0.45],
      lookOffset: [-1.4, 0.95, 5.2],
    },
    title: 'OhhFiles — Medical Health-Tracking Platform',
    subtitle: 'Patient Tracking, Secure Uploads & Health Visualizations',
    role: 'Full-Stack HealthTech Engineer',
    summary:
      'Built a patient tracking web app in React, featuring secure file uploads and dynamic data visualizations.',
    techStack: ['React', 'Data Visualization', 'Secure Uploads', 'HealthTech'],
    highlights: [
      'Interactive longitudinal health charts surfacing patient vitals and lab trends',
      'Pre-signed encrypted document upload pipeline for imaging and clinical records',
      'Responsive React workspace designed for fast clinician and patient review',
    ],
    imagePath: '/assets/projects/ohhfiles.webp',
    accentColor: '#a78bfa',
    links: [
      { label: 'Platform Overview', url: 'https://jasonmartinez.dev/#ohhfiles', external: true },
    ],
  },
  {
    id: 'mediger',
    kind: 'project',
    mileNumber: 'MILE 05',
    navLabel: 'MediGer',
    shortLabel: 'M5',
    range: [0.76, 0.9],
    jumpProgress: 0.84,
    anchorT: 0.86,
    side: 'right',
    lateralOffset: 9.2,
    cameraBias: {
      offset: [0.22, 0.35, 0.45],
      lookOffset: [1.4, 0.95, 5.2],
    },
    title: 'MediGer — Eldercare Scheduling & Records Portal',
    subtitle: 'Medical Records & Caregiver Scheduling Interface',
    role: 'Full-Stack .NET & React Engineer',
    summary:
      'Developed a medical records and scheduling portal using React and .NET to optimize patient care tracking.',
    techStack: ['React', '.NET', 'Medical Records', 'Scheduling'],
    highlights: [
      'Shift coordination calendar syncing caregiver assignments and medication rounds',
      'Strongly typed .NET REST endpoints managing resident charts and care histories',
      'Role-scoped clinical views streamlining daily handoffs across care teams',
    ],
    imagePath: '/assets/projects/mediger.webp',
    accentColor: '#fb923c',
    links: [
      { label: 'System Overview', url: 'https://jasonmartinez.dev/#mediger', external: true },
    ],
  },
  {
    id: 'overlook',
    kind: 'overlook',
    mileNumber: 'OVERLOOK',
    navLabel: 'Contact',
    shortLabel: 'END',
    range: [0.92, 1.0],
    jumpProgress: 0.995,
    cameraBias: {
      offset: [-2.2, 0.45, -0.75],
      lookOffset: [-0.85, 0.35, 4.8],
    },
    title: 'Destination Overlook',
    subtitle: 'Let’s Build Resilient Systems Together',
    summary:
      'Reached the summit pull-off. Reach out directly to collaborate on backend architecture, cloud infrastructure, or applied AI engineering.',
    techStack: ['jasonmartinez.dev', 'C# / .NET', 'SQL', 'Cloud & AI', 'React'],
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

/** Total route distance in thematic miles, dynamically synced with the project milestones + summit pull-off */
export const TOTAL_ROUTE_MILES = Number((PROJECT_WAYPOINTS.length + 0.5).toFixed(2));
