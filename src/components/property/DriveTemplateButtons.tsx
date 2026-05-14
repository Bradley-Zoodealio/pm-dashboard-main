"use client";

import { useState, useTransition } from "react";
import {
  createCompsAction,
  createRemodelBidAction,
  createProjectTrackerAction,
} from "@/lib/actions/drive";
import type { EnsureResult } from "@/lib/services/drive-templating";
import { FillBidFromJson } from "./FillBidFromJson";

type TemplateAction = (slug: string) => Promise<EnsureResult>;

interface ButtonSpec {
  label: string;
  action: TemplateAction;
  existingUrl: string | null;
  showInStage?: (stage: string) => boolean;
}

export function DriveTemplateButtons({
  slug,
  stage,
  comps_url,
  remodel_bid_url,
  project_tracker_url,
}: {
  slug: string;
  stage: string;
  comps_url: string | null;
  remodel_bid_url: string | null;
  project_tracker_url: string | null;
}) {
  const buttons: ButtonSpec[] = [
    { label: "Comps Sheet", action: createCompsAction, existingUrl: comps_url },
    { label: "Remodel Bid", action: createRemodelBidAction, existingUrl: remodel_bid_url },
    {
      label: "Project Tracker",
      action: createProjectTrackerAction,
      existingUrl: project_tracker_url,
      showInStage: (s) => s === "contract-work",
    },
  ];

  const visible = buttons.filter((b) => !b.showInStage || b.showInStage(stage));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Drive
      </h2>
      <div className="flex flex-wrap gap-2">
        {visible.map((b) => (
          <TemplateButton key={b.label} slug={slug} spec={b} />
        ))}
      </div>
      <div className="mt-3">
        <FillBidFromJson slug={slug} remodelBidUrl={remodel_bid_url} />
      </div>
    </section>
  );
}

function TemplateButton({ slug, spec }: { slug: string; spec: ButtonSpec }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<EnsureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing = result?.url ?? spec.existingUrl;

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await spec.action(slug);
        setResult(r);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  if (existing) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={existing}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Open {spec.label} ↗
        </a>
        <button
          type="button"
          onClick={trigger}
          disabled={isPending}
          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
          title="Re-run: check for an existing copy in Drive or create a new one"
        >
          {isPending ? "Checking…" : "Refresh link"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={trigger}
        disabled={isPending}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
      >
        {isPending ? `Creating ${spec.label}…` : `Create ${spec.label}`}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
