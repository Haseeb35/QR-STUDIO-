// 3D and motion: hero layer scene, pointer tilt, scan beam, card flip.
// Everything here is decorative and switches off when motion is reduced
// (system setting or the animations toggle; see prefs.js).
window.QR = window.QR || {};

(() => {
  "use strict";

  const reduced = () => QR.prefs.reducedMotion();
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

  // Eases current values toward a target each frame, so motion trails the
  // pointer smoothly instead of snapping. Stops when it settles.
  function follower(apply) {
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    function tick() {
      cur.x += (target.x - cur.x) * 0.1;
      cur.y += (target.y - cur.y) * 0.1;
      apply(cur);
      const settled = Math.abs(target.x - cur.x) < 0.001 && Math.abs(target.y - cur.y) < 0.001;
      raf = settled ? 0 : requestAnimationFrame(tick);
    }
    return (x, y) => {
      target.x = x;
      target.y = y;
      if (!raf) raf = requestAnimationFrame(tick);
    };
  }

  // Pointer position over an element, as -1..1 on each axis.
  function relative(e, el) {
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
  }

  // ---------- Hero: a real QR code split into floating layers ----------

  function hero() {
    const scene = document.getElementById("heroScene");
    if (!scene) return;
    const model = QR.render.build(
      "https://github.com/Haseeb35/QR-STUDIO-",
      { fg: "#000", fg2: "#000", bg: "#fff", gradient: "none", dots: "rounded", corners: "rounded",
        frame: "none", caption: "", ecc: "M", margin: 2, logoSize: 0.22 },
      null
    );
    const { W, H } = model.L;
    const svg = (inner) => `<svg viewBox="0 0 ${W} ${H}">${inner}</svg>`;

    scene.innerHTML = `
      <div class="float">
        <div class="rig" id="heroRig">
          <div class="layer l-shadow"></div>
          <div class="layer l-plate">${svg(`<rect width="${W}" height="${H}" rx="1.6"/>`)}</div>
          <div class="layer l-data">${svg(`<path d="${model.dataPath}" fill-rule="evenodd"/>`)}</div>
          <div class="layer l-marks">${svg(`<path d="${model.markPath}" fill-rule="evenodd"/>`)}</div>
          <div class="layer l-glass"><span class="scanline"></span></div>
        </div>
      </div>
      <ul class="layer-legend">
        <li><span class="swatch s-marks"></span>Finder patterns</li>
        <li><span class="swatch s-data"></span>Data modules</li>
        <li><span class="swatch s-plate"></span>Quiet zone</li>
      </ul>`;

    // Layers start stacked flat, then separate once painted.
    requestAnimationFrame(() => requestAnimationFrame(() => scene.classList.add("is-ready")));

    if (!finePointer.matches) return;
    const rig = document.getElementById("heroRig");
    const move = follower(({ x, y }) => {
      rig.style.setProperty("--px", x.toFixed(4));
      rig.style.setProperty("--py", y.toFixed(4));
    });
    const area = document.querySelector(".hero");
    area.addEventListener("pointermove", (e) => !reduced() && move(...relative(e, area)));
    area.addEventListener("pointerleave", () => move(0, 0));
    QR.prefs.onMotionChange((off) => off && move(0, 0));
  }

  // ---------- Preview card tilt with moving glare ----------

  function tilt() {
    const stage = document.getElementById("stage");
    const card = document.getElementById("card3d");
    if (!stage || !card || !finePointer.matches) return;
    const move = follower(({ x, y }) => {
      card.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
      card.style.setProperty("--rx", `${(-y * 9).toFixed(2)}deg`);
      card.style.setProperty("--gx", `${(50 + x * 45).toFixed(1)}%`);
      card.style.setProperty("--gy", `${(50 + y * 45).toFixed(1)}%`);
    });
    stage.addEventListener("pointermove", (e) => {
      if (reduced()) return;
      stage.classList.add("is-hover");
      move(...relative(e, stage));
    });
    stage.addEventListener("pointerleave", () => {
      stage.classList.remove("is-hover");
      move(0, 0);
    });
    QR.prefs.onMotionChange((off) => off && move(0, 0));
  }

  // Restart a CSS animation by toggling its class across a reflow.
  function replay(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---------- Header ----------

  function header() {
    const bar = document.getElementById("topbar");
    if (!bar) return;
    const update = () => bar.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  hero();
  tilt();
  header();

  QR.motion = {
    sweep: () => replay(document.getElementById("beam"), "run"),
    flip: () => replay(document.getElementById("qrWrap"), "flip"),
  };
})();
