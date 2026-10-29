// Security helpers: link analysis, decoded-content inspection,
// passphrase-locked share links, and input limits.
window.QR = window.QR || {};

(() => {
  "use strict";

  const LIMITS = {
    logoBytes: 5 * 1024 * 1024,
    csvBytes: 2 * 1024 * 1024,
    inspectBytes: 10 * 1024 * 1024,
    fieldChars: 4000,
  };

  // Schemes that can run script, read local files or launch apps when opened.
  const BLOCKED_SCHEMES = new Set(["javascript", "vbscript", "data", "file", "blob", "about", "chrome", "intent"]);

  const SHORTENERS = new Set([
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly",
    "shorturl.at", "rb.gy", "tiny.cc", "s.id", "t.ly", "bl.ink", "lnkd.in", "v.gd", "qrco.de", "short.io",
  ]);

  const schemeOf = (s) => ((String(s).match(/^\s*([a-z][a-z0-9+.-]*):/i) || [])[1] || "").toLowerCase();

  // Returns [{ level: "danger" | "caution" | "info", text, block? }].
  function analyzeUrl(raw) {
    const scheme = schemeOf(raw);
    if (BLOCKED_SCHEMES.has(scheme)) {
      return [{ level: "danger", block: true, text: `"${scheme}:" links can run code or open local files, so they are blocked.` }];
    }

    let url;
    try {
      url = new URL(raw);
    } catch {
      return [{ level: "caution", text: "This isn't a valid web address." }];
    }

    const issues = [];
    const host = url.hostname;

    if (url.username || url.password) {
      issues.push({
        level: "danger",
        text: `The part before "@" is a disguise. This link actually goes to ${host}.`,
      });
    }
    if (url.protocol === "http:") {
      issues.push({ level: "caution", text: "Not encrypted (http). Anyone on the same network can read or alter the page." });
    } else if (url.protocol !== "https:") {
      issues.push({ level: "caution", text: `Opens with "${url.protocol}" rather than a web page.` });
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
      issues.push({ level: "caution", text: "Points to a raw IP address instead of a named website." });
    }
    // Browsers convert non-Latin domains to "xn--" punycode, which is how
    // lookalike domains (e.g. Cyrillic "а" for Latin "a") show up.
    if (host.split(".").some((label) => label.startsWith("xn--"))) {
      issues.push({ level: "caution", text: `The domain uses non-Latin characters (${host}). Check it isn't imitating a familiar site.` });
    }
    if (SHORTENERS.has(host.replace(/^www\./, ""))) {
      issues.push({ level: "caution", text: "This is a link shortener, so the real destination is hidden until it's opened." });
    }
    if (url.port && url.port !== "80" && url.port !== "443") {
      issues.push({ level: "caution", text: `Uses an unusual port (:${url.port}).` });
    }
    return issues;
  }

  // Safety issues for a payload the generator is about to encode.
  function checkPayload(typeId, fields, payload) {
    if (typeId === "url") return analyzeUrl(payload);
    if (typeId === "contact" && fields.website) {
      const site = /^[a-z][a-z0-9+.-]*:/i.test(fields.website.trim()) ? fields.website.trim() : `https://${fields.website.trim()}`;
      return analyzeUrl(site).map((i) => ({ ...i, text: `Website: ${i.text}` }));
    }
    return [];
  }

  // ---------- Inspecting a scanned code ----------

  // Split on unescaped ";" for the WIFI: format.
  function parseWifi(s) {
    const out = {};
    const body = s.replace(/^WIFI:/i, "");
    let key = "";
    let val = "";
    let inKey = true;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "\\" && i + 1 < body.length) {
        (inKey ? (key += body[++i]) : (val += body[++i]));
      } else if (inKey && ch === ":") {
        inKey = false;
      } else if (!inKey && ch === ";") {
        if (key) out[key.toUpperCase()] = val;
        key = "";
        val = "";
        inKey = true;
      } else {
        inKey ? (key += ch) : (val += ch);
      }
    }
    return out;
  }

  function vField(text, name) {
    const m = text.match(new RegExp(`^${name}[^:\\r\\n]*:(.*)$`, "im"));
    return m ? m[1].replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim() : "";
  }

  // Describe decoded QR content: what it is, what it will do, and any risks.
  function describe(content) {
    const text = String(content);
    const scheme = schemeOf(text);
    const result = { kind: "Text", details: [], issues: [], openUrl: null };

    if (/^WIFI:/i.test(text)) {
      const w = parseWifi(text);
      result.kind = "Wi-Fi network";
      result.details.push(["Network", w.S || "(none)"], ["Security", w.T || "None"]);
      if (w.P) result.details.push(["Password", w.P, "secret"]);
      if (!w.T || /^nopass$/i.test(w.T)) {
        result.issues.push({ level: "caution", text: "Open network with no password. Others on it may see your traffic." });
      }
      result.issues.push({ level: "info", text: "Your phone will offer to join this network. Only join networks you recognise." });
      return result;
    }

    if (/^BEGIN:VCARD/i.test(text)) {
      result.kind = "Contact card";
      [["Name", "FN"], ["Phone", "TEL"], ["Email", "EMAIL"], ["Company", "ORG"], ["Website", "URL"]].forEach(([label, key]) => {
        const v = vField(text, key);
        if (v) result.details.push([label, v]);
      });
      const site = vField(text, "URL");
      if (site) result.issues.push(...analyzeUrl(site).map((i) => ({ ...i, text: `Website: ${i.text}` })));
      return result;
    }

    if (/^BEGIN:VEVENT/i.test(text)) {
      result.kind = "Calendar event";
      [["Event", "SUMMARY"], ["Starts", "DTSTART"], ["Ends", "DTEND"], ["Location", "LOCATION"]].forEach(([label, key]) => {
        const v = vField(text, key);
        if (v) result.details.push([label, v]);
      });
      return result;
    }

    if (scheme === "mailto") {
      result.kind = "Email";
      const [to, query = ""] = text.slice(7).split("?");
      const params = new URLSearchParams(query);
      result.details.push(["To", decodeURIComponent(to)]);
      if (params.get("subject")) result.details.push(["Subject", params.get("subject")]);
      result.issues.push({ level: "info", text: "Opens a pre-written email. Nothing is sent until you press send." });
      return result;
    }

    if (scheme === "smsto" || scheme === "sms") {
      result.kind = "Text message";
      const [number, ...rest] = text.replace(/^sms(to)?:/i, "").split(":");
      result.details.push(["To", number]);
      if (rest.length) result.details.push(["Message", rest.join(":")]);
      result.issues.push({ level: "info", text: "Opens a pre-written text. Check the number; premium-rate numbers can cost money." });
      return result;
    }

    if (scheme === "tel") {
      result.kind = "Phone call";
      result.details.push(["Number", text.slice(4)]);
      return result;
    }

    if (scheme === "geo") {
      result.kind = "Map location";
      result.details.push(["Coordinates", text.slice(4).split("?")[0]]);
      return result;
    }

    if (scheme === "upi") {
      result.kind = "UPI payment request";
      try {
        const params = new URL(text).searchParams;
        if (params.get("pn")) result.details.push(["Pay to", params.get("pn")]);
        if (params.get("pa")) result.details.push(["UPI ID", params.get("pa")]);
        if (params.get("am")) result.details.push(["Amount", `${params.get("am")} ${params.get("cu") || ""}`.trim()]);
        if (params.get("tn")) result.details.push(["Note", params.get("tn")]);
      } catch {}
      result.issues.push({
        level: "caution",
        text: "This asks you to send money. Scanning a code never receives money, so only pay someone you trust.",
      });
      return result;
    }

    if (scheme === "http" || scheme === "https") {
      result.kind = "Web link";
      result.details.push(["Address", text]);
      result.issues = analyzeUrl(text);
      try {
        result.details.push(["Opens", new URL(text).hostname]);
      } catch {}
      if (!result.issues.some((i) => i.level === "danger")) result.openUrl = text;
      return result;
    }

    if (scheme) {
      result.kind = `"${scheme}:" link`;
      result.details.push(["Content", text]);
      result.issues = BLOCKED_SCHEMES.has(scheme)
        ? analyzeUrl(text)
        : [{ level: "caution", text: `Opens an app using "${scheme}:". Only continue if you expected this.` }];
      return result;
    }

    result.details.push(["Content", text]);
    return result;
  }

  const verdict = (issues) =>
    issues.some((i) => i.level === "danger") ? "danger" : issues.some((i) => i.level === "caution") ? "caution" : "ok";

  // ---------- Base64url ----------

  function toB64url(bytes) {
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64url(text) {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  }

  // ---------- Passphrase-locked share links (AES-GCM, PBKDF2) ----------

  const PBKDF2_ITERATIONS = 310000;
  const cryptoAvailable = () => !!(window.crypto && crypto.subtle && window.isSecureContext !== false);

  async function deriveKey(passphrase, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Output layout: salt (16 bytes) | iv (12 bytes) | ciphertext + tag.
  async function seal(text, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
    const out = new Uint8Array(salt.length + iv.length + cipher.length);
    out.set(salt, 0);
    out.set(iv, salt.length);
    out.set(cipher, salt.length + iv.length);
    return toB64url(out);
  }

  // Throws if the passphrase is wrong or the token was altered.
  async function unseal(token, passphrase) {
    const bytes = fromB64url(token);
    if (bytes.length < 29) throw new Error("Token too short");
    const key = await deriveKey(passphrase, bytes.slice(0, 16));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(16, 28) }, key, bytes.slice(28));
    return new TextDecoder().decode(plain);
  }

  const formatBytes = (n) => `${Math.round(n / 1024 / 1024)} MB`;

  QR.security = {
    LIMITS,
    analyzeUrl,
    checkPayload,
    describe,
    verdict,
    toB64url,
    fromB64url,
    seal,
    unseal,
    cryptoAvailable,
    formatBytes,
  };
})();
