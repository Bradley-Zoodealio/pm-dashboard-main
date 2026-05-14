import { listBucketSummaries, type BucketSummary } from "@/lib/db/bid-aggregates";
import { BucketGrid } from "@/components/bids/BucketGrid";

export const dynamic = "force-dynamic";

export default async function BidsItemsPage() {
  let buckets: BucketSummary[];
  let error: string | null = null;
  try {
    buckets = await listBucketSummaries();
  } catch (err) {
    buckets = [];
    error = (err as Error).message;
  }

  buckets.sort((a, b) => b.totalSpend - a.totalSpend);

  if (error) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
        <div className="font-medium">Couldn&apos;t load bucket summaries</div>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The bid library is empty. Run{" "}
        <code className="rounded bg-foreground/10 px-1">/api/admin/scrape-bids</code> to populate
        it from Drive.
      </p>
    );
  }

  return <BucketGrid buckets={buckets} />;
}
