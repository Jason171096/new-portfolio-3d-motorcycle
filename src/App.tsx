import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { HUD } from './components/HUD';
import { Scene, type HudTelemetrySnapshot } from './components/Scene';
import { PORTFOLIO_WAYPOINTS } from './data/waypoints';
import { useReducedMotion } from './hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

export function App() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollProgressRef = useRef<number>(0);
  const lenisRef = useRef<Lenis | null>(null);
  const reducedMotion = useReducedMotion();

  const [telemetry, setTelemetry] = useState<HudTelemetrySnapshot>({
    progress: 0,
    miles: 0,
    speedMph: 0,
    activeWaypoint: PORTFOLIO_WAYPOINTS[0],
  });

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let lenis: Lenis | null = null;
    let tickerCallback: ((time: number) => void) | null = null;

    if (!reducedMotion) {
      lenis = new Lenis({
        duration: 1.25,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 0.95,
        touchMultiplier: 1.4,
      });

      lenisRef.current = lenis;
      lenis.on('scroll', ScrollTrigger.update);

      tickerCallback = (time: number) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(tickerCallback);
      gsap.ticker.lagSmoothing(0);
    } else {
      lenisRef.current = null;
    }

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        scrollProgressRef.current = self.progress;
      },
    });

    ScrollTrigger.refresh();

    // Support direct milestone deep links (e.g. /#primefitness, /#overlook)
    const syncHashTarget = () => {
      const hashId = window.location.hash.replace(/^#/, '');
      if (!hashId) return;
      const targetWp = PORTFOLIO_WAYPOINTS.find((w) => w.id === hashId);
      if (!targetWp) return;
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const targetY = targetWp.jumpProgress * maxScroll;
      scrollProgressRef.current = targetWp.jumpProgress;
      window.scrollTo({ top: targetY, behavior: 'auto' });
      ScrollTrigger.update();
    };

    syncHashTarget();
    window.addEventListener('hashchange', syncHashTarget);

    return () => {
      window.removeEventListener('hashchange', syncHashTarget);
      trigger.kill();
      if (tickerCallback) {
        gsap.ticker.remove(tickerCallback);
      }
      if (lenis) {
        lenis.destroy();
      }
      lenisRef.current = null;
    };
  }, [reducedMotion]);

  const handleNavigate = useCallback(
    (targetProgress: number) => {
      const clamped = Math.max(0, Math.min(1, targetProgress));
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const targetY = clamped * maxScroll;

      if (lenisRef.current && !reducedMotion) {
        lenisRef.current.scrollTo(targetY, {
          duration: 1.8,
          easing: (t) => 1 - Math.pow(1 - t, 3),
        });
      } else {
        window.scrollTo({
          top: targetY,
          behavior: reducedMotion ? 'auto' : 'smooth',
        });
      }
    },
    [reducedMotion],
  );

  const handleTelemetryUpdate = useCallback((snapshot: HudTelemetrySnapshot) => {
    setTelemetry(snapshot);
  }, []);

  return (
    <main className="relative bg-[#0e1015] text-stone-100">
      {/* Fixed 3D Countryside Highway WebGL Canvas */}
      <Scene
        scrollProgressRef={scrollProgressRef}
        reducedMotion={reducedMotion}
        onTelemetryUpdate={handleTelemetryUpdate}
      />

      {/* Minimalist HUD & Synchronized Project Detail Cards */}
      <HUD
        telemetry={telemetry}
        onNavigate={handleNavigate}
        reducedMotion={reducedMotion}
      />

      {/* Scrollable Scrollytelling Track mapped 0% -> 100% via GSAP ScrollTrigger */}
      <div
        ref={scrollContainerRef}
        className="pointer-events-none relative z-10 h-[900vh] w-full"
        aria-label="Scrollable portfolio route"
      >
        {PORTFOLIO_WAYPOINTS.map((wp) => (
          <div
            key={wp.id}
            id={wp.id}
            style={{ top: `${wp.jumpProgress * 100}%` }}
            className="absolute left-0 h-px w-px opacity-0"
            aria-hidden="true"
          >
            {wp.title}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
