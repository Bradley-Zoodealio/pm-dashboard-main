"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  startTransition,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { PropertyCard } from "./PropertyCard";
import { Board } from "./Board";
import { STAGES, type StageId, isStageId } from "@/lib/services/stages";
import type { PropertyRow } from "@/lib/db/properties";
import { moveStageAction } from "@/lib/actions/properties";

type Patch = { id: string; stage: StageId };

export function BoardDnd({ properties }: { properties: PropertyRow[] }) {
  // dnd-kit assigns sequential IDs to its accessibility announcer; the counter
  // diverges between SSR and the first client render, which trips React's
  // hydration check. Render the static Board on SSR + first paint, then swap
  // to the DnD version after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [activeId, setActiveId] = useState<string | null>(null);

  const [optimistic, applyPatch] = useOptimistic(properties, (state, patch: Patch) =>
    state.map((p) => (p.id === patch.id ? { ...p, stage: patch.stage } : p)),
  );

  const byStage = useMemo(() => {
    const map = new Map<string, PropertyRow[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const p of optimistic) {
      const bucket = map.get(p.stage);
      if (bucket) bucket.push(p);
      else map.set(p.stage, [p]);
    }
    return map;
  }, [optimistic]);

  const activeCard = useMemo(
    () => optimistic.find((p) => p.id === activeId) ?? null,
    [optimistic, activeId],
  );

  if (!mounted) {
    return <Board properties={properties} />;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const targetStage = String(over.id);
    if (!isStageId(targetStage)) return;

    const property = optimistic.find((p) => p.id === active.id);
    if (!property) return;
    if (property.stage === targetStage) return;

    startTransition(() => {
      applyPatch({ id: property.id, stage: targetStage });
      void moveStageAction(property.slug, targetStage);
    });
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {STAGES.map((stage) => {
          const items = byStage.get(stage.id) ?? [];
          return (
            <DroppableColumn key={stage.id} stageId={stage.id} label={stage.label} count={items.length}>
              {items.map((p) => (
                <DraggableCard key={p.id} property={p} />
              ))}
            </DroppableColumn>
          );
        })}
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="rotate-1 opacity-90">
            <PropertyCard property={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({
  stageId,
  label,
  count,
  children,
}: {
  stageId: StageId;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <section
      ref={setNodeRef}
      data-stage={stageId}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border p-2 shadow-sm transition-colors ${
        isOver ? "bg-accent/15 ring-2 ring-accent" : "bg-card"
      }`}
    >
      <header className="flex items-center justify-between rounded-md bg-[color:var(--brand-blue-tint)] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-blue)]">
        <span>{label}</span>
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
          {count}
        </span>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function DraggableCard({ property }: { property: PropertyRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: property.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-none ${isDragging ? "opacity-30" : ""}`}
    >
      <PropertyCard property={property} />
    </div>
  );
}
