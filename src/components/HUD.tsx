import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  Gauge,
  Github,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  Maximize2,
  X,
} from 'lucide-react';
import {
  CONTACT_INFO,
  PORTFOLIO_WAYPOINTS,
  TOTAL_ROUTE_MILES,
  type WaypointConfig,
} from '../data/waypoints';
import { createFallbackProjectDataUrl } from '../utils/textures';
import type { HudTelemetrySnapshot } from './Scene';

interface HUDProps {
  telemetry: HudTelemetrySnapshot;
  onNavigate: (targetProgress: number) => void;
  reducedMotion: boolean;
}

export function HUD({ telemetry, onNavigate, reducedMotion }: HUDProps) {
  const { progress, miles, speedMph, activeWaypoint } = telemetry;
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    title: string;
    subtitle: string;
  } | null>(null);

  useEffect(() => {
    setMobileExpanded(false);
  }, [activeWaypoint?.id]);

  const percent = Math.round(progress * 100);
  const isStart = activeWaypoint?.kind === 'intro';
  const isProject = activeWaypoint?.kind === 'project';
  const isOverlook = activeWaypoint?.kind === 'overlook';
  const firstProjectWaypoint = PORTFOLIO_WAYPOINTS.find((w) => w.kind === 'project');

  const resolvedProjectPreviewSrc = useMemo(() => {
    if (!activeWaypoint || activeWaypoint.kind !== 'project') return null;
    if (!activeWaypoint.imagePath || failedImages[activeWaypoint.id]) {
      return createFallbackProjectDataUrl(activeWaypoint);
    }
    return activeWaypoint.imagePath;
  }, [activeWaypoint, failedImages]);

  const handlePreviewError = (wp: WaypointConfig) => {
    setFailedImages((prev) => (prev[wp.id] ? prev : { ...prev, [wp.id]: true }));
  };

  // Keep project card gently docked opposite the 3D billboard side on wide screens
  const desktopCardSide =
    activeWaypoint?.side === 'left'
      ? 'lg:left-auto lg:right-8'
      : 'lg:left-8 lg:right-auto';

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_INFO.email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      window.location.href = `mailto:${CONTACT_INFO.email}`;
    }
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 lg:p-8">
        {/* TOP NAVIGATION BAR */}
        <header className="flex items-start justify-between gap-2 sm:gap-3">
          {/* Top-Left: Minimal JM Monogram */}
          <button
            type="button"
            onClick={() => onNavigate(0)}
            aria-label="Return to start line"
            className="pointer-events-auto group flex shrink-0 items-center gap-3 rounded-2xl border border-amber-200/15 bg-stone-950/60 px-3 py-2 backdrop-blur-md transition-all hover:border-amber-300/40 hover:bg-stone-900/75 sm:px-3.5 sm:py-2.5"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 font-display text-sm font-bold tracking-tight text-stone-950 shadow-sm shadow-amber-500/30 transition-transform group-hover:scale-105">
              JM
            </span>
            <div className="hidden text-left lg:block">
              <p className="font-display text-xs font-semibold tracking-wide text-stone-100">
                JASON MARTINEZ
              </p>
              <p className="font-mono text-[10px] tracking-wider text-amber-200/70">
                {CONTACT_INFO.domain}
              </p>
            </div>
          </button>

          {/* Top-Right: Clickable Waypoint Route Bar */}
          <nav
            aria-label="Portfolio highway waypoints"
            className="pointer-events-auto glass-panel flex items-center gap-0.5 rounded-2xl px-1.5 py-1 sm:gap-1 sm:px-2.5 sm:py-1.5 lg:gap-1.5 lg:px-3 lg:py-2"
          >
            {PORTFOLIO_WAYPOINTS.map((wp, idx) => {
              const isCurrent = activeWaypoint?.id === wp.id;
              const isPassed = progress > wp.range[1];
              return (
                <div key={wp.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onNavigate(wp.jumpProgress)}
                    title={`${wp.mileNumber}: ${wp.title}`}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`group flex items-center gap-1 rounded-xl px-1.5 py-1 font-mono text-[10px] transition-all sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-[11px] lg:px-2.5 ${
                      isCurrent
                        ? 'bg-amber-300/20 text-amber-200 ring-1 ring-amber-300/50'
                        : isPassed
                          ? 'text-stone-300 hover:bg-white/10 hover:text-white'
                          : 'text-stone-400 hover:bg-white/10 hover:text-stone-200'
                    }`}
                  >
                    <span
                      className={`hidden h-1.5 w-1.5 rounded-full transition-all sm:inline-block ${
                        isCurrent
                          ? 'scale-125 bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.9)]'
                          : isPassed
                            ? 'bg-amber-400/60'
                            : 'bg-stone-500 group-hover:bg-stone-300'
                      }`}
                    />
                    <span className="hidden whitespace-nowrap md:inline">{wp.navLabel}</span>
                    <span className="whitespace-nowrap md:hidden">{wp.shortLabel}</span>
                  </button>
                  {idx < PORTFOLIO_WAYPOINTS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={`mx-0.5 hidden h-[1px] w-2 md:block lg:w-2.5 ${
                        isPassed ? 'bg-amber-300/50' : 'bg-white/10'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </nav>
        </header>

        {/* CONTEXTUAL FLOATING CARDS (MIDDLE / LOWER REGION) */}
        <div className="relative flex flex-1 items-end justify-between pb-2 sm:pb-0">
          {/* 0% - 10% | START LINE HERO OVERLAY */}
          {isStart && activeWaypoint && (
            <section
              aria-label="Hero introduction"
              className="pointer-events-auto glass-panel w-full max-w-[420px] rounded-3xl p-4 sm:p-6 transition-colors duration-200"
            >
              <div className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                {activeWaypoint.mileNumber} · Countryside Route
              </div>

              <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {activeWaypoint.title}
                <span className="sr-only"> — </span>
                <span className="mt-1 block text-base font-medium text-amber-200/90 sm:text-lg">
                  {activeWaypoint.subtitle}
                </span>
              </h1>

              <p className="mt-2.5 text-xs leading-relaxed text-stone-300 sm:text-sm">
                {activeWaypoint.summary}
              </p>

              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {activeWaypoint.techStack.map((item) => (
                  <span
                    key={item}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-stone-200 sm:text-[11px]"
                  >
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3.5">
                <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-widest text-amber-200/90">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 ${
                      reducedMotion ? '' : 'animate-bounce'
                    }`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </span>
                  <span>Scroll to ride</span>
                </div>

                {firstProjectWaypoint && (
                  <button
                    type="button"
                    onClick={() => onNavigate(firstProjectWaypoint.jumpProgress)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-300 px-3.5 py-2 font-display text-xs font-semibold text-stone-950 transition-colors hover:bg-amber-200"
                  >
                    <span>Next: {firstProjectWaypoint.mileNumber}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </section>
          )}

          {/* 12% - 90% | SYNCHRONIZED PROJECT DETAIL CARD (MILES 1 - 5) */}
          {isProject && activeWaypoint && (
            <aside
              aria-label={activeWaypoint.title}
              className={`pointer-events-auto glass-panel w-full max-w-[420px] rounded-3xl p-4 sm:p-5 transition-colors duration-200 lg:absolute lg:bottom-0 ${desktopCardSide}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-stone-200">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: activeWaypoint.accentColor,
                      boxShadow: `0 0 10px ${activeWaypoint.accentColor}`,
                    }}
                  />
                  {activeWaypoint.mileNumber}
                </span>
                {activeWaypoint.role && (
                  <span className="truncate font-mono text-[11px] text-stone-400">
                    {activeWaypoint.role}
                  </span>
                )}
              </div>

              <h2 className="mt-2.5 font-display text-lg font-bold tracking-tight text-white sm:text-xl">
                {activeWaypoint.title}
              </h2>
              <p className="mt-0.5 text-xs font-medium text-amber-200/80">
                {activeWaypoint.subtitle}
              </p>

              <p className="mt-2 text-xs leading-relaxed text-stone-300 sm:text-sm">
                {activeWaypoint.summary}
              </p>

              {/* Tech stack pills always shown on the detail card upon entering the milestone */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {activeWaypoint.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-stone-200 sm:text-[11px]"
                  >
                    {tech}
                  </span>
                ))}
              </div>

              {/* Mobile drawer toggle so 3D highway & billboard stay unobstructed above */}
              <div className="mt-2.5 flex justify-end lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileExpanded((prev) => !prev)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 font-mono text-[10px] text-amber-200"
                >
                  <span>{mobileExpanded ? 'Less' : 'Details & UI'}</span>
                  {mobileExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronUp className="h-3 w-3" />
                  )}
                </button>
              </div>

              <div
                className={`${
                  mobileExpanded ? 'mt-3 block max-h-[34vh] overflow-y-auto pr-1' : 'hidden'
                } lg:mt-3 lg:block lg:max-h-none`}
              >
                {/* Clickable screenshot preview thumbnail (with procedural fallback if WebP is absent) */}
                {resolvedProjectPreviewSrc && (
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxImage({
                        src: resolvedProjectPreviewSrc,
                        title: activeWaypoint.title,
                        subtitle: activeWaypoint.subtitle,
                      })
                    }
                    className="group relative block w-full overflow-hidden rounded-xl border border-white/15 bg-stone-900/80 text-left transition-all hover:border-amber-300/45"
                  >
                    <img
                      src={resolvedProjectPreviewSrc}
                      alt={`${activeWaypoint.title} UI preview`}
                      onError={() => handlePreviewError(activeWaypoint)}
                      className="h-24 w-full object-cover object-top opacity-90 transition-transform duration-300 group-hover:scale-[1.03] group-hover:opacity-100 sm:h-28"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/75 via-transparent to-transparent" />
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-stone-950/80 px-2 py-1 font-mono text-[10px] text-stone-200 backdrop-blur-sm">
                      <Maximize2 className="h-3 w-3 text-amber-300" />
                      Inspect UI
                    </span>
                  </button>
                )}

                <ul className="mt-2.5 space-y-1 text-xs text-stone-300">
                  {activeWaypoint.highlights.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: activeWaypoint.accentColor }}
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                {activeWaypoint.links && activeWaypoint.links.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                    {activeWaypoint.links.map((link) => (
                      <a
                        key={link.label}
                        href={link.url}
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noreferrer' : undefined}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 font-mono text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-300/20"
                      >
                        <span>{link.label}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* 92% - 100% | DESTINATION OVERLOOK CONTACT CARD */}
          {isOverlook && activeWaypoint && (
            <section
              aria-label="Contact and links"
              className="pointer-events-auto glass-panel max-w-lg rounded-3xl p-6 sm:p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/15 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-amber-200">
                  <MapPin className="h-3 w-3" />
                  Destination Overlook · Mile {TOTAL_ROUTE_MILES.toFixed(2)}
                </span>
                <span className="font-mono text-[11px] text-emerald-300/90">
                  ● Available for work
                </span>
              </div>

              <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {activeWaypoint.subtitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-300">
                {activeWaypoint.summary}
              </p>

              <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <a
                  href={`https://${CONTACT_INFO.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 transition-all hover:border-amber-300/40 hover:bg-white/10"
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    <Globe className="h-4 w-4 text-amber-300" />
                    {CONTACT_INFO.domain}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-stone-400" />
                </a>

                <a
                  href={CONTACT_INFO.github}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 transition-all hover:border-amber-300/40 hover:bg-white/10"
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    <Github className="h-4 w-4 text-amber-300" />
                    GitHub
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-stone-400" />
                </a>

                <a
                  href={CONTACT_INFO.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 transition-all hover:border-amber-300/40 hover:bg-white/10"
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    <Linkedin className="h-4 w-4 text-amber-300" />
                    LinkedIn
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-stone-400" />
                </a>

                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 transition-all hover:border-amber-300/40 hover:bg-white/10"
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    {copiedEmail ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-amber-300" />
                    )}
                    {copiedEmail ? 'Email copied!' : 'Copy email'}
                  </span>
                  <span className="font-mono text-[10px] text-stone-400">
                    {CONTACT_INFO.email.split('@')[0]}@
                  </span>
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1">
                <a
                  href={`mailto:${CONTACT_INFO.email}?subject=Engineering%20Inquiry%20-%20jasonmartinez.dev`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 to-orange-400 px-5 py-3 font-display text-sm font-bold text-stone-950 shadow-lg shadow-amber-500/20 transition-transform hover:scale-[1.01]"
                >
                  <Mail className="h-4 w-4" />
                  <span>Send Email ({CONTACT_INFO.email})</span>
                </a>

                <button
                  type="button"
                  onClick={() => onNavigate(0)}
                  className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 font-mono text-xs text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Ride Again ↑
                </button>
              </div>
            </section>
          )}

          {/* Subtle cruise status pill when between project zones */}
          {!activeWaypoint && (
            <div className="glass-panel rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-amber-200/80">
              Cruising Countryside Highway · Keep scrolling
            </div>
          )}
        </div>

        {/* BOTTOM-RIGHT: MINIMAL ODOMETER & WAYPOINT-SYNCED PROGRESS GAUGE */}
        <footer className="flex items-end justify-end">
          <div className="pointer-events-auto glass-panel flex items-center gap-4 rounded-2xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-300" />
              <div className="font-mono leading-tight">
                <p className="text-[10px] uppercase tracking-wider text-stone-400">
                  Speed
                </p>
                <p className="text-sm font-semibold tabular-nums text-stone-100">
                  {progress >= 0.985 ? (
                    <span className="text-amber-300">PARKED</span>
                  ) : (
                    <>
                      {String(speedMph).padStart(2, '0')}{' '}
                      <span className="text-[10px] font-normal text-stone-400">MPH</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="h-7 w-[1px] bg-white/10" />

            <div className="font-mono leading-tight">
              <p className="text-[10px] uppercase tracking-wider text-stone-400">
                Odometer
              </p>
              <p className="text-sm font-semibold tabular-nums text-stone-100">
                {miles.toFixed(2)}{' '}
                <span className="text-[10px] font-normal text-stone-400">
                  / {TOTAL_ROUTE_MILES.toFixed(2)} MI
                </span>
              </p>
            </div>

            <div className="hidden h-7 w-[1px] bg-white/10 sm:block" />

            <div className="hidden w-28 sm:block">
              <div className="flex items-center justify-between font-mono text-[10px] text-stone-400">
                <span>{activeWaypoint ? activeWaypoint.shortLabel : 'ROUTE'}</span>
                <span className="text-amber-200">{percent}%</span>
              </div>
              <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400 transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
                {PORTFOLIO_WAYPOINTS.map((wp) => {
                  const isCurrent = activeWaypoint?.id === wp.id;
                  const isReached = progress >= wp.jumpProgress - 0.005;
                  return (
                    <span
                      key={wp.id}
                      aria-hidden="true"
                      style={{ left: `${wp.jumpProgress * 100}%` }}
                      className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
                        isCurrent
                          ? 'scale-110 bg-amber-200 shadow-[0_0_6px_rgba(252,211,77,0.9)]'
                          : isReached
                            ? 'bg-amber-400/90'
                            : 'bg-stone-600'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* LIGHTBOX MODAL FOR FULL-SIZE SCREENSHOT INSPECTION */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxImage.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="glass-panel relative max-w-4xl overflow-hidden rounded-3xl p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-white">
                  {lightboxImage.title}
                </h3>
                <p className="text-xs text-stone-400">{lightboxImage.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close preview"
                className="rounded-xl border border-white/15 bg-white/5 p-2 text-stone-300 transition-colors hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.title}
              className="max-h-[72vh] w-full rounded-2xl border border-white/10 object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
