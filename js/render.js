// Turns a payload plus appearance options into SVG markup or a canvas.
// Geometry is built once as SVG path data (in module units) and reused by
// both outputs: the SVG embeds it directly, the canvas fills it via Path2D.
window.QR = window.QR || {};

(() => {
  "use strict";

  // Encode multi-byte characters (emoji, Urdu, accents) correctly.
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  }

  const FONT = '"Instrument Sans", "Segoe UI", Helvetica, Arial, sans-serif';
  const n3 = (v) => +v.toFixed(3);

  function buildMatrix(text, ecc) {
    const qr = qrcode(0, ecc);
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const matrix = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      matrix.push(row);
    }
    return matrix;
  }

  // ---------- Path primitives ----------

  // Rounded rectangle with per-corner radii [tl, tr, br, bl].
  function roundRect(x, y, w, h, radius) {
    const [tl, tr, br, bl] = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
    const arc = (r, ex, ey) => (r ? `A${n3(r)} ${n3(r)} 0 0 1 ${n3(ex)} ${n3(ey)}` : "");
    return (
      `M${n3(x + tl)} ${n3(y)}H${n3(x + w - tr)}${arc(tr, x + w, y + tr)}` +
      `V${n3(y + h - br)}${arc(br, x + w - br, y + h)}` +
      `H${n3(x + bl)}${arc(bl, x, y + h - bl)}` +
      `V${n3(y + tl)}${arc(tl, x + tl, y)}Z`
    );
  }

  function circle(cx, cy, r) {
    return `M${n3(cx - r)} ${n3(cy)}a${n3(r)} ${n3(r)} 0 1 0 ${n3(2 * r)} 0a${n3(r)} ${n3(r)} 0 1 0 ${n3(-2 * r)} 0Z`;
  }

  // Three nested shapes; filled with the even-odd rule they form ring + centre.
  function finderPath(x, y, style) {
    if (style === "circle") {
      return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5) + circle(x + 3.5, y + 3.5, 1.5);
    }
    const [outer, hole, centre] = style === "rounded" ? [2.2, 1.4, 1] : [0, 0, 0];
    return roundRect(x, y, 7, 7, outer) + roundRect(x + 1, y + 1, 5, 5, hole) + roundRect(x + 2, y + 2, 3, 3, centre);
  }

  // Alignment patterns are drawn as one solid shape too: split into separate
  // dots, scanners stop recognising them on version 2+ codes.
  function alignPath(x, y, style) {
    if (style === "circle") {
      return circle(x + 2.5, y + 2.5, 2.5) + circle(x + 2.5, y + 2.5, 1.5) + circle(x + 2.5, y + 2.5, 0.5);
    }
    const [outer, hole, centre] = style === "rounded" ? [1.5, 0.8, 0.35] : [0, 0, 0];
    return roundRect(x, y, 5, 5, outer) + roundRect(x + 1, y + 1, 3, 3, hole) + roundRect(x + 2, y + 2, 1, 1, centre);
  }

  function isFinder(r, c, n) {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  // Centre coordinates of alignment patterns (ISO/IEC 18004 table, computed).
  function alignmentCentres(n) {
    const version = (n - 17) / 4;
    if (version < 2) return [];
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const coords = [6];
    for (let pos = n - 7; coords.length < count; pos -= step) coords.splice(1, 0, pos);
    const centres = [];
    coords.forEach((r) =>
      coords.forEach((c) => {
        const overlapsFinder = (r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6);
        if (!overlapsFinder) centres.push([r, c]);
      })
    );
    return centres;
  }

  // ---------- Layout ----------

  let measureCtx;
  function fitFontSize(text, maxWidth, size) {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    measureCtx.font = `600 ${size}px ${FONT}`;
    const width = measureCtx.measureText(text).width;
    return width > maxWidth ? size * (maxWidth / width) : size;
  }

  // Everything is measured in modules; the outputs scale it to pixels.
  function layout(matrix, opts, logo) {
    const n = matrix.length;
    const frame = opts.frame || "none";
    const caption = frame !== "none" ? String(opts.caption || "").trim() : "";
    const margin = frame === "box" ? Math.max(opts.margin, 2) : opts.margin;
    const T = n + margin * 2;
    const border = frame === "box" ? Math.max(1, T * 0.035) : 0;
    const capH = frame !== "none" ? Math.max(5, T * 0.17) : 0;
    const W = T + border * 2;
    const H = T + border * 2 + capH;
    const qx = border + margin;
    const qy = border + margin;

    // Logo box: an odd number of modules so it stays centred on the grid.
    let logoBox = null;
    if (logo) {
      let k = Math.round(n * (opts.logoSize || 0.22));
      if (k % 2 === 0) k += 1;
      const start = (n - k) / 2;
      const pad = 0.6;
      const inner = k - pad * 2;
      const scale = Math.min(inner / logo.width, inner / logo.height);
      const w = logo.width * scale;
      const h = logo.height * scale;
      logoBox = {
        start,
        end: start + k,
        x: qx + start + (k - w) / 2,
        y: qy + start + (k - h) / 2,
        w,
        h,
      };
    }

    let fontSize = 0;
    if (caption) fontSize = fitFontSize(caption, W * 0.86, capH * 0.42);

    return { n, frame, caption, margin, T, border, capH, W, H, qx, qy, logoBox, fontSize };
  }

  function codePath(matrix, opts, L) {
    const { n, qx, qy, logoBox } = L;
    const excavated = (r, c) =>
      logoBox && r >= logoBox.start && r < logoBox.end && c >= logoBox.start && c < logoBox.end;
    const underLogo = (r, c) =>
      logoBox && r - 2 < logoBox.end && r + 2 >= logoBox.start && c - 2 < logoBox.end && c + 2 >= logoBox.start;
    const aligns = alignmentCentres(n).filter(([r, c]) => !underLogo(r, c));
    const inAlign = (r, c) => aligns.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2);
    const dark = (r, c) =>
      r >= 0 && c >= 0 && r < n && c < n && matrix[r][c] && !isFinder(r, c, n) && !inAlign(r, c) && !excavated(r, c);

    const parts = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!dark(r, c)) continue;
        const x = qx + c;
        const y = qy + r;
        if (opts.dots === "dots") {
          parts.push(circle(x + 0.5, y + 0.5, 0.45));
        } else if (opts.dots === "rounded") {
          // Round a corner only where both neighbours touching it are light,
          // so connected runs stay solid and edges become smooth.
          const up = !dark(r - 1, c);
          const down = !dark(r + 1, c);
          const left = !dark(r, c - 1);
          const right = !dark(r, c + 1);
          const R = 0.5;
          parts.push(roundRect(x, y, 1, 1, [up && left ? R : 0, up && right ? R : 0, down && right ? R : 0, down && left ? R : 0]));
        } else {
          parts.push(`M${x} ${y}h1v1h-1z`);
        }
      }
    }
    const marks = [
      finderPath(qx, qy, opts.corners),
      finderPath(qx + n - 7, qy, opts.corners),
      finderPath(qx, qy + n - 7, opts.corners),
    ];
    aligns.forEach(([r, c]) => marks.push(alignPath(qx + c - 2, qy + r - 2, opts.corners)));
    return { data: parts.join(""), marks: marks.join("") };
  }

  function gradientGeometry(opts, L) {
    const { qx, qy, n } = L;
    switch (opts.gradient) {
      case "vertical": return { kind: "linear", x1: qx, y1: qy, x2: qx, y2: qy + n };
      case "horizontal": return { kind: "linear", x1: qx, y1: qy, x2: qx + n, y2: qy };
      case "diagonal": return { kind: "linear", x1: qx, y1: qy, x2: qx + n, y2: qy + n };
      case "radial": return { kind: "radial", cx: qx + n / 2, cy: qy + n / 2, r: n * 0.72 };
      default: return null;
    }
  }

  // Options can arrive from share links and saved history, so every value is
  // checked here before any of it is written into SVG markup.
  const DEFAULTS = {
    fg: "#111111", fg2: "#2f5d50", bg: "#ffffff", gradient: "none", dots: "square", corners: "square",
    frame: "none", caption: "", ecc: "M", margin: 4, logoSize: 0.22,
  };
  const ENUMS = {
    gradient: ["none", "vertical", "horizontal", "diagonal", "radial"],
    dots: ["square", "rounded", "dots"],
    corners: ["square", "rounded", "circle"],
    frame: ["none", "caption", "box"],
    ecc: ["L", "M", "Q", "H"],
  };
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fallback);

  function sanitizeOpts(o = {}) {
    const out = { ...DEFAULTS };
    ["fg", "fg2", "bg"].forEach((k) => {
      if (/^#[0-9a-f]{6}$/i.test(o[k])) out[k] = o[k].toLowerCase();
    });
    Object.entries(ENUMS).forEach(([k, allowed]) => {
      if (allowed.includes(o[k])) out[k] = o[k];
    });
    out.margin = Math.round(clamp(o.margin, 0, 8, DEFAULTS.margin));
    out.logoSize = clamp(o.logoSize, 0.1, 0.3, DEFAULTS.logoSize);
    out.caption = String(o.caption == null ? "" : o.caption).slice(0, 40);
    return out;
  }

  // Logos are always re-encoded to PNG on upload; refuse anything else.
  const isSafeLogo = (logo) => !!logo && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo.src);

  function build(payload, rawOpts, rawLogo) {
    const opts = sanitizeOpts(rawOpts);
    const logo = isSafeLogo(rawLogo) ? rawLogo : null;
    const ecc = logo ? "H" : opts.ecc;
    const matrix = buildMatrix(payload, ecc);
    const L = layout(matrix, opts, logo);
    const { data, marks } = codePath(matrix, opts, L);
    return { payload, opts, logo, ecc, matrix, L, dataPath: data, markPath: marks, path: data + marks };
  }

  // ---------- SVG ----------

  const escapeXml = (s) =>
    s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);

  let gradientId = 0;

  function toSvg(model) {
    const { opts, logo, L, path } = model;
    const g = gradientGeometry(opts, L);
    const id = `qrg${++gradientId}`;
    const out = [];

    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${n3(L.W)} ${n3(L.H)}">`
    );
    if (g) {
      const stops = `<stop offset="0" stop-color="${opts.fg}"/><stop offset="1" stop-color="${opts.fg2}"/>`;
      out.push(
        g.kind === "linear"
          ? `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient></defs>`
          : `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${g.cx}" cy="${g.cy}" r="${n3(g.r)}">${stops}</radialGradient></defs>`
      );
    }

    // The box frame's rounded outer corners stay transparent.
    if (L.frame !== "box") out.push(`<rect width="${n3(L.W)}" height="${n3(L.H)}" fill="${opts.bg}"/>`);
    if (L.frame === "box") {
      out.push(`<path d="${roundRect(0, 0, L.W, L.H, L.border * 1.6)}" fill="${opts.fg}"/>`);
      out.push(`<path d="${roundRect(L.border, L.border, L.T, L.T, L.border * 0.8)}" fill="${opts.bg}"/>`);
    }

    const crisp = opts.dots === "square" && opts.corners === "square" ? ' shape-rendering="crispEdges"' : "";
    out.push(`<path d="${path}" fill="${g ? `url(#${id})` : opts.fg}" fill-rule="evenodd"${crisp}/>`);

    if (logo && L.logoBox) {
      const b = L.logoBox;
      out.push(
        `<image x="${n3(b.x)}" y="${n3(b.y)}" width="${n3(b.w)}" height="${n3(b.h)}" href="${logo.src}" xlink:href="${logo.src}" preserveAspectRatio="none"/>`
      );
    }

    if (L.caption) {
      const y = L.frame === "box" ? L.border + L.T + L.capH / 2 : L.T + L.capH / 2 - L.capH * 0.12;
      const fill = L.frame === "box" ? opts.bg : opts.fg;
      out.push(
        `<text x="${n3(L.W / 2)}" y="${n3(y)}" text-anchor="middle" dominant-baseline="central" font-family='${FONT}' font-weight="600" font-size="${n3(L.fontSize)}" fill="${fill}">${escapeXml(L.caption)}</text>`
      );
    }

    out.push("</svg>");
    return out.join("");
  }

  // ---------- Canvas ----------

  function toCanvas(model, width) {
    const { opts, logo, L, path } = model;
    const scale = width / L.W;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(L.W * scale);
    canvas.height = Math.round(L.H * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    if (L.frame !== "box") {
      ctx.fillStyle = opts.bg;
      ctx.fillRect(0, 0, L.W, L.H);
    }
    if (L.frame === "box") {
      ctx.fillStyle = opts.fg;
      ctx.fill(new Path2D(roundRect(0, 0, L.W, L.H, L.border * 1.6)));
      ctx.fillStyle = opts.bg;
      ctx.fill(new Path2D(roundRect(L.border, L.border, L.T, L.T, L.border * 0.8)));
    }

    const g = gradientGeometry(opts, L);
    if (g) {
      const grad =
        g.kind === "linear"
          ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
          : ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r);
      grad.addColorStop(0, opts.fg);
      grad.addColorStop(1, opts.fg2);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = opts.fg;
    }
    ctx.fill(new Path2D(path), "evenodd");

    if (logo && logo.img && L.logoBox) {
      const b = L.logoBox;
      ctx.drawImage(logo.img, b.x, b.y, b.w, b.h);
    }

    if (L.caption) {
      const y = L.frame === "box" ? L.border + L.T + L.capH / 2 : L.T + L.capH / 2 - L.capH * 0.12;
      ctx.fillStyle = L.frame === "box" ? opts.bg : opts.fg;
      ctx.font = `600 ${L.fontSize}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(L.caption, L.W / 2, y);
    }
    return canvas;
  }

  // ---------- Checks ----------

  function luminance(hex) {
    const v = parseInt(hex.slice(1), 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  function contrastIssues(rawOpts) {
    const opts = sanitizeOpts(rawOpts);
    const issues = [];
    const fgs = opts.gradient && opts.gradient !== "none" ? [opts.fg, opts.fg2] : [opts.fg];
    const bgLum = luminance(opts.bg);
    const worst = Math.min(...fgs.map((c) => contrastRatio(c, opts.bg)));
    if (fgs.some((c) => luminance(c) > bgLum)) {
      issues.push({ level: "warn", text: "The code is lighter than its background. Many phones can only read dark codes on light backgrounds." });
    }
    if (worst < 4) {
      issues.push({
        level: worst < 2 ? "error" : "warn",
        text: "The code and background colours are too similar, so phones may struggle to read it. Pick a darker code colour or a lighter background.",
      });
    }
    return issues;
  }

  // Decode the rendered image the way a strict scanner would (no inversion).
  function verify(model) {
    if (typeof jsQR !== "function") return { status: "unavailable" };
    const width = Math.min(1600, Math.max(480, Math.round(model.L.W * 6)));
    const canvas = toCanvas(model, width);
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
    if (!result) return { status: "fail" };
    return { status: result.data === model.payload ? "pass" : "mismatch" };
  }

  QR.render = { build, toSvg, toCanvas, verify, contrastIssues, sanitizeOpts, FONT };
})();
