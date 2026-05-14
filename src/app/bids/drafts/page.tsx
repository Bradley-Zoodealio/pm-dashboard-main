export default function BidsDraftsPage() {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-medium">No drafts yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Drafts will appear here once the Compose page ships. For now you can preview the bid
        library on the <span className="font-medium">Items</span> and{" "}
        <span className="font-medium">Bids</span> tabs.
      </p>
    </div>
  );
}
