# HANDOFF — start here

Written at the close of **24 Aug 2026**, after a THIRD session that day.

**THE THIRD SESSION CLOSED THE COORS POOL — 9 of 9 months tie, and portal-wide
went 49 → 60 of 83.** It was open item 2, described there as "one query change".
The query change was real, but it was not the finding. **See D119.**

**Three things from it outrank everything else here:**

1. **AN EARLY-PAYMENT DISCOUNT AND A CARD FEE ARE NOT WORK.** The reconciliation
   compared the invoice TOTAL, but `TOTAL = SUBTOTAL − DISCOUNT + TAX`. Every
   Coors invoice carries a discount, and those nine discounts *were* the
   **−$81.09** D115 recorded as a gap. Both scripts now compare
   **`SUBTOTAL − expenses − payment fees`**, discount excluded. That one change
   fixed **seven** months and broke none — including **Wodka's "$106.03 of card
   fees"** and **Dame Mas's $112.51**, both of which had been carried as open
   gaps and were never gaps at all.

2. **`quantity = 0` IS THE HOUSE WAY TO SAY "THIS HAPPENED AND WAS NOT BILLED".**
   ⚠️ operator ruling: *"If it is in the workbook it's to be there, but if it
   isn't on the invoice then it wasn't billed. The invoices are the dues —
   whatever it says is true, so I want the portal to copy that."* Since D65 the
   quantity is the multiplier, so zero keeps the row, its venue, its photo and
   its HubSpot deal while contributing nothing. **Reach for it before
   considering a deletion** — it satisfies D85 and D107 at once and is
   reversible. 44 North already had two such rows; nobody had noticed they were
   the pattern.

3. **WODKA'S $25 CASE PAY IS CORRECT — the old item A would have cost $915.**
   *"Wodka reorder is $5, initial is $25."* Lowering it to $5 would have cut
   real contractor pay. The −$915 is the **charge** side and is the operator's
   decision, not a data fault. **A brand falling through to the shared
   `(all brands)` pay line is a fact to check, not a fault to fix** — which
   inverts what D94 seemed to teach.

**Also ruled: only data back to the portal.** QuickBooks holds 16 Coors invoices
going back to Dec 2024; the portal's activity starts 2025-06-06. The six older
ones — **$17,036.02** — are not a gap and are not to be chased.
`check_invoice_totals.py` reads the horizon from `min(activity_date)`.

**The Phil conversation happened and he agreed with the operator's position;
changes are coming.** What exactly was agreed has NOT been written down yet, and
it is the missing input for D117 (grading) and D118 (the 44 North fee model).
**Ask for the specifics before acting on either.**

Then read **D108–D115** (the first session of that day) — **D108 matters most:
63 synthetic `Invoice-derived` rows exist across nine brands, $7,035, and THEY
ARE NOT ALL WRONG.** There is a test, and bulk-deleting them breaks months that
currently tie. One of them was resolved this session and it is a good worked
example: the Feb 2026 barrel row claimed *"the portal held 0"* and was written
without looking at the adjacent month, where the real row sat.

**The single most dangerous command in this project is unchanged:**
`python parse_invoices.py --brand "<anything but Dame Mas>" --apply`. Its
double-count guard only recognises PERCENTAGE-priced months, so for a per-unit
brand it duplicates the whole brand — $11,667.10 for 44 North, $5,652.10 for
Blue Run, $2,990 for Wodka (D108). **Use `load_pool_recap.py`, or write the rows
directly.**

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


**Later on 23 Aug, the invoices.** The operator asked whether the portal ties to
the invoices before running an analysis on them, and the answer was that the
question could not be asked: **the invoice parser only ever worked for Dame
Mas** (D106). It discarded 26 of 91 pages because a continuation page carries no
`INVOICE` header; it read "September 11" as the year 2011; "Dec 2025" and
"Septrmber 2025" returned no month at all; and the item table was DOUBLE-COUNTING
because six of seven brands bill on a nested layout where each parent charge is
followed by a breakdown of itself. **Invoices tying to their own stated subtotal
went from 17 of 64 to 64 of 64.**

Then **D107**, the check the operator asked for: invoice TOTAL against the
portal, brand by month. **38 of 83 tie to the cent; Starr Rum ties on all
seven.** The result is SAVED AS DATA at
`portal_seed/reconciliation/invoice_vs_portal_2026-08-23.csv` — **do not
re-derive it.**

**Nothing in the portal was changed for any of that**, deliberately: the
remaining $7,289 is four different problems and three of them must not be
closed. Open item 1 says which.


**24 Aug was the day the portal started getting corrected**, and it went four
brands deep. **Brand-months tying went 38 → 49 of 83.** The headline gap reads
+$7,424.27 and that number is misleading: **$5,525 of it is August 2026**,
which is current-month work billed in arrears and correct as it stands. The real
gap is **$1,899.27**.

**44 North** finished at 13 of 15 — the two that remain are the operator's own
held June (a case he pulled off the invoice, where the portal edit never saved)
and August. Three `invoice_recap` transcription slips are still open.

**Wodka went from −$2,856.03 to six of eight months tying exactly.** The cause
was never a rate: a **$500/month `Expense Spend` line** the portal did not model
at all (D109), now riding on the retainer at $1,725 from Jan 2026. Then
December's phantom 22 cases, ten synthetic rows, and five venue quantities from
the operator's own workbook. What is left is $106.03 of card-processing fees and
one tap cocktail billed a month late that the invoice itself explains.

**Starr Rum tied 7 of 7 before and still does — but it now ties on real work.**
63 of its 84 activities had NO `source_activity_type`, so the rate card could
not price them and sixteen placeholder rows were carrying the money. 46 rows
classified, 16 deleted, **brand total unmoved to the cent** (D111).

**Blue Run reached 8 of 9**, and its biggest single fault was a `tasting event`
at quantity **6** — $800 on one row (D113). Its synthetic rows were checked and
KEPT: unlike Wodka's they stand in for barrels and half cases genuinely missing.

**Wodka, Starr Rum and Blue Run are now in `invoice_recap`** — 21 months
between them, every row proved against its own stated subtotal AND against
QuickBooks. **The Coors pool cannot be loaded** and that is a structural
blocker, not an oversight: see D114 and open item 2.

**Two operator rulings this session are rules, not facts**: `account sold` is
decided by what the invoice bills, never by the label (D112); and the workbook
decides ACTIVITY while QuickBooks decides TOTALS, because barrels were never
entered in the workbooks at all (D110).

---

## Later on 24 Aug — the business analysis

**Nothing in the database changed and no invoice work was done.** One page was
added to the admin; everything else is analysis, two documents, and three
decisions. Open items 1–7 are untouched.

**D118 is the finding worth waking up for.** Matching 44 North's distributor
depletion sheet against the portal's venues: **291 cases moved at accounts we
service between Jan and Jul 2026, and 63 were billed.** Not a recording failure
— reorders reach the venue through the distributor's own rep with no
iHospitality visit, so there has never been anything to log. The rate card makes
it structural: `recurring case` charges **$0.00 and pays $5.00**, so a reorder
costs five dollars and earns nothing. **One reorder has been recorded in the
entire history of 44 North.** Moving to 10 percent of every case takes 44 North
from $464/month of case revenue to about $1,048.

Two more from the same pass, neither needing a client conversation:
**51 tap/keg activities are logged as Market Favor, Account Visit or Drink
Development — all rate-carded at $0.00 — when a `tap cocktail` line exists at
$200.** And **Wodka's case sales lose $15 each** ($610 charged against $1,525
paid, −$915) because Wodka has no pay rate of its own and falls through to the
shared `(all brands)` $25.00 line. Same shape as D94.

**D116 is the only thing built.** The Analysis page has a new **Cost to serve**
tab: each contractor's base pay pushed down onto brands by their own share of
activities, with the period and brand list already driven by the page's
filters. It is an ALLOCATION and lives in the page, in no view — D67 still
governs the database, and every other margin figure is unchanged. The most
useful thing it says: **44 North's $1,450 retainer does not cover the $1,510 of
payroll on that account, and Dame Mas's $750 does not cover its $858.**

**D117 is designed and NOT agreed.** Grading, cadence, caps and a four-day
routed week. The constraint that drives all of it: **Phil owns 260 venues, does
62 visits a month, and 260 venues at the CHEAPEST cadence would cost 130.** He
is 2× over capacity even if everything is graded D, and 132 of his 260 have
never bought anything. So grading is mostly about deciding what stops being
visited on a schedule.

**Two documents were produced and are the reference for both**, in
`Ihospitality/`: `iHospitality_Rate_Talking_Points.docx` (the fee conversation
with Phil, opening with the fact that Phil is underpaid by $15–20k and how the
three changes fund it) and `iHospitality_Field_Routes_Phil.docx` (every venue
by route day).

**The Phil conversation had not happened when this was written.** Nothing here
is agreed. If it went ahead, what he said is the missing input for D117 and
D118 both.

**One number to be careful with.** Dame Mas reads **−$11** fully loaded on a
six-month window pooled, **+$18** on the same window allocated month by month
(which the tab does, and which is more correct), and **+$368** on Jun–Jul alone
— because its activity fell by a third and the allocation rewards neglect. The
honest word for Dame Mas is **break-even**, never "loses money".

---

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and **D119 plus D108–D115** in `DECISIONS.md`.
> The Coors pool is closed (9 of 9) and portal-wide is 60 of 83.
>
> **Before anything else, know four things.**
> 1. **Never run `parse_invoices.py --brand "<x>" --apply` for a per-unit
>    brand** — the guard only recognises percentage-priced months and will
>    duplicate the whole brand (D108). Use `load_pool_recap.py` or write
>    `invoice_recap` directly.
> 2. **`quantity = 0` is how a row says "this happened and was not billed"**
>    (D119). Reach for it before considering a deletion; it keeps the row, its
>    photo and its deal, and satisfies D85 and D107 at once.
> 3. **Do not touch Wodka's $25 `1st case sale` pay.** It is correct; the old
>    handoff item A was withdrawn and would have cost $915.
> 4. **The 63 synthetic `Invoice-derived` rows are not all wrong** (D108).
>    There is a test — does the work already exist elsewhere in the portal? —
>    and 44 North's June 2025 ties at exactly 0.00 while holding $660 of them.
>
> **Start by asking what Phil agreed to.** The conversation happened and he
> agreed with the operator's position, but the specifics were never written
> down, and they are the missing input for **D117** (venue grading and the
> routed week) and **D118** (the 44 North fee model). Both are designed and
> neither is agreed. Do not hand anyone a grading sheet before reading D117 —
> and when you do, send the **128 venues that have ever sold**, not all 260.
>
> **Then finish the invoice reconciliation: three brands left.** Aspen Green,
> Heaven's Door and the two barrel-only invoices. **The method, which has now
> worked six times running:**
> 1. Pull the brand's invoices from QuickBooks (`qbo_sales_get_invoices`) — its
>    totals are complete even though its service lines come back blank (D70),
>    and it is the only independent proof no invoice was missed.
> 2. Check them against the PDF parse. Every invoice must tie to its own stated
>    subtotal or the parser is broken — fix the parser, never the numbers (D93).
> 3. Check both against the operator's EOM workbook (`Ihospitality/EOM
>    reports/`). **The workbook decides ACTIVITY; QuickBooks decides TOTALS** —
>    barrels were never entered in the workbooks (D110), and the Coors workbook
>    was also missing a whole month's commission (D119).
> 4. Only when all three agree, write `invoice_recap`.
> 5. Then diff the portal's activity against the workbook, venue by venue.
>
> **What that diff keeps finding**, in descending order of money: a wrong
> QUANTITY on a real row (D113); a case sale filed as an account visit or the
> reverse (D112); a NULL `source_activity_type` so the rate card cannot price
> real work (D111); a brand whose rate line is $0.00 where the invoice charged
> real money (D119 — Barmen's barrel prep); and a synthetic row duplicating
> something already on file (D108).
>
> **Corrections go on the rows already there** — the operator's own words:
> *"I would rather change what's in the portal than create a new thing. If
> there is an account sold but it should be an account visit, just change it.
> Do not create an account visit."* Where the invoice bills work the portal
> never received, **create it** (operator-ruled 24 Aug). Where a corrected row
> was a venue's only depletion, walk `brand_venue_status` back by hand — the
> trigger only advances (D86). Note the HubSpot deal id in the row's note;
> HubSpot still holds the old figure and a promote could revert the fix.
>
> **Three things must NOT be "fixed":** August 2026 everywhere (arrears —
> billed a month behind, and it is most of the remaining headline gap), Aspen
> Green Feb–May 2026 (`uninvoiced` on purpose, D71), and Starr Rum Nov–Dec 2025
> (real work, deliberately never billed).
>
> **And nothing before 2025-06** — the portal's own horizon. QuickBooks holds
> older invoices; they are not gaps and are not to be chased (D119).
>
> Standing rules that outrank convenience: the billing is the truth (D56), no
> hardcoded business data (D60), the brand portal stays read-only by
> construction (D61), base pay is never allocated to a brand in a view (D67),
> a reimbursement never earns (D78), and reclassifying must not move money
> unless moving it is the point (D93/D112).
>
> Before calling a session done: **open every admin page AND every tab in a
> browser, and type into anything that takes input** (D79/D89/D92).

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

### NEW — from the second session on 24 Aug (D116–D118)

Lettered so nothing below has to be renumbered. **The numbered list after these
is the first session's and none of it was advanced.**

**A. ~~FIX WODKA'S CASE SALE PAY RATE~~ — WITHDRAWN, AND DOING IT WOULD HAVE
COST $915.** ✅ operator-ruled 24 Aug 2026. This item said to add a Wodka
`1st case sale` pay row at $5.00. **Do not.** The operator: *"Wodka reorder is
$5, initial is $25."* The $25.00 arriving through the shared `(all brands)` line
is CORRECT, and lowering it would have cut real contractor pay. The −$915 is
real but it is the **charge** side — Wodka pays $25 to place a first case and
bills $10 for it — which is a priced decision for the operator, not a data
fault (D60). See the D118 correction at the end of `DECISIONS.md`. **The general
rule this leaves: a brand falling through to the shared pay line is a fact to
check, not a fault to fix.**

**B. STOP GIVING AWAY TAP AND KEG WORK BY CLASSIFICATION** (D118). 51 tap/keg
activities are logged as **Market Favor (26), Account Visit (19), Drink
Development (5)** — all rate-carded at $0.00 — against 9 billed as tap work.
There is a `tap cocktail` line at **$200** for 44 North, $150 for Wodka. This is
a classification rule for three people, not a rate change: *if it involves
building, batching or servicing a tap, it is a tap cocktail or tap maintenance
line, never a favour.* Reclassifying moves money on purpose here, so D93's rule
does not apply — but check each row before changing it.

**C. THE PHIL CONVERSATION, and it gates D117 and D118 both.** The talking
points are written (`Ihospitality/iHospitality_Rate_Talking_Points.docx`) and
open with the fact that **Phil takes $32,188 against a $50–65k market rate**,
and that the three changes on the table fund about $14,232/year of that. Until
it happens, the grading scheme is a proposal and the 44 North fee model is a
proposal. **What he says is the missing input for both.**

**D. VERIFY THE $21/BOTTLE REFERENCE PRICE** before it reaches a contract
(D118). It is the operator's conservative estimate and the whole 10 percent
model rests on it — **every dollar is worth about $12/month**. Take it from an
invoice or the depletion report, never from a per-bottle average (D101).

**E. POPULATE `venues.market`.** **186 of 187 44 North venues have a NULL
market**, so D117's routes had to be clustered by city string and nothing can be
filtered to `central_florida` / `palm_beach_county` at all. It also means the
route design silently includes Pensacola, Jacksonville and Miami venues. Two
markets only, and the enum already enforces the vocabulary.

**F. Decide whether the ONE unowned venue matters** (D116). 339 of 340 venues
have an owning contractor. The one that does not drops out of every allocation
on the Cost to serve tab without comment.

---


1. **FINISH MATCHING THE PORTAL TO THE INVOICES — four brands done, four to go.**

   **DO NOT RE-DERIVE THE ANALYSIS.** The current state is saved at
   `portal_seed/reconciliation/invoice_vs_portal_2026-08-24.csv`, one row per
   brand-month, with a README beside it saying what is settled. Refresh it:

   ```bash
   cd Hubspot/portal_seed
   python check_invoice_totals.py                              # the summary
   python check_invoice_totals.py --brand "Blue Run"           # one brand
   python check_invoice_totals.py --csv reconciliation/invoice_vs_portal_$(date +%F).csv
   ```

   **OPERATOR RULING (D107):** the portal is not live, the invoices are sent and
   paid, so **where they differ the invoice is right and the portal gets
   corrected** — and **without creating duplicate deals**. This sharpens D56: it
   is still the portal that gets investigated, and now also the portal that gets
   changed.

   **49 of 83 brand-months tie.** Portal $119,983.93 against $112,559.66 —
   +$7,424.27, of which **$5,525 is August 2026 and correct**. Real gap
   **$1,899.27**.

   | Brand | State | What is left |
   |---|---|---|
   | Starr Rum | **4 of 4** | nothing |
   | Blue Run | **8 of 9** | Jan 2026 −$205, a 10L barrel |
   | Wodka | **6 of 8** on the canary | $106.03 of card fees; a ±$150 timing pair that nets zero |
   | 44 North | **13 of 15** | operator's held Jun 2026; 3 recap slips |
   | Dame Mas | — | not re-checked this session |
   | **Coors pool** | **1 of 10** | see item 2 — cannot even be loaded |
   | Aspen Green | — | not started |
   | Heaven's Door | — | not started, $16,361.08 outstanding |

   **THE METHOD, which worked four times running:** QuickBooks totals → PDF
   parse → operator workbook → only then write `invoice_recap` → then diff the
   portal's activity against the workbook venue by venue. See THE NEXT PROMPT.

   **THREE THINGS IN THAT GAP MUST NOT BE "FIXED":** August 2026 everywhere
   (arrears); Aspen Green Feb–May 2026 (`uninvoiced` on purpose, D71); and
   **Starr Rum Nov–Dec 2025** — real work, deliberately never billed, roughly
   $360 if anyone "helpfully" classifies it (D111).

   **ONE QUESTION STILL OPEN:** invoice **3210, $1,235.33, Jul 2026, billed to
   "Chris Nicolas"** — which brand? One row in `brand_billing_name` once he says.

   Still open, same field as ever: **`Executive Cigar`, 31 Jul 2026, amount
   $210.80 should be $210.75** (D101), and **the five `is_expense` rows** carry a
   NULL amount, which is why `reimbursements` reads $0.00 against $2,456.20 of
   expense lines (D78/D98). Both are Review and edit.

2. **~~TEACH `canary()` TO POOL BRANDS~~ — DONE, AND THE POOL TIES 9 OF 9.**
   ✅ 24 Aug 2026 (third session). See **D119**.

   `canary()` now derives a pool **label** for every brand and applies it to
   both sides of the comparison; `admin/app.py` selects on it. Nine months are
   loaded under `Barmen 1873 + Coors Whiskey + Five Trail` by the new
   `load_pool_recap.py` — **never `parse_invoices.py --apply`** for a per-unit
   brand (D108). **Every other brand's numbers are unchanged.**

   The −$81.09 the pool was recorded as owing was **nine early-payment
   discounts** and never a gap. Both scripts now compare
   `SUBTOTAL − expenses − payment fees`, with the discount excluded entirely.
   That alone fixed seven months, three of which were long-standing handoff
   items: Wodka's "$106.03 of card fees" and Dame Mas's $112.51 ACH fee.

   **`verify_live.py` now asserts that each brand resolves to exactly ONE pool
   label.** The join is on the brand, so two labels would double-count its
   activity silently. It holds today only because the two billing names
   reaching those three brands name the same three.

3. **DECIDE THE BARRELS.** ⚠️ operator has ruled they SHOULD be portal
   activities; the mechanics are not there yet.

   Two things are missing and both are operator data (D60):
   - **Blue Run has no `cwc 10l barrel` rate line.** Barmen's says $150; Blue
     Run's invoices bill $205. Blue Run Jan 2026 is $205 short for exactly this.
   - **Two barrel-only invoices sit outside the monthly programme entirely** —
     **3159** (Blue Run, $618.04, malformed date "September 11", billed to a
     Molson Coors address) and **3178** (Coors pool, $757.23, *"Fred Fisher
     requested barrels"*, no work month at all). `invoice_recap` is unique on
     `(brand_name, month)` so neither can sit beside its month's programme
     invoice.

4. **Resolve the remaining 26 synthetic rows** (D108). $3,030 across 44 North
   ($860), Five Trail ($930), Heaven's Door ($1,245), Aspen Green ($995) and
   Dame Mas ($0). **Test each against the brand's workbook — do not bulk-delete.**
   44 North's June 2025 ties at exactly 0.00 and holds $660 of them.
   ```sql
   select b.name, a.activity_date, a.source_activity_type, a.quantity
     from activities a join brands b on b.id = a.brand_id
    where a.notes like 'Invoice-derived.%' order by 1, 2;
   ```

5. **Fix the `parse_invoices.py` double-count guard** (D108). It asks
   `charge_pct is not null`, which only recognises the Dame Mas percentage
   model; it should ask whether the month already carries ANY billable charge.
   Until then the `--apply` path is a loaded gun for every per-unit brand.

6. **Finish 44 North's `invoice_recap`.** Sept is corrected; three left, all
   verified against the PDFs: **2025-10 expenses 302.44 → 259.30** (the last
   line counted twice), **2026-01 expenses 174.48 → 174.18**, and **2025-06 is
   missing entirely** (invoice 3117: 1,450 / 870.00 / 308.77 / 2,628.77). Plus
   his held **Jun 2026**, where the portal edit never saved and the recap still
   says 2,200 where the invoice says 2,150 — both wrong the same way, which is
   why that month reads green.

7. **Tick `bottle_reorder` as a reorder** on the Activity types page. There are
   now FIVE Dame Mas `bottle_reorder` rows (D93) on top of the 11 pairs it was
   worth, and every one of those accounts demonstrably bought again while still
   reading `placed`.

8. **Contractors — DONE, and the base pay figure moved with it.** Three people
   are on file (Phil $619 weekly, Nick $375 semimonthly, Eric $350
   semimonthly = **$4,132.33/month**), and 339 of 340 venues now have an owning
   contractor. **Base pay is no longer understated.** What is still missing is a
   pay row for anyone hired next, and note that the ONE unowned venue silently
   drops out of every allocation on the Cost to serve tab (D116).

9. **GRADE THE VENUES — owners are done, grades are not** (D88, and now D117).
   339 of 339 rows in `venue_grading` carry an owning contractor; **not one
   carries a grade.**
   Grid or CSV — download, edit in Excel, upload, confirm the diff. A blank
   grade means not graded yet; nothing reads it as a bad grade.

   **D117 designed the whole scheme and it is NOT agreed with Phil.** Read it
   before handing anyone a spreadsheet. The four things that will otherwise be
   got wrong: cap A as a **share of capacity, never a flat number** (ten A's is
   71 percent of Phil); **A is a campaign, not a status**; a **90-day floor on
   every venue that has ever bought** is what makes the arithmetic fit at all;
   and a B graded on potential **must drop to D after 90 days without a sale**,
   or the grade and its cost persist for ever.

   **Do not send Phil 260 rows.** Send the **128 that have ever sold** — he will
   grade 260 rows as C and you will learn nothing. The other 132 have never
   bought and the answer for them is already known.
10. **Enter the remaining pay rates and the 5 expense amounts** (D78).
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
11. **DECIDE THE PRICES THAT LOSE MONEY** (D90). Measured and listed on the Rate
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
12. **Portal exceeds the invoices** on account visits (257) and `1st case sale`
   (117). Investigate — do not delete to make it tie.
13. **Chase Heaven's Door — $16,361.08 outstanding**, invoices 3099, 3106, 3111,
   3114, 3119 (work months Mar–Jul 2025, none paid).
14. **$2,000 of Aspen Green Zelle money has no QuickBooks sale at all** — not an
   invoice, not a sale. A bookkeeping question outside this system.
15. **Load `invoice_recap` for THE REMAINING BRANDS.** Done: Dame Mas (13),
   44 North (13), **Wodka (8)**, **Starr Rum (4)**, **Blue Run (9)** — 47 months
   on file, every row proved against its own stated subtotal AND QuickBooks.
   **Left: Aspen Green, Heaven's Door, Barmen 1873, Five Trail, iHospitality.**
   The last two are the Coors pool and are BLOCKED by item 2, not merely
   undone. **Write the rows directly — do NOT use `parse_invoices.py --apply`
   for a per-unit brand** (D108). The $455 Dame Mas tasting invoice (3203) is
   still in neither the workbook nor the portal.
16. **Widen the Health canary further.** It now reads `commission + billable +
   mileage`, all coalesced (D114) — `billable` was missing and 44 North Sept
   2025 was the row that proved it. Still ignores `total`, still **cannot pool
   brands** (item 2), and **its invoice side is still hand-typed**, which is the
   circularity that produced a false green and a false red on one brand in one
   morning. The real repair is to source it from the parsed PDFs.
17. **Run the sync for real.** Never run with the staging code. Use `--month` on
   one month and watch the review queue. **Check afterwards that no venue came
   back**: the merges of 22 Aug depend on `venue_hubspot_alias` being consulted
   by the pre-load loop (D82), and that path has never run against live HubSpot.
18. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. **This is the fourth known instance of D113**, and the
   other three were each worth real money: Pourhouse Lounge 12 ($120),
   Debauchery 3 ($30), Executive Cigar 6 ($800). All four are real activities
   with real deals; the quantity multiplies (D65) and nothing about the row
   looks wrong. **Worth a sweep** — anything whose quantity is far above its
   neighbours at the same venue deserves a look at the operator's workbook.
19. **Fill the activity-type property on HubSpot deals**, or rows keep arriving
    unclassified (D76).
20. **Ten months of Dame Mas billing nothing.** Jun 2025 – Mar 2026 show $0
    activity charge against real contractor cost.
21. **`QB_RETAINER_LAST_MONTH` in `8_Retainer.py` is a hand-maintained date.**
    It bounds the QuickBooks comparison at the last invoiced work month (D79).
    It needs bumping when a new month is invoiced, alongside `QB_RETAINER_TOTAL`
    and `QB_RETAINER_MONTHS` — or, better, derived from `invoice_recap` once
    item 8 lands.
22. **Fix `Crown Lounge`'s city** — it reads "Locals Eatery & Bar", a venue name
    in the city column, straight from HubSpot. Editing it in the admin now
    STICKS (D84); it did not before today.
23. **THE LAYOUT — the operator has asked three times and we never got to it.**
    He wants to change the site's layout and wanted to talk it through rather
    than be handed a design. **Ask these before building anything:**
    - **Which surface?** The public marketing site (`index.html`, gallery) or
      the brand portal (`portal/`, the five logged-in pages)? They are very
      different jobs.
    - **What is prompting it** — something hard to find, something that looks
      dated, phone rendering, or showing it to someone specific soon? That
      answer usually matters more than the layout itself.
    - **How far does it go** — a re-skin inside the current structure, a
      re-think of what lives on which page, or a new page?

    The binding constraint to name up front: **no build step, no npm** (locked).
    Plain static HTML with shared tokens in `css/site.css`, page-specific CSS
    inline AFTER the link so pages can override. That rules out reaching for a
    framework; it rules out very little visually.

24. **Phase 3 proper**, password reset (D18), deleting the two test logins, and
    merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **`parse_invoices.py --apply` DUPLICATES ANY PER-UNIT BRAND** (D108). The
  double-count guard is `select month from v_activity_money where brand_name = %s
  and charge_pct is not null` — it recognises a month as already-priced ONLY when
  the pricing is a PERCENTAGE, which is the Dame Mas model it was written for.
  Every other brand is priced per unit, `charge_pct` is NULL on every row, and
  the guard reports "none". Its dry run will tell you, in as many words, that
  **$11,667.10 of 44 North commission is "not currently in the portal"** when all
  of it is. Write `invoice_recap` directly.
- **A CHECK WHOSE TWO SIDES SHARE A SOURCE CANNOT FAIL** (D114). The Health
  page compares the portal against `invoice_recap`, which is typed by hand. On
  44 North it showed **June 2026 green while the invoice says $2,150** (both
  sides said $2,200) and **September red on a month that ties to the cent**
  (typed $610.00 against an invoice of $912.10). If a page and a tool disagree,
  ask which one reads the document.
- **DO NOT BULK-DELETE THE `Invoice-derived` ROWS** (D108). 63 of them, $7,035,
  nine brands. Wodka's ten were duplicates. **Blue Run's are load-bearing and 44
  North's June 2025 ties at exactly 0.00 while holding $660 of them.** The test
  is whether the work exists elsewhere in the portal, and only the operator's
  workbook can answer it.
- **A QUANTITY IS MONEY, AND A WRONG ONE LOOKS ORDINARY** (D113). Four found:
  Pourhouse Lounge 12, Debauchery 3, Executive Cigar 6, Meg O'Malley's 6 —
  $1,110 between them. Every one a real activity with a real HubSpot deal.
  **The type and the quantity go wrong together**; two of the four were also
  case sales filed as account visits.
- **MONEY ON A VENUE-LESS ROW IS A SYMPTOM, USUALLY OF A NULL
  `source_activity_type`** (D111). Starr Rum tied 7 of 7 while 63 of its 84
  activities priced at $0.00, because the rate card keys on that column (D74)
  and it was empty. Classify the real rows first, prove the brand total does not
  move, and only then remove the placeholders.
- **THE WORKBOOK IS NOT THE BILLING** (D110). Barrels were never entered in the
  EOM workbooks at all. Blue Run's disagrees with QuickBooks on **6 of 14**
  invoices and omits one entirely; Starr Rum's carries a November row for an
  invoice that does not exist; the Coors workbook books **$69.56 of Blue Run's
  barrel shipping to the wrong brand**. Use it for what happened, never for what
  was billed.
- **THE COORS POOL CANNOT GO INTO `invoice_recap`** (D114). That table is keyed
  on one brand; those invoices belong to three, and both billing names are
  deliberately unmapped. Loading them anywhere fabricates a ~$19,000 gap on a
  pool that ties to −$81.09. Fix `canary()` first.
- **SOME GAPS ARE BILLING, NOT WORK, AND SHOULD STAY** (D115). Card and
  processing fees, early-payment discounts, balances carried to the next
  invoice, and work billed a month late. Four of the Coors pool's nine months
  differ from the portal by **exactly their discount and nothing else**. Wodka's
  April/May pair is ±$150 for ever because invoice 3195 says so in its own line
  description — **moving that row would date a real activity wrongly**.
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
