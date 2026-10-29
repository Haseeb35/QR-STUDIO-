// Animated background: a faint field of QR modules that twinkles, assembles
// real (scannable) QR codes in the margins, reacts to the cursor and clicks,
// and gets swept by a scanner beam. Purely decorative.
(() => {
  "use strict";

  const CELL = 16;
  const QUIET = 2; // cleared border around assembled codes so scanners can find them
  const FPS = 30;
  // A code takes ~0.8s to assemble, holds, then ~0.9s to dissolve; the
  // interval is longer than that so two codes never overlap.
  const STAMP_EVERY = 5600;
  const STAMP_HOLD = 3400;
  const WORDS = ["hello", "scan me", "QR Studio", "hi there", "made with care", "nice find", "ping", "404", "beep boop", "keep scanning"];

  const canvas = document.createElement("canvas");
  canvas.className = "bg-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  let cols = 0;
  let rows = 0;
  let width = 0;
  let height = 0;
  let ambient; // resting brightness per cell (sparse random pattern)
  let level; // current brightness, eased toward the goal each frame
  let tint; // 0 = neutral colour, 1 = accent colour
  let size; // extra size for cells that belong to an assembled code
  let stamps = [];
  let ripples = [];
  const pointer = { x: -9999, y: -9999 };
  let colors = { ink: "#000", accent: "#2f5d50", light: true };
  let lastStamp = 0;
  let lastFrame = 0;
  let still = false; // true while showing the reduced-motion still frame

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const bg = (css.getPropertyValue("--bg").trim() || "#ffffff").replace("#", "");
    const lum = parseInt(bg.slice(0, 2), 16) * 0.3 + parseInt(bg.slice(2, 4), 16) * 0.59 + parseInt(bg.slice(4, 6), 16) * 0.11;
    colors = {
      ink: css.getPropertyValue("--text").trim() || "#000",
      accent: css.getPropertyValue("--accent").trim() || "#2f5d50",
      light: lum > 128,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / CELL) + 1;
    rows = Math.ceil(height / CELL) + 1;
    const n = cols * rows;
    ambient = new Float32Array(n);
    level = new Float32Array(n);
    tint = new Float32Array(n);
    size = new Float32Array(n);
    for (let i = 0; i < n; i++) ambient[i] = Math.random() < 0.13 ? 0.25 + Math.random() * 0.35 : 0;
    level.set(ambient);
    stamps = [];
  }

  // ---------- Assembling QR codes ----------

  function matrixFor(text) {
    const qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) m.push(qr.isDark(r, c));
    return { n, m };
  }

  // Codes only appear in the gutters beside the content column, so they never
  // sit behind text. On wide screens the whole code is visible (and scannable;
  // only its quiet zone may touch the edge). On narrower screens it peeks in
  // from the edge as decoration. Returns null when there's no room at all.
  function placeStamp(n) {
    const span = (n + QUIET * 2) * CELL;
    const gutter = (width - 1072) / 2 - 8; // 1072 = content column minus its padding
    const xMax = gutter - span; // tucked against the content column
    const scannableMin = -QUIET * CELL;
    let offset;
    if (xMax >= scannableMin) offset = scannableMin + Math.random() * (xMax - scannableMin);
    else if (xMax >= -span * 0.3) offset = xMax;
    else return null;
    const x = Math.random() < 0.5 ? offset : width - span - offset;
    const y = 70 + Math.random() * Math.max(1, height - span - 100);
    return { c0: Math.floor(x / CELL) + QUIET, r0: Math.floor(y / CELL) + QUIET };
  }

  function addStamp(now) {
    const { n, m } = matrixFor(WORDS[Math.floor(Math.random() * WORDS.length)]);
    const spot = placeStamp(n);
    if (!spot) return;
    const { c0, r0 } = spot;
    const centre = (n - 1) / 2;
    const delays = new Float32Array(n * n);
    const outro = new Float32Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        // Builds outward from the centre, dissolves in random order.
        delays[r * n + c] = Math.hypot(r - centre, c - centre) * 38 + Math.random() * 120;
        outro[r * n + c] = Math.random() * 900;
      }
    }
    stamps.push({ n, m, c0, r0, start: now, delays, outro, end: now + STAMP_HOLD + n * 38 });
  }

  const isFinder = (r, c, n) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // ---------- Frame ----------

  function frame(now) {
    const n = cols * rows;
    const goal = new Float32Array(ambient);
    const goalTint = new Float32Array(n);
    const locked = new Uint8Array(n); // cells of a live code: no beam/cursor effects
    size.fill(0);

    // Twinkle: a few resting cells change every frame.
    for (let k = 0; k < (still ? 0 : 6); k++) {
      const i = (Math.random() * n) | 0;
      ambient[i] = ambient[i] ? 0 : 0.25 + Math.random() * 0.35;
    }

    stamps = stamps.filter((s) => now < s.end + 1000);
    stamps.forEach((s) => {
      const live = now - s.start > 0 && now < s.end + 900;
      for (let r = -QUIET; r < s.n + QUIET; r++) {
        const row = s.r0 + r;
        if (row < 0 || row >= rows) continue;
        for (let c = -QUIET; c < s.n + QUIET; c++) {
          const col = s.c0 + c;
          if (col < 0 || col >= cols) continue;
          const i = row * cols + col;
          if (live) locked[i] = 1;
          if (r < 0 || c < 0 || r >= s.n || c >= s.n) {
            if (live) goal[i] = 0; // quiet zone
            continue;
          }
          const k = r * s.n + c;
          if (now - s.start < s.delays[k] || now > s.end + s.outro[k]) continue;
          goal[i] = s.m[k] ? 1 : 0;
          size[i] = 1;
          if (s.m[k] && isFinder(r, c, s.n)) goalTint[i] = 1;
        }
      }
    });

    // Scanner beam sweeping down the viewport.
    const beamY = still ? -9999 : ((now % 9000) / 9000) * (height + 240) - 120;
    // Click ripples: expanding rings.
    ripples = ripples.filter((rp) => now - rp.t < 1600);

    for (let row = 0; row < rows; row++) {
      const y = row * CELL + CELL / 2;
      const beam = Math.max(0, 1 - Math.abs(y - beamY) / 46);
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (locked[i]) {
          // Keep live codes crisp so they stay scannable.
          level[i] += (goal[i] - level[i]) * 0.16;
          tint[i] += (goalTint[i] - tint[i]) * 0.2;
          continue;
        }
        const x = col * CELL + CELL / 2;
        let boost = beam * 0.45;
        let accent = beam * 0.8;

        const d = Math.hypot(x - pointer.x, y - pointer.y);
        if (d < 140) {
          const p = 1 - d / 140;
          boost += p * 0.7;
          accent = Math.max(accent, p);
        }
        for (const rp of ripples) {
          const radius = ((now - rp.t) / 1000) * 620;
          const band = 1 - Math.abs(Math.hypot(x - rp.x, y - rp.y) - radius) / 36;
          if (band > 0) {
            const fade = 1 - (now - rp.t) / 1600;
            boost += band * fade * 0.9;
            accent = Math.max(accent, band * fade);
          }
        }

        const target = Math.min(1, goal[i] + (goal[i] || ambient[i] || boost > 0.3 ? boost : 0));
        level[i] += (target - level[i]) * 0.16;
        tint[i] += (Math.max(goalTint[i], accent) - tint[i]) * 0.2;
      }
    }

    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const n = cols * rows;
    // Two passes keep fillStyle changes to a minimum.
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass ? colors.accent : colors.ink;
      for (let i = 0; i < n; i++) {
        const l = level[i];
        if (l < 0.02) continue;
        const accentCell = tint[i] > 0.5;
        if (accentCell !== !!pass) continue;
        // Code modules fill their cell so finder patterns stay solid (scanners
        // look for an unbroken 1:1:3:1:1 ratio); ambient dots stay small.
        const s = size[i] ? CELL : CELL * (0.28 + l * 0.32);
        const x = (i % cols) * CELL + (CELL - s) / 2;
        const y = ((i / cols) | 0) * CELL + (CELL - s) / 2;
        // Assembled codes get enough contrast to actually scan (scanners need
        // properly dark modules on light backgrounds); the ambient field stays faint.
        const alpha = size[i]
          ? (pass ? (colors.light ? 0.95 : 0.8) : (colors.light ? 0.85 : 0.6))
          : (pass ? 0.42 : 0.13);
        ctx.globalAlpha = l * alpha;
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (now - lastFrame < 1000 / FPS) return;
    lastFrame = now;
    if (now - lastStamp > STAMP_EVERY) {
      addStamp(now);
      lastStamp = now;
    }
    frame(now);
  }

  // ---------- Setup ----------

  let running = false;
  let rafId = 0;

  // Reduced motion: one still frame with a single assembled code.
  function staticFrame() {
    still = true;
    stamps = [];
    ripples = [];
    pointer.x = pointer.y = -9999;
    const t = performance.now();
    addStamp(t - 5000 + STAMP_HOLD);
    for (let k = 0; k < 40; k++) frame(t);
  }

  function start() {
    if (running) return;
    running = true;
    still = false;
    stamps = [];
    // First code shortly after starting rather than waiting a full interval.
    lastStamp = performance.now() - STAMP_EVERY + 900;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    staticFrame();
  }

  readColors();
  resize();

  // Re-read colours when the theme changes (toggle or system setting).
  const recolor = () => {
    readColors();
    if (!running) draw();
  };
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (!running) staticFrame();
    }, 150);
  });

  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    pointer.x = pointer.y = -9999;
  });
  window.addEventListener("pointerdown", (e) => {
    if (!running || e.target.closest("input, textarea, select, dialog")) return;
    ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  }, { passive: true });

  QR.prefs.onMotionChange((reduced) => (reduced ? stop() : start()));
  QR.prefs.reducedMotion() ? staticFrame() : start();
})();
