"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDraftAction } from "@/lib/actions/bid-drafts";

export interface DraftEligibleProperty {
  id: string;
  slug: string;
  address: string;
  stage: string;
  assignee: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  "inspection-received": "Inspection Received",
  "inspection-under-review": "Inspection Under Review",
  "exec-final-review": "Exec Final Review",
  "addendum-sent": "Addendum Sent",
  "contract-work": "Contract Work",
};

export function NewDraftButton({
  properties,
  variant = "primary",
  label = "+ New draft",
}: {
  properties: DraftEligibleProperty[];
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on click-outside.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return properties;
    return properties.filter(
      (p) => p.address.toLowerCase().includes(f) || (p.assignee ?? "").toLowerCase().includes(f),
    );
  }, [properties, filter]);

  async function start(input: { propertySlug?: string; title?: string }) {
    setPending(true);
    setError(null);
    try {
      const { draftId } = await createDraftAction(input);
      router.push(`/bids/compose?draft=${draftId}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  const buttonClasses =
    variant === "primary"
      ? "h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
      : "h-9 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent";

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} className={buttonClasses}>
        {label}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-96 rounded-lg border border-border bg-popover p-3 shadow-xl">
          <header className="mb-2">
            <h3 className="text-sm font-medium">Start a new draft</h3>
            <p className="text-[11px] text-muted-foreground">
              Tie it to an active property, or give it a generic title.
            </p>
          </header>

          <section className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Active properties
            </label>
            <input
              type="search"
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by address or assignee…"
              className="h-8 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
            />
            <ul className="mt-1 max-h-56 overflow-y-auto rounded border border-border">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">
                  No matching active properties.
                </li>
              ) : (
                filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start({ propertySlug: p.slug })}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
                    >
                      <span className="font-medium">{p.address}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {STAGE_LABELS[p.stage] ?? p.stage}
                        {p.assignee && ` · ${p.assignee}`}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Or — generic draft (no property)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim().length > 0) start({ title });
                }}
                placeholder="e.g. Pricing exploration, Cabinet upgrade option"
                className="h-8 flex-1 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
              />
              <button
                type="button"
                onClick={() => start({ title })}
                disabled={pending || title.trim().length === 0}
                className="h-8 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Start
              </button>
            </div>
          </section>

          {error && (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
