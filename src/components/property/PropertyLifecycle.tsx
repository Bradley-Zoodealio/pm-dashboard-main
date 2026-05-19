import {
  cancelPropertyAction,
  closePropertyAction,
  markRenovationCompleteAction,
  restoreFromTerminalAction,
  undoRenovationCompleteAction,
} from "@/lib/actions/property-lifecycle";
import { STAGES, isTerminalStage } from "@/lib/services/stages";
import type { PropertyRow } from "@/lib/db/properties";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

export function PropertyLifecycle({ property }: { property: PropertyRow }) {
  if (isTerminalStage(property.stage)) {
    return <TerminalRestoreSection property={property} />;
  }
  return <ActiveLifecycleSection property={property} />;
}

function ActiveLifecycleSection({ property }: { property: PropertyRow }) {
  const inContractWork = property.stage === "contract-work";
  const isComplete = !!property.renovation_completed_at;
  const closeAction = closePropertyAction.bind(null, property.slug);

  return (
    <>
      {inContractWork && !isComplete ? (
        <RenovationCompleteForm slug={property.slug} />
      ) : null}

      {isComplete ? (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-50/40 p-4 dark:bg-emerald-950/15">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Renovation Complete
          </h2>
          <div className="mb-3 text-xs text-muted-foreground">
            Marked complete {formatDate(property.renovation_completed_at) ?? "(no timestamp)"}.
            Card auto-hides from the board after 24h; auto-close cron closes
            the property after 2 days.
          </div>
          {property.renovation_complete_note ? (
            <div className="mb-3 rounded-md border bg-card px-3 py-2 text-sm">
              {property.renovation_complete_note}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <form action={closeAction}>
              <button
                type="submit"
                className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
              >
                Mark Closed now
              </button>
            </form>
            <form action={undoRenovationCompleteAction}>
              <input type="hidden" name="slug" value={property.slug} />
              <button
                type="submit"
                className="rounded-md border border-input bg-card px-3 py-1.5 text-sm hover:bg-accent"
                title="Clear the completion timestamp and note; card returns to standard Contract Work tint"
              >
                Undo renovation complete
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-rose-500/30 bg-rose-50/30 p-4 dark:bg-rose-950/10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">
          Lifecycle
        </h2>

        <form action={cancelPropertyAction} className="space-y-2">
          <input type="hidden" name="slug" value={property.slug} />
          <label className="block text-xs text-muted-foreground" htmlFor="reason">
            Cancel this property — what happened? (required, min 5 chars)
          </label>
          <textarea
            id="reason"
            name="reason"
            required
            minLength={5}
            rows={2}
            placeholder="Seller backed out, inspection killed it, exec rejected, etc."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-rose-500/40 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/50"
          >
            Cancel Property
          </button>
        </form>
      </section>
    </>
  );
}

function RenovationCompleteForm({ slug }: { slug: string }) {
  return (
    <section className="rounded-lg border border-emerald-500/30 bg-emerald-50/40 p-4 dark:bg-emerald-950/15">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        Renovation Complete
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Flags this property as renovation-complete. Card stays in Contract
        Work with a darker emerald tint, then hides from the board 24h later.
        Auto-close cron closes the property after 2 days.
      </p>
      <form action={markRenovationCompleteAction} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <label className="block text-xs text-muted-foreground" htmlFor="note">
          Completion note (required, min 5 chars)
        </label>
        <textarea
          id="note"
          name="note"
          required
          minLength={5}
          rows={2}
          placeholder="Final walk passed, photos uploaded, lockbox combo 1234, ready for agent…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
        >
          Mark Renovation Complete
        </button>
      </form>
    </section>
  );
}

function TerminalRestoreSection({ property }: { property: PropertyRow }) {
  const isCancelled = property.stage === "cancelled";

  return (
    <section className="rounded-lg border border-border bg-muted/30 p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {isCancelled ? "Cancelled" : "Closed"}
      </h2>
      <div className="mb-3 space-y-1 text-sm">
        {isCancelled ? (
          <>
            <div className="text-xs text-muted-foreground">
              Cancelled {formatDate(property.cancelled_at) ?? "(no timestamp)"}
            </div>
            {property.cancelled_reason ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {property.cancelled_reason}
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            Closed {formatDate(property.closed_at) ?? "(no timestamp)"}
          </div>
        )}
      </div>

      <form action={restoreFromTerminalAction} className="flex items-center gap-2">
        <input type="hidden" name="slug" value={property.slug} />
        <label htmlFor="newStage" className="text-xs text-muted-foreground">
          Restore to:
        </label>
        <select
          id="newStage"
          name="newStage"
          defaultValue="inspection-under-review"
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
        >
          Restore
        </button>
      </form>
    </section>
  );
}
