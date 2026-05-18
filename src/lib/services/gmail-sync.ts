import "server-only";

import {
  extractPlaintextBody,
  getThread,
  header,
  listThreads,
  senderName,
} from "@/lib/google/gmail";
import type { MailboxKey } from "@/lib/google/mailboxes";
import { slugify } from "@/lib/address";
import {
  insertNotes,
  insertProperty,
  listProperties,
  moveStage,
  updatePropertyField,
  type PropertyInsert,
  type PropertyRow,
} from "@/lib/db/properties";
import { getSupabase } from "@/lib/db/supabase";
import { copyCmaToPropertyDocs, extractSheetIdFromUrl } from "./cma-copy";
import type { StageId } from "@/lib/services/stages";

// ── Detection regexes ────────────────────────────────────────────────────────
//
// OAuth pivot (2026-05-15): the sync now runs as `tih-contracts` (not
// `bradley@`). Inspection emails are in contracts@'s SENT folder; team
// replies (remodel-bid responses, addendum confirmations) are in its INBOX.
// Inside the thread, every message keeps its original From: header so the
// existing per-message detection logic still works.
//
// Closing-confirmed detection was DROPPED — closings now happen via Joseph's
// Slack post in #acq-dis-properties, not email. The CLOSING_VERB_RE regex is
// kept *only* for getThreadActivity display, so historical threads that DO
// contain closing emails still get labeled correctly.

const SUBJECT_PATTERN = /Inspection Report Ready for Viewing\s*-\s*(.+?)$/i;
const TEAM_DOMAIN = "@zoodealio.com";
const MARKET_STATS_RE =
  /CURRENTLY ACTIVE HOMES?[:\s]+(\d+)[\s\S]{0,200}?SOLD IN THE LAST MONTH[:\s]+(\d+)[\s\S]{0,200}?PENDING HOMES?[:\s]+(\d+)[\s\S]{0,200}?([\d.]+\s*months? of inventory)/i;
const ESIGN_HOSTS = /(docusign|hellosign|dropboxsign|adobesign|pandadoc|signnow)/i;
const ADDENDUM_COMPLETION_RE =
  /\baddendum\b[\s\S]{0,200}?(signed|completed|executed|countersigned|all parties)/i;
const CLOSING_VERB_RE =
  /\bofficially closed\b|\bclosing (?:has been )?(?:completed|finalized)\b|\bwe (?:are|have) (?:officially )?closed\b|\bclear to close\b|\bclose of escrow\b/i;

// ── Body field extractors (labels of the form "*Field:* value") ──────────────

function extractField(body: string, label: string): string {
  const re = new RegExp(`\\*${label}:[^*]*\\*\\s*(?:\\*)?([^\\n*]*)`, "i");
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

function moneyToCents(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function reservePercent(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function extractInspectifyUrl(body: string): string | null {
  const m = body.match(/https?:\/\/app2\.inspectify\.com\/orders\/[A-Za-z0-9]+\/result/);
  return m ? m[0] : null;
}

function extractCmaUrl(body: string): string | null {
  const m = body.match(
    /CMA Sheet[^<]*<(https?:\/\/docs\.google\.com\/spreadsheets\/[^>]+)>/i,
  );
  if (m) {
    return m[1].split("#")[0].split("?")[0].replace(/\/edit.*$/, "/edit");
  }
  const idx = body.search(/CMA Sheet/i);
  if (idx === -1) return null;
  const slice = body.slice(idx, idx + 500);
  const u = slice.match(/https?:\/\/docs\.google\.com\/spreadsheets\/[^\s<>]+/);
  return u
    ? u[0].split("#")[0].split("?")[0].replace(/\/edit.*$/, "/edit")
    : null;
}

function extractAddressFromSubject(subject: string, body: string): string {
  const s = subject.match(SUBJECT_PATTERN);
  if (s) return s[1].replace(/^Fwd:\s*/i, "").trim();
  const b = body.match(/details for the property\s+(.+?)\./i);
  return b ? b[1].trim() : "";
}

function redfinUrl(address: string): string {
  return (
    "https://www.google.com/search?q=site:redfin.com+" +
    encodeURIComponent(address).replace(/%20/g, "+")
  );
}

function questionnaireUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

// Extracts a Gmail thread id from a mail.google.com URL. Mirrors the regex
// used by PropertyActivity so backfilled URLs stay in sync with what the
// Activity component can resolve.
function extractThreadIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/#all\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ── Detection functions ──────────────────────────────────────────────────────

export interface ParsedInspection {
  threadId: string;
  address: string;
  purchase_cents: number | null;
  clr_cents: number | null;
  reserve_pct: number | null;
  inspect_date: string | null;
  inspect_url: string | null;
  cma_url: string | null;
  emailDate: string;
}

async function parseInspectionThread(
  threadId: string,
  mailbox: MailboxKey,
): Promise<ParsedInspection | null> {
  const data = await getThread(threadId, mailbox);
  const firstMsg = data.messages?.[0];
  if (!firstMsg) return null;

  const subject = header(firstMsg.payload?.headers ?? undefined, "subject");
  const date = header(firstMsg.payload?.headers ?? undefined, "date");
  const body = extractPlaintextBody(firstMsg);

  const address = extractAddressFromSubject(subject, body);
  if (!address) return null;

  return {
    threadId,
    address,
    purchase_cents: moneyToCents(extractField(body, "Purchase")),
    clr_cents: moneyToCents(extractField(body, "Credit")),
    reserve_pct: reservePercent(extractField(body, "Reserve")),
    inspect_date: normalizeDate(extractField(body, "End of Inspect Period")),
    inspect_url: extractInspectifyUrl(body),
    cma_url: extractCmaUrl(body),
    emailDate: date,
  };
}

export interface RemodelBidSignal {
  hasBid: boolean;
  byWho?: string;
  date?: string;
  marketStats?: string;
}

async function detectRemodelBidReply(
  threadId: string,
  mailbox: MailboxKey,
): Promise<RemodelBidSignal> {
  const data = await getThread(threadId, mailbox);
  const messages = data.messages ?? [];
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const from = header(msg.payload?.headers ?? undefined, "from");
    const date = header(msg.payload?.headers ?? undefined, "date");
    if (!from.includes(TEAM_DOMAIN)) continue;
    const body = extractPlaintextBody(msg);
    const stats = body.match(MARKET_STATS_RE);
    if (!stats) continue;
    const marketStats = `${stats[1]} active, ${stats[2]} sold/mo, ${stats[3]} pending (${stats[4]})`;
    return {
      hasBid: true,
      byWho: senderName(from),
      date,
      marketStats,
    };
  }
  return { hasBid: false };
}

export interface AddendumSignal {
  signed: boolean;
  byWho?: string;
  date?: string;
  source?: "docusign" | "contracts-reply";
}

async function detectAddendumSigned(
  threadId: string,
  mailbox: MailboxKey,
): Promise<AddendumSignal> {
  const data = await getThread(threadId, mailbox);
  const messages = data.messages ?? [];
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const from = header(msg.payload?.headers ?? undefined, "from");
    const subject = header(msg.payload?.headers ?? undefined, "subject");
    const date = header(msg.payload?.headers ?? undefined, "date");
    const body = extractPlaintextBody(msg);

    if (
      ESIGN_HOSTS.test(from) &&
      /\b(complete|completed|signed|all parties signed)\b/i.test(subject + " " + body)
    ) {
      return { signed: true, byWho: "DocuSign/e-sign", date, source: "docusign" };
    }
    if (
      from.includes("tradeinholdings.com") &&
      ADDENDUM_COMPLETION_RE.test(body + " " + subject)
    ) {
      return {
        signed: true,
        byWho: senderName(from),
        date,
        source: "contracts-reply",
      };
    }
  }
  return { signed: false };
}

// ── Activity timeline ────────────────────────────────────────────────────────
//
// Closing-confirmed branch left intact for *display* of historical threads
// that contain closing emails (rare — most closings are Slack-only).

export type ActivityEventType =
  | "inspection-received"
  | "remodel-bid-sent"
  | "addendum-signed"
  | "closing-confirmed"
  | "reply";

export interface ActivityEvent {
  date: string;
  iso: string;
  sender: string;
  subject: string;
  snippet: string;
  eventType: ActivityEventType;
}

export async function getThreadActivity(
  threadId: string,
  mailbox: MailboxKey = "tih-contracts",
): Promise<ActivityEvent[]> {
  const data = await getThread(threadId, mailbox);
  const messages = data.messages ?? [];
  const events: ActivityEvent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const from = header(msg.payload?.headers ?? undefined, "from");
    const subject = header(msg.payload?.headers ?? undefined, "subject");
    const date = header(msg.payload?.headers ?? undefined, "date");
    const body = extractPlaintextBody(msg);

    let eventType: ActivityEventType = "reply";
    if (i === 0) {
      eventType = "inspection-received";
    } else if (MARKET_STATS_RE.test(body) && from.includes(TEAM_DOMAIN)) {
      eventType = "remodel-bid-sent";
    } else if (
      ESIGN_HOSTS.test(from) ||
      (from.includes("tradeinholdings.com") &&
        ADDENDUM_COMPLETION_RE.test(body + " " + subject))
    ) {
      eventType = "addendum-signed";
    } else if (CLOSING_VERB_RE.test(body)) {
      eventType = "closing-confirmed";
    }

    const firstLine =
      body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith(">")) ?? "";
    const snippet = firstLine.length > 140 ? firstLine.slice(0, 137) + "…" : firstLine;

    events.push({
      date,
      iso: new Date(date).toISOString(),
      sender: senderName(from),
      subject,
      snippet,
      eventType,
    });
  }
  return events;
}

// ── Plan items ───────────────────────────────────────────────────────────────

export interface PlanItemAdd {
  type: "add";
  threadId: string;
  address: string;
  toStage: StageId;
  fields: PropertyInsert;
  note?: string;
  copyCma?: { sourceUrl: string };
}

export interface PlanItemMove {
  type: "move";
  threadId: string;
  slug: string;
  address: string;
  fromStage: string;
  toStage: StageId;
  note: string;
}

export interface PlanItemCopyCma {
  type: "copy-cma";
  threadId: string;
  slug: string;
  address: string;
  sourceUrl: string;
}

// Backfills questionnaire_url with the contracts@ thread id when the existing
// value is missing or refers to a thread id from a different mailbox (e.g.
// pasted from a personal account). Without this, Activity would 404 because
// Gmail thread ids are per-mailbox.
export interface PlanItemSetThreadId {
  type: "set-thread-id";
  threadId: string;
  slug: string;
  address: string;
  oldUrl: string | null;
  newUrl: string;
}

export type PlanItem =
  | PlanItemAdd
  | PlanItemMove
  | PlanItemCopyCma
  | PlanItemSetThreadId;

function bidNote(b: RemodelBidSignal): string {
  return (
    `Remodel bid${b.byWho ? ` by ${b.byWho}` : ""}` +
    `${b.date ? ` (${b.date.split(" ").slice(1, 4).join(" ")})` : ""}` +
    `${b.marketStats ? `. Market: ${b.marketStats}` : ""}.`
  );
}

function addendumNote(s: AddendumSignal): string {
  return (
    `Addendum signed${s.source === "docusign" ? " (e-sign completion)" : s.byWho ? ` per ${s.byWho}` : ""}` +
    `${s.date ? ` (${s.date.split(" ").slice(1, 4).join(" ")})` : ""}.`
  );
}

function streetSlug(address: string): string {
  return slugify(address.split(",")[0]);
}

function matchesExisting(newStreetSlug: string, existing: PropertyRow): boolean {
  const s = streetSlug(existing.address);
  return (
    s === newStreetSlug ||
    s.startsWith(newStreetSlug + "-") ||
    newStreetSlug.startsWith(s + "-")
  );
}

function fieldsForNewProperty(p: ParsedInspection, toStage: StageId): PropertyInsert {
  return {
    slug: slugify(p.address),
    address: p.address,
    stage: toStage,
    purchase_cents: p.purchase_cents,
    clr_cents: p.clr_cents,
    reserve_pct: p.reserve_pct,
    inspect_date: p.inspect_date,
    assignee: "Unassigned",
    inspect_url: p.inspect_url,
    redfin_url: redfinUrl(p.address),
    cma_url: p.cma_url,
    questionnaire_url: questionnaireUrl(p.threadId),
  };
}

// ── Scan + apply ─────────────────────────────────────────────────────────────

export interface ScanResult {
  plan: PlanItem[];
  scannedThreads: number;
  existingCount: number;
}

export async function scanForPipelineChanges(
  opts: { sinceDays?: number; mailbox?: MailboxKey } = {},
): Promise<ScanResult> {
  const mailbox = opts.mailbox ?? "tih-contracts";
  const sinceDays = opts.sinceDays ?? 30;
  // Inspection emails arrive FROM Inspectify (or similar) into contracts@'s
  // inbox — don't filter by sender. The thread API returns the full thread
  // regardless of who started it, so message[0]'s body still has the
  // inspection details we parse.
  const q = `subject:"Inspection Report Ready" newer_than:${sinceDays}d`;

  const [threads, existing] = await Promise.all([
    listThreads(q, mailbox),
    listProperties(),
  ]);

  const plan: PlanItem[] = [];
  // Track slugs we've already proposed a thread-id fix for so re-inspections
  // (multiple inspection threads, same property) only emit one FIX URL row.
  // listThreads returns newest-first, so the first thread we see is preferred.
  const setThreadIdSlugs = new Set<string>();
  for (const t of threads) {
    const parsed = await parseInspectionThread(t.threadId, mailbox);
    if (!parsed) continue;
    const sSlug = streetSlug(parsed.address);
    const existingProp = existing.find((p) => matchesExisting(sSlug, p));

    if (!existingProp) {
      const bid = await detectRemodelBidReply(parsed.threadId, mailbox);
      const toStage: StageId = bid.hasBid ? "exec-final-review" : "inspection-received";
      const copyCma = parsed.cma_url
        ? { sourceUrl: parsed.cma_url }
        : undefined;
      plan.push({
        type: "add",
        threadId: parsed.threadId,
        address: parsed.address,
        toStage,
        fields: fieldsForNewProperty(parsed, toStage),
        note: bid.hasBid ? bidNote(bid) : undefined,
        copyCma,
      });
      continue;
    }

    const existingThreadId = extractThreadIdFromUrl(existingProp.questionnaire_url);
    if (
      existingThreadId !== parsed.threadId &&
      !setThreadIdSlugs.has(existingProp.slug)
    ) {
      plan.push({
        type: "set-thread-id",
        threadId: parsed.threadId,
        slug: existingProp.slug,
        address: existingProp.address,
        oldUrl: existingProp.questionnaire_url,
        newUrl: questionnaireUrl(parsed.threadId),
      });
      setThreadIdSlugs.add(existingProp.slug);
    }

    if (existingProp.stage === "inspection-received") {
      const bid = await detectRemodelBidReply(parsed.threadId, mailbox);
      if (bid.hasBid) {
        plan.push({
          type: "move",
          threadId: parsed.threadId,
          slug: existingProp.slug,
          address: existingProp.address,
          fromStage: existingProp.stage,
          toStage: "exec-final-review",
          note: bidNote(bid),
        });
      }
    } else if (existingProp.stage === "exec-final-review") {
      const addendum = await detectAddendumSigned(parsed.threadId, mailbox);
      if (addendum.signed) {
        plan.push({
          type: "move",
          threadId: parsed.threadId,
          slug: existingProp.slug,
          address: existingProp.address,
          fromStage: existingProp.stage,
          toStage: "addendum-sent",
          note: addendumNote(addendum),
        });
      }
    }
    // addendum-sent → contract-work transition dropped: closing is Slack-only.

    // CMA copy proposal for an existing property that has a cma_url but no
    // CMA Sheet locally in its Docs folder. We can't easily tell from here
    // whether the local copy exists, so we propose only when cma_url points
    // at the source URL we just parsed (= the inspection-email body's URL)
    // AND the property has no drive_folder_id yet (= never went through the
    // copy step). Better than nothing for v1.
    if (
      existingProp &&
      parsed.cma_url &&
      existingProp.cma_url === parsed.cma_url &&
      !existingProp.drive_folder_id &&
      extractSheetIdFromUrl(parsed.cma_url)
    ) {
      plan.push({
        type: "copy-cma",
        threadId: parsed.threadId,
        slug: existingProp.slug,
        address: existingProp.address,
        sourceUrl: parsed.cma_url,
      });
    }
  }

  // Dedup ADDs: multiple inspection emails can exist for the same property
  // (re-inspections, forwards). Keep the entry whose stage is most advanced;
  // ties broken by the more informative note.
  const STAGE_ORDER: Record<string, number> = {
    "inspection-received": 0,
    "inspection-under-review": 1,
    "exec-final-review": 2,
    "addendum-sent": 3,
    title: 4,
    "contract-work": 5,
    "ready-for-listing": 6,
  };
  const adds = plan.filter((p): p is PlanItemAdd => p.type === "add");
  const other = plan.filter((p) => p.type !== "add");
  const bestBySlug = new Map<string, PlanItemAdd>();
  for (const a of adds) {
    const prev = bestBySlug.get(a.fields.slug);
    if (!prev) {
      bestBySlug.set(a.fields.slug, a);
      continue;
    }
    const prevRank = STAGE_ORDER[prev.toStage] ?? -1;
    const curRank = STAGE_ORDER[a.toStage] ?? -1;
    if (curRank > prevRank) bestBySlug.set(a.fields.slug, a);
    else if (curRank === prevRank && a.note && !prev.note)
      bestBySlug.set(a.fields.slug, a);
  }
  const dedupedPlan = [...bestBySlug.values(), ...other];

  return {
    plan: dedupedPlan,
    scannedThreads: threads.length,
    existingCount: existing.length,
  };
}

export interface ApplyResult {
  applied: number;
  failed: number;
  details: Array<{ ok: boolean; item: PlanItem; error?: string }>;
}

export async function applyPlan(plan: PlanItem[]): Promise<ApplyResult> {
  const details: ApplyResult["details"] = [];
  for (const item of plan) {
    try {
      if (item.type === "add") {
        const row = await insertProperty(item.fields);
        if (item.note) {
          await insertNotes(row.id, [
            { body: item.note, checked: false, position: 0 },
          ]);
        }
        if (item.copyCma) {
          try {
            await copyCmaToPropertyDocs({
              slug: row.slug,
              sourceUrl: item.copyCma.sourceUrl,
            });
          } catch (err) {
            // CMA copy failure is non-fatal — the property is still added and
            // its cma_url field is set to the source URL. Surface the warning
            // in the apply result so the user can re-share + retry manually.
            details.push({
              ok: false,
              item,
              error: `Property added, but CMA copy failed: ${(err as Error).message}. Share the CMA Sheet with pm@tradeinholdings.com and retry.`,
            });
            continue;
          }
        }
        details.push({ ok: true, item });
      } else if (item.type === "move") {
        await moveStage(item.slug, item.toStage);
        const sb = getSupabase();
        const { data: prop } = await sb
          .from("properties")
          .select("id")
          .eq("slug", item.slug)
          .maybeSingle();
        if (prop?.id) {
          const { data: existingNotes } = await sb
            .from("property_notes")
            .select("position")
            .eq("property_id", prop.id);
          const nextPos =
            existingNotes && existingNotes.length > 0
              ? Math.max(...existingNotes.map((n) => n.position)) + 1
              : 0;
          await sb.from("property_notes").insert({
            property_id: prop.id,
            body: item.note,
            checked: false,
            position: nextPos,
          });
        }
        details.push({ ok: true, item });
      } else if (item.type === "copy-cma") {
        await copyCmaToPropertyDocs({
          slug: item.slug,
          sourceUrl: item.sourceUrl,
        });
        details.push({ ok: true, item });
      } else if (item.type === "set-thread-id") {
        await updatePropertyField(item.slug, "questionnaire_url", item.newUrl);
        details.push({ ok: true, item });
      }
    } catch (err) {
      details.push({ ok: false, item, error: (err as Error).message });
    }
  }
  return {
    applied: details.filter((d) => d.ok).length,
    failed: details.filter((d) => !d.ok).length,
    details,
  };
}

/** Cron-friendly: scan and apply in one shot. */
export async function runGmailSync(
  opts: { sinceDays?: number; mailbox?: MailboxKey } = {},
): Promise<{ scanned: number; planSize: number; applied: number; failed: number }> {
  const scan = await scanForPipelineChanges(opts);
  if (scan.plan.length === 0) {
    return { scanned: scan.scannedThreads, planSize: 0, applied: 0, failed: 0 };
  }
  const result = await applyPlan(scan.plan);
  return {
    scanned: scan.scannedThreads,
    planSize: scan.plan.length,
    applied: result.applied,
    failed: result.failed,
  };
}
