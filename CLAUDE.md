@AGENTS.md

# Memory

## Me

Bradley Meyer (bradley@zoodealio.com) — **Property Project Manager** at **Zoodealio**. On the Offers & PM team alongside **Ethan**, **Colton**, and **Chris**. Team triages inspection reports from Trade In Holdings, decides who takes each property, and the assigned PM owns it end-to-end.

## People

| Who | Role |
|-----|------|
| **Kala** | Kala Laos — Cofounder/CEO, Zoodealio. Runs Offers & PM team meetings. |
| **Ethan** | ethan@zoodealio.com — Property Project Manager (PM team peer); admin on Zoodealio's Claude/Anthropic workspace |
| **Eliot** | eliot@zoodealio.com — leadership; previously coordinated #utilities posting with Kei |
| **Jason** | jason@zoodealio.com — works with Colton on contractor disputes (Morning Dove) |
| **Colton** | colton@zoodealio.com — Property Project Manager (PM team peer); built filters for the Inspection Tracker; handles contractor issues |
| **Chris** | chris@zoodealio.com — Property Project Manager (PM team peer) |
| **Christina** | christina@zoodealio.com — on Offers & PM email distribution |
| **Joseph** | Joseph Molinar — Trade In Holdings; flag inspection issues to him asap. Address: 1760 E Pecos Rd #501, Gilbert AZ 85295 |
| **Rachel** | rachel@zoodealio.com — Contracts team (with Joseph); adopting new Claude workflows |
| **Kei** | kei@jkalltheway.com — posts in #utilities Slack channel when properties close |
| **Keilyn** | keilyn@tradeinholdings.com — Trade In Holdings, on Offers Recap distribution |
| **Luis** | Luis Chavez — Zoodealio; raised pool question on $2M+ home in #offerstatus |
| **Carlos** | Receives GHL trigger emails on closings (alongside Joseph and Kyan) |
| **Kyan** | kyan@zoodealio.com — receives GHL closing notifications |
| **Tushar** | tushar@zoodealio.com — active in Slack alongside Luis |
| **Jakob** | jakob@zoodealio.com — sent Brad a DM about Zoom invitation |

## Terms

| Term | Meaning |
|------|---------|
| **Trade In Holdings** | Sister/partner contracts entity (contracts@tradeinholdings.com); handles deal contracts and inspection reports |
| **PM team** | Offers & Project Management — Bradley's team |
| **GHL** | Go High Level (CRM) — triggers automated emails on property closings (going to Joseph, Carlos, Kyan) |
| **#utilities** | Slack channel where Kei posts each property closing |
| **#offerstatus** | Slack channel for active offer discussion |
| **Inspection Tracker** | Internal tool; Colton added filters so leadership can see inspections ready for review |
| **Inspection Approval Request** | Formal approval workflow Contracts sends after inspection |
| **Cash+ Agreement** | Lower-tier offer: lower purchase price, smaller program fee, **CLR = $0** (no renovation budget). Seller takes more cash, no renovation expected. |
| **Cash+ with Repairs Agreement / ARV** | Higher-tier offer: higher purchase price reflecting post-renovation value, higher program fee, **CLR > 0** to fund renovations. Same overall workflow as Cash+. The offers team **always presents both tiers** in the original offer; the seller picks one. |
| **ARV** | After Repair Value — the projected resale value of the property after renovation. Drives the higher tier's purchase price. |
| **DOM** | Days on Market — high DOM is a price-justification signal (e.g., "$151k offer due to high DOM & Tax") |
| **Program Fee / Resale Fee / Reserve / Credit** | Standard line items on Trade In Holdings property deals |
| **Reserve** | % of home equity held back from the seller's initial payout to cover **holding costs** (taxes, insurance, utilities, surprise repairs) while Zoodealio owns/renovates. **NOT a renovation budget** — that's CLR. |
| **CLR** | Credit in Lieu of Repairs — the **renovation budget** for the property. Funds the Remodel Bid. Can start at $0 (Cash+) and be raised via addendum after inspection if the bid scope requires it. When the addendum goes out with a new CLR, update the `clr` field in TASKS.md — the property then goes through Contract Work rather than skipping it. |
| **Title** | Step between Addendum Sent and Contract Work — Trade In Holdings runs lien checks / title clearance / closing prep. PM team is hands-off during this period. |
| **Comps** | Comparable homes (pulled from Redfin) used to gauge pricing and market tendencies |
| **Remodel Bid** | Renovation bid sized to fit a CLR. Can also propose a higher CLR when the inspection reveals more scope than the current credit covers; the addendum carries the new CLR figure. |
| **Project Tracker** | Spreadsheet created at the start of Contract Work to coordinate the renovation. Template at Drive ID `1BJlhiWeyy2htJoUQdKsGwuWTI7v9UmkgPQGN67xEyeY`. Created via the **Create Project Tracker** button on the property page (only appears in the Contract Work stage). |
| **arv** | After Repair Value field on TASKS.md property — used by the Offer Scenarios calculator on the property page to project 2nd payout / total proceeds. Persisted via `PUT /api/properties/[slug]/field`. |
| **est_repair** | Estimated repair cost field on TASKS.md property — typically the Remodel Bid grand total. Used as a reference in Offer Scenarios. Persisted via the same field endpoint. |

## Projects

Active properties live in [TASKS.md](TASKS.md) — that's the source of truth read by the dashboard. Below is a quick reference for context that's not captured in TASKS.md (codenamed renovations, ongoing issues, etc.).

| Name | What |
|------|------|
| **3122 W Treeline Dr** | Tucson AZ, $330k, hoarder house. CLR ask raised from $70k → $88,700 via addendum to cover roof + HVAC replacement. Option 1 ($83k) and Option 2 ($94k) both in the Remodel Bid sheet. |
| **8834 Judwin St** | Houston TX, $151k, accepted Cash+ at $0 CLR. ARV tier on original offer was $247k / $69.5k CLR — that's the addendum pivot target. Bid is $59.5k including HVAC, water heater, exterior fixes, mech + remodel scope. |
| **5010 Redbud St** | Houston TX — Cash+ with Repairs; inspection delayed (power was off). |
| **Bridal** | Renovation in progress; final walk videos received, need review |
| **Cosden** | Renovation; final walk pending; possible mix-up with Piney Ridge |
| **Piney Ridge** | Renovation; status uncertain |
| **Morning Dove** | Contractor siding dispute (work billed from a different property); Colton + Jason resolving |

## Preferences

- Property-level decisions documented in inspection report email replies (CC the team)
- Send inspection issues (no power, missed rooms) to Joseph asap
- Be specific on bid line items (e.g., "stainless dishwasher, range, microwave" — never "Appliance Package")
- Never include refrigerators on installed appliance lists (per Kala's recap)
- **Bid line item wording**: match the convention from existing bids (7472 Silver Cir is the best reference for full scope). Examples: "Install Modern Shaker-Style Vanity in Bathrooms 1 and 2", "Install Quartz Kitchen Counters with a Single Basin Sink", "Demo Ceiling Panels + Install Drywall Ceiling Where Panel Ceiling Exists". Lighter-tier wording: "Recaulk Tubs and Install Shower Bar" (vs new tub+shower combo), "Install Microwave and Range" (vs full SS package), "Prep and Paint Kitchen Cabinets" (vs new cabinets).
- **Footer items** on the Remodel Bid template are filled manually below the line items: Final clean **$800**, Rekey Home + Install Combo Lockbox **$350**, 30 Day Per Diem for Remodel **$3,100** (or $3,600 — confirm per deal), GC Management Fee Included (no value).
- **Pricing formulas** for paint and LVP flooring are saved at [memory/feedback_remodel_bid_pricing.md](memory/feedback_remodel_bid_pricing.md) — use these directly, don't scale from old bids.

## Workflow: After Receiving an Inspection Report

See [memory/context/inspection-workflow.md](memory/context/inspection-workflow.md) for the full process. Summary:

1. **Receive** inspection report (forwarded from Trade In Holdings contracts) — email lists offer details (purchase, fees, reserve, CLR, EOI, closing).
2. **Assign** — team decides who takes the property.
3. **Quick once-over + agent call** — scan report, call listing agent.
4. **Deep inspection review** — line-by-line read of the report (often 100+ pages).
5. **Pull Redfin comps** in the comps sheet (template at Drive ID `1M_DNYKLSpzHASUuw9_cyeSYFuuI6fnBDPVUeI_iFG2k`).
6. **Build the Remodel Bid** in the bid template (Drive ID `10-lhSUj4IIwjfQWaUv4RdgP_26KVSeoBg78DV-ffOtY`). If the inspection requires more scope than the CLR covers, propose a CLR raise via addendum (Cash+ with Repairs case) or convert the deal to Cash+ with Repairs by adopting the ARV tier (Cash+ case — see [memory/feedback_offer_types.md](memory/feedback_offer_types.md)).
7. **Submit Remodel Bid email** to Contracts + leadership (reply in-thread to the original inspection email). This moves the property to **Exec Final Review**. Email format documented in [memory/feedback_remodel_bid_email.md](memory/feedback_remodel_bid_email.md).
8. **Exec approves** → Contracts sends **Addendum** to listing agent. Property moves to **Addendum Sent**.
9. **Agent signs** → deal goes to **Title** (Trade In Holdings runs title clearance). PM team is hands-off.
10. **Closing trigger**: Joseph posts in Slack: *"We are officially closed on \<address\>, please work to have the reno started shortly..."* — PM moves property to **Contract Work** and clicks **Create Project Tracker from Template** (template at Drive ID `1BJlhiWeyy2htJoUQdKsGwuWTI7v9UmkgPQGN67xEyeY`).
11. **Renovation** per the approved Remodel Bid. When done, property moves to **Ready for Listing**.

## Dashboard tools available

The PPM Dashboard at `localhost:3001` has the following automation wired up. Most operations write back to TASKS.md so this is a closed loop with the markdown that lives in the repo.

| Tool | What it does |
|---|---|
| **Gmail Sync (header button)** | Scans the last 30 days of `from:contracts@tradeinholdings.com subject:"Inspection Report Ready"` and proposes: (a) adding new properties to Inspection Received, (b) promoting properties to Exec Final Review when a qualifying Remodel Bid email exists in the thread. Shows a diff modal; user approves before any writes. |
| **Create Comps Sheet from Template** (property page) | Copies the Comps template, renames to `Comps/Inspection Report - <address>`. Checks Drive first for an existing copy and reuses if found. |
| **Create Remodel Bid from Template** (property page) | Same pattern — copies template, renames to `Remodel Bid - <address>`. |
| **Fill from JSON** (property page, only when Remodel Bid exists) | Paste a JSON array of `{description, total}` line items; the dashboard writes them directly to the bid sheet at B19:H58 (descriptions in B, totals in H). Multi-tab support: pass `tab` parameter to write to specific Option 1 / Option 2 tabs. |
| **Create Project Tracker from Template** (property page, only in Contract Work stage) | Copies the Project Tracker template, renames to `Project Tracker - <address>`. |
| **Offer Scenarios** (property page section) | Two-payout calculator. Inputs: ARV + est repair cost (persisted to TASKS.md), plus session-level fee assumptions. Renders AS IS vs Repaired side-by-side showing 1st payout (at closing) + 2nd payout (after resale) + total to seller, with a delta callout. |
| **Documents** (property page section) | Auto-listed Drive files matching the property's street address. Excludes templates and already-linked sheets. Uses `findFilesForAddress` in `lib/google-drive.ts`. |
| **Activity** (property page section) | Chronological timeline of the property's Gmail thread events (initial inspection, replies, remodel bid sent, addendum signed, closing confirmed) + TASKS.md sub-notes. Uses `getThreadActivity` in `lib/gmail.ts`. |
| **Gmail Sync v2 (header button)** | Now also detects: signed-addendum emails (from e-sign platforms or Contracts replies) → propose Exec Final Review → Addendum Sent; and closing-confirmed emails ("officially closed", "clear to close") → propose Addendum Sent → Contract Work with lockbox combo/location captured if present. |
| **Inspection Reports/** folder | Drop PDF inspection reports here for Claude to read with `pypdf`. Already gitignored. |

The "Remodel Bid email" can be drafted via chat: tell Claude "draft the Remodel Bid email for \<property\>" and it'll pull from the comps sheet and bid sheet to generate the in-thread reply (recipients, format, comps notes, Reserve section with AS IS / Repaired columns).

## Dev infrastructure (for future sessions)

The dashboard is a Next.js 14 App Router app at `/Users/bradleymeyer/Desktop/cowork/PPMDashboard`. Some session-saving notes:

- **Dev server runs on port 3001** — `PORT=3001 npm run dev`. Most curl tests use `http://localhost:3001/`.
- **Google OAuth** — Drive + Gmail scopes already authorized. Refresh token persisted to `.google-token.json` (gitignored). `.env.local` has `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, plus three template file IDs (`DRIVE_TEMPLATE_FILE_ID` for comps, `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID`, `DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID`).
- **PDF inspection reports** — drop in `Inspection Reports/` (gitignored). Read with `python3 -c "import pypdf; r = pypdf.PdfReader(path); ..."`. `pypdf` is already installed.
- **TASKS.md** — single-file source of truth. Each property is a single line with `key: value | key: value | ...` fields. The `slug` is implicit from `slugify(address)`.
- **Sheets API** — covered by the `drive` OAuth scope. Helpers in [lib/sheets.ts](lib/sheets.ts). Multi-tab support is built — pass `tab` param to the `/lines` endpoint. Line items go in column **B** (descriptions) and column **H** (totals), starting at row **19**.

## Memory map

| File | What |
|---|---|
| [memory/MEMORY.md](memory/MEMORY.md) | Index of all memory files |
| [memory/feedback_offer_financials.md](memory/feedback_offer_financials.md) | Reserve vs CLR — common mistake to avoid |
| [memory/feedback_offer_types.md](memory/feedback_offer_types.md) | Cash+ vs ARV tiers; addendum can convert between them |
| [memory/feedback_remodel_bid_pricing.md](memory/feedback_remodel_bid_pricing.md) | Paint/flooring per-sqft formulas |
| [memory/feedback_remodel_bid_email.md](memory/feedback_remodel_bid_email.md) | How to draft the Remodel Bid email from a comps sheet |
| [memory/context/inspection-workflow.md](memory/context/inspection-workflow.md) | Full Inspection Received → Ready for Listing workflow |
| [memory/glossary.md](memory/glossary.md) | All terms (ARV, DOM, CLR, etc.) |

## Open questions

- Other key people I haven't mapped yet (full names/roles): Tori, Austin, Jeremy, Noah, Tyler, Crystal, Jake, Keith, Marketing@?
- "Trade In Holdings" vs "Zoodealio" — same parent or separate companies sharing deals?
