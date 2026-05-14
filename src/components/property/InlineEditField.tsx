"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { updateFieldAction } from "@/lib/actions/properties";

interface Props {
  slug: string;
  field: string;
  displayValue: string;
  inputValue: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "url";
  type?: "text" | "url" | "date";
}

export function InlineEditField({
  slug,
  field,
  displayValue,
  inputValue,
  placeholder = "—",
  inputMode = "text",
  type = "text",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(inputValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(inputValue);
  }, [inputValue]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    if (value === inputValue) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateFieldAction(slug, field, value);
        setEditing(false);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function cancel() {
    setValue(inputValue);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left text-sm hover:underline disabled:opacity-50"
        disabled={isPending}
        aria-label={`Edit ${field}`}
      >
        {displayValue || <span className="text-muted-foreground">{placeholder}</span>}
        {isPending && <span className="ml-2 text-xs text-muted-foreground">saving…</span>}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        disabled={isPending}
        className="h-7 w-full min-w-0 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
