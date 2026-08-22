# HANDOFF — start here

Written at the close of **21 Aug 2026**. This is the "what now" document;
`PROGRESS.md` is the full build log and `DECISIONS.md` is why things are the way
they are. Read this first, then **D65 through D77**.

---

## The one-paragraph version

The portal went from modelling roughly a tenth of the business to reconciling
against the actual invoices. **D65** made `quantity` multiply everywhere.
**D66–D71** gave the retainer its own table, loaded it from the invoice PDFs and
reconciled it to **zero** — $71,125 on file against $71,125 invoiced. **D72–D73**
did the same line by line for activity, which found that Aspen Green's missing
cases had never been in HubSpot at all, and backfilled 65 rows from the invoices.
**D74–D77** rebuilt the admin around the monthly workflow. Revenue is now
**$116,752** against $24,754 that morning. **The margin figure is still too
high** — nobody is on file as a contractor, and the mileage/expenses ruling is
not applied.

---

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and D65–D77 in `DECISIONS.md`.
>
> **1. Enter the contractors.** Nobody is on file, so base pay is $0 in every
> total and every margin figure is overstated. I am entering these myself — pay
> runs on the 1st and the 15th, semimonthly, 24 a year. Base pay is a COMPANY
> cost (D67); it must never land in a per-brand margin.
>
> **2. Mileage earns, expenses pass through.** Ruled 21 Aug, still not applied.
> Mileage belongs in revenue with a cost behind it; itemised expenses are
> reimbursements at cost and must be out of revenue and margin entirely, or
> margin is inflated by money that was never ours. Work out where each lands
> today and fix it.
>
> **3. The portal holds MORE than the invoices in two places, and that is the
> dangerous direction — making them agree means DELETING logged work.** Account
> visits run 257 over (partly D69's own All Brands split, which multiplies one
> visit across brands while an invoice bills it once) and `1st case sale` runs
> 117 over. Investigate; do not reconcile them away.
>
> **4. Clear the classification queue** on the Activity types page — 98 rows,
> 10 of them genuinely unclassified. Nothing auto-saves.
>
> **5. Merge the 15 empty duplicate venues** — no city, no activity — now that
> identical names are selectable (D76).
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
# the staff admin — nine pages
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Hubspot/portal_seed"
python -m streamlit run admin/app.py          # http://127.0.0.1:8501

# the invoices against the portal, line by line
python reconcile_invoices.py
```

**Launch the admin from `portal_seed/` and nowhere else** (D63). It has no
login; its access control is that it binds to loopback, and Streamlit resolves
`.streamlit/config.toml` against the *working directory*. From the wrong
directory that setting silently vanishes and the app publishes every brand's
rate card — and every contractor's pay — to whatever network you are on.
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
| website (`…/ihospitality/`) | `portal-v1` | `git log` — unpushed vs `origin/portal-v1` |
| `Hubspot/portal_seed/` | `main` | `f091fd3` — local only, no remote by design |

**Verified at close:** 73 pytest · offline schema/RLS/staging/retainer suite
green **through both idempotency passes** · 0 grants to `anon`, 0 write grants
to `authenticated` (30 SELECT grants) · 1,255 activities · admin boots on
loopback and every page was opened in a browser · Dame Mas canary unchanged —
Apr +$0.01 (D48), May/Jun/Jul tying exactly, Jan–Mar the known hole.

**The money:**

| | that morning | now |
|---|---|---|
| activity charge | $24,754 | **$39,202** |
| retainer | — | **$79,650** |
| revenue | $24,754 | **$116,752** |
| contractor cost | $13,851 | $21,466 |

Margin is **not** quotable until contractors and the expenses ruling land.

---

## Open work, most useful first

1. **Enter the contractors.** Base pay is $0 everywhere, so margin is
   overstated. The operator is entering these himself.
2. **Mileage earns, expenses pass through** (D67). Ruled, not applied.
3. **Portal exceeds the invoices** on account visits (257) and `1st case sale`
   (117). Investigate — do not delete to make it tie.
4. **Chase Heaven's Door — $16,361.08 outstanding**, invoices 3099, 3106, 3111,
   3114, 3119 (work months Mar–Jul 2025, none paid).
5. **$2,000 of Aspen Green Zelle money has no QuickBooks sale at all** — not an
   invoice, not a sale. A bookkeeping question outside this system.
6. **Load `invoice_recap` from QuickBooks, not the spreadsheets.** It still
   holds ONE brand and seven months. Aug 2025 commission is typed `375.75`
   where the invoice bills `354.75`; a $455 Dame Mas tasting invoice (3203) is
   in neither the workbook nor the portal.
7. **Widen the Health canary further.** It compares commission to commission
   correctly now (D73) but still ignores consulting, billable and total.
8. **Run the sync for real.** Never run with the staging code. Use `--month` on
   one month and watch the review queue.
9. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. Matters more since D65, because quantity multiplies.
10. **Fill the activity-type property on HubSpot deals**, or rows keep arriving
    unclassified (D76).
11. **Ten months of Dame Mas billing nothing.** Jun 2025 – Mar 2026 show $0
    activity charge against real contractor cost.
12. **Phase 3 proper**, password reset (D18), deleting the two test logins, and
    merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **NEVER SAVE A PDF INTO THE WEBSITE REPO.** Its root IS the Netlify publish
  directory, so a committed PDF is served at `ihospitality.vip/<name>`. Twelve
  months of client invoices sat there untracked on 21 Aug. `*.pdf` is gitignored
  now; the invoices live at `Hubspot/Invoice_year.pdf` and
  `Hubspot/Invoice_June_july25.pdf`.
- **The QuickBooks API blanks invoice service lines; the PDFs do not** (D70). A
  $3,503 invoice returns four empty line objects and a subtotal, in a
  single-invoice fetch as much as a bulk one. Invoice *totals* are complete.
  Use `reconcile_invoices.py`; do not spend a session rediscovering this.
- **Billed in arrears.** The invoice naming a work month is issued the month
  after; `ACTIVITY DATE` states the work month, so no inference is needed.
  `invoice_recap.month` is already work-month based — **do not shift it**.
- **Aspen Green Feb–May 2026 is `source='uninvoiced'`** and correctly does NOT
  tie to QuickBooks (D71). Deleting it would delete $2,000 of real revenue —
  nearly done once already.
- **44 North `recurring case` is paid but never charged**, so it is on no
  invoice by design. Another expected non-match.
- **Nothing in the admin auto-saves.** Both grids need the Save button beneath
  them, and a refresh discards unsaved edits (D77).
- **The column that moves money is `source_activity_type`, not the type label**
  (D74). The rate card is keyed on the raw string.
- **Base pay is never allocated to a brand** (D67).
- **Coors Whiskey is a billing name covering Five Trail AND Barmen 1873.**
  `reconcile_invoices.py` pools them; without that, every line on both sides
  reads as a discrepancy. **Gin Lane 1751 ($6,661) is not in the portal at all.**
- **Scope starts June 2025**, where the HubSpot data starts.
- **A constraint or control that has never been exercised looks exactly like one
  that works (D62).** Five instances found on 21 Aug alone: the sync's
  overwrite, the `per_unit` default, the edit grid reclassifying without
  repricing, the venue merge on identical names, and the test harness reporting
  success while printing a schema failure.
- **Local Postgres is not Supabase, in both directions (D6).** On 21 Aug local
  was the stricter one and caught a fresh-install bug live could not show.
- **`market` is deliberately unused.** All venues carry NULL on purpose.

---

## Not yet tested by anything automatic

- The landing loop in `sync_hubspot.py.apply()`, and the sync against live
  HubSpot with the staging code. That run is the real first test.
- The admin's forms were exercised through their queries and write paths against
  live, and every page was opened in a browser — but **no end-to-end save is
  covered by a test**. Three bugs on 21 Aug were found by the operator using a
  page, not by any check: the grid that reclassified without repricing, the
  venue merge that could not merge identical names, and an IndexError that hid
  the Save button.
- `reconcile_invoices.py` has no test; its expected non-matches live in code and
  comments, not assertions.
- The first real sync will likely re-promote the backfilled rows as state
  `auto`. Expected and harmless — none are hand-edited.
