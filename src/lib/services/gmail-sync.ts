import "server-only";

import {
  decodeBase64Url,
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
  type PropertyInsert,
  type PropertyRow,
} from "@/lib/db/properties";
import { getSupabase } from "@/lib/db/supabase";
import type { StageId } from "@/lib/services/stages";

// ── Detection regexes (ported verbatim from old PPMDashboard) ────────────────

const SUBJECT_PATTERN = /Inspection Report Ready for Viewing\s*-\s*(.+?)$/i;
const TEAM_DOMAIN = "@zoodealio.com";
const MARKET_STATS_RE =
  /CURRENTLY ACTIVE HOMES?[:\s]+(\d+)[\s\S]{0,200}?SOLD IN THE LAST MONTH[:\s]+(\d+)[\s\S]{0,200}?PENDING HOMES?[:\s]+(\d+)[\s\S]{0,200}?([\d.]+\s*months? of inventory)/i;
const ESIGN_HOSTS = /(docusign|hellosign|dropboxsign|adobesign|pandadoc|signnow)/i;
const ADDENDUM_COMPLETION_RE =
  /\baddendum\b[\s\S]{0,200}?(signed|completed|executed|countersigned|all parties)/i;
const CLOSING_VERB_RE =
  /\bofficially closed\b|\bclosing (?:has been )?(?:completed|finalized)\b|\bwe (?:are|have) (?:officially )?closed\b|\bclear to close\b|\bclose of escrow\b/i;
const LOCKBOX_COMBO_RE = /\bcombo[:\s]*(\d{3,6})\b/i;
const LOCKBOX_LOCATION_RE =
  /\blockbox(?:\s+is)?\s+(?:on the\s+|at the\s+|on\s+|in the\s+|at\s+)?([a-z0-9\s]+?(?:side|back|front|porch|door|gate|patio|garage|fence)[a-z0-9\s]*?(?:of the (?:house|home|property))?)\b/i;

// ── Helpers for the labeled "*Field:* value" inspection email body ───────────

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
  const m = body.match(/CMA Sheet[^<]*<(https?:\/\/docs\.google\.com\/spreadsheets\/[^>]+)>/i);
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

export interface ClosingSignal {
  closed: boolean;
  byWho?: string;
  date?: string;
  lockboxCombo?: string;
  lockboxLocation?: string;
}

async function detectClosingConfirmed(
  threadId: string,
  mailbox: MailboxKey,
): Promise<ClosingSignal> {
  const data = await getThread(threadId, mailbox);
  const messages = data.messages ?? [];
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const from = header(msg.payload?.headers ?? undefined, "from");
    const date = header(msg.payload?.headers ?? undefined, "date");
    const body = extractPlaintextBody(msg);
    if (!CLOSING_VERB_RE.test(body)) continue;
    const combo = body.match(LOCKBOX_COMBO_RE);
    const loc = body.match(LOCKBOX_LOCATION_RE);
    return {
      closed: true,
      byWho: senderName(from),
      date,
      lockboxCombo: combo?.[1],
      lockboxLocation: loc?.[1]?.trim(),
    };
  }
  return { closed: false };
}

// ── Activity timeline ────────────────────────────────────────────────────────

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
  mailbox: MailboxKey = "bradley",
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

export type PlanItem = PlanItemAdd | PlanItemMove;

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

function closingNote(s: ClosingSignal): string {
  const parts = [
    `Closed${s.byWho ? ` per ${s.byWho}` : ""}${s.date ? ` (${s.date.split(" ").slice(1, 4).join(" ")})` : ""}`,
  ];
  if (s.lockboxLocation) parts.push(`Lockbox: ${s.lockboxLocation}`);
  if (s.lockboxCombo) parts.push(`Combo: ${s.lockboxCombo}`);
  return parts.join(". ") + ".";
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
  const mailbox = opts.mailbox ?? "bradley";
  const sinceDays = opts.sinceDays ?? 30;
  const q = `from:contracts@tradeinholdings.com subject:"Inspection Report Ready" newer_than:${sinceDays}d`;

  const [threads, existing] = await Promise.all([
    listThreads(q, mailbox),
    listProperties(),
  ]);

  const plan: PlanItem[] = [];
  for (const t of threads) {
    const parsed = await parseInspectionThread(t.threadId, mailbox);
    if (!parsed) continue;
    const sSlug = streetSlug(parsed.address);
    const existingProp = existing.find((p) => matchesExisting(sSlug, p));

    if (!existingProp) {
      const bid = await detectRemodelBidReply(parsed.threadId, mailbox);
      const toStage: StageId = bid.hasBid ? "exec-final-review" : "inspection-received";
      plan.push({
        type: "add",
        threadId: parsed.threadId,
        address: parsed.address,
        toStage,
        fields: fieldsForNewProperty(parsed, toStage),
        note: bid.hasBid ? bidNote(bid) : undefined,
      });
      continue;
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
    } else if (existingProp.stage === "addendum-sent") {
      const closing = await detectClosingConfirmed(parsed.threadId, mailbox);
      if (closing.closed) {
        plan.push({
          type: "move",
          threadId: parsed.threadId,
          slug: existingProp.slug,
          address: existingProp.address,
          fromStage: existingProp.stage,
          toStage: "contract-work",
          note: closingNote(closing),
        });
      }
    }
  }

  return { plan, scannedThreads: threads.length, existingCount: existing.length };
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
        details.push({ ok: true, item });
      } else {
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

// Suppress unused-import warnings for re-exports consumers may want
export { decodeBase64Url };
