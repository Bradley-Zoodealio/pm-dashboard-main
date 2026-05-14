export type MailboxKey = "bradley" | "tih-contracts" | "tih-pm";

export type MailboxPurpose =
  | "inspection-reports"
  | "status-updates"
  | "personal-thread"
  | "bid-attachments";

export type MailboxDomain = "zoodealio.com" | "tradeinholdings.com";

export interface Mailbox {
  email: string;
  label: string;
  domain: MailboxDomain;
  purposes: ReadonlyArray<MailboxPurpose>;
}

export const MAILBOXES: Record<MailboxKey, Mailbox> = {
  bradley: {
    email: "bradley@zoodealio.com",
    label: "Bradley",
    domain: "zoodealio.com",
    purposes: ["personal-thread"],
  },
  "tih-contracts": {
    email: "contracts@tradeinholdings.com",
    label: "TIH Contracts",
    domain: "tradeinholdings.com",
    purposes: ["inspection-reports", "status-updates", "bid-attachments"],
  },
  "tih-pm": {
    email: "pm@tradeinholdings.com",
    label: "TIH PM",
    domain: "tradeinholdings.com",
    purposes: ["status-updates"],
  },
};

export const MAILBOX_KEYS = Object.keys(MAILBOXES) as MailboxKey[];

export function mailboxesWithPurpose(purpose: MailboxPurpose): MailboxKey[] {
  return MAILBOX_KEYS.filter((key) => MAILBOXES[key].purposes.includes(purpose));
}
