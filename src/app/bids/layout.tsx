import Link from "next/link";
import { BidLibraryTabs } from "@/components/bids/BidLibraryTabs";

export default function BidLibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Board
        </Link>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold leading-tight">Bid Library</h1>
        <p className="text-sm text-muted-foreground">
          Historical Remodel Bid line items scraped from Drive. Search past bids,
          browse common line items by category, manage draft bids.
        </p>
      </header>

      <BidLibraryTabs />
      {children}
    </main>
  );
}
