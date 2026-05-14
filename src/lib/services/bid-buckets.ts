import "server-only";

// Functional categorization of bid line items, locked in the 2026-05-14 grilling
// session. Order matters — more-specific patterns must come before more-general
// ones (e.g. "Mirror & Vanity Lights" before "Vanity", "Hardware/Safety" before
// "Electrical" so smoke/CO detectors land in the right bucket).

export interface Bucket {
  readonly name: string;
  readonly regex: RegExp;
}

export const BUCKETS: readonly Bucket[] = [
  { name: "Site Prep/Cleanup", regex: /(tree(\s+stump)?\s+removal|brick\s+mortar|pest control|trash\s+out|remove\s+all\s+screens|landscap(e|ing)\s+clean|pool)/i },
  { name: "Demo", regex: /^demo\b|\bdemolition\b/i },
  { name: "Mirror & Vanity Lights", regex: /\b(mirror|vanity\s+light)\b/i },
  { name: "Vanity", regex: /\bvanit(y|ies)\b/i },
  { name: "Tub/Shower", regex: /\b(tub|shower|recaulk)\b/i },
  { name: "Toilets", regex: /\btoilet\b/i },
  { name: "Kitchen Cabinets", regex: /\bcabinet(s|ry)?\b/i },
  { name: "Countertops", regex: /\b(countertop|quartz|granite)\b/i },
  { name: "Backsplash", regex: /\bbacksplash\b/i },
  { name: "Appliances", regex: /\bappliance\b|stainless\s+steel/i },
  { name: "Flooring", regex: /\b(lvp|carpet|vinyl\s+flooring|hardwood|tile\s+flooring|flooring|subfloor)\b/i },
  { name: "Drywall/Ceiling", regex: /\b(drywall|ceiling|popcorn|patch)\b/i },
  { name: "Paint", regex: /\b(paint|repaint|kilz)\b/i },
  { name: "Hardware/Safety", regex: /\b(smoke\s+and\s+carbon|smoke.*detector|carbon\s+monoxide|deadbolt|handle|lockset|hardware|screen)\b/i },
  { name: "Doors", regex: /\bdoor(s|way)?\b/i },
  { name: "Windows", regex: /\bwindow(s)?\b/i },
  { name: "Trim/Baseboard", regex: /\b(trim|baseboard|molding|casing|fascia)\b/i },
  { name: "Plumbing", regex: /\b(plumb|faucet|sink|valve|drain|water\s+line|garbage\s+disposal|interior\s+leak)\b/i },
  { name: "Electrical", regex: /\b(electrical|outlet|switch|wiring|panel|light(ing|s)?|fixture)\b/i },
  { name: "HVAC", regex: /\b(hvac|furnace|ductwork|ducting|drip\s+pan|thermostat|ac\b)/i },
  { name: "Water Heater", regex: /\bwater\s+heater\b/i },
  { name: "Roof", regex: /\b(roof|shingle)\b/i },
  { name: "Exterior/Landscape", regex: /\b(landscape|fence|deck|siding|gutter|exterior|garage\s+door|driveway)\b/i },
  { name: "Misc", regex: /.*/ },
] as const;

// Footer-like line items that the scraper missed flagging as is_footer.
// These get filtered out of the Items tab; they live on Compose's footer panel
// where their canonical prices are sourced from CLAUDE.md instead.
export const FOOTER_PATTERN = /\b(rekey|lockbox|per\s+diem|final\s+(sales\s+)?clean|gc\s+management|tax\s+included|sign\s+here|seller\s+signature|effort\s+has\s+been\s+made)\b/i;

export function classifyLineItem(description: string): string {
  const text = description.trim();
  for (const bucket of BUCKETS) {
    if (bucket.regex.test(text)) return bucket.name;
  }
  return "Misc";
}

export function isFooterText(description: string): boolean {
  return FOOTER_PATTERN.test(description);
}
