import {
  listPropertyDriveFiles,
  type DriveFileGroup,
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

  let groups: DriveFileGroup[] = [];
  let error: string | null = null;
  try {
    groups = await listPropertyDriveFiles(property.slug);
  } catch (err) {
    error = (err as Error).message;
  }

  // Filter out already-linked files from each group; drop empty groups whose
  // folder doesn't even exist yet (folderUrl === null AND files === []).
  const visibleGroups = groups
    .map((g) => ({ ...g, files: g.files.filter((f) => !linkedIds.has(f.id)) }))
    .filter((g) => g.folderUrl !== null || g.files.length > 0);

  const totalFiles = visibleGroups.reduce((n, g) => n + g.files.length, 0);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Documents
      </h2>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : totalFiles === 0 && visibleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Drive folders linked yet. Create a Comps Sheet, Remodel Bid, or
          Project Tracker above to start populating this section.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleGroups.map((g) => (
            <DriveGroup key={g.group} group={g} />
          ))}
        </div>
      )}
    </section>
  );
}

function DriveGroup({ group }: { group: DriveFileGroup }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {group.group}
        </span>
        {group.folderUrl ? (
          <a
            href={group.folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:underline"
          >
            Open folder ↗
          </a>
        ) : null}
      </div>
      {group.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {group.folderUrl ? "Empty." : "Not created yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {group.files.map((f) => (
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
    </div>
  );
}
