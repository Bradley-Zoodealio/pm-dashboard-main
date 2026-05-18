import { listOAuthAccounts, type OAuthAccountRow } from "@/lib/db/oauth-accounts";
import { MAILBOXES, MAILBOX_KEYS, type MailboxKey } from "@/lib/google/mailboxes";

import { revokeMailbox } from "./actions";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

export default async function OAuthAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  let accounts: OAuthAccountRow[] = [];
  let listError: string | null = null;
  try {
    accounts = await listOAuthAccounts();
  } catch (err) {
    listError = (err as Error).message;
  }
  const byKey = new Map(accounts.map((a) => [a.mailbox_key, a]));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">OAuth Bootstrap</h1>
        <p className="text-sm text-muted-foreground">
          Connect each Google mailbox the app needs to act as. Tokens are
          AES-256-GCM encrypted at rest using <code>OAUTH_TOKEN_ENCRYPTION_KEY</code>
          {" "}and never logged.
        </p>
      </header>

      {connected ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
          Connected mailbox: <code>{connected}</code>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
          {error}
        </div>
      ) : null}
      {listError ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          Could not read oauth_accounts: {listError}
        </div>
      ) : null}

      <ul className="space-y-3">
        {MAILBOX_KEYS.map((key) => {
          const mb = MAILBOXES[key];
          const row = byKey.get(key);
          const deferred = mb.scopes.length === 0;
          const status = deferred
            ? "deferred"
            : !row
            ? "not-connected"
            : row.revoked_at
            ? "revoked"
            : "connected";

          return (
            <li
              key={key}
              className="flex items-start justify-between gap-4 rounded-md border p-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mb.label}</span>
                  <code className="text-xs text-muted-foreground">{key}</code>
                  <StatusBadge status={status} />
                </div>
                <div className="text-sm text-muted-foreground">{mb.email}</div>
                <div className="space-x-3 text-xs text-muted-foreground">
                  {row?.granted_at ? (
                    <span>granted {formatDate(row.granted_at)}</span>
                  ) : null}
                  {row?.last_used_at ? (
                    <span>· last used {formatDate(row.last_used_at)}</span>
                  ) : null}
                  {row?.revoked_at ? (
                    <span className="text-rose-600">
                      · revoked {formatDate(row.revoked_at)}
                    </span>
                  ) : null}
                </div>
                {row?.last_error ? (
                  <div className="text-xs text-rose-600">
                    last error: {row.last_error}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  scopes:{" "}
                  {mb.scopes.length === 0
                    ? "—"
                    : mb.scopes.map((s) => s.split("/").pop()).join(", ")}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!deferred ? (
                  <a
                    href={`/api/oauth/start?mailbox=${key}`}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    {row && !row.revoked_at ? "Reconnect" : "Connect"}
                  </a>
                ) : null}
                {row && !row.revoked_at ? (
                  <RevokeForm mailbox={key} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t pt-4 text-xs text-muted-foreground">
        Health check:{" "}
        <code>
          curl -H &quot;Authorization: Bearer $CRON_SECRET&quot;{" "}
          /api/admin/oauth-verify
        </code>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "connected"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "deferred"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function RevokeForm({ mailbox }: { mailbox: MailboxKey }) {
  const action = async () => {
    "use server";
    await revokeMailbox(mailbox);
  };
  return (
    <form action={action}>
      <button
        type="submit"
        className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
      >
        Revoke
      </button>
    </form>
  );
}
