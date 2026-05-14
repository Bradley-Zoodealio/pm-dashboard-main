"use client";

import { useState, useTransition } from "react";
import {
  addNoteAction,
  toggleNoteAction,
  deleteNoteAction,
} from "@/lib/actions/properties";
import type { PropertyNoteRow } from "@/lib/db/properties";

export function PropertyNotes({
  slug,
  notes,
}: {
  slug: string;
  notes: PropertyNoteRow[];
}) {
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      await addNoteAction(slug, text);
      setDraft("");
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Notes
      </h2>

      <ul className="mb-3 flex flex-col gap-2 text-sm">
        {notes.length === 0 && (
          <li className="text-muted-foreground">No notes yet.</li>
        )}
        {notes.map((n) => (
          <NoteRow key={n.id} slug={slug} note={n} />
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          disabled={isPending}
          className="h-8 flex-1 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <button
          type="submit"
          disabled={isPending || !draft.trim()}
          className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </form>
    </section>
  );
}

function NoteRow({ slug, note }: { slug: string; note: PropertyNoteRow }) {
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(note.checked);

  function toggle() {
    const next = !checked;
    setChecked(next);
    startTransition(async () => {
      try {
        await toggleNoteAction(slug, note.id, next);
      } catch {
        setChecked(!next);
      }
    });
  }

  function remove() {
    if (!confirm("Delete this note?")) return;
    startTransition(async () => {
      await deleteNoteAction(slug, note.id);
    });
  }

  return (
    <li className="group flex items-start gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="mt-0.5 select-none"
        aria-label={checked ? "Mark incomplete" : "Mark complete"}
      >
        {checked ? "☑" : "☐"}
      </button>
      <span className={`flex-1 ${checked ? "text-muted-foreground line-through" : ""}`}>
        {note.body}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={isPending}
        className="text-xs text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
        aria-label="Delete note"
      >
        ✕
      </button>
    </li>
  );
}
