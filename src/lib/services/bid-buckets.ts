import "server-only";

// Functional categorization of bid line items, locked in the 2026-05-14 grilling
// session. Order matters — more-specific patterns must come before more-general
// ones (e.g. "Mirror & Vanity Lights" before "Vanity", "Hardware/Safety" before
// "Electrical" so smoke/CO detectors land in the right bucket).

export type BucketArea =
  | "kitchen"
  | "bathroom"
  | "interior"
  | "mechanical"
  | "exterior"
  | "demo"
  | "misc";

// A group is the parent header in the Items tab. Buckets that share a group
// stack under it (e.g. Kitchen Cabinets + Countertops + Backsplash + Appliances
// all under Kitchen). Buckets without an explicit group are rendered as their
// own single-member group, which expands straight to phrasings.
export interface Bucket {
  readonly name: string;
  readonly regex: RegExp;
  readonly area: BucketArea;
  readonly group?: string;
}

export const BUCKETS: readonly Bucket[] = [
  // Site prep / cleanup work — typically pre-construction. Comes first so
  // landscape-y phrases ("mow", "trim trees") don't fall into Trim/Baseboard
  // or Exterior/Landscape.
  { name: "Site Prep/Cleanup", regex: /(\btree\s+stump\b|\btrim\s+(tree|bush|overhanging)|\btrash\s*out\b|\bremove\s+all\s+screens\b|\blandscap(e|ing)\s+(clean|cleanup|maintenance|mow)|\byard\s+(cleanup|maintenance|debris|landscape|of\s+all\s+debris)|\bpest\s+(control|fumigation)\b|\bmow\b|\bpool\b|\bclean\s+(attic|up\s+yard)|\binitial\s+landscap|\bbrick\s+mortar\b)/i, area: "exterior" },

  // Demo includes any line starting with "demo" plus dedicated removal scopes
  // (wallpaper, screens). Mixed demo+install lines stay here because demo is
  // the primary scope; the replacement is implied.
  { name: "Demo", regex: /^demo\b|\bdemolition\b|\bremove\s+all\s+wallpaper\b|\bwallpaper\b/i, area: "demo" },

  // Bathroom group — most-specific first so "Mirrors + Vanity Lights" doesn't
  // get eaten by Vanity, and toilet/tub plurals are caught.
  { name: "Mirror & Vanity Lights", regex: /\b(mirrors?|vanity\s+lights?)\b/i, area: "bathroom", group: "Bathroom" },
  { name: "Vanity", regex: /\bvanit(y|ies)\b/i, area: "bathroom", group: "Bathroom" },
  { name: "Tub/Shower", regex: /\b(tubs?|showers?|recaulk|bathtubs?)\b/i, area: "bathroom", group: "Bathroom" },
  { name: "Toilets", regex: /\btoilets?\b/i, area: "bathroom", group: "Bathroom" },

  // Kitchen group.
  { name: "Kitchen Cabinets", regex: /\bcabinet(s|ry)?\b/i, area: "kitchen", group: "Kitchen" },
  { name: "Countertops", regex: /\b(countertops?|counter\s+tops?|quartz|granite)\b/i, area: "kitchen", group: "Kitchen" },
  { name: "Backsplash", regex: /\bbacksplash(es)?\b/i, area: "kitchen", group: "Kitchen" },
  // Sink & Faucet — kitchen-context sink/faucet installs. Bathroom faucets
  // (which usually appear with "bathroom" or "vanity") still land in
  // Plumbing further down, since this regex requires kitchen indicators.
  { name: "Sink & Faucet", regex: /\b(kitchen\s+(sink|faucet)|undermount\s+(stainless\s+steel\s+)?sink|single\s+basin\s+(sink|undermount)|new\s+faucet\s+\+\s+(single|stainless))\b/i, area: "kitchen", group: "Kitchen" },
  // Appliances now requires either the word "appliance(s)" or a specific
  // appliance noun, OR "stainless steel <appliance>" — so "stainless steel
  // sink" no longer mis-buckets here.
  { name: "Appliances", regex: /\bappliances?\b|\b(microwaves?|dishwashers?|stoves?|range\/oven)\b|\bstainless\s+steel\s+(appliance|range|oven|microwave|dishwasher|stove)\b/i, area: "kitchen", group: "Kitchen" },

  // Flooring also catches tile grout cleanup since it's tile-flooring work.
  { name: "Flooring", regex: /\b(lvp|carpet|vinyl\s+flooring|hardwood|tile\s+flooring|tile\s+(and\s+)?tile\s+grout|tile\s+grout|flooring|subfloor)\b/i, area: "interior" },

  // Specific mechanical/structural before the noisier Paint/Doors/etc.
  { name: "Roof", regex: /\b(roof|shingles?)\b/i, area: "exterior" },
  { name: "Water Heater", regex: /\bwater\s+heater\b/i, area: "mechanical" },
  { name: "HVAC", regex: /\b(hvac|furnace|ductwork|ducting|drip\s+pan|thermostat|air\s+handler|condenser|\bac\b)/i, area: "mechanical" },

  // Drywall/Ceiling now requires drywall|sheetrock|popcorn or a specific
  // ceiling-replacement phrase. Previously the bare "ceiling" word stole
  // paint scopes like "prep and paint ... walls, ceiling, baseboards".
  { name: "Drywall/Ceiling", regex: /\b(drywall|sheetrock|popcorn|drop\s+(in\s+)?ceiling|ceiling\s+(panel|repair)|misc\s+drywall|texture\s+(repair|removal)|retexture)\b/i, area: "interior" },

  // Paint splits into Exterior Paint and Interior Paint. Exterior is checked
  // first because the keyword overlap is "paint" in both — Exterior requires
  // a specific surface (siding/deck/fence/eaves/soffit/fascia) or the literal
  // word "exterior". Whatever isn't exterior falls through to Interior Paint.
  // Both belong to the "Paint" group so they nest together in the Items tab.
  {
    name: "Exterior Paint",
    regex: /\b(paint|repaint)\b.*\b(exterior|deck|fence|sidings?|eaves?|soffits?|fascia|chimney)\b|\b(exterior|deck|fence|sidings?|eaves?|soffits?|fascia|chimney)\b.*\b(paint|repaint)\b/i,
    area: "exterior",
    group: "Paint",
  },
  // Interior Paint: any remaining paint/repaint/kilz scope. Comes BEFORE
  // Doors/Windows/Trim so paint scopes mentioning those surfaces don't get
  // mis-bucketed.
  {
    name: "Interior Paint",
    regex: /\b(paint|repaint|kilz)\b/i,
    area: "interior",
    group: "Paint",
  },

  { name: "Doors", regex: /\bdoor(s|way)?\b/i, area: "interior" },
  { name: "Windows", regex: /\b(windows?|screens?)\b/i, area: "interior" },
  // Trim/Baseboard narrower — drop "trim" (ambiguous with "trim trees") and
  // "fascia" (which is an exterior item; moved to Exterior/Landscape).
  { name: "Trim/Baseboard", regex: /\b(baseboards?|moldings?|casings?|crown\s+molding)\b/i, area: "interior" },

  // Plumbing picks up the items Hardware/Appliances used to grab incorrectly
  // (kitchen sinks, garbage disposal, water supply leaks, pipe work, aerators).
  { name: "Plumbing", regex: /\b(plumb|faucets?|sinks?|valves?|drains?|water\s+line|waterline|water\s+supply|pipes?|leaks?|garbage\s+disposal|aerators?|p\s*trap|wax\s+ring|towel\s+(and|&)?\s*toilet\s+paper|towel\s+bars?)\b/i, area: "mechanical" },

  // Electrical comes BEFORE Hardware/Safety so "Install GFCIs ... and Missing
  // Smoke Detector" lands here (GFCI install is the primary scope) instead of
  // Hardware (which would catch on the smoke-detector mention).
  { name: "Electrical", regex: /\b(electrical|outlets?|switches?|wires?|wiring|receptacles?|gfcis?|panel|light(ing|s)?|fixtures?)\b/i, area: "mechanical" },

  // Hardware/Safety drops "screen" (now Windows) and "gfci" (now Electrical).
  { name: "Hardware/Safety", regex: /\b(smoke\s+(and|&)\s+carbon|smoke\s+detectors?|carbon\s+monoxide|deadbolts?|locksets?|hardware)\b/i, area: "interior" },

  // Exterior gains fascia/eaves/soffits/walkways/pressure wash/wood-rot from
  // items that used to mis-bucket as Trim or Misc.
  { name: "Exterior/Landscape", regex: /\b(landscape|fence|deck|sidings?|gutters?|exterior|garage\s+door|driveway|fascia|eaves?|soffits?|walkways?|pressure\s+wash|powerwash|earthwork|wood-?rot)\b/i, area: "exterior" },

  { name: "Misc", regex: /.*/, area: "misc" },
] as const;

export function getBucketArea(name: string): BucketArea {
  return BUCKETS.find((b) => b.name === name)?.area ?? "misc";
}

// Resolves the group for a bucket. Defaults to the bucket name when no
// explicit `group` is set, so ungrouped buckets become their own single-
// member group at render time.
export function getBucketGroup(name: string): string {
  const b = BUCKETS.find((x) => x.name === name);
  return b?.group ?? b?.name ?? name;
}

// Footer-like line items that the scraper missed flagging as is_footer.
// These get filtered out of the Items tab; they live on Compose's footer panel
// where their canonical prices are sourced from CLAUDE.md instead.
// Final-clean pattern is loose to catch wordy variants like "Final Interior
// Deep Sales Clean".
export const FOOTER_PATTERN = /\b(rekey|lockbox|per\s+diem|final\s+(\w+\s+){0,4}clean|gc\s+management|tax\s+included|sign\s+here|seller\s+signature|effort\s+has\s+been\s+made)\b/i;

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
