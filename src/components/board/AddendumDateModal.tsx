"use client";

import { useEffect, useState } from "react";

function todayYmd(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function AddendumDateModal({
  address,
  onConfirm,
  onCancel,
}: {
  address: string;
  onConfirm: (yyyyMmDd: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState<string>(() => todayYmd());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onConfirm(date);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h2 className="text-sm font-semibold">Addendum sent</h2>
        <p className="mt-1 text-xs text-muted-foreground">{address}</p>
        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          Date sent
          <input
            autoFocus
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Starts the 5-day window. Gmail sync overrides this with the real
          send instant once it detects the outbound thread.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}
