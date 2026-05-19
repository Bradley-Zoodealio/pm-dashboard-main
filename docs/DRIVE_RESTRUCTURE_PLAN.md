# Drive Restructure — Implementation Plan

> Companion to [`OAUTH_PIVOT_PLAN.md`](./OAUTH_PIVOT_PLAN.md). Read that first for the OAuth bootstrap pattern this plan extends. This doc supersedes the §2 "Drive root", "Property folder name", "Per-property subfolder", "Template location", "Cancellation", and "Closing" Drive-folder decisions of the OAuth pivot — the underlying OAuth/encryption/admin patterns are unchanged.

**Status:** locked 2026-05-18 grilling. PM team paperwork splits across two Drives: Accounting drive for company-wide artifacts (Comps + Remodel Bid), PM drive for internal renovation working files. Comps + Remodel Bid templates already moved to `accounting@`'s Drive under `Templates/`.

---

## 1. Why this restructure

Today every PM artifact lands in `pm@tradeinholdings.com`'s Drive at `Properties/<address>/Docs/`. That made sense when PM was the only audience. It no longer does — the rest of the company (Contracts, Accounting, Insurance) maintains its own per-property folder in the **Accounting drive** with the signed bid, addendum, and other deal paperwork. Two separate filing cabinets for the same property means hunting between them and uncertainty about which copy is canonical.

The restructure consolidates company-wide artifacts (Comps Report, Remodel Bid) into the Accounting drive folder that already exists for each property, and reserves the PM drive for renovation working files (Project Tracker + contractor docs + photos + receipts). Each Drive has one owner and one purpose.

## 2. Locked decisions (quick reference)

| Area | Decision |
|---|---|
| Accounting Drive account | New `tih-accounting` mailbox (`accounting@tradeinholdings.com`). Drive + Sheets scope. Standard OAuth bootstrap via `/admin/oauth`. |
| PM Drive account | Existing `tih-pm` mailbox, narrowed to renovation Drive ops only. |
| Accounting layout | `2026 Acquisition & Disposition Files/<address>/Acquisitions/PM Review/` — we create only `PM Review/`. Parent + `Acquisitions/` assumed pre-created by the deal team. |
| Comps + Bid location | Inside `PM Review/`. |
| PM layout | `Renovations/2026 Renovations/Active/<address>/` with 6 subfolders: Change Orders, Contractor Bid, Photos, Contractor Agreement, Hola Bid, Payment Receipts. |
| Project Tracker location | At the root of the `Active/<address>/` folder (sibling to the 6 subfolders). |
| Address matching | Fuzzy via `extractAddressTokens` (street number + first street word). One match → use silently. Zero or 2+ → URL-paste modal showing the attempted search terms. |
| PM Review creation | Lazy — on first "Create Comps Sheet" or "Create Remodel Bid" click. |
| Renovation parent creation | Lazy on Contract Work transition. Fuzzy-match first; create if missing using the property's `address` column verbatim. |
| 6 subfolders | All created defensively (`ensureFolder`) at the same moment as the renovation parent. Idempotent if any already exist. |
| Year resolution — Accounting | Search current year, fall back to previous year. No persisted year. |
| Year resolution — Renovation | Use current year on first creation. Once `renovation_folder_id` is stored, year is irrelevant. |
| Stage-driven folder moves | None. `moveFolderToBucket` deleted. Active → Completed is manual in Drive. |
| Documents tab source | PM Review files + renovation root + 6 subfolders, recursive, grouped by source folder. Excludes Accounting siblings (Acquisitions/Disposition/Insurance) — those are linked, not listed. |
| Cross-drive links | Two buttons on property page: "Open Accounting folder" (link to `<address>/`) and "Open Renovation folder" (link to `Active/<address>/`, hidden until folder exists). |
| Templates | Comps + Remodel Bid in `accounting@`'s Drive under `Templates/`. Project Tracker stays in `pm@`'s Drive. File IDs preserved (move, not copy). |
| Picker UX | URL-paste modal only. Modal displays system's attempted search terms for trust. |
| Migration | One-time manual `npm run` script. Surfaces a punch list of unmatched properties at the end. |

## 3. Pre-flight (manual steps before code starts)

### 3.1 Confirm templates are in place

In `accounting@tradeinholdings.com`'s Drive, confirm there's a `Templates/` folder at the root containing both the Comps template and the Remodel Bid template, with the file IDs unchanged from `DRIVE_TEMPLATE_FILE_ID` and `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID` in `.env.local`. If the templates were copied (not moved), IDs will have changed and the env vars need updating.

### 3.2 Confirm `accounting@` Drive layout

Verify the path exists exactly as: `2026 Acquisition & Disposition Files/<some property address>/Acquisitions/`. The migration script assumes both `2026 Acquisition & Disposition Files/` and `Acquisitions/` are present for every active property. If naming drifted (e.g. some folders titled `2026 A&D`), normalize manually before running the migration.

### 3.3 Confirm `pm@` Drive renovation layout

Confirm `Renovations/2026 Renovations/Active/` exists at the root of `pm@`'s My Drive. For each property currently in Contract Work, Ready for Listing, or beyond, confirm there's already a sibling folder under `Active/<address>/`. Mismatches go on the migration punch list.

### 3.4 What you do not need to do yet

- Don't OAuth `accounting@` yet — Task #1 sets up the bootstrap UX.
- Don't touch the existing `Properties/` folder in `pm@`'s Drive. Migration moves the active files; the empty parents can be archived manually later.

---

## 4. Task-by-task breakdown

### Task #1 — Mailbox catalog + bootstrap UX

**Scope:** Add `tih-accounting` to the mailbox catalog. Surface it on `/admin/oauth` so it can be authorized through the same flow as `pm@` and `contracts@`.

**Files:**
- `src/lib/google/mailboxes.ts` — add `tih-accounting` entry with `email: "accounting@tradeinholdings.com"`, `purposes: ["drive-operations"]`, `scopes: [DRIVE, SHEETS]`. Narrow `tih-pm` purpose to `["drive-operations"]` (unchanged in name, but document the new scope: renovation Drive only).
- `src/app/admin/oauth/page.tsx` — automatically picks up the new mailbox via `MAILBOX_KEYS`; verify the Connect button appears.
- `.env.local` documentation — no new env vars; the existing OAuth client supports all mailboxes.

**Verification:** Click Connect on `tih-accounting`, complete the OAuth round-trip, confirm an `oauth_accounts` row exists with `mailbox_key='tih-accounting'` and an encrypted refresh token.

### Task #2 — Schema migration

**Scope:** Drop `drive_folder_id`, add the three new folder ID columns.

**Files:**
- `supabase/migrations/<next>_drive_restructure.sql` —
  ```sql
  alter table properties
    drop column drive_folder_id,
    add column accounting_address_folder_id text,
    add column pm_review_folder_id text,
    add column renovation_folder_id text;
  ```
- `src/lib/db/properties.ts` — update `PropertyRow`, `PropertyField` types; remove `drive_folder_id` reads/writes; add the new fields to `updatePropertyField`'s union.

**Verification:** Migration applies clean on a Supabase reset. App boots. No code path references `drive_folder_id`.

### Task #3 — Drive helpers: accounting resolution

**Scope:** New helpers for finding/creating folders in the Accounting drive.

**Files:**
- `src/lib/google/drive.ts` —
  - `ensureAccountingAddressFolder(slug)`: returns the property's `<address>/` folder ID in the Accounting drive. First reads `accounting_address_folder_id` from the property row. If null: fuzzy-match using `extractAddressTokens` against the current year's `Acquisition & Disposition/` folder, then previous year. If exactly one match → persist + return. If 0 or 2+ → throw `AccountingFolderAmbiguous` with the attempted search terms and any candidates. Uses `getDriveClient("tih-accounting")` and `supportsAllDrives: false` (My Drive only).
  - `ensurePmReviewFolder(slug)`: resolves the accounting address folder, finds `Acquisitions/` inside (errors if missing — data error), ensures `PM Review/` inside that, persists `pm_review_folder_id`.
- `src/lib/google/mailboxes.ts` — `getDriveClient` already takes a `MailboxKey`; new helpers just pass `"tih-accounting"`.

**Verification:** Unit test or REPL script: pick an existing property, call `ensurePmReviewFolder`, confirm `PM Review/` appears under that property's `Acquisitions/` folder and the column updates.

### Task #4 — Drive helpers: renovation resolution

**Scope:** Match-or-create the renovation parent + ensure the 6 subfolders.

**Files:**
- `src/lib/google/drive.ts` —
  - `ensureRenovationFolder(slug)`: returns the renovation `Active/<address>/` folder ID. Read from row first. If null: walk `Renovations/<year> Renovations/Active/` (current year, then previous), fuzzy-match. One match → persist + return. Zero matches → create with the property's `address` column verbatim in the current year's `Active/`. 2+ → throw `RenovationFolderAmbiguous`. Then call `ensureRenovationSubfolders(folderId)`.
  - `ensureRenovationSubfolders(folderId)`: idempotent `ensureFolder` call for each of the six fixed names. Order in code: Change Orders, Contractor Bid, Photos, Contractor Agreement, Hola Bid, Payment Receipts (Drive will sort however the viewer has it set).

**Verification:** Move a test property to Contract Work, click "Create Project Tracker," confirm the Active folder + 6 subfolders + Project Tracker file all exist.

### Task #5 — Templating wiring

**Scope:** Point the existing template orchestration at the new locations and mailboxes.

**Files:**
- `src/lib/services/drive-templating.ts` —
  - `comps` and `remodel-bid` kinds: replace `ensurePropertyFolder` + `ensureDocsSubfolder` with `ensurePmReviewFolder`. Pass `mailbox: "tih-accounting"` to `copyTemplate`.
  - `project-tracker` kind: replace with `ensureRenovationFolder`. Mailbox stays `"tih-pm"`.
- `src/lib/google/drive.ts` — `copyTemplate` already accepts a mailbox arg; no signature change.

**Verification:** On a fresh property, click Create Comps → file lands in `accounting@:.../<address>/Acquisitions/PM Review/`. Click Create Remodel Bid → same folder. Click Create Project Tracker (after Contract Work) → file lands in `pm@:Renovations/2026 Renovations/Active/<address>/`.

### Task #6 — Documents tab + cross-drive links

**Scope:** Rebuild the Documents tab and add the two top-of-page link buttons.

**Files:**
- `src/lib/google/drive.ts` —
  - `listFilesInDocsFolder` → replaced by `listPropertyDriveFiles(slug)` which returns `{ group: string; files: DriveFileRow[] }[]`. Reads from PM Review (one folder via `tih-accounting`) + renovation root + 6 subfolders (seven folders via `tih-pm`). Calls fire in parallel. Folders that don't exist yet contribute an empty group.
- Property page component (likely `src/app/properties/[slug]/page.tsx` or its Documents section) — render groups as labeled sections. Two `<a>` buttons at the top: "Open Accounting folder" (visible whenever `accounting_address_folder_id` is set), "Open Renovation folder" (visible whenever `renovation_folder_id` is set).

**Verification:** On a Contract-Work property, the tab shows PM Review files in one section and renovation contents grouped by subfolder. Both top buttons link out to the correct Drive UIs.

### Task #7 — Delete `moveFolderToBucket`

**Scope:** Remove the now-dead stage-transition folder move.

**Files:**
- `src/lib/google/drive.ts` — delete `moveFolderToBucket` and its caller chain (likely in `property-lifecycle.ts`).
- `src/lib/services/property-lifecycle.ts` — remove the folder-move call from Cancelled/Closed transitions.

**Verification:** Cancel a test property, close another. Neither operation calls any Drive folder mutation; transitions still update the DB row.

### Task #8 — Picker fallback UX

**Scope:** Modal that fires when `AccountingFolderAmbiguous` or `RenovationFolderAmbiguous` is thrown. URL paste only.

**Files:**
- New component `src/components/drive-folder-picker.tsx` — modal with: error message, attempted search terms, paste field for Drive folder URL, submit button. On submit, extract folder ID from URL (`drive.google.com/drive/folders/<id>` pattern), POST to a new endpoint that validates the folder exists in the right mailbox and persists it to the right column.
- New endpoint `src/app/api/properties/[slug]/link-folder/route.ts` — accepts `{ kind: "accounting" | "renovation", folderId: string }`, validates with a single `drive.files.get`, writes to the corresponding column.
- Property page wiring: catch the ambiguous-folder errors from Create Comps / Create Project Tracker, open the picker pre-filled with the right `kind`.

**Verification:** Force an ambiguous match (e.g., point a property at an address with two similar accounting folders), see modal, paste a URL, confirm column is set and retry succeeds.

### Task #9 — One-time migration script

**Scope:** Walk every property in the `properties` table and move existing artifacts into the new structure.

**Files:**
- `scripts/migrate-drive-layout.ts` — for each property:
  1. Resolve `accounting_address_folder_id` via fuzzy match. Skip + report if 0 or 2+ matches.
  2. Ensure `PM Review/` exists under `Acquisitions/`.
  3. For each of `comps_url` and `remodel_bid_url`, extract the file ID, `drive.files.update` to remove the old parent and add `PM Review/` as the new parent. Persist `pm_review_folder_id`.
  4. If property stage is Contract Work or later: resolve `renovation_folder_id` via fuzzy match in `pm@`'s `Active/`. Skip + report if not found. Ensure 6 subfolders. Move `project_tracker_url`'s file in.
  5. Print a final report: `migrated=N, unmatched_accounting=[slugs], unmatched_renovation=[slugs]`.
- `package.json` — add `"migrate-drive": "tsx scripts/migrate-drive-layout.ts"`.

**Verification:** Dry-run mode (`--dry-run` flag) prints what would happen without writing. Real run on prod produces the expected report; punch list properties are resolved manually via the picker UX from Task #8.

### Task #10 — Cleanup pass

**Scope:** Remove legacy code paths that are now unreachable.

**Removed:**
- `listFilesInDocsFolder` — superseded by `listPropertyDriveFiles` in Task #6, no callers.
- `findFilesForAddress` — no callers; replaced years ago by `listFilesInDocsFolder` and now also by `listPropertyDriveFiles`.

**Kept (still has callers):**
- `ensurePropertyFolder`, `ensureDocsSubfolder`, `propertiesRootCache`, `docsFolderCache` — `src/lib/services/cma-copy.ts` still uses them. Removed when CMA migration follow-up rewires that path.
- `findTemplateCopiesForAddress` — used by `scripts/smoke-drive.ts` for dev-time Drive search.
- `listRemodelBidSheets` — used by `src/lib/services/bid-scraper.ts` for the PDF-first bid backfill.
- `findFileByNameInFolder` — used by templating dedup (Task #5).

**Deferred to CMA follow-up:**
- Drop `properties.drive_folder_id` column. Currently still read+written by `ensurePropertyFolder` (CMA path) and used as a heuristic in `gmail-sync.ts` for the CMA copy proposal.
- Remove the `drive_folder_id` field from `PropertyRow` and `PropertyInsert` types.

**Verification:** Type-check clean. App still boots end-to-end.

---

## 5. Open risks

- **Concurrent template creation.** Two users clicking "Create Comps" simultaneously on the same property can race past the `findFileByNameInFolder` dedup. Same risk exists today; not addressed here. Revisit with a per-property mutex if it becomes a real-world problem.
- **Accounting team folder renames.** If they rename `Acquisitions/` to something else, every property page errors on first Comps/Bid click. Mitigation: surface the error clearly ("Acquisitions/ not found under <address>/") so the user knows to fix the Accounting drive, not the dashboard.
- **Templates file IDs.** Pre-flight assumption that templates were moved (not copied) preserves IDs. If env vars need updating, do so during Task #5 before testing.
- **`bradley@` mailbox.** Still a placeholder with empty scopes. Unchanged by this plan.

## 6. Follow-up: CMA migration

The CMA copy path (`src/lib/services/cma-copy.ts` + the "copy-cma" plan items in `gmail-sync.ts`) still drops files into the legacy PM-drive `Properties/<addr>/Docs/` location. That folder is invisible to the new Documents tab — users see the CMA only via the `cma_url` button on the property row.

A future follow-up should:
1. Route CMA copies into PM Review (alongside Comps + Remodel Bid) by replacing `ensurePropertyFolder` + `ensureDocsSubfolder` with `ensurePmReviewFolder` in `cma-copy.ts`.
2. Update the gmail-sync heuristic that uses `!existingProp.drive_folder_id` as a "no copy yet" signal. Replace with a better check (e.g. `cma_url` not yet pointing at a Drive copy, or a dedicated `cma_copied_at` column).
3. Drop `properties.drive_folder_id` once the column has no readers.
4. Delete `ensurePropertyFolder`, `ensureDocsSubfolder`, and their caches from `drive.ts`.

## 7. Out of scope

- Cross-drive file mirroring (the company copy of the Remodel Bid lives only in Accounting; PM does not keep a duplicate).
- Surfacing Acquisitions / Disposition / Insurance contents in the Documents tab.
- Automated Active → Completed renovation folder moves.
- Year folder rollover automation (handled by search-current-then-previous, no scheduled task).
- An embedded Google Picker.
