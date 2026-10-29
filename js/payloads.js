// Code types: form fields, payload encoding, and labels for each one.
window.QR = window.QR || {};

(() => {
  "use strict";

  const escapeWifi = (v) => v.replace(/([\\;,:"])/g, "\\$1");
  // vCard and iCalendar share the same text escaping rules.
  const escapeText = (v) =>
    v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const enc = encodeURIComponent;

  const truthy = (v) => v === true || /^(1|true|yes|y|on)$/i.test(String(v || ""));

  function normalizeUrl(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  }

  // "Link to" shortcuts: people type a username or number and we build the link.
  const PLATFORMS = {
    web: {
      option: "Any website", name: "website", field: "Website address", placeholder: "https://example.com",
      help: "Tip: copy it from your browser's address bar. You can leave out https://.",
    },
    whatsapp: {
      option: "WhatsApp chat", name: "WhatsApp", field: "WhatsApp number", placeholder: "+92 300 1234567",
      help: "Include the country code. People can message you without saving your number first.", caption: "Chat on WhatsApp",
    },
    instagram: { option: "Instagram profile", name: "Instagram", base: "https://instagram.com/", caption: "Follow on Instagram" },
    facebook: { option: "Facebook page", name: "Facebook", base: "https://facebook.com/", caption: "Find us on Facebook" },
    youtube: { option: "YouTube channel", name: "YouTube", base: "https://youtube.com/@", caption: "Watch on YouTube" },
    tiktok: { option: "TikTok profile", name: "TikTok", base: "https://tiktok.com/@", caption: "Follow on TikTok" },
    linkedin: {
      option: "LinkedIn profile", name: "LinkedIn", base: "https://linkedin.com/in/", caption: "Connect on LinkedIn",
      help: "The part after linkedin.com/in/ in your profile link. You can also paste the whole link.",
    },
    x: { option: "X (Twitter) profile", name: "X", base: "https://x.com/", caption: "Follow on X" },
  };
  const platformOf = (f) => PLATFORMS[f.platform] || PLATFORMS.web;

  function linkFor(f) {
    const p = platformOf(f);
    const value = String(f.url || "").trim();
    if (!value) return "";
    if (p === PLATFORMS.web) return normalizeUrl(value);
    if (p === PLATFORMS.whatsapp) {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 7) return "";
      return `https://wa.me/${digits}${f.waText ? `?text=${enc(f.waText)}` : ""}`;
    }
    // Accept "@name", "name" or a pasted profile link.
    const handle = value
      .replace(/^https?:\/\//i, "")
      .replace(/^(www\.|m\.)?[a-z]+\.(com|net)\/(in\/)?@?/i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "");
    return /^[\w.-]+$/.test(handle) ? p.base + handle : "";
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "") || url;
    } catch {
      return url;
    }
  }

  // 2026-10-29T15:00 (local) -> 20261029T100000Z
  function icsDate(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  const TYPES = [
    {
      id: "url",
      label: "Website",
      about: "Opens a web page, a WhatsApp chat or a social profile. Great for your site, a menu or a form.",
      missing: (f) => {
        const p = platformOf(f);
        if (p === PLATFORMS.web) return "Type or paste a website address to create your code.";
        if (p === PLATFORMS.whatsapp) return "Enter your WhatsApp number, including the country code.";
        return `Enter your ${p.name} username to create your code.`;
      },
      outcome: (f) => {
        const p = platformOf(f);
        if (p === PLATFORMS.web) return `Open ${hostOf(linkFor(f))} in their web browser.`;
        if (p === PLATFORMS.whatsapp) return `Open a WhatsApp chat with you${f.waText ? ", with your message already typed in" : ""}.`;
        return `Open your ${p.name} profile in the ${p.name} app.`;
      },
      fields: [
        {
          key: "platform", label: "Link to", type: "select", value: "web",
          options: Object.entries(PLATFORMS).map(([id, p]) => [id, p.option]),
        },
        {
          key: "url", label: "Website address", type: "url", placeholder: "https://example.com", value: "https://github.com/",
          help: PLATFORMS.web.help,
          // Label, placeholder and hint follow the "Link to" choice.
          adapt: (f) => {
            const p = platformOf(f);
            const social = p !== PLATFORMS.web && p !== PLATFORMS.whatsapp;
            return {
              label: p.field || `${p.name} username`,
              placeholder: p.placeholder || "yourname",
              help: p.help || (social ? "Your username, with or without @. You can also paste your profile link." : ""),
              inputType: p === PLATFORMS.web ? "url" : p === PLATFORMS.whatsapp ? "tel" : "text",
            };
          },
        },
        {
          key: "waText", label: "Ready-made message", type: "textarea", placeholder: "Hi! I'd like to know more about…",
          help: "Optional. It's typed in for them, and they still choose whether to send it.",
          showIf: (f) => f.platform === "whatsapp",
        },
      ],
      build: linkFor,
      title: (f) => linkFor(f).replace(/^https?:\/\//, "").replace(/\/$/, ""),
      caption: (f) => platformOf(f).caption || "Scan to visit",
    },
    {
      id: "text",
      label: "Text",
      about: "Shows a short message on the phone's screen. No internet needed.",
      missing: "Type a message to create your code.",
      outcome: () => "Show your message on their screen.",
      fields: [
        {
          key: "text", label: "Message", type: "textarea", counter: true, placeholder: "Anything you want to share",
          help: "Shorter messages make simpler codes that are easier to scan.",
        },
      ],
      build: (f) => f.text || "",
      title: (f) => (f.text || "").slice(0, 40),
      caption: () => "Scan to read",
    },
    {
      id: "wifi",
      label: "Wi-Fi",
      about: "Guests scan it to join your Wi-Fi without typing the password.",
      missing: "Enter your Wi-Fi network name to create your code.",
      outcome: (f) => `Offer to join the "${f.ssid}" Wi-Fi network${f.encryption === "nopass" ? "" : ", with the password filled in"}.`,
      fields: [
        { key: "ssid", label: "Network name", placeholder: "Home Network", help: "The name you pick when connecting to Wi-Fi. Capitals and spaces matter." },
        { key: "password", label: "Password", type: "password", placeholder: "••••••••", help: "Usually on a sticker on your router." },
        {
          key: "encryption", label: "Security type", type: "select", value: "WPA",
          options: [["WPA", "WPA / WPA2 / WPA3 (most common)"], ["WEP", "WEP (older routers)"], ["nopass", "No password"]],
          help: "Not sure? Leave it on the first option.",
        },
        { key: "hidden", label: "My network is hidden (rare)", type: "checkbox" },
      ],
      build(f) {
        if (!f.ssid) return "";
        const type = f.encryption || "WPA";
        const parts = [`T:${type}`, `S:${escapeWifi(f.ssid)}`];
        if (type !== "nopass") parts.push(`P:${escapeWifi(f.password || "")}`);
        if (truthy(f.hidden)) parts.push("H:true");
        return `WIFI:${parts.join(";")};;`;
      },
      title: (f) => f.ssid,
      caption: (f) => `Scan to join ${f.ssid || "Wi-Fi"}`,
    },
    {
      id: "contact",
      label: "Contact",
      about: "A digital business card. People scan it to save your details to their phone.",
      missing: "Add at least a name, phone number or email to create your code.",
      outcome: (f) => `Offer to save ${[f.firstName, f.lastName].filter(Boolean).join(" ") || "this contact"} to their contacts.`,
      fields: [
        { key: "firstName", label: "First name", placeholder: "Ada", half: true },
        { key: "lastName", label: "Last name", placeholder: "Lovelace", half: true },
        { key: "phone", label: "Phone", type: "tel", placeholder: "+92 300 0000000", half: true },
        { key: "email", label: "Email", type: "email", placeholder: "ada@example.com", half: true },
        { key: "org", label: "Company", placeholder: "Analytical Engines Ltd.", half: true },
        { key: "jobTitle", label: "Job title", placeholder: "Engineer", half: true },
        { key: "website", label: "Website", type: "url", placeholder: "https://example.com" },
      ],
      build(f) {
        const v = (k) => String(f[k] || "").trim();
        if (["firstName", "lastName", "phone", "email", "org", "jobTitle", "website"].every((k) => !v(k))) return "";
        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `N:${escapeText(v("lastName"))};${escapeText(v("firstName"))};;;`,
          `FN:${escapeText([v("firstName"), v("lastName")].filter(Boolean).join(" "))}`,
        ];
        if (v("org")) lines.push(`ORG:${escapeText(v("org"))}`);
        if (v("jobTitle")) lines.push(`TITLE:${escapeText(v("jobTitle"))}`);
        if (v("phone")) lines.push(`TEL;TYPE=CELL:${v("phone")}`);
        if (v("email")) lines.push(`EMAIL:${v("email")}`);
        if (v("website")) lines.push(`URL:${normalizeUrl(v("website"))}`);
        lines.push("END:VCARD");
        return lines.join("\r\n");
      },
      title: (f) => [f.firstName, f.lastName].filter(Boolean).join(" ") || f.org || f.email,
      caption: () => "Scan to save contact",
    },
    {
      id: "email",
      label: "Email",
      about: "Opens a ready-to-send email. Handy for feedback or support.",
      missing: "Enter the email address that messages should go to.",
      outcome: (f) => `Open a new email to ${f.to}. Nothing is sent until they press Send.`,
      fields: [
        { key: "to", label: "Send to", type: "email", placeholder: "hello@example.com" },
        { key: "subject", label: "Subject", placeholder: "Hello" },
        { key: "body", label: "Message", type: "textarea", placeholder: "Optional" },
      ],
      build(f) {
        const to = String(f.to || "").trim();
        if (!to) return "";
        const query = [];
        if (f.subject) query.push(`subject=${enc(f.subject)}`);
        if (f.body) query.push(`body=${enc(f.body)}`);
        return `mailto:${to}${query.length ? `?${query.join("&")}` : ""}`;
      },
      title: (f) => f.to,
      caption: () => "Scan to email",
    },
    {
      id: "sms",
      label: "SMS",
      about: "Opens a ready-to-send text message.",
      missing: "Enter the phone number that texts should go to.",
      outcome: (f) => `Open a text message to ${f.number}. Nothing is sent until they press Send.`,
      fields: [
        { key: "number", label: "Phone number", type: "tel", placeholder: "+92 300 0000000", help: "Include the country code, like +92." },
        { key: "message", label: "Message", type: "textarea", counter: true, placeholder: "Optional" },
      ],
      build(f) {
        const number = String(f.number || "").replace(/[^\d+]/g, "");
        if (!number) return "";
        return `SMSTO:${number}:${f.message || ""}`;
      },
      title: (f) => f.number,
      caption: () => "Scan to text",
    },
    {
      id: "phone",
      label: "Phone",
      about: "Lets people call you with one tap.",
      missing: "Enter a phone number to create your code.",
      outcome: (f) => `Offer to call ${f.number}.`,
      fields: [{ key: "number", label: "Phone number", type: "tel", placeholder: "+92 300 0000000", help: "Include the country code, like +92." }],
      build(f) {
        const number = String(f.number || "").replace(/[^\d+]/g, "");
        return number ? `tel:${number}` : "";
      },
      title: (f) => f.number,
      caption: () => "Scan to call",
    },
    {
      id: "event",
      label: "Event",
      about: "Adds your event to people's calendars, with the time and place filled in.",
      missing: "Add an event name and a start time to create your code.",
      outcome: (f) => `Offer to add "${f.title}" to their calendar.`,
      fields: [
        { key: "title", label: "Event name", placeholder: "Launch party" },
        { key: "start", label: "Starts", type: "datetime-local", half: true },
        { key: "end", label: "Ends", type: "datetime-local", half: true, hint: "Optional" },
        { key: "location", label: "Location", placeholder: "Optional" },
        { key: "description", label: "Details", type: "textarea", placeholder: "Optional" },
      ],
      build(f) {
        if (!f.title || !f.start) return "";
        const start = new Date(f.start);
        if (isNaN(start)) return "";
        let end = f.end ? new Date(f.end) : null;
        if (!end || isNaN(end) || end < start) end = new Date(start.getTime() + 3600000);
        const lines = [
          "BEGIN:VEVENT",
          `SUMMARY:${escapeText(f.title)}`,
          `DTSTART:${icsDate(start)}`,
          `DTEND:${icsDate(end)}`,
        ];
        if (f.location) lines.push(`LOCATION:${escapeText(f.location)}`);
        if (f.description) lines.push(`DESCRIPTION:${escapeText(f.description)}`);
        lines.push("END:VEVENT");
        return lines.join("\r\n");
      },
      title: (f) => f.title,
      caption: () => "Scan to add event",
    },
    {
      id: "location",
      label: "Location",
      about: "Opens a spot on the map so people can get directions.",
      missing: "Press \"Use my current location\", or enter the map coordinates.",
      outcome: () => "Open this spot in a map app, ready for directions.",
      fields: [
        { key: "lat", label: "Latitude", type: "number", placeholder: "24.8607", half: true, step: "any" },
        { key: "lng", label: "Longitude", type: "number", placeholder: "67.0011", half: true, step: "any" },
        {
          key: "format", label: "Opens in", type: "select", value: "maps",
          options: [["maps", "Google Maps (works on every phone)"], ["geo", "The phone's default map app (Android)"]],
          help: "To find coordinates: right-click a place in Google Maps and click the numbers at the top.",
        },
      ],
      action: "geolocate",
      build(f) {
        const lat = parseFloat(f.lat);
        const lng = parseFloat(f.lng);
        if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "";
        return f.format === "geo"
          ? `geo:${lat},${lng}`
          : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      },
      title: (f) => `${f.lat}, ${f.lng}`,
      caption: () => "Scan for directions",
    },
    {
      id: "payment",
      label: "Payment",
      about: "A UPI payment request (India). People scan it with a UPI app to pay you.",
      missing: "Enter your UPI ID (it looks like name@bank) to create your code.",
      outcome: (f) => `Open a UPI app to pay ${f.name || f.vpa}${parseFloat(f.amount) > 0 ? ` ₹${parseFloat(f.amount).toFixed(2)}` : ""}.`,
      fields: [
        { key: "vpa", label: "UPI ID", placeholder: "name@bank", help: "Find it in your UPI app's profile, e.g. yourname@okbank." },
        { key: "name", label: "Payee name", placeholder: "Ada Lovelace" },
        { key: "amount", label: "Amount (INR)", type: "number", placeholder: "Optional", half: true, step: "0.01", min: "0" },
        { key: "note", label: "Note", placeholder: "Optional", half: true },
      ],
      build(f) {
        const vpa = String(f.vpa || "").trim();
        if (!/^[\w.-]+@[\w.-]+$/.test(vpa)) return "";
        let uri = `upi://pay?pa=${vpa}`;
        if (f.name) uri += `&pn=${enc(f.name)}`;
        const amount = parseFloat(f.amount);
        if (amount > 0) uri += `&am=${amount.toFixed(2)}`;
        uri += "&cu=INR";
        if (f.note) uri += `&tn=${enc(f.note)}`;
        return uri;
      },
      title: (f) => f.name || f.vpa,
      caption: () => "Scan to pay",
    },
  ];

  const byId = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  QR.types = TYPES;
  QR.getType = (id) => byId[id] || byId.url;
  QR.truthy = truthy;
})();
