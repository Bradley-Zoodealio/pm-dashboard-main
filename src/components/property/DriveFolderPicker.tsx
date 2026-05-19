"use client";

import { useState, type FormEvent } from "react";
import type { AddressTokens, FolderCandidate } from "@/lib/google/drive";

export interface DriveFolderPickerProps {
  slug: string;
  folderKind: "accounting" | "renovation";
  address: string;
  candidates: FolderCandidate[];
  searchedYears: number[];
  searchedTokens: AddressTokens;
  onLinked: () => void;
  onCancel: () => void;
}

function extractFolderId(url: string): string | null {
  const trimmed = url.trim();
  // Accept either a full Drive URL or a bare folder ID.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function DriveFolderPicker({
  slug,
  folderKind,
  address,
  candidates,
  searchedYears,
  searchedTokens,
  onLinked,
  onCancel,
}: DriveFolderPickerProps) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = folderKind === "accounting" ? "Accounting" : "Renovation";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const folderId = extractFolderId(url);
    if (!folderId) {
      setError("Couldn't parse a Drive folder URL or ID from that input.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/properties/${slug}/link-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: folderKind, folderId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Link failed (HTTP ${res.status})`);
      }
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg">
        <h3 className="text-base font-semibold">Link {label} folder</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Couldn&apos;t auto-match a {label.toLowerCase()} folder for &ldquo;{address}&rdquo;.
          Paste the URL of the correct folder in Google Drive.
        </p>

        <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
          <div className="font-medium uppercase tracking-wide text-muted-foreground">
            Searched
          </div>
          <div className="mt-1 text-muted-foreground">
            Years:{" "}
            {searchedYears.length === 0
              ? "—"
              : searchedYears.join(", ")}
            <br />
            Tokens: number=<code>{searchedTokens.number ?? "—"}</code>, primary=
            <code>{searchedTokens.primary ?? "—"}</code>
          </div>
          {candidates.length > 0 && (
            <>
              <div className="mt-2 font-medium uppercase tracking-wide text-muted-foreground">
                Candidates ({candidates.length})
              </div>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {candidates.map((c) => (
                  <li key={c.id}>
                    {c.webViewLink ? (
                      <a
                        href={c.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {c.name}
                      </a>
                    ) : (
                      <span>{c.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="drive-folder-url">
            Folder URL
          </label>
          <input
            id="drive-folder-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            disabled={pending}
            autoFocus
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Linking…" : "Link folder & retry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
