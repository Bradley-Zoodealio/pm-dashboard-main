import { findFilesForAddress, type DriveFileRow } from "@/lib/google/drive";
import type { PropertyRow } from "@/lib/db/properties";

function streetPart(address: string): string {
  return address.split(",")[0].trim();
}

function extractFileIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function templateIds(): string[] {
  return [
    process.env.DRIVE_TEMPLATE_FILE_ID,
    process.env.DRIVE_REMODEL_BID_TEMPLATE_FILE_ID,
    process.env.DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID,
  ].filter((x): x is string => !!x);
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
  const exclude = [
    ...templateIds(),
    ...[property.comps_url, property.remodel_bid_url, property.project_tracker_url]
      .map(extractFileIdFromUrl)
      .filter((x): x is string => !!x),
  ];

  let files: DriveFileRow[] = [];
  let error: string | null = null;
  try {
    files = await findFilesForAddress(streetPart(property.address), exclude);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Documents
      </h2>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No other Drive files match this address.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((f) => (
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
