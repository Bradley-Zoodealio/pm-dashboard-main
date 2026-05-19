import { NextResponse } from "next/server";
import { z } from "zod";

import { getDriveClient } from "@/lib/google/auth";
import {
  getPropertyBySlug,
  updatePropertyField,
} from "@/lib/db/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOLDER_MIME = "application/vnd.google-apps.folder";

const bodySchema = z.object({
  kind: z.enum(["accounting", "renovation"]),
  folderId: z.string().min(10).max(200),
});

// Picker-fallback endpoint: when the address fuzzy-match in Task #3 / #4
// can't disambiguate, the client modal POSTs the user-chosen folder here.
// We validate the folder exists in the right Drive, then persist its ID
// to the matching column on the property row.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const property = await getPropertyBySlug(slug);
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { kind, folderId } = parsed.data;
  const mailbox = kind === "accounting" ? "tih-accounting" : "tih-pm";

  try {
    const drive = await getDriveClient(mailbox);
    const { data } = await drive.files.get({
      fileId: folderId,
      fields: "id, mimeType, trashed",
    });
    if (data.trashed) {
      return NextResponse.json({ error: "Folder is in trash" }, { status: 400 });
    }
    if (data.mimeType !== FOLDER_MIME) {
      return NextResponse.json(
        { error: "URL does not point to a folder" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      {
        error: `Folder not found or not accessible by ${mailbox}. Check the URL and that the folder is shared with the right account.`,
      },
      { status: 404 },
    );
  }

  const field =
    kind === "accounting" ? "accounting_address_folder_id" : "renovation_folder_id";
  await updatePropertyField(slug, field, folderId);

  return NextResponse.json({ ok: true });
}
