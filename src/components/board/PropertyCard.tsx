import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { PropertyRow } from "@/lib/db/properties";
import { showCountdown } from "@/lib/services/stages";
import {
  TINT_STYLES,
  daysUntil,
  formatInspectDate,
  tintForProperty,
} from "@/lib/services/property-tint";
import { PersonPicker } from "./PersonPicker";
import {
  ASSIGNEE_OPTIONS,
  EXEC_OPTIONS,
  isExecReviewStage,
} from "@/lib/services/stages";

function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function PropertyCard({ property }: { property: PropertyRow }) {
  const countdown = showCountdown(property.stage) ? daysUntil(property.inspect_date) : null;
  const tint =
    TINT_STYLES[
      tintForProperty(
        property.stage,
        property.inspect_date,
        property.renovation_completed_at,
      )
    ];

  return (
    <Card
      size="sm"
      className={`relative overflow-hidden transition-all hover:-translate-y-px hover:shadow-md hover:ring-1 hover:ring-primary/30 ${tint.bg} before:absolute before:inset-y-0 before:left-0 before:w-1 ${tint.beforeStripe}`}
    >
      <CardContent className="flex flex-col gap-2 pl-4">
        <div className="font-medium leading-snug text-foreground">
          <Link
            href={`/properties/${property.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {property.address}
          </Link>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Purchase</dt>
          <dd className="text-right text-foreground">{formatMoney(property.purchase_cents)}</dd>
          <dt>CLR</dt>
          <dd className="text-right text-foreground">{formatMoney(property.clr_cents)}</dd>
          <dt>Reserve</dt>
          <dd className="text-right text-foreground">
            {property.reserve_pct != null ? `${property.reserve_pct}%` : "—"}
          </dd>
          <dt>Assignee</dt>
          <dd className="relative z-10 text-right text-foreground">
            <PersonPicker
              slug={property.slug}
              field="assignee"
              value={property.assignee}
              options={ASSIGNEE_OPTIONS}
              size="sm"
              ariaLabel="Assignee"
            />
          </dd>
          {isExecReviewStage(property.stage) && (
            <>
              <dt>Exec</dt>
              <dd className="relative z-10 text-right text-foreground">
                <PersonPicker
                  slug={property.slug}
                  field="exec_reviewer"
                  value={property.exec_reviewer}
                  options={EXEC_OPTIONS}
                  size="sm"
                  ariaLabel="Exec reviewer"
                />
              </dd>
            </>
          )}
          {countdown !== null && (
            <>
              <dt>Inspect</dt>
              <dd className="text-right">
                <span className="text-foreground">{formatInspectDate(property.inspect_date)}</span>
                <span className={`ml-1 font-medium ${tint.label}`}>
                  ({countdown >= 0
                    ? countdown === 0
                      ? "today"
                      : `in ${countdown}d`
                    : `${-countdown}d ago`})
                </span>
              </dd>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
