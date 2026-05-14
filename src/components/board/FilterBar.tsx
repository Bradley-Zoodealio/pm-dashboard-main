"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ASSIGNEE_OPTIONS } from "@/lib/services/stages";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const current = params.get("assignee");

  function setAssignee(value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("assignee", value);
    else next.delete("assignee");
    startTransition(() => router.replace(`/?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs">
      <span className="mr-2 text-muted-foreground">Filter by:</span>
      <Chip label="All" active={!current} onClick={() => setAssignee(null)} />
      {ASSIGNEE_OPTIONS.map((name) => (
        <Chip
          key={name}
          label={name}
          active={current === name}
          onClick={() => setAssignee(name)}
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
