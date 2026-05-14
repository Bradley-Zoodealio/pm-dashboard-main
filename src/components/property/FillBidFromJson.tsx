"use client";

import { useState, useTransition } from "react";
import { fillBidLineItemsAction, type FillBidResult } from "@/lib/actions/sheets";

const SAMPLE = `[
  { "description": "Demo + haul-off", "total": 1200 },
  { "description": "Install LVP flooring (1,400 sqft)", "total": 4900 }
]`;

export function FillBidFromJson({
  slug,
  remodelBidUrl,
}: {
  slug: string;
  remodelBidUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [tab, setTab] = useState("");
  const [result, setResult] = useState<FillBidResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!remodelBidUrl) {
    return null;
  }

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await fillBidLineItemsAction(slug, json, tab || undefined);
        setResult(r);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Fill bid from JSON
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Fill bid from JSON</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Pastes line items into <code className="rounded bg-foreground/10 px-1">B19:H58</code> of the linked Remodel Bid.
        Optionally target a specific tab (e.g. <code className="rounded bg-foreground/10 px-1">Option 1</code>).
      </p>
      <input
        type="text"
        value={tab}
        onChange={(e) => setTab(e.target.value)}
        placeholder="Tab (optional, e.g. Option 1)"
        className="h-8 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder={SAMPLE}
        rows={12}
        className="rounded border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</span>}
        {result && (
          <span className="mr-auto text-xs text-emerald-700 dark:text-emerald-300">
            Wrote {result.written} item{result.written === 1 ? "" : "s"}{result.tab ? ` to ${result.tab}` : ""}.
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !json.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "Writing…" : "Write to sheet"}
        </button>
      </div>
    </div>
  );
}
