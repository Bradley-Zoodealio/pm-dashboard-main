import {
  getThreadActivity,
  type ActivityEvent,
  type ActivityEventType,
} from "@/lib/services/gmail-sync";

// Plaintext from Gmail contains full URLs that are often hundreds of
// characters (Inspectify tracking links, Drive sheet ids, etc.). Render them
// as clickable anchors with a compact host+path display so the timeline reads
// naturally without dominating the page.
function compactLinkText(url: string): string {
  const maxLen = 60;
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname;
    const queryHint = u.search ? "?…" : "";
    const full = `${host}${path}${queryHint}`;
    if (full.length <= maxLen) return full;
    // Doesn't fit — keep host + as many whole path segments as fit, then "…".
    // This keeps URLs like Redfin comps (host + state + city + street) visibly
    // distinct from one another instead of collapsing to bare "redfin.com/AZ…".
    const segs = path.split("/").filter(Boolean);
    let acc = host;
    for (const seg of segs) {
      const next = `${acc}/${seg}`;
      if (next.length + 1 > maxLen) break;
      acc = next;
    }
    return `${acc}/…`;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + "…" : url;
  }
}

function LinkifiedBody({ text }: { text: string }) {
  // Match either <https://...> (Gmail plaintext wraps anchor URLs in angles)
  // or a bare https://... URL. Bracketed form captures group 1; bare URL is
  // group 2. The brackets are dropped from the output either way.
  const re = /<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>]+)/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      out.push(<span key={`t-${i}`}>{text.slice(lastIdx, match.index)}</span>);
    }
    const url = match[1] ?? match[2];
    out.push(
      <a
        key={`l-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className="break-all text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {compactLinkText(url)}
      </a>,
    );
    lastIdx = match.index + match[0].length;
    i++;
  }
  if (lastIdx < text.length) {
    out.push(<span key={`t-${i}`}>{text.slice(lastIdx)}</span>);
  }
  return <>{out}</>;
}

function extractThreadId(questionnaireUrl: string | null): string | null {
  if (!questionnaireUrl) return null;
  const m = questionnaireUrl.match(/#all\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

const EVENT_LABELS: Record<ActivityEventType, string> = {
  "inspection-received": "Inspection received",
  "remodel-bid-sent": "Remodel bid sent",
  "addendum-signed": "Addendum signed",
  "closing-confirmed": "Closing confirmed",
  reply: "Reply",
};

const EVENT_BADGE_COLOR: Record<ActivityEventType, string> = {
  "inspection-received": "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
  "remodel-bid-sent": "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  "addendum-signed": "bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200",
  "closing-confirmed": "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
  reply: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export async function PropertyActivity({
  questionnaireUrl,
}: {
  questionnaireUrl: string | null;
}) {
  const threadId = extractThreadId(questionnaireUrl);
  if (!threadId) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h2>
        <p className="text-sm text-muted-foreground">
          No Gmail thread linked. Set the Questionnaire link to a mail.google.com URL to enable
          activity history.
        </p>
      </section>
    );
  }

  let events: ActivityEvent[] = [];
  let error: string | null = null;
  try {
    events = await getThreadActivity(threadId);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Activity
      </h2>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages in thread.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-sm">
          {events.map((e, i) => (
            <li key={`${e.iso}-${i}`} className="flex gap-3">
              <div className="flex shrink-0 flex-col items-end text-xs text-muted-foreground">
                <span>{new Date(e.iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span>{e.sender}</span>
              </div>
              <details className="group flex-1 rounded border border-transparent open:border-border open:bg-muted/40 open:p-2">
                <summary className="flex cursor-pointer list-none flex-col gap-0.5 marker:hidden [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${EVENT_BADGE_COLOR[e.eventType]}`}
                    >
                      {EVENT_LABELS[e.eventType]}
                    </span>
                    <span className="text-xs text-muted-foreground">{e.subject}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/70 group-open:hidden">
                      ▸ expand
                    </span>
                    <span className="ml-auto hidden text-[10px] text-muted-foreground/70 group-open:inline">
                      ▾ collapse
                    </span>
                  </div>
                  {e.snippet && (
                    <p className="text-sm text-foreground/80 group-open:hidden">{e.snippet}</p>
                  )}
                </summary>
                {e.body ? (
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">
                    <LinkifiedBody text={e.body} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    (no plaintext body — message may be HTML-only)
                  </p>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
