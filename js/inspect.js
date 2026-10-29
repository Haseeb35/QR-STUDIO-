// "Check a QR code": decode an image or camera feed locally and explain
// what the code will do before anyone opens it.
window.QR = window.QR || {};

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const S = QR.security;
  const toast = (msg) => QR.toast && QR.toast(msg);

  const drop = $("#inspectDrop");
  const video = $("#inspectVideo");
  const cameraBtn = $("#cameraBtn");
  if (!drop) return;

  const MAX_SIDE = 1600;
  let stream = null;
  let scanTimer = 0;
  let current = "";

  const VERDICTS = {
    ok: ["No problems found", "Still only open codes from sources you trust."],
    caution: ["Proceed with care", "Read the notes below before opening."],
    danger: ["Don't open this", "This code shows signs of being malicious."],
  };

  function decode(source, width, height, attempts = "attemptBoth") {
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, canvas.width, canvas.height, { inversionAttempts: attempts });
  }

  async function inspectFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose an image file");
    if (file.size > S.LIMITS.inspectBytes) return toast(`Images must be under ${S.formatBytes(S.LIMITS.inspectBytes)}`);
    stopCamera();
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const result = decode(img, img.naturalWidth || 800, img.naturalHeight || 800);
      result ? show(result.data) : showNotFound();
    } catch {
      toast("Couldn't read that image");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Camera ----------

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast("The camera needs a secure (https) page");
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch {
      return toast("Camera permission was denied or no camera was found");
    }
    video.srcObject = stream;
    video.hidden = false;
    $("#inspectIdle").hidden = true;
    drop.classList.add("is-live");
    cameraBtn.textContent = "Stop camera";
    await video.play().catch(() => {});
    tick();
  }

  function tick() {
    if (!stream) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const result = decode(video, video.videoWidth, video.videoHeight, "dontInvert");
      if (result && result.data) {
        stopCamera();
        show(result.data);
        return;
      }
    }
    scanTimer = setTimeout(tick, 150);
  }

  function stopCamera() {
    clearTimeout(scanTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    $("#inspectIdle").hidden = false;
    drop.classList.remove("is-live");
    cameraBtn.textContent = "Use camera";
  }

  // ---------- Results ----------

  function showNotFound() {
    $("#resultEmpty").hidden = false;
    $("#resultBody").hidden = true;
    $("#resultEmpty").textContent = "No QR code found in that image. Try a sharper, closer or better-lit photo.";
  }

  function show(content) {
    current = content;
    const info = S.describe(content);
    const level = S.verdict(info.issues);
    const [title, sub] = VERDICTS[level];

    $("#resultEmpty").hidden = true;
    $("#resultBody").hidden = false;
    $("#verdict").dataset.level = level;
    $("#verdictTitle").textContent = title;
    $("#verdictSub").textContent = `${info.kind} · ${sub}`;

    // All decoded text is inserted with textContent only, never as HTML.
    const dl = $("#resultDetails");
    dl.innerHTML = "";
    info.details.forEach(([label, value, secret]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      if (secret) {
        const span = document.createElement("span");
        span.textContent = "•".repeat(Math.min(12, value.length));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "link-btn";
        btn.textContent = "Show";
        btn.addEventListener("click", () => {
          const hidden = btn.textContent === "Show";
          span.textContent = hidden ? value : "•".repeat(Math.min(12, value.length));
          btn.textContent = hidden ? "Hide" : "Show";
        });
        dd.append(span, " ", btn);
      } else {
        dd.textContent = value;
      }
      row.append(dt, dd);
      dl.appendChild(row);
    });

    const ul = $("#resultIssues");
    ul.innerHTML = "";
    info.issues.forEach((issue) => {
      const li = document.createElement("li");
      li.className = `warning ${issue.level}`;
      li.textContent = issue.text;
      ul.appendChild(li);
    });

    const open = $("#openLink");
    open.hidden = !info.openUrl;
    open.href = info.openUrl || "#";
    open.dataset.level = level;
    $("#rawContent").textContent = content;
    $("#check").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- Wiring ----------

  $("#inspectInput").addEventListener("change", (e) => {
    inspectFile(e.target.files[0]);
    e.target.value = "";
  });

  drop.addEventListener("click", () => !stream && $("#inspectInput").click());
  drop.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !stream) {
      e.preventDefault();
      $("#inspectInput").click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-dragging")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    inspectFile(e.dataTransfer.files[0]);
  });

  // Paste an image anywhere on the page (outside text fields) to check it.
  document.addEventListener("paste", (e) => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      inspectFile(item.getAsFile());
    }
  });

  cameraBtn.addEventListener("click", () => (stream ? stopCamera() : startCamera()));
  window.addEventListener("pagehide", stopCamera);

  $("#copyContent").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(current);
      toast("Content copied");
    } catch {
      toast("Couldn't copy to the clipboard");
    }
  });

  $("#openLink").addEventListener("click", (e) => {
    const link = e.currentTarget;
    if (link.dataset.level === "caution" && !window.confirm(`Open this link?\n\n${link.href}`)) e.preventDefault();
  });

  QR.inspect = { show };
})();
