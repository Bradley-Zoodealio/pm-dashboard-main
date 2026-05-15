import Link from "next/link";
import { redirect } from "next/navigation";
import { createDraft, getDraftWithItems, listDrafts } from "@/lib/db/bid-drafts";
import { getPropertyBySlug } from "@/lib/db/properties";
import { listBucketSummaries } from "@/lib/db/bid-aggregates";
import { ComposeEditor } from "@/components/bids/ComposeEditor";

export const dynamic = "force-dynamic";

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; property?: string }>;
}) {
  const { draft: draftId, property: propertySlug } = await searchParams;

  // No draft requested. If there's a property, bootstrap one for them and redirect.
  // Otherwise show the empty start page.
  if (!draftId) {
    if (propertySlug) {
      const property = await getPropertyBySlug(propertySlug);
      if (!property) {
        return <ComposeEmptyState notFoundId={`property ${propertySlug}`} />;
      }
      const newDraft = await createDraft({
        propertyId: property.id,
        title: property.address,
      });
      redirect(`/bids/compose?draft=${newDraft.id}&property=${propertySlug}`);
    }
    return <ComposeEmptyState />;
  }

  const draft = await getDraftWithItems(draftId);
  if (!draft) {
    return <ComposeEmptyState notFoundId={draftId} />;
  }

  const property =
    draft.property_id && propertySlug
      ? await getPropertyBySlug(propertySlug)
      : null;

  const [buckets, recentDrafts] = await Promise.all([
    listBucketSummaries(),
    listDrafts({ limit: 5 }),
  ]);
  buckets.sort((a, b) => b.totalSpend - a.totalSpend);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/bids" className="hover:underline">
          ← Bid Library
        </Link>
      </nav>
      <ComposeEditor
        initialDraft={draft}
        property={
          property
            ? {
                id: property.id,
                slug: property.slug,
                address: property.address,
                clrCents: property.clr_cents,
                remodelBidUrl: property.remodel_bid_url,
              }
            : null
        }
        buckets={buckets}
        recentDrafts={recentDrafts.map((d) => ({
          id: d.id,
          title: d.title,
          updatedAt: d.updated_at,
          totalCents: d.total_cents,
          itemCount: d.item_count,
        }))}
      />
    </main>
  );
}

function ComposeEmptyState({ notFoundId }: { notFoundId?: string }) {
  async function startNew() {
    "use server";
    const { createDraftAction } = await import("@/lib/actions/bid-drafts");
    const { draftId } = await createDraftAction({});
    redirect(`/bids/compose?draft=${draftId}`);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/bids" className="hover:underline">
          ← Bid Library
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold leading-tight">Compose a bid draft</h1>
        <p className="text-sm text-muted-foreground">
          Assemble line items with median historical pricing, copy as JSON for paste, or send
          directly to a property&apos;s Remodel Bid sheet.
        </p>
      </header>
      {notFoundId && (
        <div className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          Draft <code>{notFoundId}</code> was not found. It may have been deleted.
        </div>
      )}
      <form action={startNew}>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          + New blank draft
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        To compose for a specific property, open it from the board and click{" "}
        <span className="font-medium">Compose Bid Draft</span>.
      </p>
    </main>
  );
}
