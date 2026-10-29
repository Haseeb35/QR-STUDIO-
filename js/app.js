(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const S = QR.security;

  const form = $("#form");
  const qrEl = $("#qr");
  const emptyEl = $("#emptyState");
  const payloadEl = $("#payload");
  const exportButtons = ["#downloadPng", "#downloadSvg", "#copyPng", "#shareLink", "#printOne"].map((s) => $(s));

  const HISTORY_KEY = "qr-history";
  const HISTORY_LIMIT = 10;
  const MAX_LOGO_PX = 512;

  let activeType = "url";
  let current = null; // { model, type, fields }
  let logo = null; // { src, img, width, height, name }

  // ---------- Storage (may be unavailable in private windows) ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
  };

  // ---------- Type tabs and generated fields ----------

  const fieldName = (type, f) => `${type.id}.${f.key}`;

  const ICONS = {
    url: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    wifi: '<path d="M5 12.5a11 11 0 0 1 14 0M1.5 9a16 16 0 0 1 21 0M8.5 16a6 6 0 0 1 7 0M12 20h.01"/>',
    contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
    event: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    location: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    payment: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  };

  function buildField(type, f) {
    const name = fieldName(type, f);

    if (f.type === "checkbox") {
      const wrap = document.createElement("label");
      wrap.className = `check field${f.half ? "" : " full"}`;
      wrap.innerHTML = `<input type="checkbox" name="${name}"><span></span>`;
      wrap.querySelector("span").textContent = f.label;
      return wrap;
    }

    const wrap = document.createElement("label");
    wrap.className = `field${f.half ? "" : " full"}`;
    const label = document.createElement("span");
    label.className = "label";
    const labelText = document.createElement("span");
    labelText.className = "label-text";
    labelText.textContent = f.label;
    label.appendChild(labelText);
    if (f.counter || f.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      if (f.counter) hint.dataset.counter = name;
      hint.textContent = f.counter ? "0 characters" : f.hint;
      label.appendChild(hint);
    }
    wrap.appendChild(label);

    let control;
    if (f.type === "textarea") {
      control = document.createElement("textarea");
      control.rows = 5;
    } else if (f.type === "select") {
      control = document.createElement("select");
      f.options.forEach(([value, text]) => control.add(new Option(text, value)));
    } else {
      control = document.createElement("input");
      control.type = f.type || "text";
      if (f.step) control.step = f.step;
      if (f.min) control.min = f.min;
      if (f.type === "url") control.inputMode = "url";
    }
    control.name = name;
    if (f.placeholder) control.placeholder = f.placeholder;
    if (f.value) control.value = f.value;

    if (f.type === "password") {
      const group = document.createElement("span");
      group.className = "input-group";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ghost-btn";
      toggle.textContent = "Show";
      toggle.addEventListener("click", () => {
        const show = control.type === "password";
        control.type = show ? "text" : "password";
        toggle.textContent = show ? "Hide" : "Show";
      });
      group.append(control, toggle);
      wrap.appendChild(group);
    } else {
      wrap.appendChild(control);
    }
    if (f.help || f.adapt) {
      const help = document.createElement("span");
      help.className = "field-help";
      help.textContent = f.help || "";
      wrap.appendChild(help);
    }
    return wrap;
  }

  // Fields can adapt (label, placeholder, hint) or hide based on other answers,
  // e.g. "Link to: WhatsApp" turns the address box into a phone number box.
  function updateAdaptiveFields() {
    QR.types.forEach((type) => {
      if (!type.fields.some((f) => f.adapt || f.showIf)) return;
      const values = readFields(type);
      type.fields.forEach((f) => {
        const el = form.elements[fieldName(type, f)];
        const wrap = el.closest(".field");
        if (f.showIf) wrap.hidden = !f.showIf(values);
        if (!f.adapt) return;
        const a = f.adapt(values);
        wrap.querySelector(".label-text").textContent = a.label;
        el.placeholder = a.placeholder;
        wrap.querySelector(".field-help").textContent = a.help;
        if (el.type !== a.inputType) el.type = a.inputType;
      });
    });
  }

  function buildTypeUI() {
    const tabs = $("#typeTabs");
    const container = $("#typeFields");
    QR.types.forEach((type) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "type-tab";
      tab.setAttribute("role", "tab");
      tab.dataset.type = type.id;
      tab.innerHTML = `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[type.id] || ""}</svg><span></span>`;
      tab.querySelector("span").textContent = type.label;
      tab.addEventListener("click", () => selectType(type.id));
      tabs.appendChild(tab);

      const panel = document.createElement("fieldset");
      panel.className = "fields";
      panel.dataset.panel = type.id;
      panel.hidden = true;
      type.fields.forEach((f) => panel.appendChild(buildField(type, f)));

      if (type.action === "geolocate") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn small field full fit";
        btn.textContent = "Use my current location";
        btn.addEventListener("click", geolocate);
        panel.appendChild(btn);
      }
      container.appendChild(panel);
    });

    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const all = $$(".type-tab");
      const i = all.findIndex((t) => t.dataset.type === activeType);
      const next = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
      next.focus();
      selectType(next.dataset.type);
    });
  }

  function selectType(id) {
    const next = QR.getType(id).id;
    if (next !== activeType && QR.motion) QR.motion.flip();
    activeType = next;
    $("#typeChip").textContent = QR.getType(next).label;
    $("#typeAbout").textContent = QR.getType(next).about || "";
    $$(".type-tab").forEach((t) => {
      const on = t.dataset.type === activeType;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== activeType));
    updateBatchStatus();
    render();
  }

  function readFields(type) {
    const out = {};
    type.fields.forEach((f) => {
      const el = form.elements[fieldName(type, f)];
      out[f.key] = f.type === "checkbox" ? el.checked : el.value;
    });
    return out;
  }

  function writeFields(type, values) {
    type.fields.forEach((f) => {
      const el = form.elements[fieldName(type, f)];
      const v = values[f.key];
      if (f.type === "checkbox") el.checked = QR.truthy(v);
      else if (f.type === "select") {
        // Links and history from older versions may lack newer options.
        const valid = f.options.some(([value]) => value === String(v));
        el.value = valid ? String(v) : f.value || f.options[0][0];
      } else el.value = v == null ? "" : String(v).slice(0, S.LIMITS.fieldChars);
    });
    updateFieldUI();
  }

  function updateFieldUI() {
    updateAdaptiveFields();
    $$("[data-counter]").forEach((hint) => {
      const len = form.elements[hint.dataset.counter].value.length;
      hint.textContent = `${len} character${len === 1 ? "" : "s"}`;
    });
    const enc = form.elements["wifi.encryption"];
    form.elements["wifi.password"].disabled = enc.value === "nopass";
  }

  function geolocate() {
    if (!navigator.geolocation) return toast("Location isn't available in this browser");
    toast("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.elements["location.lat"].value = pos.coords.latitude.toFixed(6);
        form.elements["location.lng"].value = pos.coords.longitude.toFixed(6);
        render();
        toast("Location added");
      },
      () => toast("Couldn't get your location"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ---------- Appearance ----------

  function readOpts() {
    const e = form.elements;
    return {
      fg: e.fg.value,
      fg2: e.fg2.value,
      bg: e.bg.value,
      gradient: e.gradient.value,
      dots: e.dots.value,
      corners: e.corners.value,
      frame: e.frame.value,
      caption: e.caption.value,
      ecc: e.ecc.value,
      margin: Number(e.margin.value),
      logoSize: Number(e.logoSize.value),
    };
  }

  function writeOpts(opts) {
    const e = form.elements;
    Object.entries(opts).forEach(([key, value]) => {
      if (e[key] !== undefined && e[key] !== null) e[key].value = value;
    });
    updateAppearanceUI();
  }

  function updateAppearanceUI() {
    const e = form.elements;
    ["fg", "fg2", "bg"].forEach((k) => ($(`code[data-for="${k}"]`).textContent = e[k].value.toUpperCase()));
    $("#fg2Field").hidden = e.gradient.value === "none";
    $("#captionField").hidden = e.frame.value === "none";
    $("#marginValue").textContent = e.margin.value;
    $("#logoSizeValue").textContent = `${Math.round(e.logoSize.value * 100)}%`;
    $("#logoSizeField").hidden = !logo;
    e.ecc.disabled = !!logo;
    $("#eccHint").textContent = logo ? "Set to highest because of your logo" : "";
    markActivePreset();
  }

  // ---------- Logo ----------

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function setLogo(file) {
    if (!file || !file.type.startsWith("image/")) return toast("Choose an image file");
    if (file.size > S.LIMITS.logoBytes) return toast(`Logos must be under ${S.formatBytes(S.LIMITS.logoBytes)}`);
    try {
      const original = await loadImage(await readAsDataUrl(file));
      const w0 = original.naturalWidth || MAX_LOGO_PX;
      const h0 = original.naturalHeight || MAX_LOGO_PX;

      // Re-encode every logo, SVG included, as a PNG of at most 512px. This
      // strips any script or external reference an SVG could carry and keeps
      // exports, share data and history light.
      const scale = Math.min(1, MAX_LOGO_PX / Math.max(w0, h0));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      canvas.getContext("2d").drawImage(original, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL("image/png");
      const img = await loadImage(src);

      logo = { src, img, width: canvas.width, height: canvas.height, name: file.name };
      $("#logoThumb").innerHTML = "";
      $("#logoThumb").appendChild(img.cloneNode());
      $("#logoName").textContent = file.name;
      $("#logoHint").textContent = "Added. The code is made extra sturdy so it still scans with the logo covering part of it.";
      $("#logoRemove").hidden = false;
      updateAppearanceUI();
      render();
    } catch {
      toast("Couldn't read that image");
    }
  }

  const LOGO_ICON = $("#logoThumb").innerHTML;

  function clearLogo() {
    logo = null;
    $("#logoInput").value = "";
    $("#logoThumb").innerHTML = LOGO_ICON;
    $("#logoName").textContent = "Add a logo";
    $("#logoHint").textContent = "PNG, JPG or SVG. Drop a file here or choose one.";
    $("#logoRemove").hidden = true;
    updateAppearanceUI();
    render();
  }

  $("#logoInput").addEventListener("change", (e) => setLogo(e.target.files[0]));
  $("#logoRemove").addEventListener("click", clearLogo);

  const drop = $("#logoDrop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-dragging")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    setLogo(e.dataTransfer.files[0]);
  });

  // ---------- Render ----------

  function setStatus(state, text) {
    const el = $("#scanStatus");
    el.dataset.state = state;
    $("#scanText").textContent = text;
  }

  function setWarnings(issues) {
    const list = $("#warnings");
    list.innerHTML = "";
    issues.forEach((issue) => {
      const li = document.createElement("li");
      li.className = `warning ${issue.level}`;
      li.textContent = issue.text;
      list.appendChild(li);
    });
  }

  function setEmpty(message) {
    current = null;
    qrEl.innerHTML = "";
    qrEl.classList.add("is-empty");
    emptyEl.textContent = message;
    emptyEl.hidden = false;
    payloadEl.textContent = "";
    $("#metaVersion").textContent = "—";
    $("#metaModules").textContent = "—";
    exportButtons.forEach((b) => (b.disabled = true));
    setStatus("idle", "Your code appears as soon as the details are filled in");
    setWarnings([]);
    $("#scanSays").hidden = true;
    $("#wifiSignBtn").hidden = true;
    $("#stage").classList.remove("can-zoom");
    clearTimeout(verifyTimer);
  }

  let verifyTimer;
  let verifyToken = 0;

  function scheduleVerify() {
    clearTimeout(verifyTimer);
    const token = ++verifyToken;
    setStatus("checking", "Testing your code…");
    verifyTimer = setTimeout(() => {
      if (!current || token !== verifyToken) return;
      const { status } = QR.render.verify(current.model);
      if (token !== verifyToken) return;
      const messages = {
        pass: ["pass", "Tested: phones can read this code"],
        mismatch: ["warn", "Phones may read this code wrongly. Try simpler styles or darker colours."],
        fail: ["fail", "Phones may not be able to read this. Try darker colours, a smaller logo, or the Square style."],
        unavailable: ["idle", "Automatic test isn't available in this browser"],
      };
      setStatus(...messages[status]);
      if (status === "pass" && QR.motion) QR.motion.sweep();
    }, 250);
  }

  function render() {
    const type = QR.getType(activeType);
    const fields = readFields(type);
    const payload = type.build(fields);
    const opts = readOpts();
    $("#metaType").textContent = type.label;

    if (!payload) {
      const missing = typeof type.missing === "function" ? type.missing(fields) : type.missing;
      setEmpty(missing || "Fill in the details to create your code.");
      return;
    }

    const safety = S.checkPayload(type.id, fields, payload).map((issue) => ({
      ...issue,
      level: issue.level === "danger" ? "error" : "warn",
    }));
    const blocked = safety.find((issue) => issue.block);
    if (blocked) {
      setEmpty("This link can't be turned into a QR code.");
      setWarnings([blocked]);
      return;
    }

    let model;
    try {
      model = QR.render.build(payload, opts, logo);
    } catch {
      setEmpty("That's too much for one QR code. Try shortening it, or lower the damage tolerance under Advanced settings.");
      return;
    }

    current = { model, type, fields };
    qrEl.innerHTML = QR.render.toSvg(model);
    qrEl.classList.remove("is-empty");
    emptyEl.hidden = true;
    payloadEl.textContent = payload;
    const n = model.matrix.length;
    $("#metaVersion").textContent = `${(n - 17) / 4} · ${model.ecc}`;
    $("#metaModules").textContent = `${n}×${n}`;
    exportButtons.forEach((b) => (b.disabled = false));
    setWarnings(safety.concat(QR.render.contrastIssues(opts)));
    $("#scanSaysText").textContent = type.outcome ? type.outcome(fields) : "";
    $("#scanSays").hidden = !type.outcome;
    $("#wifiSignBtn").hidden = type.id !== "wifi";
    $("#stage").classList.add("can-zoom");
    scheduleVerify();
  }

  form.addEventListener("input", (e) => {
    if (e.target.type === "file") return;
    updateFieldUI();
    updateAppearanceUI();
    render();
  });
  form.addEventListener("change", (e) => {
    if (e.target.type === "file") return;
    // A website address doesn't fit a WhatsApp number or username, so start fresh.
    if (e.target.name === "url.platform") {
      form.elements["url.url"].value = "";
      setTimeout(() => form.elements["url.url"].focus(), 0);
    }
    updateFieldUI();
    updateAppearanceUI();
    render();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  // ---------- State: share links and history ----------

  function snapshot() {
    return { v: 1, t: activeType, f: readFields(QR.getType(activeType)), o: readOpts() };
  }

  // State from share links and storage is untrusted: field values are
  // length-capped in writeFields and options are whitelisted here.
  function applyState(state) {
    if (!state || typeof state !== "object" || typeof state.t !== "string") return;
    const type = QR.getType(state.t);
    const fields = state.f && typeof state.f === "object" ? state.f : {};
    writeFields(type, fields);
    writeOpts(QR.render.sanitizeOpts({ ...DEFAULT_OPTS, ...(state.o && typeof state.o === "object" ? state.o : {}) }));
    selectType(type.id);
  }

  const encodeState = (state) => S.toB64url(new TextEncoder().encode(JSON.stringify(state)));
  const decodeState = (text) => JSON.parse(new TextDecoder().decode(S.fromB64url(text)));

  const clearHash = () => history.replaceState(null, "", location.pathname + location.search);

  function loadFromHash() {
    const plain = location.hash.match(/^#s=([\w-]+)$/);
    const locked = location.hash.match(/^#e=([\w-]+)$/);
    if (locked) {
      openUnlock(locked[1]);
      return false;
    }
    if (!plain) return false;
    try {
      applyState(decodeState(plain[1]));
      clearHash();
      toast("Loaded from shared link");
      return true;
    } catch {
      toast("That share link is invalid");
      return false;
    }
  }

  // Wi-Fi passwords are never written to history.
  function scrubState(state) {
    if (state.t === "wifi" && state.f && state.f.password) state.f = { ...state.f, password: "" };
    return state;
  }

  function addToHistory() {
    if (!current) return;
    const state = scrubState(snapshot());
    const key = JSON.stringify([state.t, state.f, state.o]);
    const list = store.get(HISTORY_KEY, []).filter((item) => item.key !== key);
    list.unshift({
      key,
      state,
      title: current.type.title(current.fields) || current.type.label,
      label: current.type.label,
      ts: Date.now(),
    });
    store.set(HISTORY_KEY, list.slice(0, HISTORY_LIMIT));
    renderHistory();
  }

  const relTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  function timeAgo(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    if (s > -60) return "just now";
    if (s > -3600) return relTime.format(Math.round(s / 60), "minute");
    if (s > -86400) return relTime.format(Math.round(s / 3600), "hour");
    return relTime.format(Math.round(s / 86400), "day");
  }

  function renderHistory() {
    let list = store.get(HISTORY_KEY, []);
    if (!Array.isArray(list)) list = [];
    // Clean entries saved by older versions that kept passwords.
    list = list.filter((item) => item && item.state && typeof item.state.t === "string");
    if (list.some((item) => item.state.t === "wifi" && item.state.f && item.state.f.password)) {
      list = list.map((item) => {
        const state = scrubState(item.state);
        return { ...item, state, key: JSON.stringify([state.t, state.f, state.o]) };
      });
      store.set(HISTORY_KEY, list);
    }
    const ul = $("#historyList");
    ul.innerHTML = "";
    $("#historyEmpty").hidden = list.length > 0;
    $("#historyClear").hidden = list.length === 0;

    list.forEach((item) => {
      const type = QR.getType(item.state.t);
      const payload = type.build(item.state.f || {});
      let thumb = "";
      try {
        thumb = QR.render.toSvg(QR.render.build(payload, { ...DEFAULT_OPTS, ...item.state.o, frame: "none" }, null));
      } catch {}

      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item";
      btn.innerHTML = `<span class="history-thumb">${thumb}</span><span class="history-text"><strong></strong><span></span></span>`;
      btn.querySelector("strong").textContent = String(item.title || "").slice(0, 80);
      btn.querySelector(".history-text span").textContent = `${item.label} · ${timeAgo(item.ts)}`;
      btn.addEventListener("click", () => {
        applyState(item.state);
        toast("Restored from history");
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  $("#historyClear").addEventListener("click", () => {
    store.set(HISTORY_KEY, []);
    renderHistory();
  });

  // ---------- Export ----------

  function fileName(ext) {
    const base = (current.type.title(current.fields) || current.type.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `qr-${base || current.type.id}.${ext}`;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function ensureFonts() {
    // Canvas text needs the caption font loaded before drawing.
    if (document.fonts && current && current.model.L.caption) {
      try {
        await document.fonts.load(`600 16px "Instrument Sans"`);
      } catch {}
    }
  }

  function pngBlob() {
    const width = Number($("#pngSize").value);
    return ensureFonts().then(
      () => new Promise((resolve) => QR.render.toCanvas(current.model, width).toBlob(resolve, "image/png"))
    );
  }

  $("#downloadPng").addEventListener("click", async () => {
    if (!current) return;
    downloadBlob(await pngBlob(), fileName("png"));
    addToHistory();
    toast("Image downloaded. Tip: test it with your phone camera before printing.");
  });

  $("#downloadSvg").addEventListener("click", () => {
    if (!current) return;
    downloadBlob(new Blob([QR.render.toSvg(current.model)], { type: "image/svg+xml" }), fileName("svg"));
    addToHistory();
    toast("SVG downloaded. It stays sharp at any print size.");
  });

  $("#copyPng").addEventListener("click", async () => {
    if (!current) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
      addToHistory();
      toast("Image copied");
    } catch {
      toast("Copying images isn't supported in this browser");
    }
  });

  // ---------- Share dialog ----------

  const shareDialog = $("#shareDialog");
  const baseUrl = () => (location.origin === "null" ? location.href.split("#")[0] : location.origin + location.pathname);

  $("#shareLink").addEventListener("click", () => {
    if (!current) return;
    const hasPassword = activeType === "wifi" && !!form.elements["wifi.password"].value;
    $("#sharePwRow").hidden = !hasPassword;
    $("#shareIncludePw").checked = false;
    $("#shareLock").checked = false;
    $("#shareLock").disabled = !S.cryptoAvailable();
    $("#shareLockHint").textContent = S.cryptoAvailable() ? "" : "Needs a secure (https) page.";
    $("#sharePass").value = "";
    $("#sharePassField").hidden = true;
    $("#shareError").textContent = "";
    $("#shareNote").textContent = logo ? "Logos aren't included in links." : "";
    shareDialog.showModal();
  });

  $("#shareLock").addEventListener("change", (e) => {
    $("#sharePassField").hidden = !e.target.checked;
    if (e.target.checked) $("#sharePass").focus();
  });

  $("#shareCancel").addEventListener("click", () => shareDialog.close());

  async function copyShareLink() {
    const state = snapshot();
    if (state.t === "wifi" && !$("#shareIncludePw").checked) state.f.password = "";

    let hash;
    if ($("#shareLock").checked) {
      const pass = $("#sharePass").value;
      if (pass.length < 8) {
        $("#shareError").textContent = "Use at least 8 characters.";
        return;
      }
      $("#shareCopy").disabled = true;
      try {
        hash = `#e=${await S.seal(JSON.stringify(state), pass)}`;
      } catch {
        $("#shareError").textContent = "Couldn't encrypt the link in this browser.";
        return;
      } finally {
        $("#shareCopy").disabled = false;
      }
    } else {
      hash = `#s=${encodeState(state)}`;
    }

    const url = baseUrl() + hash;
    shareDialog.close();
    addToHistory();
    try {
      await navigator.clipboard.writeText(url);
      toast($("#shareLock").checked ? "Locked link copied. Send the passphrase separately." : "Link copied");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  $("#shareCopy").addEventListener("click", copyShareLink);
  $("#sharePass").addEventListener("keydown", (e) => e.key === "Enter" && copyShareLink());

  // ---------- Unlocking a passphrase-protected link ----------

  const unlockDialog = $("#unlockDialog");
  let pendingToken = null;

  function openUnlock(token) {
    if (!S.cryptoAvailable()) {
      toast("Locked links need a secure (https) page");
      return;
    }
    pendingToken = token;
    $("#unlockPass").value = "";
    $("#unlockError").textContent = "";
    unlockDialog.showModal();
  }

  async function unlock() {
    if (!pendingToken) return;
    $("#unlockBtn").disabled = true;
    try {
      const state = JSON.parse(await S.unseal(pendingToken, $("#unlockPass").value));
      applyState(state);
      pendingToken = null;
      unlockDialog.close();
      clearHash();
      toast("Unlocked shared settings");
    } catch {
      $("#unlockError").textContent = "Wrong passphrase, or the link was changed.";
    } finally {
      $("#unlockBtn").disabled = false;
    }
  }

  $("#unlockBtn").addEventListener("click", unlock);
  $("#unlockPass").addEventListener("keydown", (e) => e.key === "Enter" && unlock());
  $("#unlockCancel").addEventListener("click", () => {
    pendingToken = null;
    unlockDialog.close();
    clearHash();
  });

  $("#printOne").addEventListener("click", async () => {
    if (!current) return;
    await ensureFonts();
    addToHistory();
    QR.batch.print(
      [{ model: current.model, title: current.type.title(current.fields), caption: current.type.caption(current.fields) }],
      { single: true }
    );
  });

  // ---------- Ready-made designs ----------

  // Every preset keeps strong contrast against its background and passes the
  // scan test with each code type, with and without a logo.
  const PRESETS = [
    { name: "Classic", opts: { fg: "#111111", bg: "#ffffff", gradient: "none", dots: "square", corners: "square", frame: "none" } },
    { name: "Soft", opts: { fg: "#1f2937", bg: "#ffffff", gradient: "none", dots: "rounded", corners: "rounded", frame: "none" } },
    { name: "Dots", opts: { fg: "#111111", bg: "#ffffff", gradient: "none", dots: "dots", corners: "circle", frame: "none" } },
    { name: "Ocean", opts: { fg: "#0b3954", fg2: "#087e8b", bg: "#ffffff", gradient: "diagonal", dots: "rounded", corners: "rounded", frame: "none" } },
    { name: "Sunset", opts: { fg: "#7c2d12", fg2: "#c2410c", bg: "#fff7ed", gradient: "vertical", dots: "dots", corners: "circle", frame: "none" } },
    { name: "Forest", opts: { fg: "#14532d", fg2: "#15803d", bg: "#ffffff", gradient: "radial", dots: "rounded", corners: "rounded", frame: "none" } },
    { name: "Berry", opts: { fg: "#581c87", fg2: "#a21caf", bg: "#ffffff", gradient: "diagonal", dots: "dots", corners: "rounded", frame: "none" } },
    { name: "Scan me", opts: { fg: "#2f5d50", bg: "#ffffff", gradient: "none", dots: "rounded", corners: "rounded", frame: "box" } },
  ];
  const PRESET_KEYS = ["fg", "fg2", "bg", "gradient", "dots", "corners", "frame"];

  function buildPresets() {
    const box = $("#presets");
    PRESETS.forEach((preset, i) => {
      const sample = QR.render.build("QR Studio", { ...DEFAULT_OPTS, ...preset.opts, caption: "SCAN ME", margin: 2 }, null);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset";
      btn.dataset.index = i;
      btn.innerHTML = `<span class="preset-thumb" aria-hidden="true">${QR.render.toSvg(sample)}</span><span class="preset-name"></span>`;
      btn.querySelector(".preset-name").textContent = preset.name;
      btn.addEventListener("click", () => applyPreset(preset));
      box.appendChild(btn);
    });
    markActivePreset();
  }

  function applyPreset(preset) {
    const opts = { ...readOpts(), ...preset.opts };
    if (preset.opts.frame !== "none" && !opts.caption.trim()) opts.caption = "SCAN ME";
    writeOpts(opts);
    render();
  }

  function markActivePreset() {
    const opts = readOpts();
    $$(".preset").forEach((btn) => {
      const p = PRESETS[btn.dataset.index].opts;
      btn.setAttribute("aria-pressed", String(PRESET_KEYS.every((k) => p[k] === undefined || p[k] === opts[k])));
    });
  }

  // ---------- Full screen view (for testing with a phone) ----------

  const bigDialog = $("#bigDialog");

  function openBig() {
    if (!current) return;
    $("#bigCode").innerHTML = QR.render.toSvg(current.model);
    $("#bigSays").textContent = current.type.outcome ? current.type.outcome(current.fields) : "";
    bigDialog.showModal();
  }

  $("#bigBtn").addEventListener("click", openBig);
  $("#stage").addEventListener("click", openBig);
  // Any click or Esc closes it.
  bigDialog.addEventListener("click", () => bigDialog.close());

  // ---------- Wi-Fi sign ----------

  const signDialog = $("#signDialog");

  $("#wifiSignBtn").addEventListener("click", () => {
    if (!current || activeType !== "wifi") return;
    if (!$("#signTitle").value.trim()) $("#signTitle").value = "Free Wi-Fi";
    $("#signPwRow").hidden = current.fields.encryption === "nopass";
    signDialog.showModal();
  });
  $("#signCancel").addEventListener("click", () => signDialog.close());

  $("#signPrint").addEventListener("click", async () => {
    if (!current || activeType !== "wifi") return;
    const f = current.fields;
    const make = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };

    const card = make("div", "wifi-sign");
    card.append(
      make("p", "sign-kicker", "Wi-Fi"),
      make("h1", null, $("#signTitle").value.trim() || "Wi-Fi"),
      make("p", "sign-sub", "Point your phone camera at the code to connect")
    );
    const code = make("div", "sign-code");
    code.innerHTML = QR.render.toSvg(current.model);
    card.appendChild(code);

    const details = make("dl", "sign-details");
    const row = (label, value) => {
      const div = make("div");
      div.append(make("dt", null, label), make("dd", null, value));
      details.appendChild(div);
    };
    row("Network", f.ssid);
    if (f.encryption === "nopass") row("Password", "None needed");
    else if ($("#signShowPw").checked) row("Password", f.password || "(none)");
    card.append(details, make("p", "sign-foot", "No camera? Open your Wi-Fi settings and choose the network above."));

    const area = $("#printArea");
    area.className = "print-area sign";
    area.replaceChildren(card);
    signDialog.close();
    await ensureFonts();
    addToHistory();
    const cleanup = () => {
      area.replaceChildren();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  });

  // ---------- Batch ----------

  let batch = null; // { name, records }

  function updateBatchStatus() {
    const status = $("#batchStatus");
    const enabled = !!batch;
    $("#batchZip").disabled = !enabled;
    $("#batchPrint").disabled = !enabled;
    if (!batch) {
      status.textContent = "No file loaded";
      return;
    }
    const type = QR.getType(activeType);
    const { items, skipped } = QR.batch.prepare(type, batch.records, readOpts(), logo);
    status.textContent =
      `${batch.name}: ${items.length} ${type.label} code${items.length === 1 ? "" : "s"}` +
      (skipped ? `, ${skipped} row${skipped === 1 ? "" : "s"} skipped` : "");
    $("#batchZip").disabled = $("#batchPrint").disabled = items.length === 0;
  }

  $("#batchTemplate").addEventListener("click", () => {
    const type = QR.getType(activeType);
    downloadBlob(new Blob([QR.batch.template(type)], { type: "text/csv" }), `qr-${type.id}-template.csv`);
  });

  $("#batchInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > S.LIMITS.csvBytes) return toast(`CSV files must be under ${S.formatBytes(S.LIMITS.csvBytes)}`);
    const records = QR.batch.rowsToRecords(QR.batch.parseCsv(await file.text()));
    if (!records.length) {
      batch = null;
      toast("No rows found. The first row should be column names.");
    } else {
      batch = { name: file.name, records };
    }
    updateBatchStatus();
  });

  $("#batchZip").addEventListener("click", async () => {
    if (!batch) return;
    const type = QR.getType(activeType);
    const { items } = QR.batch.prepare(type, batch.records, readOpts(), logo);
    if (!items.length) return;
    const btn = $("#batchZip");
    btn.disabled = true;
    try {
      await ensureFonts();
      const blob = await QR.batch.zip(items, Number($("#pngSize").value), (done, total) => {
        $("#batchStatus").textContent = `Rendering ${done} of ${total}…`;
      });
      downloadBlob(blob, `qr-batch-${type.id}.zip`);
      toast(`${items.length} codes downloaded`);
    } catch {
      toast("Couldn't build the ZIP file");
    } finally {
      btn.disabled = false;
      updateBatchStatus();
    }
  });

  $("#batchPrint").addEventListener("click", async () => {
    if (!batch) return;
    const { items } = QR.batch.prepare(QR.getType(activeType), batch.records, readOpts(), logo);
    if (!items.length) return;
    await ensureFonts();
    QR.batch.print(items);
  });

  // ---------- Misc UI ----------

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    // Longer messages stay up longer so they can be read.
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), Math.max(2200, message.length * 55));
  }
  QR.toast = toast;

  // Theme: follow the system until the user picks one, then remember it.
  const root = document.documentElement;
  const savedTheme = store.get("qr-theme", null);
  if (savedTheme === "light" || savedTheme === "dark") root.dataset.theme = savedTheme;

  $("#themeToggle").addEventListener("click", () => {
    const isDark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = isDark ? "light" : "dark";
    store.set("qr-theme", root.dataset.theme);
  });

  // Animations toggle: overrides the system reduce-motion setting once clicked.
  const motionBtn = $("#motionToggle");
  const syncMotionBtn = () => {
    const on = !QR.prefs.reducedMotion();
    motionBtn.setAttribute("aria-pressed", String(on));
    motionBtn.title = on ? "Animations on (click to turn off)" : "Animations off (click to turn on)";
  };
  motionBtn.addEventListener("click", () => {
    QR.prefs.setMotion(QR.prefs.reducedMotion());
    toast(QR.prefs.reducedMotion() ? "Animations off" : "Animations on");
  });
  QR.prefs.onMotionChange(syncMotionBtn);
  syncMotionBtn();

  // Offline support. Service workers need http(s), so skip when opened as a file.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#installBtn").hidden = false;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("#installBtn").hidden = true;
  });

  // ---------- Init ----------

  buildTypeUI();
  const DEFAULT_OPTS = readOpts();
  buildPresets();
  updateFieldUI();
  updateAppearanceUI();
  if (!loadFromHash()) selectType("url");
  renderHistory();
  window.addEventListener("hashchange", loadFromHash);
  if (document.fonts) document.fonts.ready.then(() => current && render());
})();
