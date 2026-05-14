"use client";

import { useState } from "react";
import { BoardDnd } from "./BoardDnd";
import { ListView } from "./ListView";
import { CalendarView } from "./CalendarView";
import type { PropertyRow } from "@/lib/db/properties";

type View = "board" | "list" | "calendar";

export function ViewSwitcher({ properties }: { properties: PropertyRow[] }) {
  const [view, setView] = useState<View>("board");
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        {(["board", "list", "calendar"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
              view === v
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {view === "board" && <BoardDnd properties={properties} />}
        {view === "list" && <ListView properties={properties} />}
        {view === "calendar" && <CalendarView properties={properties} />}
      </div>
    </>
  );
}
