// Mockup-only helpers: page switcher and deterministic fake data for bars/grids.
(function () {
  const pages = [
    ["index.html", "Overview"],
    ["landing.html", "Landing"],
    ["search.html", "Results"],
    ["viewer.html", "Viewer"],
    ["history.html", "History"],
    ["settings.html", "Settings"]
  ];
  const here = location.pathname.split("/").pop() || "index.html";
  const ribbon = document.createElement("nav");
  ribbon.className = "mock-ribbon";
  ribbon.setAttribute("aria-label", "Mockup pages");
  for (const [href, label] of pages) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (href === here) a.setAttribute("aria-current", "page");
    ribbon.append(a);
  }
  document.body.append(ribbon);

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Capture-density bars: one per crawl, used by the search timeline.
  document.querySelectorAll("[data-bars]").forEach((el) => {
    const n = Number(el.dataset.bars);
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      const ramp = Math.min(1, 0.15 + i / n);
      const h = Math.round((0.12 + rand() * 0.88) * ramp * 100);
      s.style.height = h + "%";
      if (el.dataset.sel) {
        const [a, b] = el.dataset.sel.split("-").map(Number);
        if (i >= a && i <= b) s.className = "sel";
      }
      el.append(s);
    }
  });

  // Scan progress: one cell per Common Crawl collection.
  document.querySelectorAll("[data-collections]").forEach((el) => {
    const n = Number(el.dataset.collections);
    const done = Number(el.dataset.done);
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      const r = rand();
      if (i < done) s.className = r > 0.83 ? "hit" : r < 0.04 ? "fail" : "done";
      else if (i === done) s.className = "now";
      el.append(s);
    }
  });

  document.querySelectorAll("[data-scrub]").forEach((el) => {
    const n = Number(el.dataset.scrub);
    const cur = Number(el.dataset.cur);
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      if (i === cur) s.className = "cur";
      else if (rand() > 0.62) s.className = "has";
      el.append(s);
    }
  });

  document.querySelectorAll("[data-spark]").forEach((el) => {
    for (let i = 0; i < 24; i++) {
      const s = document.createElement("span");
      const r = rand();
      if (r < Number(el.dataset.spark)) s.className = "z";
      else s.style.height = Math.round(20 + r * 80) + "%";
      el.append(s);
    }
  });

  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  });
  document.querySelectorAll(".toggle").forEach((t) =>
    t.addEventListener("click", () => t.setAttribute("aria-checked", String(t.getAttribute("aria-checked") !== "true")))
  );
})();
