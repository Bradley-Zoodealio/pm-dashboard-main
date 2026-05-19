export type MailboxKey = "bradley" | "tih-contracts" | "tih-pm" | "tih-accounting";

export type MailboxPurpose =
  | "inspection-reports"
  | "status-updates"
  | "personal-thread"
  | "bid-attachments"
  | "drive-operations";

export interface Mailbox {
  email: string;
  label: string;
  purposes: ReadonlyArray<MailboxPurpose>;
  scopes: ReadonlyArray<string>;
}

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE = "https://www.googleapis.com/auth/drive";
const SHEETS = "https://www.googleapis.com/auth/spreadsheets";

// OAuth pivot: scopes are authorized at consent-screen time, per account, and
// recorded in oauth_accounts.scopes. No more Workspace Admin DWD step.
// `bradley` is a placeholder for the future personal-email login + Gmail write
// use case — left in the catalog but with empty scopes (not bootstrapped in v1).
export const MAILBOXES: Record<MailboxKey, Mailbox> = {
  bradley: {
    email: "bradley@zoodealio.com",
    label: "Bradley",
    purposes: ["personal-thread"],
    scopes: [],
  },
  "tih-contracts": {
    email: "contracts@tradeinholdings.com",
    label: "TIH Contracts",
    purposes: ["inspection-reports", "status-updates", "bid-attachments"],
    scopes: [GMAIL_READONLY],
  },
  "tih-pm": {
    email: "pm@tradeinholdings.com",
    label: "TIH PM",
    purposes: ["drive-operations"],
    scopes: [DRIVE, SHEETS],
  },
  "tih-accounting": {
    email: "accounting@tradeinholdings.com",
    label: "TIH Accounting",
    purposes: ["drive-operations"],
    scopes: [DRIVE, SHEETS],
  },
};

export const MAILBOX_KEYS = Object.keys(MAILBOXES) as MailboxKey[];

export function mailboxesWithPurpose(purpose: MailboxPurpose): MailboxKey[] {
  return MAILBOX_KEYS.filter((key) => MAILBOXES[key].purposes.includes(purpose));
}
