'use strict';
/**
 * _csv.js — Minimal quote-aware CSV read/write.
 * No npm dependency — handles quoted fields containing commas (page titles do).
 * Shared by list-pending.js and mark-faq-done.js.
 */

const fs = require('fs');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      // guard against \r before \n
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  // trailing field/row
  if (field.length || row.length) {
    if (field.endsWith('\r')) field = field.slice(0, -1);
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift() || [];
  return {
    header,
    records: rows
      .filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''))
      .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))),
  };
}

function csvField(value) {
  const v = value == null ? '' : String(value);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function stringifyCsv(header, records) {
  const lines = [header.map(csvField).join(',')];
  for (const rec of records) {
    lines.push(header.map(h => csvField(rec[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function readCsv(path) {
  return parseCsv(fs.readFileSync(path, 'utf8'));
}

function writeCsv(path, header, records) {
  fs.writeFileSync(path, stringifyCsv(header, records), 'utf8');
}

module.exports = { parseCsv, stringifyCsv, readCsv, writeCsv };
