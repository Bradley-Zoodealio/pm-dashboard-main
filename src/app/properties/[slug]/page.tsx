import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPropertyBySlug,
  listNotesForProperty,
  type PropertyRow,
} from "@/lib/db/properties";
import { labelFor } from "@/lib/services/stages";
import { InlineEditField } from "@/components/property/InlineEditField";
import { PropertyNotes } from "@/components/property/PropertyNotes";
import { DriveTemplateButtons } from "@/components/property/DriveTemplateButtons";
import { PropertyActivity } from "@/components/property/PropertyActivity";
import { PropertyDocuments } from "@/components/property/PropertyDocuments";
import { OfferScenarios } from "@/components/property/OfferScenarios";
import { PropertyDrafts } from "@/components/property/PropertyDrafts";
import { PropertyLifecycle } from "@/components/property/PropertyLifecycle";

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null): string {
  if (cents == null) return "";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function moneyInputValue(cents: number | null): string {
  if (cents == null) return "";
  return String(cents / 100);
}

// Renders an ISO timestamp from a timestamptz column as YYYY-MM-DD so the
// <input type="date"> can round-trip it. Uses local-tz components — matches
// how setAddendumSentAtAction interprets the date on the way in.
function ymdFromIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const property = await getPropertyBySlug(slug);
  if (!property) notFound();

  const notes = await listNotesForProperty(property.id);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Board
        </Link>
      </nav>

      <header className="sticky top-0 z-30 -mx-6 flex flex-col gap-1 border-b border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {labelFor(property.stage)}
        </div>
        <h1 className="text-2xl font-semibold leading-tight">
          <InlineEditField
            slug={property.slug}
            field="address"
            displayValue={property.address}
            inputValue={property.address}
          />
        </h1>
      </header>

      <PropertyFields property={property} />
      <OfferScenarios
        slug={property.slug}
        purchaseCents={property.purchase_cents}
        clrCents={property.clr_cents}
        reservePct={property.reserve_pct}
        arvCents={property.arv_cents}
        estRepairCents={property.est_repair_cents}
        revisedAsIs={{
          purchaseCents: property.revised_as_is_purchase_cents,
          clrCents: property.revised_as_is_clr_cents,
          reservePct: property.revised_as_is_reserve_pct,
        }}
        revisedRepaired={{
          purchaseCents: property.revised_repaired_purchase_cents,
          clrCents: property.revised_repaired_clr_cents,
          reservePct: property.revised_repaired_reserve_pct,
        }}
      />
      <DriveTemplateButtons
        slug={property.slug}
        stage={property.stage}
        comps_url={property.comps_url}
        remodel_bid_url={property.remodel_bid_url}
        project_tracker_url={property.project_tracker_url}
        accounting_address_folder_id={property.accounting_address_folder_id}
        renovation_folder_id={property.renovation_folder_id}
      />
      <PropertyDrafts propertyId={property.id} propertySlug={property.slug} />
      <PropertyLinks property={property} />
      <PropertyDocuments property={property} />
      <PropertyActivity
        inspectionThreadId={property.inspection_thread_id}
        addendumThreadId={property.addendum_thread_id}
        stage={property.stage}
      />
      <PropertyNotes slug={property.slug} notes={notes} />
      <PropertyLifecycle property={property} />
    </main>
  );
}

function PropertyFields({ property }: { property: PropertyRow }) {
  const fields: Array<{
    label: string;
    field: string;
    display: string;
    input: string;
    type?: "text" | "url" | "date";
    inputMode?: "text" | "numeric" | "decimal" | "url";
  }> = [
    {
      label: "Purchase",
      field: "purchase_cents",
      display: formatMoney(property.purchase_cents),
      input: moneyInputValue(property.purchase_cents),
      inputMode: "decimal",
    },
    {
      label: "CLR",
      field: "clr_cents",
      display: formatMoney(property.clr_cents),
      input: moneyInputValue(property.clr_cents),
      inputMode: "decimal",
    },
    {
      label: "Reserve",
      field: "reserve_pct",
      display: property.reserve_pct != null ? `${property.reserve_pct}%` : "",
      input: property.reserve_pct != null ? String(property.reserve_pct) : "",
      inputMode: "decimal",
    },
    {
      label: "Program fee",
      field: "program_fee_pct",
      display: property.program_fee_pct != null ? `${property.program_fee_pct}%` : "",
      input: property.program_fee_pct != null ? String(property.program_fee_pct) : "",
      inputMode: "decimal",
    },
    {
      label: "Resale fee",
      field: "resale_fee_pct",
      display: property.resale_fee_pct != null ? `${property.resale_fee_pct}%` : "",
      input: property.resale_fee_pct != null ? String(property.resale_fee_pct) : "",
      inputMode: "decimal",
    },
    {
      label: "Inspect date",
      field: "inspect_date",
      display: property.inspect_date ?? "",
      input: property.inspect_date ?? "",
      type: "date",
    },
    {
      label: "Addendum sent",
      field: "addendum_sent_at",
      display: ymdFromIso(property.addendum_sent_at),
      input: ymdFromIso(property.addendum_sent_at),
      type: "date",
    },
    {
      label: "Assignee",
      field: "assignee",
      display: property.assignee ?? "",
      input: property.assignee ?? "",
    },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Original Offer
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {fields.map((f) => (
          <div key={f.field} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd>
              <InlineEditField
                slug={property.slug}
                field={f.field}
                displayValue={f.display}
                inputValue={f.input}
                inputMode={f.inputMode}
                type={f.type}
                placeholder="—"
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PropertyLinks({ property }: { property: PropertyRow }) {
  // Project tracker lives in the Drive section above with the other
  // template buttons, so it's intentionally not in this list.
  const links: Array<{ label: string; field: string; url: string | null }> = [
    { label: "Inspection report", field: "inspect_url", url: property.inspect_url },
    { label: "Redfin", field: "redfin_url", url: property.redfin_url },
    { label: "CMA", field: "cma_url", url: property.cma_url },
    { label: "Comps sheet", field: "comps_url", url: property.comps_url },
    { label: "Questionnaire", field: "questionnaire_url", url: property.questionnaire_url },
    { label: "Remodel bid", field: "remodel_bid_url", url: property.remodel_bid_url },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Links
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <li key={l.field}>
            <LinkPill slug={property.slug} label={l.label} field={l.field} url={l.url} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkPill({
  slug,
  label,
  field,
  url,
}: {
  slug: string;
  label: string;
  field: string;
  url: string | null;
}) {
  if (!url) {
    // Empty slot: render the inline editor so a single click starts adding a URL.
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm">
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 text-muted-foreground">
          <InlineEditField
            slug={slug}
            field={field}
            displayValue=""
            inputValue=""
            type="url"
            inputMode="url"
            placeholder="add URL"
          />
        </span>
      </div>
    );
  }

  return (
    <div className="group flex items-center rounded-md border border-input bg-card transition-colors hover:border-primary/50 hover:bg-accent/40">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-1 items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">↗</span>
      </a>
      <div className="border-l border-border px-2 py-2 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <InlineEditField
          slug={slug}
          field={field}
          displayValue="edit"
          inputValue={url}
          type="url"
          inputMode="url"
          placeholder="—"
        />
      </div>
    </div>
  );
}

