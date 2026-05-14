"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  scanGmailAction,
  applyGmailPlanAction,
} from "@/lib/actions/gmail-sync";
import type { PlanItem, ScanResult } from "@/lib/services/gmail-sync";
import { labelFor } from "@/lib/services/stages";

export function SyncButton() {
  const router = useRouter();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isScanning, scanTransition] = useTransition();
  const [isApplying, applyTransition] = useTransition();

  function runScan() {
    setError(null);
    scanTransition(async () => {
      try {
        const result = await scanGmailAction();
        setScan(result);
        setSelected(new Set(result.plan.map(itemKey)));
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function applySelected() {
    if (!scan) return;
    const items = scan.plan.filter((item) => selected.has(itemKey(item)));
    if (items.length === 0) return;
    setError(null);
    applyTransition(async () => {
      try {
        await applyGmailPlanAction(items);
        setScan(null);
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={runScan}
        disabled={isScanning}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
      >
        {isScanning ? "Scanning Gmail…" : "Sync Gmail"}
      </button>

      {scan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-lg bg-background p-6 shadow-xl">
            <header className="flex items-baseline justify-between">
              <div>
                <h2 className="text-lg font-semibold">Gmail Sync</h2>
                <p className="text-xs text-muted-foreground">
                  Scanned {scan.scannedThreads} inspection threads. Found {scan.plan.length}{" "}
                  proposed change{scan.plan.length === 1 ? "" : "s"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScan(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {scan.plan.length === 0 ? (
              <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                Nothing to do. Your board is in sync with Gmail.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 overflow-y-auto">
                {scan.plan.map((item) => {
                  const key = itemKey(item);
                  const isSelected = selected.has(key);
                  return (
                    <li
                      key={key}
                      className={`flex items-start gap-3 rounded border p-3 ${
                        isSelected ? "border-primary/40 bg-primary/5" : "border-border"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(key)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 text-sm">
                        <PlanItemRow item={item} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <div className="rounded border border-red-500/40 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            )}

            <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setScan(null)}
                className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Close
              </button>
              <button
                type="button"
                onClick={applySelected}
                disabled={isApplying || selected.size === 0}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {isApplying ? "Applying…" : `Apply ${selected.size} change${selected.size === 1 ? "" : "s"}`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function itemKey(item: PlanItem): string {
  return item.type === "add"
    ? `add:${item.threadId}`
    : `move:${item.slug}:${item.toStage}`;
}

function PlanItemRow({ item }: { item: PlanItem }) {
  if (item.type === "add") {
    return (
      <div>
        <div>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
            ADD
          </span>{" "}
          <span className="font-medium">{item.address}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          → {labelFor(item.toStage)}
          {item.note && <span className="ml-2">· {item.note}</span>}
        </div>
        <a
          href={`https://mail.google.com/mail/u/0/#all/${item.threadId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-primary hover:underline"
        >
          open thread ↗
        </a>
      </div>
    );
  }
  return (
    <div>
      <div>
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-950/60 dark:text-blue-200">
          MOVE
        </span>{" "}
        <span className="font-medium">{item.address}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {labelFor(item.fromStage)} → {labelFor(item.toStage)}
        <span className="ml-2">· {item.note}</span>
      </div>
      <a
        href={`https://mail.google.com/mail/u/0/#all/${item.threadId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-xs text-primary hover:underline"
      >
        open thread ↗
      </a>
    </div>
  );
}
