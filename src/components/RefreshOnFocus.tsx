"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetch server data when the tab regains visibility. Catches the common
// case where the user edits something externally (Drive, Gmail, the bid sheet
// in another tab) and switches back to the dashboard — without this, the
// page shows stale server-rendered data until a manual reload.
//
// Cheap: only fires when the tab actually becomes visible after being hidden.
// A small minimum-interval guard prevents thrash if the user is bouncing
// rapidly between two tabs.
const MIN_INTERVAL_MS = 3000;

export function RefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = 0;
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh < MIN_INTERVAL_MS) return;
      lastRefresh = now;
      router.refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  return null;
}
