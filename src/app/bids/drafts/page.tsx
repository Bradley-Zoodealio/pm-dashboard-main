import Link from "next/link";
import { listDrafts } from "@/lib/db/bid-drafts";
import { listActiveProperties } from "@/lib/db/properties";
import { NewDraftButton } from "@/components/bids/NewDraftButton";

export const dynamic = "force-dynamic";

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function formatRelativeDate(iso: string): string {
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

export default async function BidsDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const [drafts, properties] = await Promise.all([
    listDrafts({ includeArchived: showArchived }),
    listActiveProperties(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <NewDraftButton
          properties={properties.map((p) => ({
            id: p.id,
            slug: p.slug,
            address: p.address,
            stage: p.stage,
            assignee: p.assignee,
          }))}
        />
        <Link
          href={showArchived ? "/bids/drafts" : "/bids/drafts?archived=1"}
          className="text-xs text-muted-foreground hover:underline"
        >
          {showArchived ? "← Active drafts" : "Show archived →"}
        </Link>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <h2 className="font-medium">
            {showArchived ? "No archived drafts" : "No drafts yet"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {showArchived
              ? "Drafts you archive will appear here."
              : "Create a blank draft above, or open a property page and click Compose Bid Draft to start one tied to that property."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <Link
                  href={`/bids/compose?draft=${d.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {d.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {d.property_slug && d.property_address && (
                    <Link
                      href={`/properties/${d.property_slug}`}
                      className="rounded bg-accent/40 px-1.5 py-0.5 hover:bg-accent"
                    >
                      {d.property_address}
                    </Link>
                  )}
                  {d.tier && (
                    <span className="rounded bg-foreground/10 px-1.5 py-0.5">
                      {d.tier === "option-1" ? "Option 1" : "Option 2"}
                    </span>
                  )}
                  <span>Updated {formatRelativeDate(d.updated_at)}</span>
                  {d.archived_at && (
                    <span className="text-amber-600 dark:text-amber-400">Archived</span>
                  )}
                </div>
              </div>
              <div className="text-right text-xs">
                <p className="text-sm tabular-nums">{dollars(d.total_cents)}</p>
                <p className="text-[10px] text-muted-foreground">{d.item_count} items</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
