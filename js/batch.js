// CSV batch generation (ZIP of PNGs) and printable sheets.
window.QR = window.QR || {};

(() => {
  "use strict";

  const MAX_ROWS = 500;

  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  }

  // First row is the header; returns one object per data row keyed by header.
  function rowsToRecords(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1, MAX_ROWS + 1).map((cells) => {
      const record = {};
      headers.forEach((h, i) => (record[h] = (cells[i] || "").trim().slice(0, QR.security.LIMITS.fieldChars)));
      return record;
    });
  }

  // Match CSV columns to a type's field keys, ignoring case.
  function fieldsFor(type, record) {
    const lower = Object.fromEntries(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
    const fields = {};
    type.fields.forEach((f) => {
      const v = lower[f.key.toLowerCase()];
      fields[f.key] = v !== undefined && v !== "" ? v : f.value || "";
    });
    return { fields, filename: lower.filename || "", caption: lower.caption || "" };
  }

  const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  function template(type) {
    const keys = type.fields.map((f) => f.key).concat("filename", "caption");
    const example = type.fields
      .map((f) => {
        if (f.type === "select") return f.value || f.options[0][0];
        if (f.type === "checkbox") return "false";
        if (f.type === "password") return "password123";
        return f.placeholder === "Optional" ? "" : f.placeholder || "";
      })
      .concat("example", "");
    return `${keys.map(csvCell).join(",")}\r\n${example.map(csvCell).join(",")}\r\n`;
  }

  const slug = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

  // Build every row into a render model; rows with no usable payload are skipped.
  function prepare(type, records, opts, logo) {
    const items = [];
    let skipped = 0;
    records.forEach((record, i) => {
      const { fields, filename, caption } = fieldsFor(type, record);
      const payload = type.build(fields);
      const blocked = QR.security.checkPayload(type.id, fields, payload).some((issue) => issue.block);
      if (!payload || blocked) {
        skipped++;
        return;
      }
      try {
        const rowOpts = caption && opts.frame !== "none" ? { ...opts, caption } : opts;
        const model = QR.render.build(payload, rowOpts, logo);
        items.push({
          model,
          name: slug(filename) || `${String(i + 1).padStart(3, "0")}-${slug(type.title(fields)) || type.id}`,
          title: type.title(fields) || "",
          caption: caption || type.caption(fields),
        });
      } catch {
        skipped++;
      }
    });
    return { items, skipped };
  }

  async function zip(items, width, onProgress) {
    const archive = new JSZip();
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      let name = items[i].name;
      for (let k = 2; used.has(name); k++) name = `${items[i].name}-${k}`;
      used.add(name);
      const canvas = QR.render.toCanvas(items[i].model, width);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      archive.file(`${name}.png`, blob);
      onProgress(i + 1, items.length);
    }
    return archive.generateAsync({ type: "blob" });
  }

  // Render items into a hidden print-only container and open the print dialog.
  function print(items, { single = false } = {}) {
    const area = document.getElementById("printArea");
    area.className = single ? "print-area single" : "print-area";
    area.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("figure");
      card.className = "print-card";
      card.innerHTML = QR.render.toSvg(item.model);
      const cap = document.createElement("figcaption");
      if (item.model.opts.frame === "none") {
        const strong = document.createElement("strong");
        strong.textContent = item.caption;
        cap.appendChild(strong);
      }
      if (item.title) {
        const span = document.createElement("span");
        span.textContent = item.title;
        cap.appendChild(span);
      }
      card.appendChild(cap);
      area.appendChild(card);
    });
    const cleanup = () => {
      area.innerHTML = "";
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // Let the SVGs (and any logo images) lay out before the dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  QR.batch = { parseCsv, rowsToRecords, template, prepare, zip, print, MAX_ROWS };
})();
