"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Active Properties", match: (p: string) => p === "/" || p.startsWith("/properties") },
  { href: "/pipeline", label: "Pipeline", match: (p: string) => p.startsWith("/pipeline") },
  { href: "/bids", label: "Bid Library", match: (p: string) => p.startsWith("/bids") },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
