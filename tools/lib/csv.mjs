// Veilmap - GPL-3.0-or-later
// Minimal RFC4180-ish CSV reader for all-numeric DB2 exports.
// Handles: quoted fields with commas, doubled quotes (escaped), CRLF line endings,
// UTF-8 BOM stripping, and strict field-count validation.
// Does NOT handle newlines inside quoted fields (fields are split by line before quotes
// are examined) or blank lines (always skipped, not just at end).

function splitLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function parseCsv(text) {
  // Strip leading UTF-8 BOM if present
  const normalized = text.startsWith('﻿') ? text.slice(1) : text;

  const lines = normalized.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = splitLine(lines[0]);
  return lines.slice(1).map((line, idx) => {
    const fields = splitLine(line);
    const lineNumber = idx + 2; // 1-based, accounting for header

    // Validate field count matches header
    if (fields.length !== header.length) {
      throw new Error(`CSV line ${lineNumber}: expected ${header.length} fields, got ${fields.length}`);
    }

    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i];
    return row;
  });
}
