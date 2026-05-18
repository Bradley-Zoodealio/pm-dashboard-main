import {
  cancelPropertyAction,
  closePropertyAction,
  restoreFromTerminalAction,
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
  return <ActiveDestructiveSection property={property} />;
}

function ActiveDestructiveSection({ property }: { property: PropertyRow }) {
  const showCloseButton = property.stage === "ready-for-listing";
  const closeAction = closePropertyAction.bind(null, property.slug);

  return (
    <section className="rounded-lg border border-rose-500/30 bg-rose-50/30 p-4 dark:bg-rose-950/10">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">
        Lifecycle
      </h2>

      {showCloseButton ? (
        <form action={closeAction} className="mb-4 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
          >
            Mark Closed
          </button>
          <span className="text-xs text-muted-foreground">
            Moves the Drive folder to <code>Properties/Closed/</code>. Auto-cron
            does this after 2 days in Ready for Listing.
          </span>
        </form>
      ) : null}

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
