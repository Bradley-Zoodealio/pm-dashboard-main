#!/usr/bin/env tsx
// One-shot: parse the old PPMDashboard TASKS.md and load it into the new Supabase project.
//
// Usage:
//   npx tsx scripts/migrate-tasks-md.ts                      # dry-run by default
//   npx tsx scripts/migrate-tasks-md.ts --write              # actually insert
//   npx tsx scripts/migrate-tasks-md.ts --write --reset      # truncate first
//   npx tsx scripts/migrate-tasks-md.ts --source path/to/TASKS.md
//
// The script never touches the old PPMDashboard files; it only reads TASKS.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { slugify } from "@/lib/address";
import { stageFromLabel, type StageId } from "@/lib/services/stages";
import {
  insertProperty,
  insertNotes,
  type PropertyInsert,
} from "@/lib/db/properties";
import { getSupabase } from "@/lib/db/supabase";

interface ParsedProperty extends PropertyInsert {
  notes: Array<{ body: string; checked: boolean; position: number }>;
}

function parseMoney(raw: string): number | null {
  if (!raw || raw.toUpperCase() === "TBD") return null;
  const digits = raw.replace(/[^0-9.-]/g, "");
  if (!digits) return null;
  const dollars = parseFloat(digits);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

function parsePercent(raw: string): number | null {
  if (!raw || raw.toUpperCase() === "TBD") return null;
  const digits = raw.replace(/[^0-9.-]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  if (!raw || raw.toUpperCase() === "TBD") return null;
  const m = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseFields(noteText: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!noteText) return out;
  noteText
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf(":");
      if (idx === -1) return;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = value;
    });
  return out;
}

function parseTasksMd(content: string): ParsedProperty[] {
  const lines = content.split("\n");
  const props: ParsedProperty[] = [];

  let currentStage: StageId | null = null;
  let current: ParsedProperty | null = null;
  let notePos = 0;

  function commit() {
    if (current) props.push(current);
    current = null;
    notePos = 0;
  }

  for (const line of lines) {
    const header = line.match(/^##\s+\*{0,2}(.+?)\*{0,2}\s*$/);
    if (header) {
      commit();
      currentStage = stageFromLabel(header[1]);
      continue;
    }

    if (!currentStage) continue;

    const topItem = line.match(/^- \[[ xX]\]\s+\*\*(.+?)\*\*(.*)$/);
    if (topItem) {
      commit();
      const address = topItem[1].trim();
      const tail = topItem[2].replace(/^\s*-\s*/, "").trim();
      const fields = parseFields(tail);

      current = {
        slug: slugify(address),
        address,
        stage: currentStage,
        purchase_cents: fields.purchase ? parseMoney(fields.purchase) : null,
        clr_cents: fields.clr ? parseMoney(fields.clr) : null,
        reserve_pct: fields.reserve ? parsePercent(fields.reserve) : null,
        inspect_date: fields.inspect ? parseDate(fields.inspect) : null,
        assignee: fields.assignee ?? null,
        inspect_url: fields.inspect_url ?? null,
        redfin_url: fields.redfin_url ?? null,
        cma_url: fields.cma_url ?? null,
        comps_url: fields.comps_url ?? null,
        questionnaire_url: fields.questionnaire_url ?? null,
        remodel_bid_url: fields.remodel_bid_url ?? null,
        project_tracker_url: fields.project_tracker_url ?? null,
        arv_cents: fields.arv ? parseMoney(fields.arv) : null,
        est_repair_cents: fields.est_repair ? parseMoney(fields.est_repair) : null,
        notes: [],
      };
      continue;
    }

    const subNote = line.match(/^\s+- \[([ xX])\]\s+(.+)$/);
    if (subNote && current) {
      current.notes.push({
        body: subNote[2].trim(),
        checked: subNote[1].toLowerCase() === "x",
        position: notePos++,
      });
    }
  }

  commit();
  return props;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const reset = args.includes("--reset");
  const sourceIdx = args.indexOf("--source");
  const sourcePath = sourceIdx >= 0
    ? args[sourceIdx + 1]
    : "../../cowork/PPMDashboard/TASKS.md";

  const absSource = resolve(sourcePath);
  console.log(`Reading ${absSource}`);
  console.log(`Mode: ${write ? "WRITE" : "DRY-RUN"}${reset ? " +RESET" : ""}\n`);

  const content = readFileSync(absSource, "utf-8");
  const parsed = parseTasksMd(content);

  console.log(`Parsed ${parsed.length} properties:\n`);
  for (const p of parsed) {
    const dollars = (cents: number | null | undefined) =>
      cents == null ? "—" : `$${(cents / 100).toLocaleString()}`;
    console.log(
      `  [${p.stage}] ${p.address}\n` +
      `      slug=${p.slug}\n` +
      `      purchase=${dollars(p.purchase_cents)} clr=${dollars(p.clr_cents)} reserve=${p.reserve_pct ?? "—"}% inspect=${p.inspect_date ?? "—"} assignee=${p.assignee ?? "—"}\n` +
      `      notes=${p.notes.length}`,
    );
  }

  if (!write) {
    console.log("\nDry-run only. Re-run with --write to actually insert.");
    return;
  }

  if (reset) {
    console.log("\nResetting properties + property_notes…");
    const sb = getSupabase();
    const del1 = await sb.from("property_notes").delete().not("id", "is", null);
    if (del1.error) throw del1.error;
    const del2 = await sb.from("properties").delete().not("id", "is", null);
    if (del2.error) throw del2.error;
  }

  console.log("\nInserting…");
  let ok = 0;
  let failed = 0;
  for (const p of parsed) {
    try {
      const { notes, ...row } = p;
      const inserted = await insertProperty(row);
      if (notes.length > 0) await insertNotes(inserted.id, notes);
      console.log(`  ✓ ${p.slug}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ ${p.slug}: ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`\nDone. ${ok} inserted, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
