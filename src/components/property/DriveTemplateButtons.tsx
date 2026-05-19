"use client";

import { useState, useTransition } from "react";
import {
  createCompsAction,
  createRemodelBidAction,
  createProjectTrackerAction,
} from "@/lib/actions/drive";
import type { TemplateActionResult } from "@/lib/actions/drive";
import type { EnsureResult } from "@/lib/services/drive-templating";
import type { AddressTokens, FolderCandidate } from "@/lib/google/drive";
import { DriveFolderPicker } from "./DriveFolderPicker";
import { FillBidFromJson } from "./FillBidFromJson";

type TemplateAction = (slug: string) => Promise<TemplateActionResult>;

interface ButtonSpec {
  label: string;
  action: TemplateAction;
  existingUrl: string | null;
}

interface PickerState {
  folderKind: "accounting" | "renovation";
  address: string;
  candidates: FolderCandidate[];
  searchedYears: number[];
  searchedTokens: AddressTokens;
}

function folderUrl(folderId: string | null): string | null {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;
}

export function DriveTemplateButtons({
  slug,
  comps_url,
  remodel_bid_url,
  project_tracker_url,
  accounting_address_folder_id,
  renovation_folder_id,
}: {
  slug: string;
  comps_url: string | null;
  remodel_bid_url: string | null;
  project_tracker_url: string | null;
  accounting_address_folder_id: string | null;
  renovation_folder_id: string | null;
}) {
  const buttons: ButtonSpec[] = [
    { label: "Comps Sheet", action: createCompsAction, existingUrl: comps_url },
    { label: "Remodel Bid", action: createRemodelBidAction, existingUrl: remodel_bid_url },
    { label: "Project Tracker", action: createProjectTrackerAction, existingUrl: project_tracker_url },
  ];

  const accountingUrl = folderUrl(accounting_address_folder_id);
  const renovationUrl = folderUrl(renovation_folder_id);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Drive
      </h2>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <TemplateButton key={b.label} slug={slug} spec={b} />
        ))}
      </div>
      {(accountingUrl || renovationUrl) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {accountingUrl && (
            <a
              href={accountingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Open Accounting folder ↗
            </a>
          )}
          {renovationUrl && (
            <a
              href={renovationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Open Renovation folder ↗
            </a>
          )}
        </div>
      )}
      {remodel_bid_url && (
        <div className="mt-3">
          <FillBidFromJson slug={slug} remodelBidUrl={remodel_bid_url} />
        </div>
      )}
    </section>
  );
}

function TemplateButton({ slug, spec }: { slug: string; spec: ButtonSpec }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<EnsureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);

  const existing = result?.url ?? spec.existingUrl;

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await spec.action(slug);
        if (r.ok) {
          setResult(r.result);
        } else if (r.needsPicker) {
          setPicker({
            folderKind: r.folderKind,
            address: r.address,
            candidates: r.candidates,
            searchedYears: r.searchedYears,
            searchedTokens: r.searchedTokens,
          });
        }
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function onPickerLinked() {
    setPicker(null);
    // Retry the original action now that the folder is linked.
    trigger();
  }

  return (
    <>
      {existing ? (
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
      ) : (
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
      )}

      {picker && (
        <DriveFolderPicker
          slug={slug}
          folderKind={picker.folderKind}
          address={picker.address}
          candidates={picker.candidates}
          searchedYears={picker.searchedYears}
          searchedTokens={picker.searchedTokens}
          onLinked={onPickerLinked}
          onCancel={() => setPicker(null)}
        />
      )}
    </>
  );
}
