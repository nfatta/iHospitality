# CLAUDE.md — standing instructions

Read these before doing anything: **`HANDOFF.md` (start here — where we
stopped and the next prompt)**, `PROGRESS.md` (where the build is),
`DECISIONS.md` (judgment calls already made and why), `PORTAL_PLAN.md` (the WHAT
— its locked decisions are final). `BUILD-PLAYBOOK.md` is the HOW.

## Two repos, and why

| Repo | Holds |
|---|---|
| **this one** (`Website/…/ihospitality/`) | The public site and the portal's *servable* files only. Deploys to Netlify from `main`. |
| `Hubspot/portal_seed/` | All Python, `db/schema.sql`, and the SQL test harness. Its own git repo. **Not deployed.** |

**The repo root IS the Netlify publish directory.** Every committed file here is
served at `ihospitality.vip/<path>`. That single fact drives several decisions:
`*.py`, `.env` and `credentials.json` are gitignored here, and the schema plus
test harness live in the other repo entirely. Do not rely on `_redirects` to
hide a file — Netlify's `*` is a trailing splat, not a filename glob, so
`/portal/*.sql` does **not** match (D12). If a file must not be public, it does
not belong in this repo.

## Running the site

```bash
python -m http.server 8123
```

The staff admin has a double-click launcher: **`portal_seed/start-admin.cmd`**.
Its first line is `cd /d "%~dp0"`, which is what keeps D63 true from a Desktop
shortcut. Do not replace it with a direct `streamlit` invocation from elsewhere.

Or the `ihospitality-static` config in `.claude/launch.json` via `preview_start`.
The portal is at `/portal/login.html` — it needs `http://localhost`, not
`file://`, because it uses ES modules.

## The database

Live on Supabase (Postgres 17.6), seeded. Everything reads `DATABASE_URL` from
`Hubspot/.env` — never pass it on a command line.

```bash
cd ../../Hubspot/portal_seed
python -m streamlit run admin/app.py   # THE STAFF ADMIN — analysis, review, cleanup
python verify_live.py                  # read-only health check
python apply_schema.py --apply         # re-apply db/schema.sql (idempotent)
python seed_from_csv.py                # dry run; --apply to load
python create_portal_user.py --list    # who has portal access
python -m pytest test_normalize.py test_sync.py test_admin_sql.py -q  # 103 tests
bash db/test/run.sh                    # schema + RLS + staging suite, no network
python backfill_staging.py             # one-time; already applied 19 Aug
bash test_seed_integration.sh          # end-to-end load, asserts idempotency
```

**The admin binds to loopback, and that is its whole access control (D63).**
It has no login and does not need one — cleanup is the operator's job at his own
machine. But Streamlit resolves `.streamlit/config.toml` against the *working
directory*, so launching from anywhere but `portal_seed/` silently drops the
setting and publishes every brand's rate card to whatever network the laptop is
on. `lib._require_loopback()` refuses to render if that happens; do not treat
that guard as permission to launch from elsewhere.

**Local Postgres is not Supabase.** Anything touching roles, grants or default
privileges must be checked against the real project — Supabase grants `ALL` on
new public objects to `anon`/`authenticated` by default and a stock local
cluster does not. That difference hid a real bug once (D6). The local stub now
reproduces it; keep it that way.

## Conventions that matter

- **No build step, no npm.** Locked decision. Plain static HTML.
- **Shared CSS is in `css/site.css`.** Page-specific CSS stays inline *after*
  the link so pages can override (gallery.html relies on this). Change brand
  colours in `:root` in that file only.
- **The account status is two layers, and mixing them up is the live trap.**
  STORED, by the trigger: non-depletion work makes a venue `pitched`, a
  depletion makes it `placed`, a **reorder** makes it `reordering` — one fact
  each, off `activity_types.is_depletion` and `activity_types.is_reorder`
  (D86). The reorder branch is FIRST because every reorder is also a depletion.
  It only ever advances; `lost` is a human judgement it never touches.
  DERIVED, at read time: **`dormant` is 180 days quiet, computed in
  `account_status_effective()` and never stored** — deliberately, so a visited
  account comes back to life by itself. Do not copy the trigger's advance-only
  logic into it, and do not "simplify" it into the table.
- **The account list DISPLAYS `status` and COUNTS `status_stored`** (D87).
  Dormancy layers over the stored value, so counting stocking accounts off the
  displayed status drops every one that has gone quiet — 102 pairs, out of the
  number brands care about most. Both views carry `status_stored` for this.
  Reach for it in any new count or filter over account status.
- **A reorder type is a FLAG THE OPERATOR TICKS, not a code in the trigger**
  (D60/D86). `recurring_case` is ticked; `bottle_reorder` is deliberately not —
  that is his call on the Activity types page. Ticking it there backfills every
  account already on file, which is what ticking it means.
- **Two markets only:** `central_florida`, `palm_beach_county`. Never "South
  Florida" — the database enum enforces it.
- **Internal notes are never brand-facing.** `activities.notes` is internal;
  `activities.brand_visible_summary` is what a client reads. The brand-facing
  views do not select `notes`. Do not add it.
- **Portal queries are written without a brand filter, on purpose.** RLS applies
  the restriction in Postgres. Never "helpfully" add `.eq('brand_id', …)` — it
  implies the security lives in the browser, and it does not.
- **Escape anything from the database before putting it in HTML** (`esc()` in
  `portal.js`). Venue names come from HubSpot and are untrusted.
- The portal is **read-only by construction**: RLS has SELECT policies only, and
  `authenticated` holds no write grants. Writes go through `service_role` in the
  Python tooling. **The staff admin is a separate Streamlit app for this reason**
  — it connects from Python with `DATABASE_URL`, where the credential never
  reaches a browser. Do not add write grants to `authenticated` to save building
  a page; that would dissolve the guarantee for brand logins too (D61).
- **No hardcoded business data** (D60). Rates, classification rules, activity
  aliases and invoice figures live in tables the admin edits at runtime. A rule
  compiled into a script is a rule the operator cannot reach. `load_rate_card.py`
  is retired and its write path deleted — do not revive it.
- **HubSpot lands in staging; a person promotes it** (D64) — **for DEALS only.**
  `apply()` upserts `brands` and `venues` DIRECTLY, before the staging zone is
  reached (D83). Do not assume the staging zone covers anything but deals.
- **The portal is the source of record; HubSpot is an input** (D84). The
  business is moving off HubSpot, which is now a collection tool. A venue edited
  in the admin is stamped `hand_edited_at` and the sync will NOT overwrite its
  city — it files the disagreement into `staging.hubspot_venue_proposal` for the
  Venues page. **This reverses D59 for venue attributes**: do not tell the
  operator to "fix it in HubSpot" for those. Venue city goes through
  `set_venue_city_from_hubspot()`, never a bare UPDATE. `sync_hubspot.py`
  writes to `staging.hubspot_deals`, never to `activities`. Rows nobody has
  edited still take HubSpot's updates automatically — that is what keeps D59
  working — but a row with `hand_edited_at` set stops and asks. Never restore the
  old `on conflict (hubspot_deal_id) do update set …` over `activities`: it
  silently reverts every fix made in the admin. Deleting a duplicate tombstones
  the deal id in `staging.hubspot_suppressed` so a re-sync cannot resurrect it.
  `promote()` has ONE definition (`promote.py`), used by the sync and the admin.
- **Itemised expenses earn nothing, and the view enforces it** (D78). The
  `is_expense` branch is FIRST in both CASE expressions in `v_activity_money`,
  so no rate-card line can make a reimbursement earn. Reimbursements sit BESIDE
  revenue, never in it. Do not simplify that branch away; `04_money_test.sql`
  builds the dangerous case on purpose and will fail.
- **Three ways the rate card goes wrong, and they lie in different
  directions** (D78, D90). `unpriced` — no line at all — UNDERSTATES revenue.
  `uncosted` — charged, no pay rate — OVERSTATES margin. **Charge ≤ pay is
  neither**: fully priced, arithmetic correct, work loses money. That third one
  has no flag on the activity and cannot have one; it is a priced decision, not
  a data fault. 51 activities are in it, at −$1,295.
- **Mileage is a 100 percent pass-through** (D91). Every cent charged goes to
  the contractor; iHospitality keeps none. Its pay rate is set FROM its charge
  rate so the two cannot drift. A $0.00 mileage margin is the correct answer,
  not a missing pay rate — do not "fix" it, and do not remove it from the
  at-cost list either.
- **Editing a rate in the table RESTATES HISTORY, and that is sometimes right**
  (D91). Correcting a rate that was always wrong should reach back; changing a
  price from a date forward must not, and is a new row with a later
  `effective_from`. The grid shows the money impact before saving, measured by
  applying the edit and asking `v_activity_money` inside a rolled-back
  transaction — never by recomputing pricing in Python.
- **`create table if not exists` does NOTHING on live** (D91). Two `rate_card`
  CHECK constraints were declared inside it and had never existed on Supabase,
  while passing in every test. Anything added to an existing table — column,
  default, or constraint — must be restated as an `ALTER`.
- **Check prices against `v_activity_money`, NEVER against `rate_card` rows**
  (D90). A charge and a pay for the same work need not sit on the same row — a
  brand line can set the charge while `(all brands)` sets the pay, which is how
  Wodka loses $15 a case. A check comparing columns within a `rate_card` row is
  a second pricing implementation, and it already missed the largest instance
  of the thing it was written to find.
- **A charge with no pay rate is `uncosted`, not free** (D78). `unpriced`
  understates revenue and someone chases it; a missing pay rate overstates
  margin and nobody notices. Both are surfaced in the admin.
- **In the admin: never a literal `%` in a query that passes params, and never
  two `$` in one Streamlit markdown string** (D79). The first raises in
  psycopg — a COMMENT counts — and the second renders as LaTeX. Both broke real
  pages for a month. `test_admin_sql.py` checks the source for both.
- **A PERCENTAGE RATE PRICES OFF `amount`, AND A ROW WITHOUT ONE CHARGES
  NOTHING WHILE LOOKING PRICED** (D98). Dame Mas is 10 percent charged and 8
  percent paid off the gross (D94), so `quantity` says how many bottles moved
  and **`amount` says what they were worth** — the money comes from the second.
  A percentage row with a NULL amount is not `unpriced`, displays its rate, and
  reads `$0.00` as though that were the answer. It is a FOURTH failure mode
  beside `unpriced`, `uncosted` and charge-≤-pay, and nothing flagged it: it
  cost $21.08 of June 2026 commission, caught only by the Health canary.
  `amount` is editable on Review and edit. Take the figure from the depletion
  report or the invoice — **never from a per-bottle average**, because case
  discounting runs $123.00–$210.75 (D93).
- **Never `st.stop()` after `st.tabs()`** (D89) — checked by `test_admin_sql.py`
  now (D99). It halts the WHOLE script run, so every `with tab:` below renders
  blank with no error. Use `else:`. The checker is proven against the real
  pre-fix file, where all three older checkers pass.
- **An operator ruling reaches the venue matcher through `--assign`, not
  through a lower threshold** (D97). `_resolve_venue` refuses to guess and must
  keep refusing (D81); `load_missing_dame_mas.py --assign "X=Y"` (or `=new`) is
  how a person answers, and it is checked before every similarity score.
  **Apply a ruling to the HISTORY too** — renaming a venue made an Oct 2025 sale
  already on file report as unresolved for ever until it was assigned as well.
- **`Mullets Sports Bar` IS the cigar lounge** (D97, operator-ruled) — one
  premises, one row. This REVERSES D95's hold, which had kept them apart
  pending exactly this answer.
- **The sync cannot overwrite a venue NAME, only its city** (D97). `apply()`
  skips any venue already resolved by company id and its `on conflict` touches
  only `updated_at`. Renaming in the admin is safe and sticks.
- **TWO SKUS, NOT CASE DISCOUNTING** (D101, correcting D93). Dame Mas sells
  **Reposado at $123.00** and **Extra Añejo at $210.75**. A blended per-bottle
  figure is a MIX of the two, not a discount — "$163.88 a bottle" is not a price
  anyone charged. Never infer a unit price from a row's average and never reason
  about a discount curve; ask which SKUs were in the order. Six multi-bottle
  rows do not decompose into whole bottles of the two prices — the amounts come
  from the depletion report, so the model is likelier incomplete than the money
  is wrong (D56). Ask before touching them.
- **The fresh market incentive is a PASS-THROUGH like mileage** (D100). Charged
  $100.00, paid $100.00, keeps nothing. Its $0.00 margin is correct and it
  belongs in the at-or-below-cost list. Do not "fix" it.
- **A WRITING BUTTON'S `key` MUST CARRY WHAT IT WRITES TO** (D103). A Streamlit
  rerun can REPLAY a button press, so `st.button(key="save")` beside a
  selectbox delivers the replayed press to whatever the selector fell back to.
  It destroyed a real depletion — Dancers Royale's six bottles at $1,246.50
  became one at $210.75 — and reported success both times. Interpolate the
  target id: `key=f"calc_save_{target}"`. A confirm checkbox helps and is the
  house pattern, but only the key is structural. Checked by `test_admin_sql.py`.
- **`brand_product` IS NOT `rate_card`** (D102). The rate card says what we
  charge a brand for our WORK; `brand_product` says what the PRODUCT sold for —
  the gross a percentage is taken of. It feeds `activities.amount` and nothing
  else. A case of Reposado entered as a $720.00 rate line would bill Dame Mas
  $720.00 instead of the $72.00 earned, and every flag would read clean.
- **Breakage is a SURCHARGE ON LOOSE BOTTLES, PER SKU** (D102). $3.00 on every
  bottle outside a full case of ITS OWN SKU — ten Extra Añejo pay it on four.
  Base prices are $120.00 and $207.75; the loose price is DERIVED, never stored,
  so it cannot drift from the case price. Per-order breakage is wrong and only
  Eden Lounge's 10+3 proves it, which is why that row is in the test.
- **Never `disabled=<another widget>` inside `st.form`** (D92). A form does not
  rerun until submit, so the expression keeps the value it had at the start of
  the run and the widget can NEVER be enabled by clicking. It cost the Rate
  card's four money fields — unusable from the day they were written, on a page
  that rendered perfectly. Drop the form and use live widgets in a fragment.
  `test_admin_sql.py` checks for it now.
- **Open every admin page — AND EVERY TAB — in a browser before calling a
  session done** (D79, D89). And where a page takes input, TYPE IN IT (D92) —
  opening a page is not using it. It is the highest-yield check in this project and
  nothing else covers it. Tabs matter because `st.stop()` halts the WHOLE
  script run, not the block it sits in: one inside a tab killed "Edit a venue"
  from the day it was written, with a clean console and a page that looked
  perfect. Never `st.stop()` after `st.tabs()` — use `else:`.
- **Venue grade and owning contractor are STAFF ONLY and live in
  `venue_grading`, not on `venues`** (D88). Not a style choice: `venues_select`
  lets a brand read any venue row it relates to and the grant is table-wide, so
  a column there is a column a brand can `select *`. A blank grade means NOT
  GRADED YET, never a bad grade. `merge_venue()` carries grading across a merge
  — the cascade would otherwise destroy it invisibly.
- **Merging goes through a FUNCTION, never hand-written UPDATEs** —
  `merge_activity_type()` and `merge_venue()` (D81). The venue merge was five
  lines in the admin and had never once succeeded: it updated `photos.venue_id`,
  a column that does not exist. Photos hang off ACTIVITIES, not venues.
- **The portal does not yet model the retainer**, which is most of what every
  brand pays, so no revenue or margin figure here is complete. See `HANDOFF.md`.
- **The invoice PDFs are the billing source, and `parse_invoices.py` reads
  them** (D93). They carry the line detail the QuickBooks API blanks (D70),
  including the month's GROSS stated on the commission line. **Every invoice
  must add to its own stated SUBTOTAL or nothing is written** — that check
  caught three separate parse faults worth $1,120 in one month. Never match
  invoice lines by keyword; the descriptions are typed by hand. Take every line
  in the item table ending in an amount.
- **Dame Mas commission for Jul 2025 – Mar 2026 is booked MONTH-LEVEL** (D93),
  because no venue-level depletion exists for those months and bottle counts
  cannot be turned into money — the price runs $123.00 to $210.75 with case
  discounting. Any month already carrying percentage-priced rows is skipped, so
  loading a depletion summary stops the monthly row automatically. Never write
  both: that is D51's double-count.
- **DAME MAS PAYS NO PER-UNIT RATE ON A SALE** (D94). All Dame Mas sales are
  10 percent charged and 8 percent paid off the monthly commission, and nothing
  per case or per placement. `account sold` and `1st case sale` carry explicit
  0.00 / 0.00 brand lines for exactly this — do not remove them, or the shared
  `(all brands)` $25.00 pay line reaches back in and invents $325 of cost.
- **"Priced at zero" and "unpriced" are different, and the difference matters**
  (D94). Work that is deliberately free should carry a 0.00 rate line, not no
  line — otherwise a decision reads as a gap and sits in the admin's warnings
  for ever. `account visit` has always done this; Dame Mas placements do now.
- **Reclassifying an activity must not move money** (D93). Set
  `activity_type_id`; leave `source_activity_type` alone. The rate card keys on
  the raw string (D74), so that one rule is what makes classification safe.
- **The billing is the truth** (D56). Commission comes off the distributor's
  depletion report. Where the portal disagrees, investigate the portal.
  **QuickBooks is more the truth than the workbooks are** — they disagree, and
  the workbooks are the lossy copy.

## Where things are

| Path | What |
|---|---|
| `portal/` | The five portal pages, `portal.css`, `portal.js`. Servable files only. |
| `css/site.css` | Shared tokens, nav, buttons, section base, footer, mobile nav. |
| `PORTAL_PLAN.md` | Architecture doc — phases, locked decisions. |
| `HANDOFF.md` | Where the last session stopped, and the next prompt. |
| `../../Hubspot/portal_seed/admin/` | The staff admin (Streamlit). Analysis, review, cleanup. |
| `../../Hubspot/portal_seed/promote.py` | Promote / reject / suppress a staged deal. One definition, two callers. |
| `../../Hubspot/portal_seed/` | Python tooling + `db/schema.sql`. Separate repo. |
| `../../Hubspot/.env` | HubSpot token, Supabase keys, `DATABASE_URL`. Not in git. |
