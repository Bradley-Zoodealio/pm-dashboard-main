"use client";

import { useState, useTransition } from "react";
import { updateFieldAction } from "@/lib/actions/properties";

interface Props {
  slug: string;
  field: "assignee" | "exec_reviewer";
  value: string | null;
  options: readonly string[];
  size?: "sm" | "md";
  ariaLabel?: string;
}

// First option in `options` is the "unset" sentinel (e.g. "Unassigned") and
// maps to an empty string on save so the column becomes null.
export function PersonPicker({
  slug,
  field,
  value,
  options,
  size = "md",
  ariaLabel,
}: Props) {
  const unsetValue = options[0];
  const [current, setCurrent] = useState<string>(value ?? unsetValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const previous = current;
    setCurrent(next);
    setError(null);
    const raw = next === unsetValue ? "" : next;
    startTransition(async () => {
      try {
        await updateFieldAction(slug, field, raw);
      } catch (err) {
        setCurrent(previous);
        setError((err as Error).message);
      }
    });
  }

  function stop(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  const sizing =
    size === "sm" ? "h-6 px-1 text-xs" : "h-7 px-2 text-sm";

  return (
    <span className="inline-flex items-center gap-1" onClick={stop}>
      <select
        value={current}
        onChange={onChange}
        onClick={stop}
        onPointerDown={stop}
        onMouseDown={stop}
        onKeyDown={stop}
        disabled={isPending}
        aria-label={ariaLabel ?? field}
        className={`rounded border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 ${sizing}`}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {isPending && (
        <span className="text-[10px] text-muted-foreground">saving…</span>
      )}
      {error && (
        <span className="text-[10px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </span>
  );
}
