export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface ParsedAddress {
  raw: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const STATE_RE = /\b([A-Z]{2})\b/;
const ZIP_RE = /\b(\d{5}(?:-\d{4})?)\b/;

export function parseAddress(raw: string): ParsedAddress {
  const trimmed = raw.trim();
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { raw: trimmed, street: null, city: null, state: null, zip: null };
  }

  const street = parts[0];
  const tail = parts.slice(1).join(" ");

  const stateMatch = tail.match(STATE_RE);
  const zipMatch = tail.match(ZIP_RE);
  const state = stateMatch ? stateMatch[1] : null;
  const zip = zipMatch ? zipMatch[1] : null;

  let city: string | null = null;
  if (parts.length >= 2) {
    let cityPart = parts[1];
    if (state) cityPart = cityPart.replace(new RegExp(`\\s+${state}\\b.*$`), "");
    if (zip) cityPart = cityPart.replace(new RegExp(`\\s+${zip}\\b.*$`), "");
    cityPart = cityPart.trim();
    if (cityPart) city = cityPart;
  } else if (parts.length === 1) {
    const m = parts[0].match(/^(.+?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+[A-Z]{2}(?:\s+\d{5})?$/);
    if (m) city = m[2];
  }

  return { raw: trimmed, street, city, state, zip };
}
