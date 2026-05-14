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

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null): string {
  if (cents == null) return "";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function moneyInputValue(cents: number | null): string {
  if (cents == null) return "";
  return String(cents / 100);
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

      <header className="flex flex-col gap-1">
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
        purchaseCents={property.purchase_cents}
        clrCents={property.clr_cents}
        reservePct={property.reserve_pct}
        arvCents={property.arv_cents}
        estRepairCents={property.est_repair_cents}
      />
      <DriveTemplateButtons
        slug={property.slug}
        stage={property.stage}
        comps_url={property.comps_url}
        remodel_bid_url={property.remodel_bid_url}
        project_tracker_url={property.project_tracker_url}
      />
      <PropertyLinks property={property} />
      <PropertyDocuments property={property} />
      <PropertyActivity questionnaireUrl={property.questionnaire_url} />
      <PropertyNotes slug={property.slug} notes={notes} />
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
      label: "Inspect date",
      field: "inspect_date",
      display: property.inspect_date ?? "",
      input: property.inspect_date ?? "",
      type: "date",
    },
    {
      label: "Assignee",
      field: "assignee",
      display: property.assignee ?? "",
      input: property.assignee ?? "",
    },
    {
      label: "ARV",
      field: "arv_cents",
      display: formatMoney(property.arv_cents),
      input: moneyInputValue(property.arv_cents),
      inputMode: "decimal",
    },
    {
      label: "Est. repair",
      field: "est_repair_cents",
      display: formatMoney(property.est_repair_cents),
      input: moneyInputValue(property.est_repair_cents),
      inputMode: "decimal",
    },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Fields
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
  const links: Array<{ label: string; field: string; url: string | null }> = [
    { label: "Inspection report", field: "inspect_url", url: property.inspect_url },
    { label: "Redfin", field: "redfin_url", url: property.redfin_url },
    { label: "CMA", field: "cma_url", url: property.cma_url },
    { label: "Comps sheet", field: "comps_url", url: property.comps_url },
    { label: "Questionnaire", field: "questionnaire_url", url: property.questionnaire_url },
    { label: "Remodel bid", field: "remodel_bid_url", url: property.remodel_bid_url },
    { label: "Project tracker", field: "project_tracker_url", url: property.project_tracker_url },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Links
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {links.map((l) => (
          <div key={l.field} className="contents">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="flex items-center gap-2">
              {l.url && (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  open ↗
                </a>
              )}
              <InlineEditField
                slug={property.slug}
                field={l.field}
                displayValue={l.url ?? ""}
                inputValue={l.url ?? ""}
                type="url"
                inputMode="url"
                placeholder="add URL"
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

