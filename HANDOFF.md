# HANDOFF — start here

Written at the close of **21 Aug 2026**. This is the "what now" document;
`PROGRESS.md` is the full build log and `DECISIONS.md` is why things are the way
they are. Read this first, then **D65 through D70**.

---

## The one-paragraph version

**D65 applied** — `quantity` multiplies everywhere; activity charge is
$30,294.35. The retainer got modelled (**D66**) and then **loaded and reconciled
month by month against QuickBooks (D68)**: five months tie to the dollar, and
the reconciliation *predicted* Starr Rum's $900 before the operator supplied it.
Contractor base pay got its own shape (**D67**) — it belongs to the *person*,
not the brand, and is a **company** cost. The 21 "All Brands" rows were split
into 127, one per brand on retainer that month (**D69**), moving no money.
**The portal now shows $109,944 of revenue against $30,294 before today.** What
is still missing: nobody is on file as a contractor, so base pay is $0 in every
total, and the mileage/expenses ruling is not applied — **so the $92,203 margin
figure is still too high and must not be quoted.**

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and D65–D70 in `DECISIONS.md`.
>
> **1. Enter the contractors.** Nobody is on file, so base pay is $0 in every
> total and margin is overstated. I will give you names, base pay and cadence.
> Base pay is a COMPANY cost (D67) — it must not land in any per-brand margin.
>
> **2. The retainers are DONE and tie to the invoices** (D70) for every month
> Aug 2025 – Jul 2026. Do not "fix" the Aspen Green Feb–May 2026 gap: it is
> correct that it does not tie, because they paid by Zelle with no invoice.
> Only Jun/Jul 2025 (older than the PDF) and Aug 2026 (not yet invoiced) rest
> on assumption.
>
> **The unblock for line-by-line reconciliation is `Hubspot/Invoice_year.pdf`** —
> it carries the per-activity lines with quantity and rate that the QuickBooks
> connector blanks. `scratchpad/parse_invoices.py` already extracts them.
>
> **3. Then mileage and expenses.** Ruled 21 Aug and not yet applied: mileage
> EARNS and belongs in revenue with a cost behind it; itemised expenses are
> PASS-THROUGH at cost and must be excluded from revenue and margin entirely, or
> margin is inflated by money that was never ours. Work out where each currently
> lands and fix it.
>
> **4. Then reconcile, LINE BY LINE against the invoice lines** — not
> brand-month totals. Read the note below on the QuickBooks connector first,
> because it blanks the service lines and that is the blocker.
>
> **Do not touch the admin UI.** I said it is counterintuitive and I want to
> talk about it before anything moves.
>
> Standing rules that outrank convenience: the billing is the truth (D56), no
> hardcoded business data (D60), the brand portal stays read-only by
> construction (D61), cleanup happens in the staging zone rather than by
> overwriting (D64), and base pay is never allocated to a brand (D67).
>
> Before you finish: `python -m pytest test_normalize.py test_sync.py -q`,
> `bash db/test/run.sh`, `python verify_live.py`, and confirm the Dame Mas
> canary still ties on the admin's Health page.

---

## Run it

```bash
# the staff admin — analysis, cleanup, review, retainer, contractors
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Hubspot/portal_seed"
python -m streamlit run admin/app.py          # http://127.0.0.1:8501
```

**Launch it from `portal_seed/` and nowhere else** (D63). The admin has no
login; its access control is that it binds to loopback, and Streamlit resolves
`.streamlit/config.toml` against the *working directory*. From the wrong
directory that setting silently vanishes and the app publishes every brand's
rate card — and now every contractor's pay — to whatever network you are on.
`lib._require_loopback()` refuses to render if that happens, but do not rely on
being saved by it.

```bash
# the public site + brand portal
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Website/ihospitality-website_3_3_26/ihospitality"
python -m http.server 8123                    # portal at /portal/login.html
```

---

## Where things stand

**Committed, both repos clean.**

| repo | branch | latest |
|---|---|---|
| website (`…/ihospitality/`) | `portal-v1` | `7970255` — 11 commits unpushed (vs `origin/portal-v1`) |
| `Hubspot/portal_seed/` | `main` | `f0cba62` — local only, no remote by design |

**Verified at close:** 73 pytest pass · offline schema/RLS/staging/**retainer**
suite passes, all six retainer guards fired · 0 grants to `anon`, 0 write grants
to `authenticated` (29 SELECT grants, up from 22) · **1,190 activities** (1,084
before the All Brands split) · revenue **$109,944** = $30,294 activity +
$79,650 retainer · admin
boots headless on loopback and every query on the two new pages runs against
live · Dame Mas canary unchanged — Apr +$0.01 (D48), May/Jun/Jul tying exactly,
Jan–Mar the known hole.

---

## What changed on 21 Aug

**D65 applied.** 209 rate-card lines flipped to `per_unit` (not 211 — two are
pure-percent and the view tests `charge_pct` first), and
`coalesce(a.quantity, 0)` became `coalesce(a.quantity, 1)` on both branches of
`v_activity_money`. **Schema first, data second**, because a coalesce of 1
changes nothing while `per_unit` is still false; the reverse order would have
opened the $1,065 hole for as long as it took to run the second command. Charge
$24,754.35 → **$30,294.35**, tying to D65's prediction to the cent.

**Cost moves too, which D65 did not carry.** Contractors are paid per case as
well: cost $13,851.18 → **$17,741.18**, so margin moved **+$1,650**, not
+$5,540. Dame Mas is the row that teaches it — charge untouched (percent basis),
cost up $175. Percent on one side does not mean percent on both.

**The defaults flipped too**, operator-ruled: the `per_unit` column now defaults
to `true` and the admin checkbox is pre-checked. Every rate-bearing line is
per_unit now, so a new line starting unchecked would have reproduced the exact
bug being fixed, invisibly. D62's lesson, third application.

**D66 — the retainer has a table.** `brand_retainer`, effective-dated, inclusive
at both ends, with an exclusion constraint that refuses overlapping periods.
`v_brand_retainer_month` expands it, `v_brand_month_revenue` FULL joins it to
activity money. Dame Mas seeded at $750/mo from Jul 2025, still running:
margin **−$253.43 → +$10,246.57**.

**D67 — contractor base pay is a company cost.** `contractors` +
`contractor_pay`, effective-dated, four cadences. Deliberately kept out of
per-brand margin; it lands in `v_month_business` instead.

---

## Open work, most useful first

1. **Enter the contractors.** Nobody is on file, so base pay is $0 in every
   total and every margin figure is overstated.
2. **Chase Heaven's Door — $16,361.08 outstanding**, invoices 3099, 3106, 3111,
   3114, 3119 (work months Mar–Jul 2025, none paid). Operator flagged it as a
   live problem; the portal had no idea.
3. **Mileage earns, expenses pass through** (D67). Ruled, not applied.
4. **Reconcile line by line** against invoice lines — blocked, see below.
5. **Load `invoice_recap` from QuickBooks, not the spreadsheets.** It currently
   holds ONE brand and seven months. The workbooks are a lossy copy: Aug 2025
   commission typed `375.75` where the invoice bills `354.75`, June 2026
   expenses $158 over, Oct 2025 $125 over, and a $455 Dame Mas tasting invoice
   (3203) in neither the workbook nor the portal.
6. **Widen the Health canary.** `lib.canary()` compares only
   `invoice_recap.commission` — it reports months tying while ignoring
   consulting, billable, subtotal and total, i.e. most of the invoice.
7. **Run the sync for real.** Never run with the staging code. Use `--month` on
   a single month first and watch the review queue.
8. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. Fix in HubSpot (D59); the sync carries it through on
   its own because the row is not hand-edited. **This matters more since D65** —
   quantity now multiplies, so that row bills six times over.
9. **17 duplicate venue clusters**, including Meg O'Malley's twice.
10. **Ten months of Dame Mas billing nothing.** Jun 2025 – Mar 2026 show $0
    activity charge against real contractor cost ($50, $50, $100, $50, $25).
    Wider than the "Jan–Mar 2026" hole previously recorded.
11. **The admin UI** — the operator called it *counterintuitive* and asked that
    **nothing be moved until it is discussed**.
12. **Phase 3 proper**, password reset for brand logins (D18), deleting the two
    test logins, and merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **NEVER SAVE A PDF INTO THE WEBSITE REPO.** Its root IS the Netlify publish
  directory, so a committed PDF is served at `ihospitality.vip/<name>`. Twelve
  months of client invoices were briefly sitting there untracked on 21 Aug.
  `*.pdf` is gitignored now; the invoices live at `Hubspot/Invoice_year.pdf`.
- **THE QUICKBOOKS CONNECTOR BLANKS INVOICE SERVICE LINES**, but the invoice
  PDFs do not (D70) — use them. This is not a query problem. A $3,503 Five
  Trail invoice comes back as **four empty line objects and a subtotal** — in a
  single-invoice fetch by document number as much as in a bulk one. Invoice
  *totals* are complete and correct (93 invoices summing to $194,414, matching
  the sales-by-customer report per customer). Expense reimbursements and a few
  item-based lines do come through. Dame Mas's `Sales:Retainer` lines are the
  one service line that survives, which is the only reason its retainer could be
  evidenced. **Do not spend a session re-discovering this.** Get the detail by
  exporting *Sales by Product/Service Detail* from QuickBooks instead.
- **Billed in arrears.** The invoice naming a work month is issued the month
  after. `ACTIVITY DATE` on every invoice states the work month explicitly, so
  the lag needs no inference — and `invoice_recap.month` is already on the
  work-month basis, so **do not shift it again**.
- **Scope starts June 2025**, where the HubSpot data starts. Earlier QuickBooks
  history the operator archives manually.
- **The portal still shows a fraction of the business.** QuickBooks, Jan 2025 –
  Aug 2026: **$194,231** across 11 customers. Do not quote a portal revenue
  figure to anyone until items 1–5 are done.
- **Five Trail and Barmen Bourbon are ONE QuickBooks customer** and two brands
  here. Ruled 21 Aug: attribute the whole retainer to one brand, tolerable
  *specifically because they are no longer a customer*, so nobody will compare
  those two. **Gin Lane 1751 ($6,661) is not in the portal at all.**
- **Base pay is never allocated to a brand** (D67). If you find yourself
  dividing it across brands, stop — that allocation is not agreed.
- **A constraint that has never fired looks exactly like one that works (D62).**
  Applied three times now: the sync's overwrite, the Venues `%` bug, and the
  `per_unit` default. The retainer and contractor tables' guards are fired on
  purpose in `db/test/03_retainer_test.sql`.
- **Local Postgres is not Supabase, in both directions (D6, D64).** `btree_gist`
  and the exclusion constraints were verified live, not assumed.
- **`market` is deliberately unused.** All venues carry NULL on purpose.

---

## Not yet tested by anything automatic

- The landing loop in `sync_hubspot.py.apply()`.
- The sync against live HubSpot with the staging code. This is the real first
  test.
- The Retainer and Contractors pages were **queried** against live and the app
  **boots**, but the forms were not clicked through — no retainer has been added
  through the UI, only through SQL.
- The first real sync will likely re-promote the 1,066 backfilled rows as state
  `auto`. Expected and harmless — none are hand-edited.
