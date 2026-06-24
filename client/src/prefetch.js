// Route chunk prefetching — kills the "cold start" stall on the first nav click.
//
// Every page is route-split (React.lazy), so the first time a user navigates to a
// page its JS chunk has to be fetched + parsed before anything renders, showing the
// `载入中…` fallback and a visible jank. We warm those chunks two ways:
//   1. Intent-based: when the pointer touches a nav link we kick off its import, so
//      the chunk is usually ready by the time the click commits (instant nav).
//   2. Idle: after first paint, gently pull every remaining chunk during browser
//      idle time, so even the very first click anywhere is warm.
// Imports are deduped by the module loader, so warming never double-fetches.

const byPath = new Map();   // exact route path -> preload fn
const preloads = [];        // every route's preload fn, in declaration order

// Wrap React.lazy so the returned component also carries a `.preload()` that
// triggers (and caches) the dynamic import without rendering.
import { lazy } from 'react';

export function lazyRoute(factory) {
  const Comp = lazy(factory);
  let started;
  Comp.preload = () => (started ||= factory().catch((e) => { started = null; throw e; }));
  preloads.push(Comp.preload);
  return Comp;
}

// Register the static path(s) a lazy component answers, so pointer-intent prefetch
// can find it. Accepts one path or an array; returns the component for chaining.
export function mapRoute(paths, Comp) {
  if (Comp?.preload) for (const p of [].concat(paths)) byPath.set(p, Comp.preload);
  return Comp;
}

// Prefetch the chunk for a concrete nav target (exact match against mapped paths).
export function prefetchPath(path) {
  const fn = byPath.get(path);
  if (fn) { try { fn(); } catch { /* */ } }
}

const idle = window.requestIdleCallback
  ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
  : (cb) => setTimeout(cb, 200);

let idleStarted = false;
// Warm every route chunk during idle time, one per idle slice so we never block
// interaction or saturate the network. Safe to call multiple times.
export function prefetchAllIdle() {
  if (idleStarted) return;
  idleStarted = true;
  let i = 0;
  const pump = () => {
    if (i >= preloads.length) return;
    try { preloads[i++](); } catch { /* */ }
    idle(pump);
  };
  idle(pump);
}
