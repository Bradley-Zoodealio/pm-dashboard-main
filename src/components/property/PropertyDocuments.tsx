import {
  ensurePropertyFolder,
  listFilesInDocsFolder,
  type DriveFileRow,
} from "@/lib/google/drive";
import type { PropertyRow } from "@/lib/db/properties";

function extractFileIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function mimeLabel(mime: string): string {
  if (mime.includes("spreadsheet")) return "Sheet";
  if (mime.includes("document")) return "Doc";
  if (mime.includes("presentation")) return "Slides";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("folder")) return "Folder";
  return mime.split("/").pop() ?? "File";
}

export async function PropertyDocuments({ property }: { property: PropertyRow }) {
  // Files explicitly linked on the property row don't need to appear in the
  // Documents list — they're already surfaced in the dedicated buttons above.
  const linkedIds = new Set(
    [property.comps_url, property.remodel_bid_url, property.project_tracker_url, property.cma_url]
      .map(extractFileIdFromUrl)
      .filter((x): x is string => !!x),
  );

  let folderId = property.drive_folder_id;
  let files: DriveFileRow[] = [];
  let error: string | null = null;
  try {
    // Lazy creation: if the property has never had a Drive op, this creates
    // Properties/<address>/ now so the Documents list has a stable home.
    if (!folderId) folderId = await ensurePropertyFolder(property.slug);
    files = await listFilesInDocsFolder(folderId);
  } catch (err) {
    error = (err as Error).message;
  }

  const visible = files.filter((f) => !linkedIds.has(f.id));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Documents
      </h2>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No additional files in this property&apos;s Drive folder yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {visible.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3">
              <a
                href={f.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-primary hover:underline"
              >
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {mimeLabel(f.mimeType)} ·{" "}
                {f.modifiedTime
                  ? new Date(f.modifiedTime).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
