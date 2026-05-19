"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ASSIGNEE_OPTIONS, EXEC_OPTIONS } from "@/lib/services/stages";

type FilterDim = "pm" | "exec";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const currentAssignee = params.get("assignee");
  const currentExec = params.get("exec");

  // Default dimension follows whichever filter is currently set, so a
  // ?exec=Kala URL opens on the Exec tab.
  const [dim, setDim] = useState<FilterDim>(() =>
    currentExec && !currentAssignee ? "exec" : "pm",
  );

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() =>
      router.replace(qs ? `/?${qs}` : "/", { scroll: false }),
    );
  }

  const options = dim === "pm" ? ASSIGNEE_OPTIONS : EXEC_OPTIONS;
  const paramKey = dim === "pm" ? "assignee" : "exec";
  const currentValue = dim === "pm" ? currentAssignee : currentExec;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs">
      <span className="mr-2 text-muted-foreground">Filter by:</span>
      <DimChip label="PM" active={dim === "pm"} onClick={() => setDim("pm")} />
      <DimChip label="Exec" active={dim === "exec"} onClick={() => setDim("exec")} />
      <div className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
      <Chip
        label="All"
        active={!currentValue}
        onClick={() => setParam(paramKey, null)}
      />
      {options.map((name) => (
        <Chip
          key={name}
          label={name}
          active={currentValue === name}
          onClick={() => setParam(paramKey, name)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "border border-border text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

// Dimension selector — same chip footprint but uses a subtle outline +
// primary-tinted active state so it reads as a different control category
// from the value chips on the right.
function DimChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
