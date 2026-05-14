import Link from "next/link";
import { searchBids, listBidLineItems, type BidSearchHit } from "@/lib/db/bids";

export const dynamic = "force-dynamic";

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  let hits: BidSearchHit[] = [];
  let error: string | null = null;
  if (query.length >= 2) {
    try {
      hits = await searchBids(query, 40);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Board
        </Link>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold leading-tight">Bid Library</h1>
        <p className="text-sm text-muted-foreground">
          Search past Remodel Bid line items + addresses scraped from Drive.
        </p>
      </header>

      <form className="flex items-center gap-2" action="">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="e.g. shaker vanity, LVP flooring, 7472 Silver"
          className="h-9 flex-1 rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          autoFocus
        />
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          <div className="font-medium">Search failed</div>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-2 text-muted-foreground">
            The bid library may not be populated yet. Run{" "}
            <code className="rounded bg-foreground/10 px-1">/api/admin/scrape-bids</code>{" "}
            (POST with Authorization: Bearer CRON_SECRET) to scrape from Drive.
          </p>
        </div>
      )}

      {query.length < 2 ? (
        <p className="text-sm text-muted-foreground">Type at least 2 characters to search.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bids found for {`"${query}"`}.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {hits.map((hit) => (
            <BidHit key={hit.bid.id} hit={hit} />
          ))}
        </ul>
      )}
    </main>
  );
}

async function BidHit({ hit }: { hit: BidSearchHit }) {
  const { bid, matchedDescriptions } = hit;
  const total = bid.total_amount
    ? `$${bid.total_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : "—";

  // Show matched line items first; if there are none, show the full bid contents.
  let lines = matchedDescriptions;
  if (lines.length === 0) {
    try {
      lines = await listBidLineItems(bid.id);
    } catch {
      lines = [];
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">
            <a
              href={bid.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {bid.address_raw ?? bid.subject ?? "Unnamed bid"} ↗
            </a>
          </div>
          <div className="text-xs text-muted-foreground">
            {bid.tab_name} · {bid.bid_year ?? "?"} · {bid.authored_by ?? "—"}
          </div>
        </div>
        <div className="text-sm font-medium">{total}</div>
      </header>
      {lines.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {lines.slice(0, 12).map((li) => (
            <li key={li.id} className="flex justify-between gap-3">
              <span className={li.is_footer ? "text-muted-foreground italic" : ""}>
                {li.description}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {li.total != null
                  ? `$${li.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : ""}
              </span>
            </li>
          ))}
          {lines.length > 12 && (
            <li className="text-muted-foreground">… {lines.length - 12} more lines</li>
          )}
        </ul>
      )}
    </li>
  );
}
