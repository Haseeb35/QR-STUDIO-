// Loaded in <head> so the saved theme and motion preference apply before first paint.
// Motion follows the system "reduce motion" setting until the user picks one.
window.QR = window.QR || {};

(() => {
  "use strict";

  const root = document.documentElement;
  const system = matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new Set();

  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };

  const theme = read("qr-theme");
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;

  function apply() {
    const saved = read("qr-motion");
    const reduced = saved === "off" || (saved !== "on" && system.matches);
    const changed = root.dataset.motion !== (reduced ? "reduce" : "full");
    root.dataset.motion = reduced ? "reduce" : "full";
    if (changed) listeners.forEach((fn) => fn(reduced));
  }

  system.addEventListener("change", apply);

  QR.prefs = {
    reducedMotion: () => root.dataset.motion === "reduce",
    setMotion(on) {
      try {
        localStorage.setItem("qr-motion", JSON.stringify(on ? "on" : "off"));
      } catch {}
      apply();
    },
    onMotionChange: (fn) => listeners.add(fn),
  };

  apply();
})();
