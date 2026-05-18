"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ASSIGNEE_OPTIONS, EXEC_OPTIONS } from "@/lib/services/stages";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const currentAssignee = params.get("assignee");
  const currentExec = params.get("exec");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() =>
      router.replace(qs ? `/?${qs}` : "/", { scroll: false }),
    );
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 w-12 shrink-0 text-muted-foreground">PM:</span>
        <Chip
          label="All"
          active={!currentAssignee}
          onClick={() => setParam("assignee", null)}
        />
        {ASSIGNEE_OPTIONS.map((name) => (
          <Chip
            key={name}
            label={name}
            active={currentAssignee === name}
            onClick={() => setParam("assignee", name)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 w-12 shrink-0 text-muted-foreground">Exec:</span>
        <Chip
          label="All"
          active={!currentExec}
          onClick={() => setParam("exec", null)}
        />
        {EXEC_OPTIONS.map((name) => (
          <Chip
            key={name}
            label={name}
            active={currentExec === name}
            onClick={() => setParam("exec", name)}
          />
        ))}
      </div>
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
