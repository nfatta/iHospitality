# HANDOFF — start here

Written at the close of **23 Aug 2026 (second session)**. Read **D97–D99**
first — they are this session, and D98 is money that is currently unbilled. This is the "what now" document;
`PROGRESS.md` is the full build log and `DECISIONS.md` is why things are the way
they are. Read this first, then **D86 through D95** — 23 Aug was a long session
and those ten entries are the current state of the system.

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

23 Aug **built D86**, which had been ruled and left sitting. The account list
now moves past `placed`: **21 pairs read `reordering`** and **360 of 689 read
`dormant`**, derived rather than stored so a visited account comes back to life
by itself. It moved no money — 1,255 activities and $39,201.65 of activity
charge unchanged. **D87 is what the plan missed**: three of the four stat cards
on `venues.html` counted the displayed status, so adding dormancy would have cut
"Stocking your brand" from 218 to 116 and turned a card labelled "Quiet 90+
days" into one that counted 91-to-180 only — falling as the situation got worse,
on a page that rendered perfectly. The account list now **displays the effective
status and counts the stored one**.


**Later on 23 Aug**, three things. **D97**: the operator ruled that Mullets
Sports Bar and the cigar lounge are ONE premises, reversing the hold D95 put on
it — so it was a RENAME of the single existing row, done through the admin so
`hand_edited_at` defends it (D84). The last three Dame Mas sales are in:
**1,262 → 1,265 activities, 339 → 340 venues, and not one cent moved**. The
loader gained `--assign`, which is how an operator ruling reaches a matcher that
is correctly refusing to guess (D81/D60).

**D98 is the one that matters.** The operator reclassified a Gleneagle row to a
bottle sale and found he could not enter what it was worth. There was nothing
to enter it into: **`amount` was readable nowhere and editable nowhere**, and a
percentage-priced row with no amount **charges $0.00 while looking perfectly
priced** — not `unpriced`, shows a `10%` rate, charge reads zero. It has cost
**$21.08 of June commission**, and the Health canary is the only thing that ever
saw it. `amount` is now on Review and edit, and the preview prices percentage
rows off it. The same field unblocks the five expense rows behind
`reimbursements` reading $0.00.

**D99**: the `st.stop()`-after-`st.tabs()` checker, proven by flagging **line
265 of the real pre-fix `5_Venues.py`** while all three older checkers call that
file clean. **118 → 134 tests.**

**Verified in a browser this session:** all nine admin pages, every tab panel
carrying content, the Rate card's four money fields **typed into** and confirmed
to enable on picking a basis (D92's fix, working), the venue rename done through
the UI, and — **at last, while logged in as staff** — `business.html` and
`venues.html`. Both were correct: venues.html reads 692/221/471/151 exactly, and
counting the displayed status would have shown **117** stocking instead of 221,
so D87's fix is doing its job on live data. `business.html` reads
**−$1,265.00 across 66 activities**, not the −$1,295.00/58 this file predicted —
the figure had moved with the operator's own later rate entries, and it ties to
`v_activity_money` brand for brand.

---

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and **D86–D95** in `DECISIONS.md` (23 Aug was
> a long session: the account list, venue grading, the editable rate card, and
> Dame Mas reconciled end to end).
>
> **Start with open item 1** — $21.08 of June commission is unbilled because
> one row has no `amount`. The field to fix it now exists (D98).
>
> Then the old list below, which is still accurate apart from what D86–D95
> closed.
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
> **5. D86 IS BUILT — nothing to do, one tick to consider.** 21 pairs read
> `reordering`, 360 read `dormant`, and dormancy is derived so it un-sets
> itself. The one open question is yours: **`bottle_reorder` is a reorder by
> every plain reading of the word and is deliberately left unticked.** Ticking
> "Bought again (reorder)" on the Activity types page moves 11 more Dame Mas
> pairs to `reordering` and backfills them. It was left for you because it is a
> business call, not a mechanism. See D86 and D87.
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

Later that day: **venue grading and ownership** (D88) — an A/B/C/D grade and an
owning contractor per venue, staff-only, in their own table because a column on
`venues` is a column a brand can read. Editable grid plus a CSV round trip
keyed on the venue id. And **D89**: adding that tab revealed that `st.stop()`
inside the merge tab had been killing the whole script run on every page load,
so **"Edit a venue" had rendered blank since the day it was written** — clean
console, no exception, page looked perfect.

And **D90**, from the operator asking why Aspen Green looked wrong: it is
charged $5.00 per case and pays $5.00 per case, so it earns exactly nothing —
against $60 for four other brands. Worse, the Rate card page now measures the
whole family: **51 activities charged $2,040.00 against $3,335.00 of pay, a
margin of MINUS $1,295.00**, led by Wodka's `1st case sale` at −$1,140.
Clicking a brand-month on the Analysis page now opens every row behind it.

Then **D91**: the rate table edits in place, showing what each edit does to
money already recorded before it saves. **Mileage now pays out in full** — eight
lines, charge unchanged, contractor cost +$1,243.90, uncosted charge down to
**$5,325.00**. And the two `rate_card` one-basis CHECK constraints turned out to
have **never existed on Supabase** — declared inside `create table if not
exists`, real in every test, absent on live.

And **D92**, reported as "the cursor turns into a red null sign": the four money
fields on "Add a rate" were disabled by a radio **inside `st.form`**, and a form
does not rerun until submit — so they could never be enabled, by any sequence of
actions, since the day they were written. Fixed by dropping the form. The class
is now a static check, confirmed to fail on the pre-fix file.

Finally **D93 — Dame Mas is reconciled end to end.** The canary reads **13
months tying, 0 billed-but-missing, 0 drifted**, against 4 and 3 that morning.
$3,307.28 of missing commission is booked from the invoice PDFs, and 46 of the
50 `account sold` rows are classified from the workbook notes without moving a
cent.

**D88–D89** added venue grading and ownership (staff-only, in its own table
because a column on `venues` is a column a brand can read) — and found that
`st.stop()` inside a tab had been rendering "Edit a venue" blank since the day
it was written. **D90–D92** came from the operator reading the Analysis page:
Aspen Green earns nothing because it is charged $5.00 a case and paid $5.00 a
case, **51 activities are priced at a loss (−$1,295)**, the rate table is now
editable with a money-impact preview, and the four money fields on "Add a rate"
could never be enabled by anyone.

**D93–D95 reconciled Dame Mas end to end.** The Health canary reads **13 months
tying, 0 billed-but-missing, 0 drifted** — it read 4 and 3 that morning.
$3,307.28 of commission was booked from the invoice PDFs, 46 of the 50
`account sold` rows were classified from the operator's own workbook notes
without moving a cent, and nine sales the workbook had and HubSpot never did
were created.

And **D94** closed the loop on it: Dame Mas had no per-case rate of its own, so
the shared `(all brands)` $25.00 pay line was inventing **$325.00 of contractor
cost against no charge**. Its placements now carry explicit 0.00 / 0.00 lines,
which also stops 56 deliberately-free rows reading as a fault — **Dame Mas
unpriced 63 → 7, portal-wide 152 → 96**. Nine missing sales created; three held
back where the venue was too close to call.

**Session ended at the operator's call**, with three Dame Mas rows deliberately
unwritten (item 1) and one question outstanding (item 5). Nothing is half-done
in the database: every script here is idempotent and was re-run to prove it.

**Verified at close (23 Aug):** **118 pytest** (103 + 15 new source checks) ·
offline suite green **through both idempotency passes**, now nine files ·
0 grants to `anon`, 0 write grants to `authenticated`, 0 grants of any kind to
`anon` on `venue_grading` · 1,255 activities and $39,201.65 activity charge
unchanged by D86 · both account views agreeing status-for-status across all 689
pairs · `venue_grading`'s write path driven against live and rolled back,
including clearing a field back to empty · **all nine admin pages AND every tab
on them opened in a browser** — which is how D89 was found.

**Not covered by any test, and it bit twice today:** control flow in the admin.
`test_admin_sql.py` now catches three source faults — including D92's — but it
still passes on the version where a whole tab renders blank (D89), because
`st.stop()` after `st.tabs()` is not checked. **That is the obvious next
checker to write**, and it is about twenty lines: the shape is already in
`widgets_disabled_inside_a_form`.

**NOT verified: the logged-in `venues.html` and `business.html`.** It is behind a brand login and
there was no session to hand, so the corrected stat cards were not seen
rendering. The module parses and redirects with no console errors and the view
columns are confirmed present — but D79 is explicit that this is not the same
evidence as opening the page. **Open both once you are logged in.** On
`venues.html` the four numbers at the top are what changed; on `business.html`
it is the new **"Priced at or below cost"** card and column (D96), which should
read **−$1,295.00 across 58 activities**, with Wodka at −$1,140 and Aspen Green
at $0.00 across 23 activities that earn exactly nothing.

**The money:**

| | 21 Aug | now |
|---|---|---|
| activity charge | $39,202 | $39,202 |
| retainer | $79,650 | $79,650 |
| revenue | $116,752 | **$116,752** |
| contractor cost (per-activity) | $21,466 | **$26,891** |
| contractor base pay | — | $10,500 (one person) |
| activity charge | $39,202 | **$42,509** (D93) |
| **charge with no cost behind it** | $6,569 | **$3,225** ⚠️ |
| **charged at or below what it pays** | — | **−$1,295** ⚠️ (D90) |
| unpriced activities, portal-wide | 152 | **96** (D94) |
| reimbursements (pass-through) | — | $0.00 (none entered) |

Margin is **not** quotable. Two known reasons, both now measured rather than
suspected: base pay covers one contractor, and $6,569 of charge has no pay rate.

---

## Open work, most useful first

1. **ENTER THE GLENEAGLE AMOUNT — $21.08 of June commission is unbilled.**
   The Health canary reads **12 months tying, 1 DRIFTED**: June 2026 has portal
   $388.05 against invoice $409.13. The gap is one bottle at **Gleneagle
   Country Club** whose `amount` is NULL, so its 10 percent rate charges $0.00
   while looking perfectly priced (D98). The invoice's own arithmetic gives
   **$210.80** for that bottle — confirm it against the June depletion report,
   then type it into **Amount (gross)** on Review and edit (Dame Mas, 2026-06).
   The preview will show $21.08 before you save, and the canary should go back
   to 13 tying. **Do not infer the figure from a per-bottle average** — that
   night's other rows run $163.88 to $207.75 because of case discounting (D93).

   Then the same field clears **the five `is_expense` rows**, all NULL, which
   is why `reimbursements` reads $0.00 against $2,456.20 of expense lines.

2. **Tick `bottle_reorder` as a reorder** on the Activity types page. There are
   now FIVE Dame Mas `bottle_reorder` rows (D93) on top of the 11 pairs it was
   worth this morning, and every one of those accounts demonstrably bought again
   while still reading `placed`.
3. **Finish the contractors.** One person on file. Base pay understated. It now
   feeds a second thing: the owner dropdown on the Venues page's **Grade and
   ownership** tab lists active contractors, so until they are entered there is
   nobody to assign a venue to.
4. **Grade the venues, and assign owners** (D88). 336 venues, all blank. Grid or
   CSV — download, edit in Excel, upload, confirm the diff. A blank grade means
   not graded yet; nothing reads it as a bad grade.
5. **Enter the remaining pay rates and the 5 expense amounts** (D78).
   **Mileage is DONE** (D91), **Dame Mas is DONE** (D93/D94), and on 23 Aug the
   operator entered `aspen green fresh market incentive` and `single barrel
   sale` himself — together those took uncosted from $6,568.90 to **$3,225.00**.
   What is left: `5l barrel` ($1,395), `tap cocktail` ($700), `promo specialist`
   ($240), `day buy-out split` ($230), `barrel prep` ($200), `tap w/2 cases`
   ($200), `tap maintenance` ($100), `tasting event split` ($100), `half case
   sale` ($60). Where work is deliberately free, give it an explicit **0.00 rate
   line rather than no line** (D94), so it stops reading as a gap.

   **ONE QUESTION FOR THE OPERATOR, from his own entry:** he set
   `aspen green fresh market incentive` to **charge $100.00 and pay $100.00**,
   so it now earns nothing across 9 activities and sits in the "priced at or
   below what it pays" list beside mileage. That is right if it is a
   pass-through like mileage (D91) and wrong if the pay was meant to be lower.
   **Nothing in the data can tell which** — ask him. What is left is
   led by `5l barrel` ($1,395), `single barrel sale` ($1,000) and
   `aspen green fresh market incentive` ($900). Not a fault — unfinished. Both
   are operator data by D60.
6. **DECIDE THE PRICES THAT LOSE MONEY** (D90). Measured and listed on the Rate
   card page: **58 activities charged $3,283.90 against $4,578.90 of pay —
   minus $1,295.00.** The loss is unchanged by the mileage ruling, which is the
   point: mileage passes through at exactly zero.
   - **Mileage: $0.00 margin, 7 activities, DELIBERATE** (D91). Nothing to do.
     It is in the list because it belongs there, not because it is wrong.
   - **Wodka `1st case sale`: charged $10.00, paid $25.00, 33 activities,
     −$1,140.** The charge is on Wodka's own line; the pay comes from the shared
     `(all brands)` line. The single biggest item.
   - **Aspen Green `1st case sale` and `recurring case`: $5.00 charged, $5.00
     paid, 14 activities, $0.00.** Four brands charge $60 for the same work.
     This is why every Aspen Green month reads a flat zero margin.
   - **Dame Mas `staff training`: $0.00 charged, $50.00 paid, −$150.** May be
     correct — n/c work still costs.
   - **44 North `recurring case`: −$5.00. Known and deliberate**, on no invoice
     by design. Nothing to do.

   Not all of it is wrong, and none of it is mine to decide (D60).
7. **Portal exceeds the invoices** on account visits (257) and `1st case sale`
   (117). Investigate — do not delete to make it tie.
8. **Chase Heaven's Door — $16,361.08 outstanding**, invoices 3099, 3106, 3111,
   3114, 3119 (work months Mar–Jul 2025, none paid).
9. **$2,000 of Aspen Green Zelle money has no QuickBooks sale at all** — not an
   invoice, not a sale. A bookkeeping question outside this system.
10. **Load `invoice_recap` for THE OTHER BRANDS.** Dame Mas is DONE — 13 months,
   from the invoice PDFs, via `parse_invoices.py --brand "<name>"` (D93). The
   Aug 2025 `375.75` vs `354.75` discrepancy is resolved: the invoice bills
   354.75 and the invoice wins (D56). **The parser is brand-agnostic already**;
   what is left is confirming each brand's invoices balance and deciding how
   their commission is modelled. `Coors Whiskey` is a billing name covering Five
   Trail AND Barmen 1873 and is deliberately unmapped. The $455 Dame Mas tasting
   invoice (3203) is still in neither the workbook nor the portal.
11. **Widen the Health canary further.** It compares commission to commission
   correctly (D73) and now actually runs (D79), but still ignores consulting,
   billable and total.
12. **Run the sync for real.** Never run with the staging code. Use `--month` on
   one month and watch the review queue. **Check afterwards that no venue came
   back**: the merges of 22 Aug depend on `venue_hubspot_alias` being consulted
   by the pre-load loop (D82), and that path has never run against live HubSpot.
13. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. Matters more since D65, because quantity multiplies.
14. **Fill the activity-type property on HubSpot deals**, or rows keep arriving
    unclassified (D76).
15. **Ten months of Dame Mas billing nothing.** Jun 2025 – Mar 2026 show $0
    activity charge against real contractor cost.
16. **`QB_RETAINER_LAST_MONTH` in `8_Retainer.py` is a hand-maintained date.**
    It bounds the QuickBooks comparison at the last invoiced work month (D79).
    It needs bumping when a new month is invoiced, alongside `QB_RETAINER_TOTAL`
    and `QB_RETAINER_MONTHS` — or, better, derived from `invoice_recap` once
    item 8 lands.
17. **Fix `Crown Lounge`'s city** — it reads "Locals Eatery & Bar", a venue name
    in the city column, straight from HubSpot. Editing it in the admin now
    STICKS (D84); it did not before today.
18. **Phase 3 proper**, password reset (D18), deleting the two test logins, and
    merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **NEVER `disabled=<another widget>` INSIDE `st.form`** (D92). A form does not
  rerun until submit, so that expression keeps the value it had at the start of
  the run and the widget can never be enabled by clicking. It made the Rate
  card's four money fields unusable from the day they were written. Drop the
  form, use live widgets in a fragment. Checked by `test_admin_sql.py` now.
- **OPEN THE PAGES, EVERY TAB — AND TYPE IN THEM.** D79: open every page. D89:
  open every tab. **D92: opening a page is not USING it.** Three faults now have
  been invisible to everything except a person interacting with the thing, and
  D92 survived me opening that exact page twice in one session while working
  directly above it.
- **OPEN THE PAGES — AND EVERY TAB ON THEM. In a browser, every session.**
  D89 is why the rule grew: `st.stop()` halts the WHOLE script run, not the tab
  it sits in, and one inside the Venues merge tab had been killing "Edit a
  venue" since it was written. The page opened fine and reported 336 venues.
  Never `st.stop()` after `st.tabs()` — use `else:`. Nothing automated caught
  it and nothing automated could: the fault is control flow, not SQL, so
  `test_admin_sql.py` passes on the broken version.
- **A venue's grade and owner are STAFF ONLY and are not on `venues`** (D88).
  They live in `venue_grading` because `venues_select` lets a brand read any
  venue row it relates to and the grant is table-wide — a column there is a
  column a brand can `select *`. Do not "simplify" them onto the venue.
- **`hubspot_owner_id` is NOT in `DEAL_PROPERTIES`**, so who created a deal is
  not in this database at all — not even in the stored `payload`, because
  HubSpot returns only the properties you ask for. Any ownership-from-HubSpot
  work starts with a sync change.
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
- **`create table if not exists` DOES NOTHING ON LIVE, including its
  CONSTRAINTS** (D91). Two `rate_card` CHECK constraints were declared inside
  one and had never existed on Supabase, while being real in every offline test
  run — so the suite could not have caught it and did not. Anything added to a
  table that already exists — column, default, or constraint — must be restated
  as an `ALTER`. Seventh instance of D62.
- **Editing a rate in the table RESTATES HISTORY** (D91). Sometimes that is
  exactly right: a rate that was always wrong should be corrected everywhere. A
  price CHANGE is a new row with a later `effective_from` instead. The grid
  previews the money impact before saving, by applying the edit and asking
  `v_activity_money` in a rolled-back transaction — do not replace that with
  arithmetic in Python.
- **Mileage pays out 100 percent and its $0.00 margin is CORRECT** (D91). Its
  pay rate is set from its charge rate so they cannot drift. Do not read it as
  a missing pay rate, and do not hide it from the at-cost list.
- **CHECK PRICES AGAINST `v_activity_money`, NEVER AGAINST `rate_card` ROWS**
  (D90). The charge and the pay for the same work need not sit on the same row —
  a brand line can set the charge while `(all brands)` sets the pay. A check
  that compared columns within a `rate_card` row found two lines worth $0 and
  **missed 33 Wodka activities worth −$1,140, the largest instance of the exact
  thing it was written to find.** The view already resolves the precedence the
  way the billing does; re-implementing it is a second pricing implementation.
- **Charge ≤ pay is a THIRD failure mode and has no flag on the activity**
  (D90). `unpriced` and `uncosted` both mean data is missing. This one means the
  data is present and says we work at or below cost. It cannot be flagged on the
  row because it is not a fault — it is a price.
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
- **The account status is TWO LAYERS and they are easy to confuse** (D86/D87).
  STORED by the trigger: non-depletion → `pitched`, depletion → `placed`,
  reorder → `reordering`, off `is_depletion` and `is_reorder`. It only ever
  advances. DERIVED at read time: `dormant` is 180 days quiet, computed in
  `account_status_effective()` and **never stored**, so a visited account
  un-dormants itself. Do not move it into the table and do not give it the
  trigger's advance-only logic.
- **DISPLAY `status`, COUNT `status_stored`** (D87). This is the one that will
  catch you. Dormancy layers OVER the stored value, so any count or filter
  written against the displayed status silently loses every account that has
  gone quiet — 102 stocking pairs on the day it landed, out of the number brands
  care about most. Both account views carry `status_stored` for exactly this.
- **The reorder branch is FIRST in the trigger, on purpose.** Every reorder type
  is also a depletion, so the other order sets `placed` and stops there for
  ever — and `placed` looks entirely plausible for an account that reordered, so
  nothing about the data would tell you.
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
