"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/bids", label: "Items" },
  { href: "/bids/documents", label: "Bids" },
  { href: "/bids/drafts", label: "Drafts" },
] as const;

export function BidLibraryTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/bids" ? pathname === "/bids" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors " +
              (isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
