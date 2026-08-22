# HANDOFF — start here

Written at the close of **22 Aug 2026**. This is the "what now" document;
`PROGRESS.md` is the full build log and `DECISIONS.md` is why things are the way
they are. Read this first, then **D65 through D86**.

---

## The one-paragraph version

21 Aug took the portal from modelling a tenth of the business to reconciling
against the invoices (**D65–D77**). 22 Aug did two things. **D78** applied the
mileage/expenses ruling D67 had recorded and left sitting: itemised expenses are
now excluded from revenue and margin **by construction** rather than by luck,
and the missing-cost blind spot behind mileage turned out to be **$6,568.90
across 37 activities and 12 types**, all of which was inflating margin
invisibly. **D79** came from opening all nine admin pages in a browser, which
found **four broken pages** — including the app's own front page, broken since
D73, and Review and edit, broken by a comment warning about the very bug it
caused. **Revenue is unchanged at $116,752.** The margin figure is still not
quotable: base pay covers one person, and $6,568.90 of charge has no cost behind
it.

---

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and D65–D86 in `DECISIONS.md`.
>
> **1. Finish entering the contractors.** Only Eric Anderson is on file
> ($350 semimonthly from Jun 2025 — $10,500 so far). Everyone else is missing,
> so base pay is understated and every margin figure is overstated. I am
> entering these myself; the Contractors page renders correctly now (it did
> not — D79). Base pay is a COMPANY cost (D67) and must never land in a
> per-brand margin.
>
> **2. Enter the rates D78 exposed but must not invent.** Two gaps, both
> business data that belongs to me, not to a script (D60):
> - **`pay_rate` for the 12 uncosted types** — $6,568.90 of charge with no cost
>   behind it, listed on the Rate card page. Mileage ($1,243.90) is the one you
>   ruled on; `5l barrel` ($1,395), `single barrel sale` ($1,000) and
>   `aspen green fresh market incentive` ($900) are larger. Some may correctly
>   have none, if that work is covered by base pay instead.
> - **`amount` on the five `is_expense` rows** — pass-through totals, currently
>   all NULL, so `reimbursements` reads $0.00 while the Dame Mas invoices alone
>   show $2,456.20 of expense lines.
>
> **3. The portal holds MORE than the invoices in two places, and that is the
> dangerous direction — making them agree means DELETING logged work.** Account
> visits run 257 over (partly D69's own All Brands split, which multiplies one
> visit across brands while an invoice bills it once) and `1st case sale` runs
> 117 over. Investigate; do not reconcile them away.
>
> **4. Clear the classification queue** on the Activity types page — 93 rows,
> 5 of them genuinely unclassified (blank in HubSpot, so no reconciliation will
> ever fix them — D80). Nothing auto-saves. The **deal note is now the last
> column** and is often what decides the row; 18 of the 93 have one. **One row
> is an `is_expense` row with an empty type**; D78 means classifying it can no
> longer make it start earning, but check that it lands somewhere sensible.
>
> **5. IMPLEMENT D86 — both rulings are made, neither is built.** The account
> status stops at `placed` and never moves again, so the portal never shows a
> brand that they bought again, and never shows an account going cold.
> - **A case reorder must advance the status to `reordering`.** 21 brand/venue
>   pairs have reorders and all still read `placed` (20 Wodka, 1 44 North). A
>   reorder is a FACT, not a judgement — the original note grouping it with
>   `dormant`/`lost` was wrong on this one.
> - **A venue quiet 180 days must read `dormant`.** 360 of 689 pairs — over
>   half the account list, chosen deliberately over the 1-year option (42).
>   **It must NOT be sticky**: a dormant account that gets visited has to come
>   back to life, so do not copy the trigger's advance-only logic. Best derived
>   in the view from `days_since`, which makes it self-correcting. `lost` stays
>   a human judgement. `venues.html` already renders both pills — no front-end
>   work needed.
>
> **6. Venue duplicates are DONE** — all 17 merged, zero duplicate names left,
> 353 → 336 venues with activities and revenue unchanged (D81, D82). Nothing to
> do here. One leftover if you want it: **Crown Lounge has its city set to
> "Locals Eatery & Bar"** — a venue name in the city column.
>
> Standing rules that outrank convenience: the billing is the truth (D56), no
> hardcoded business data (D60), the brand portal stays read-only by
> construction (D61), cleanup happens in the staging zone rather than by
> overwriting (D64), base pay is never allocated to a brand (D67), and a
> reimbursement never earns (D78).
>
> Before you finish: `python -m pytest test_normalize.py test_sync.py
> test_admin_sql.py -q`, `bash db/test/run.sh`, `python verify_live.py`, and
> **open all nine admin pages in a browser** — that last one is not optional
> any more; it found four failures on 22 Aug that nothing else did (D79).

---

## Run it

**Double-click `Hubspot/portal_seed/start-admin.cmd`.** That is the whole
procedure — it `cd`s to its own folder first, which is what keeps the admin on
loopback (D63/D81), so it is safe from a Desktop shortcut or the Start menu.
Leave its console window open; closing it stops the server.

```bash
# or by hand — from portal_seed AND NOWHERE ELSE
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
| `Hubspot/portal_seed/` | `main` | local only, no remote by design |

**Verified at close:** 103 pytest (73 + 30 new source checks) · offline
schema/RLS/staging/retainer/money suite green **through both idempotency
passes**, and confirmed to **fail** when the D78 guard is removed · 0 grants to
`anon`, 0 write grants to `authenticated` (30 SELECT grants) · 1,255 activities ·
**all nine admin pages opened in a browser and checked for exceptions** · Dame
Mas canary Apr +$0.01 (D48), May/Jun/Jul tying exactly, Jan–Mar the known hole.

**The money:**

| | 21 Aug | now |
|---|---|---|
| activity charge | $39,202 | $39,202 |
| retainer | $79,650 | $79,650 |
| revenue | $116,752 | **$116,752** |
| contractor cost (per-activity) | $21,466 | $21,466 |
| contractor base pay | — | $10,500 (one person) |
| **charge with no cost behind it** | — | **$6,569** ⚠️ |
| reimbursements (pass-through) | — | $0.00 (none entered) |

Margin is **not** quotable. Two known reasons, both now measured rather than
suspected: base pay covers one contractor, and $6,569 of charge has no pay rate.

---

## Open work, most useful first

1. **Implement D86** — a reorder should read `reordering` (21 pairs), and a
   venue quiet 180 days should read `dormant` (360 pairs). Both RULED, neither
   BUILT. Dormant must not be sticky; derive it in the view. See D86 for why.
2. **Finish the contractors.** One person on file. Base pay understated.
3. **Enter the 12 missing pay rates and the 5 expense amounts** (D78). Both are
   listed in the admin; both are operator data by D60.
4. **Portal exceeds the invoices** on account visits (257) and `1st case sale`
   (117). Investigate — do not delete to make it tie.
5. **Chase Heaven's Door — $16,361.08 outstanding**, invoices 3099, 3106, 3111,
   3114, 3119 (work months Mar–Jul 2025, none paid).
6. **$2,000 of Aspen Green Zelle money has no QuickBooks sale at all** — not an
   invoice, not a sale. A bookkeeping question outside this system.
7. **Load `invoice_recap` from QuickBooks, not the spreadsheets.** It still
   holds ONE brand and seven months. Aug 2025 commission is typed `375.75`
   where the invoice bills `354.75`; a $455 Dame Mas tasting invoice (3203) is
   in neither the workbook nor the portal.
8. **Widen the Health canary further.** It compares commission to commission
   correctly (D73) and now actually runs (D79), but still ignores consulting,
   billable and total.
9. **Run the sync for real.** Never run with the staging code. Use `--month` on
   one month and watch the review queue. **Check afterwards that no venue came
   back**: the merges of 22 Aug depend on `venue_hubspot_alias` being consulted
   by the pre-load loop (D82), and that path has never run against live HubSpot.
10. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. Matters more since D65, because quantity multiplies.
11. **Fill the activity-type property on HubSpot deals**, or rows keep arriving
    unclassified (D76).
12. **Ten months of Dame Mas billing nothing.** Jun 2025 – Mar 2026 show $0
    activity charge against real contractor cost.
13. **`QB_RETAINER_LAST_MONTH` in `8_Retainer.py` is a hand-maintained date.**
    It bounds the QuickBooks comparison at the last invoiced work month (D79).
    It needs bumping when a new month is invoiced, alongside `QB_RETAINER_TOTAL`
    and `QB_RETAINER_MONTHS` — or, better, derived from `invoice_recap` once
    item 6 lands.
14. **Fix `Crown Lounge`'s city** — it reads "Locals Eatery & Bar", a venue name
    in the city column, straight from HubSpot. Editing it in the admin now
    STICKS (D84); it did not before today.
15. **Phase 3 proper**, password reset (D18), deleting the two test logins, and
    merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **OPEN THE PAGES. Every one, in a browser, every session.** This is now the
  highest-yield check in the project and it is not covered by anything else.
  D74, D76 and D77 were found by the operator using a page; D79 found four more
  in twenty minutes, two of them a month old, on the two pages the next session
  was going to work in. **The admin's own front page had been raising an
  exception since D73 while the handoff recorded the canary as verified** — it
  had been verified by querying it, never by opening the app. Those are not the
  same evidence.
- **NEVER SAVE A PDF INTO THE WEBSITE REPO.** Its root IS the Netlify publish
  directory, so a committed PDF is served at `ihospitality.vip/<name>`. Twelve
  months of client invoices sat there untracked on 21 Aug. `*.pdf` is gitignored
  now; the invoices live at `Hubspot/Invoice_year.pdf` and
  `Hubspot/Invoice_June_july25.pdf`.
- **A literal `%` in a query that passes params breaks the page, and a comment
  counts** (D79). `lib.query`'s `params or None` only rescues the no-params
  case. Spell the word out. `test_admin_sql.py` checks this now.
- **Two `$` in one Streamlit markdown string renders as LaTeX** (D79). One is
  fine, which is why it is easy to miss. Use a raw f-string and escape them.
  Same test file.
- **A reimbursement earns nothing, and that is enforced in the view, not in the
  data** (D78). Do not "simplify" the `is_expense` branch out of
  `v_activity_money` — it is first in both CASE expressions so that no rate-card
  line can reach it, and `04_money_test.sql` will fail if it goes.
- **`uncosted` deliberately requires a non-zero charge.** Without that it flags
  718 rows instead of 37, because every `n/c` type prices at zero and has no pay
  line either. A warning nobody acts on is worse than none.
- **The QuickBooks API blanks invoice service lines; the PDFs do not** (D70). A
  $3,503 invoice returns four empty line objects and a subtotal, in a
  single-invoice fetch as much as a bulk one. Invoice *totals* are complete.
  Use `reconcile_invoices.py`; do not spend a session rediscovering this.
- **Billed in arrears.** The invoice naming a work month is issued the month
  after; `ACTIVITY DATE` states the work month, so no inference is needed.
  `invoice_recap.month` is already work-month based — **do not shift it**. This
  is also why the current work month can never tie to QuickBooks (D79).
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
- **THE STAGING ZONE COVERS DEALS, NOT VENUES OR BRANDS** (D83). `apply()`
  upserts brands and venues DIRECTLY, before the staging zone is reached — no
  review queue, no `hand_edited_at`, no conflict state. D64 is intact; its
  scope is narrower than its name suggests.
- **`pitched` vs `placed` is decided by ONE fact: `activity_types.is_depletion`**
  (D86). Any non-depletion activity makes a venue `pitched`; any depletion makes
  it `placed`. It only ever advances, never downgrades, and stops at `placed`.
- **"The Wildflower" (Baldwin Park) and "Wildflower Sanford" are DIFFERENT
  BARS**, 40 miles apart with different HubSpot ids (D86). The Baldwin Park row
  reads `pitched` correctly — one drink list, no depletion. Do not merge them.
- **Deleting an activity DESTROYS its photos** — `photos.activity_id` is
  `ON DELETE CASCADE` (D85). The Duplicates page refuses for that reason and
  now offers **Move photos to the row I am keeping** first. Move goes through
  `move_activity_photos()`, never a bare UPDATE: a partial unique index on
  `(activity_id, content_hash)` collides whenever both rows hold the same
  image, which is the NORMAL case — 18 duplicate pairs carry photos.
- **A pair can be marked "not a duplicate"** (D85). `case_sale` and
  `tap_placement` are both depletions, so genuinely different work shows up as
  a suspected duplicate. Dismissals are listed with their reason and reversible.
- **THE PORTAL IS THE SOURCE OF RECORD NOW; HubSpot is an input** (D84). A
  venue edited in the admin is stamped `hand_edited_at` and the sync refuses to
  overwrite its city, filing what HubSpot wanted into
  `staging.hubspot_venue_proposal` for the Venues page to resolve. This
  reverses D59 for venue attributes — do not "fix it in HubSpot" for those any
  more. `venues.city` was the ONLY field the sync could overwrite; brands were
  never overwritable at all.
- **Merging a venue that has a `hubspot_company_id` MUST record the alias**
  (D82), or the next sync inserts the duplicate straight back — it pre-loads
  venues by company id and creates one for any id it does not recognise.
  `merge_venue()` handles it; do not merge venues with hand-written SQL.
- **An activity type with 0 activities is a MERGE that worked, not lost data**
  (D80). `merge_activity_type()` retires the source rather than deleting it, so
  a future sync of the old raw string cannot recreate what you just merged away.
  The Activity types page lists them separately and traces each to its survivor.
- **Reconciliation and classification are different axes** (D80). The
  reconciliation writes nothing; classification maps HubSpot's raw string to a
  type. A row can reconcile perfectly and still be unclassified.
- **`activities.notes` is on the classification grid now, and is still
  internal** (D80). Safe only because the admin is staff-only. Do not copy that
  query into anything a brand login can reach.
- **A constraint or control that has never been exercised looks exactly like one
  that works (D62).** Five instances on 21 Aug, and D78's expense exclusion was
  a sixth — it was working only because nothing had tested it.
- **Local Postgres is not Supabase, in both directions (D6).** On 21 Aug local
  was the stricter one and caught a fresh-install bug live could not show.
- **`market` is deliberately unused.** All venues carry NULL on purpose.

---

## Not yet tested by anything automatic

- The landing loop in `sync_hubspot.py.apply()`, and the sync against live
  HubSpot with the staging code. That run is the real first test.
- **No end-to-end SAVE is covered by a test.** `test_admin_sql.py` checks the
  admin's *source* for two render-time faults and `04_money_test.sql` checks the
  money views, but nothing drives a form and asserts the row changed. Every save
  bug so far has been found by a person clicking the button.
- `reconcile_invoices.py` has no test; its expected non-matches live in code and
  comments, not assertions.
- The first real sync will likely re-promote the backfilled rows as state
  `auto`. Expected and harmless — none are hand-edited.
