import Link from "next/link";
import { BidLibraryTabs } from "@/components/bids/BidLibraryTabs";
import { getLastSuccessfulScrape } from "@/lib/db/bids";

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default async function BidLibraryLayout({ children }: { children: React.ReactNode }) {
  let scrape;
  try {
    scrape = await getLastSuccessfulScrape();
  } catch {
    scrape = null;
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Board
        </Link>
      </nav>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">Bid Library</h1>
          <p className="text-sm text-muted-foreground">
            Historical Remodel Bid line items scraped from Drive. Search past bids,
            browse common line items by category, manage draft bids.
          </p>
        </div>
        {scrape?.finished_at && (
          <p
            className={
              "text-[11px] " +
              (scrape.has_errors ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")
            }
            title={`Drive scrape · ${scrape.bids_upserted} bids · ${scrape.items_upserted} items${scrape.has_errors ? " · with errors" : ""}`}
          >
            Library updated {formatRelative(scrape.finished_at)}
            {scrape.has_errors && " · errors"}
          </p>
        )}
      </header>

      <BidLibraryTabs />
      {children}
    </main>
  );
}
