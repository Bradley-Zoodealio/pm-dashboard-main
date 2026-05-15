import Link from "next/link";
import { listDrafts } from "@/lib/db/bid-drafts";

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export async function PropertyDrafts({
  propertyId,
  propertySlug,
}: {
  propertyId: string;
  propertySlug: string;
}) {
  const drafts = await listDrafts({ propertyId });

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Bid drafts
        </h2>
        <Link
          href={`/bids/compose?property=${propertySlug}`}
          className="text-xs text-primary hover:underline"
        >
          + New draft for this property →
        </Link>
      </header>
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drafts yet for this property. Use{" "}
          <span className="font-medium">Compose Bid Draft</span> below to start one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/bids/compose?draft=${d.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {d.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {d.tier && (
                    <span className="rounded bg-foreground/10 px-1.5 py-0.5">
                      {d.tier === "option-1" ? "Option 1" : "Option 2"}
                    </span>
                  )}
                  <span>{d.item_count} items</span>
                  <span>Updated {formatRelative(d.updated_at)}</span>
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">{dollars(d.total_cents)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
