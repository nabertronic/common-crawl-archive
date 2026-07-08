"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * Loads development-only tooling (the Performance overlay) without shipping any
 * of it to production. The `import()` sits behind a NODE_ENV check, so bundlers
 * replace the condition with `false` in production builds and dead-code-eliminate
 * the perf-panel chunk entirely — unlike a static import + render guard, which
 * keeps the module in the bundle.
 */
export function DevTools() {
  const [Panel, setPanel] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let cancelled = false;
    import("@/components/dev/perf-panel").then((mod) => {
      if (!cancelled) setPanel(() => mod.PerfPanel);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Panel ? <Panel /> : null;
}

export default DevTools;
