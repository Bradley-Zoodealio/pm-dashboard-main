"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onFocus() {
      startTransition(() => router.refresh());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
    >
      {isPending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
