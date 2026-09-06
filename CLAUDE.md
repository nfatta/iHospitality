# CLAUDE.md — standing instructions

Read these before doing anything: **`docs/HANDOFF.md` (start here — where we
stopped and the next prompt)**, `docs/PROGRESS.md` (where the build is),
`docs/DECISIONS.md` (judgment calls already made and why), `docs/PORTAL_PLAN.md`
(the WHAT — its locked decisions are final). `docs/BUILD-PLAYBOOK.md` is the HOW.

**THEY LIVE IN `docs/` BECAUSE THE REPO ROOT IS THE PUBLISH DIRECTORY.** On
26 Aug 2026 `DECISIONS.md` was found returning 200 on the deploy preview — 305 KB
of contractor pay, brand margins and invoice figures, public, with no login.
`_redirects` now force-404s `/docs/*`, which works because Netlify's `*` is a
TRAILING splat and a directory prefix is the one shape it really covers (D12).
Do not move them back to the root, and if you add another internal document,
put it in `docs/`.

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
python check_auth_settings.py          # what sign-in actually allows (the dashboard)
python backup_db.py                    # pg_dump to ~/Backups, outside OneDrive
python make_portal_icons.py            # regenerate the app icons
python create_portal_user.py --list    # who has portal access
python create_portal_user.py --email x@y --contractor "Eric Anderson"   # a field login
python create_portal_user.py --email x@y --set-role staff --contractor "Nick Fatta"
python backfill_activity_contractor.py # who did the work, from HubSpot; --apply to write
python -m pytest test_normalize.py test_sync.py test_admin_sql.py -q  # 103 tests
bash db/test/run.sh                    # schema + RLS + contractor isolation, no network
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
- **`css/site.css` IS SHARED WITH THE PUBLIC SITE — PORTAL CHROME NEVER GOES IN
  IT** (D121). It owns `nav`, `.nav-logo`, `.nav-links`, `.hamburger` and
  `.mobile-nav`, and `index.html` and `gallery.html` use every one. The portal
  navigates from a **left rail** whose class names (`.portal-sidebar`,
  `.side-links`, `.portal-topbar`, `.portal-scrim`) all live in `portal.css`;
  `renderShell()` sets `.portal-sidebar` on the `<nav>` element itself, which
  outranks site.css's bare `nav`. A sidebar written in the shared file would
  redesign the marketing site as a side effect.
- **EVERY PORTAL PAGE MUST BE IN `login.html`'s `ALLOWED` LIST** (D124). A page
  left out is not blocked — it is **silently redirected to the dashboard** after
  a successful sign-in, with no error. `business.html` behaved that way from the
  day it was written until 25 Aug 2026 and nobody noticed, because the nav link
  works once you are already inside. `requireAuth()` now carries the query
  string through, and the allowlist matches only the filename half so
  `?slug=`/`?id=` survive a login.
- **A NEW `profiles.role` VALUE FAILS SILENTLY, WITH EMPTY RESULT SETS** (D120).
  `is_staff()` and `is_contractor()` each test a LITERAL STRING, and `portal.js`
  spells them a third time. A role spelled differently in any one of those places
  returns **false**, so every gated table returns zero rows with no error, on a
  page that renders perfectly. The failure direction is the useful part — an
  unknown role sees LESS, never more — but it is silent, so the spellings must be
  kept in step. `profile_role_enum` now holds THREE values: `brand_user`,
  `staff`, `contractor` (D137). "Admin" is still only a UI label for `staff`.
- **THE CONTRACTOR ROLE: `is_internal()` IS THE LINE FOR INTERNAL DATA, NEVER
  FOR MONEY** (D137). `is_internal()` = `is_staff() or is_contractor()`, and it
  gates venues, activities, photos, notes, grades and who did what. `rate_card`,
  `contractor_pay`, `brand_retainer`, `brand_product`, `invoice_recap` and the
  billing tables **stay `is_staff()`** — a contractor holding their own pay rate
  AND the charge for the same row holds the margin on their own work. Moving a
  table across that line is a disclosure decision, not a convenience.
- **`v_internal_activity` AND `v_contractor_names` ARE `SECURITY DEFINER` VIEWS,
  SO THEIR `where` CLAUSE IS THE ENTIRE BOUNDARY** (D137). They exist because
  `activities.notes` CANNOT be column-granted: the grant is to `authenticated`,
  which is brand users and contractors alike, so widening it hands `notes` back
  to every brand and undoes D134. There is no RLS policy underneath a definer
  view — one added without its gate is world-readable to every logged-in brand.
  `db/test/11_contractor_test.sql` asserts a brand reads zero from both, and that
  assertion is proven able to fail.
- **THE PAY VIEWS GO THROUGH DEFINER *FUNCTIONS*, NOT DEFINER VIEWS** (D137).
  `security_invoker` keys off `current_user`, and a definer VIEW does not change
  it — so `v_my_pay` over `v_contractor_month_cost` came back EMPTY and
  `v_my_activity_pay` came back full of NULL money. A `security definer`
  FUNCTION does change `current_user`. Never recompute the monthly spread (D136)
  or the pricing (D90) to work around it.
- **A CONTRACTOR READING `v_activity_money` GETS ROWS WITH NO MONEY** (D137) —
  not zero rows. Contractor pages must never read it: it renders a full activity
  list with every figure blank, which looks like broken data rather than a
  boundary. They read `v_my_activity_pay`.
- **AN ADMIN IS A SUPERSET OF A CONTRACTOR, AND `auth_contractor_id()` DOES NOT
  TEST THE ROLE** (D140). Phil and Nicholas are **admins**; Eric is the only
  contractor. Both of them also work accounts, so a `staff` profile may carry a
  `contractor_id` meaning "this login is also this person in the field" — which
  grants nothing, because staff already read every rate and every salary. Every
  ownership test keys on `contractor_id`, never on the role.
- **TWO VENUE SURFACES, AND WHAT IS WITHHELD IS THE JUDGEMENT, NOT THE FACT**
  (D138). *My accounts* shows days, volume and your own earnings; *All accounts*
  shows every venue with no money and no days-since. ⚠️ **The quiet count is NOT
  concealed** — the dated activity list is right there and anyone can subtract.
  What is removed is the column, the dormant badge and the sort, because ranking
  a colleague's accounts by neglect is passing judgement on that colleague. **Do
  not "fix the leak" by hiding the dates** — that guts the tab to conceal a
  number that was never concealed.
- **A USERS PAGE THAT CAN CREATE BUT NOT RE-SCOPE IS HALF FINISHED** (D141, the
  same shape as D136). A role has no history to restate, so `set_role()` edits in
  place and REPLACES the mapping — a login moving to staff keeps no stale
  `contractor_id`. **Deactivate rather than delete**: every role helper tests
  `is_active`, so a deactivated profile sees nothing while the row survives.
  `create_portal_user.py` holds the implementation and the admin page is a second
  caller — the `promote.py` arrangement.
- **⚠️ PHOTOS ARE GATED TWICE, AND BOTH GATES MUST KNOW THE ROLE** (D153).
  `photos_select` decides who reads the ROWS; `photos_storage_select` on
  `storage.objects` decides who can SIGN THE FILES. D137 moved the first to
  `is_internal()` and left the second on `is_staff()`, so a contractor saw an
  EMPTY gallery with no error — the signing call simply returned nothing. Row
  counts cannot catch this; only opening the page can.
- **A MONEY PANEL IS GATED ON THE ROLE, NEVER ON WHETHER THE COLUMNS ARRIVED**
  (D153). `unpriced` means "no rate-card line matched", and `rate_card` is
  invisible to a contractor — so the flag reads TRUE on every activity and a
  "has money?" test shows them warnings about work priced perfectly well.
- **VENUE CONTACTS AND NOTES ARE INTERNAL, AND KEYED ON THE HUBSPOT ID** (D152).
  `venue_contact`, `venue_contact_link`, `venue_note` and `venue_profile` are
  `is_internal()` — staff and contractor, never a brand — and **none of it is a
  column on `venues`**, for D88's reason: the grant there is table-wide, so a
  contact column would be a contact list a brand could `select *`. **Never match
  a contact by NAME**: 234 of 344 have only a first name and 32 of those repeat,
  including four different people called Dan. The venue link is **many-to-many**
  (10 contacts sit on more than one venue). Refresh with
  `python sync_venue_contacts.py` — dry run by default, and it leaves a
  hand-edited contact alone (D84).
- **⚠️ THE SITE IS LIVE, AND `main` DEPLOYS TO ihospitality.vip ON MERGE.**
  Work on a branch, open a PR, and check the **deploy preview** before merging —
  the public homepage is the only thing that can regress and it is the thing
  nobody looks at. Production sat three weeks behind `main` until 27 Aug 2026,
  so the merge also shipped a CSS refactor that had never been deployed.
- **⚠️ BEFORE DEBUGGING ANYTHING REPORTED FROM A PHONE, CONFIRM THE PHONE HAS
  THE DEPLOY** (D150). The portal is a PWA whose service worker caches the shell
  BY DESIGN, so a stale phone is a permanent failure mode rather than an
  occasional one. Two reports came in the same afternoon; one was a real bug and
  one was entirely cache, and both cost a round of investigation.
- **AND CHECK YOUR OWN TOOLING BEFORE BLAMING A SETTING** (D151).
  `check_auth_settings.py` reported a broken redirect that was its own bug —
  `redirect_to` is silently ignored when nested under `options` — and the
  operator changed Supabase settings twice chasing it. **Check the endpoint the
  APPLICATION calls**, not a convenient admin equivalent: `/auth/v1/recover`
  answers in one call what the admin API obscured.
- **THE DASHBOARD IS THE ONE PART SOURCE CONTROL CANNOT SEE.** Site URL, Redirect
  URLs, SMTP, providers and `disable_signup` all live in Supabase.
  `python check_auth_settings.py` reads GoTrue's own settings and reports what is
  TRUE rather than what was intended. Run it after any change there.
- **WHAT KEEPS STRANGERS OUT IS PRE-CREATED ACCOUNTS PLUS `disable_signup`, NOT
  ANYTHING IN THE PAGE** (D149). Google's consent screen is **External** on
  purpose — Internal would lock out brands, who are most of who the button is
  for. `hd` was tried and removed: it locks the account chooser to a workspace,
  which is a real behaviour even though it is not a security control. Verified
  by the operator: a Google account with no portal login is refused.
- **`beforeinstallprompt` FIRES ONCE AND EARLY, SO IT IS CAUGHT AT MODULE SCOPE**
  (D148). A listener inside `renderShell()` misses it on a slow connection and
  the Install button never appears, on a portal that is perfectly installable.
  iOS fires nothing at all, so it shows instructions rather than hiding.
- **A FLEX ITEM THAT MUST SCROLL NEEDS `min-height: 0`** (D150). It defaults to
  `min-height: auto` and refuses to shrink below its content, so the rail's link
  list pushed the footer — holding Sign out — off the bottom instead of
  scrolling, *whatever height the rail had*. `100vh` was the other half: on a
  phone it is the LARGE viewport, so the rail ran past the fold whenever the
  address bar was showing. It is `100dvh` now.
- **ONE ICON ARTWORK, DECLARED `"any maskable"`** (D150). Separate `any` and
  `maskable` entries let Chrome pick the `any` one and shrink it onto a white
  square. A solid colour field with centred letters needs no separate versions.
  Android masks every home-screen icon to the launcher's shape, so a hard-edged
  square cannot survive one — do not try to fight it. Regenerate with
  `python make_portal_icons.py` in `portal_seed`; it writes across into the
  website repo, because that repo gitignores `*.py` so a script cannot be served
  at `ihospitality.vip/<name>`.
- **`reset.html` IS THE ONE PORTAL PAGE THAT MUST NOT CALL `requireAuth()`, AND
  MUST NOT BE IN `ALLOWED`** (D144). It is reached from a recovery link with no
  session; `requireAuth()` would bounce the person back to the login page they
  cannot get past. `ALLOWED` is the set of places a SUCCESSFUL sign-in may land,
  and this is not one. **Password changes do NOT weaken D61** — they go through
  GoTrue, not PostgREST, and add no write grant on any table in `public`.
- **⚠️ THE RESET FLOW IS BLOCKED ON SUPABASE CONFIG, NOT ON CODE** (D144). A
  recovery link asking to redirect to the portal comes back pointing at
  `http://localhost:3000`: the requested redirect is silently overridden by the
  **Site URL**, still the project default. Fix the Site URL and add the reset
  page to the **Redirect URLs** allow-list, and configure custom SMTP — the
  built-in mailer is rate-limited per address.
- **THE GOOGLE BUTTON ASKS WHETHER IT IS ENABLED** (D145). `/auth/v1/settings`
  is readable with the publishable key, so `login.html` queries it rather than
  carrying a provider list (D60). **Accounts are still made once, in the admin**
  — Google ATTACHES to the existing account with the same verified address.
  **`hd` is a hint to Google's account chooser, not a control**; what stops a
  stranger is pre-created accounts plus `disable_signup`.
- **⚠️ AN ENUM VALUE MUST BE APPLIED AND COMMITTED BEFORE ANYTHING USES IT**
  (D142). The `do $$ create type ... exception when duplicate_object` block only
  covers a FRESH database — D91's rule in its enum form — and Postgres refuses to
  USE a new value in the transaction that ADDED it. `schema.sql` marks its
  `alter type ... add value` statements between two markers and
  `apply_schema.py` runs, commits and STRIPS them before applying the rest. Put
  any new enum value between those markers. Related: a SQL function body is
  validated at CREATE time, so a function reading a column must be defined AFTER
  the ALTER that adds it.
- **THE GALLERY IS BOUNDED, AND PHOTOS ARE THE ONLY TABLE HERE THAT GROWS
  WITHOUT LIMIT** (D122). Postgres orders and slices (`.order(...).range(...)`),
  the filters are applied **server-side** — filtering a page after it arrives
  shows 60 rows drawn from the wrong set — and the dropdowns are built from
  three small tables (`v_brand_monthly_summary`, `brands`, `v_activity_mix`),
  never from the photo rows, because reading every photo to populate a control
  is the thing being avoided. The page order must be TOTAL
  (`activity_date, activity_id, id`) or a page boundary repeats or drops a row.
- **A PHOTO'S DESCRIPTION IS `summary`, NEVER `caption`** (D122). `photos.caption`
  is deliberately left NULL — filling it from the HubSpot note body would publish
  internal writing (D17/D24). `v_brand_photos.summary` is already
  `coalesce(brand_visible_summary, title)`.
- **SHOW `uncosted_charge` BESIDE MARGIN, NEVER SUBTRACTED FROM IT.** The view
  carries it precisely "so the margin figure can be read with the size of its own
  blind spot next to it". The cost is unknown, not zero. And the two flags lean
  opposite ways: **`unpriced` UNDERSTATES revenue, `uncosted` OVERSTATES margin.**
- **`business.html` IS THE COMPANY; `brands.html` IS PER BRAND** (D130). They
  overlapped badly until 26 Aug 2026 — Business read `v_brand_money` all-time
  while Brands read `v_brand_month_revenue` over a month range, so Business was
  a strictly worse copy of the table next door. Business now reads
  `v_month_business` and owns the two figures nothing else shows: **contractor
  base pay and NET**. Every other margin in the portal is before base pay, on
  purpose (D67/D116) — reading it one level up in `v_month_business` is what
  shows the number without allocating it to brands. Label base pay as an
  ANNUALISED SPREAD or it reads as a bank figure.
- **THE VENUE LIST IS NOW THE ACCOUNT UNIVERSE, AND `lifecycle` IS A THIRD AXIS**
  (D157). A HubSpot company only becomes a venue when it lands on a **deal**, so
  108 places we knew had never had a row; they exist now, each carrying its
  Record ID. `venue_grading.lifecycle` is `prospect` (known, never worked),
  `retired` (worked, stopped — the 20 Fresh Market stores) or null (active).
  ⚠️ **It is NOT the account status.** `brand_venue_status` is per BRAND and
  advance-only; `dormant` is derived at read time in
  `account_status_effective()` and never stored (D86/D87). Lifecycle is per
  VENUE, is a person's decision, and says nothing about recency. It sits on
  `venue_grading` because a column on `venues` is a column a brand can
  `select *` (D88). Compare a fresh export on the Venues page's **Compare
  against HubSpot** tab — the matching itself is `bucket_export()` in
  `normalize.py`, so it is testable without Streamlit.
- **NEVER FUZZY-MATCH THE OPERATOR'S ACCOUNTS** (D163). The distributor's flash
  names accounts differently from both the masters and the portal. Matching
  proposes; only Nicholas adopts. Left alone it offered **Universal Studios**
  (58 FYTD cases) for "University Wine and Spirit" and collapsed three Orlando
  bars onto one customer. It also failed **silently**: six flash names are shared
  by several stores, and a name-keyed lookup scored our Port St Lucie account off
  the Boca Raton one. The customer number (`700xxxxxx`) is the only durable key.
  ⚠️ **Verify the mapping with him BEFORE building anything on it** — *"building
  doesnt make sense if the data is wrong."*
- **A REORDER IS AN OUTCOME, NOT AN ACTIVITY** (D161/D162). It is logged as
  `recurring case` at $0.00 in the activity master, netted against cases already
  billed as `Case Sale`, and **last year's cases live in last year's master**.
  An account with cases in EITHER year gets a row: a lapse is a real loss, and
  counting only this year's buyers turned a **-7.3%** month into **+33.3%**.
- **A `closed` ACCOUNT AND A `retired` ONE ARE DIFFERENT FACTS** (D159).
  `lifecycle` holds FOUR values now: null, `prospect`, `retired`, `closed`.
  `retired` is OUR decision, it reverses, and the place is still trading — the 20
  Fresh Market stores. `closed` means the premises is out of business and does
  not reverse. Fold them together and the "who do we go back to?" list fills with
  bars that no longer exist. ⚠️ **"Stops showing up under venues" is TWO
  surfaces** — the admin page is a filter, but the portal's account lists read
  `v_venue_performance`, which is a view change and a deploy.
- **THE SCORECARD'S `uncharged_value` COMPUTES TO $0.00, AND RATES DO NOT
  TRANSFER BETWEEN BRANDS** (D160). The rate card records what a brand is
  CHARGED; a LIST PRICE is a different field and exists nowhere. 44 North's
  account visits and drink development are carded at $0.00, so "value the free
  work at rate card" returns nothing — the fourth way the rate card goes quiet,
  beside `unpriced`, `uncosted` and charge-≤-pay. ⚠️ **Never value one brand's
  work from another brand's rate** (operator: *"all brands are charged
  differently"*), and taking the max across brands is the same mistake as a
  formula. **Two of the four headline metrics need a placements table** that does
  not exist — and NOT `brand_venue_status`, which is advance-only (D86).
- **⚠️ AN IMPORT MUST NEVER ERASE A VENUE** (D158). "No company on the deal"
  means "no information", never "this happened nowhere" — the portal is the
  source of record (D84). Deleting one company in HubSpot silently nulled the
  venue on three real activities, on a run that reported only success;
  `promote()` now `coalesce`s `venue_id` in both branches, and
  `test_admin_sql.py` fails on the old text. **The sync can set or change a
  venue and can no longer remove one**; clearing one is a human action in the
  admin. **Take before-and-after row counts around any import** — nothing else
  found it.
- **THE MONTH-END PULL IS A BUTTON ON REVIEW AND EDIT** (D157), above the queue
  it fills, with the date of the last pull in its label. It previews (network,
  no writes) then applies, and both halves call the same `fetch_rows()` /
  `apply()` in `sync_hubspot.py` that the CLI does — the `promote.py`
  arrangement. It changes nothing about the staging contract (D64).
- **A VENUE PAGE LINKS BY `venue_id`, NEVER BY `venue_name`** (D129).
  `v_brand_activity_log` carries `venue_id` for exactly this. A name match works
  today (441 venues, no colliding names) and blends two premises into one
  history the moment a chain arrives, with every figure wrong and nothing on
  screen to say so. A venue is SHARED — Levee Liquors holds 8 brands — so the
  query carries no brand filter and RLS scopes it; verify by impersonation, not
  by logging in (D125).
- **`v_venue_performance` IS ONE ROW PER BRAND PER VENUE, AND INTERNALLY THAT IS
  THE WRONG GRAIN** (D156). It joins activities on `brand_id` as well as
  `venue_id`, so every figure on a row is that BRAND's slice — which is right for
  a brand and wrong for us. Big C Liquors listed five times with four rows saying
  dormant, on a bar visited 121 days ago. `foldVenuesByVenue()` in `portal.js`
  folds it to one row per venue for `is_internal()` callers only; a brand keeps
  the per-brand grain. **Status is the FURTHEST any brand has reached**, never the
  most recent one — the most-recent rule understated 23 venues and understated
  every one. ⚠️ **Dormancy is BORROWED from the most recently visited row, never
  recomputed**: the 180 days lives in `account_status_effective()` and a second
  implementation in JavaScript is how the two come to disagree (D86). And note
  "Stocking" now counts VENUES, not relationships — 220 became 163.
- **THE MONTH RANGE OPENS ON YEAR TO DATE, AND ITS YEAR COMES FROM THE DATA, NOT
  FROM `new Date()`** (D155). `monthRange()` is shared by `brand.html`,
  `brands.html`, `business.html` and `my-pay.html`, so its default is four pages
  at once. The year is taken from the NEWEST MONTH ON RECORD because the data
  lags the calendar — a month is not complete until it is over and the invoices
  land later still — so anchoring on today's date opens **every January on an
  empty range**, and that failure arrives on a DATE rather than on a deploy.
  Which months exist is a business fact and belongs in the query (D60). The two
  selects are labelled **Start date / End date**, with no `aria-label`: a visible
  label and an aria-label saying different things is the one thing a label must
  never do.
- **Anything saying "revenue" reads `v_brand_month_revenue` or `v_month_business`,
  NEVER `v_brand_money`.** The latter is activity charge only, and the retainer is
  about two-thirds of what iHospitality sells ($110,850 of $167,580) — sourcing
  revenue from it understates every brand by that much and can flip margin's sign.
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
- **`activities` IS GRANTED PER COLUMN, AND `notes` IS NOT ONE OF THEM** (D134).
  A brand login holds SELECT on the TABLE — the brand-facing views are
  `security_invoker`, so the caller needs it — which meant `select notes from
  activities` worked for a brand until 26 Aug 2026 even though every view
  carefully omits it. The grant is now a written-out column list: **a column
  added to `activities` later is NOT granted**, and a view selecting it fails
  loudly for brand users rather than quietly publishing it. `db/test/run.sh`
  asserts it, with a control so the check cannot pass by locking everyone out.
- **WHO DID THE WORK IS `activity_contractor`, STAFF ONLY — NEVER A COLUMN ON
  `activities`** (D135, same trap as D88). A brand can `select *` on
  `activities`, so a `contractor_id` there publishes our staffing of their
  accounts. Blank means NOT RECORDED, never "nobody". **It is now 1,059 of 1,238
  (86%) filled from the HubSpot DEAL OWNER** (D139) — not a guess: every one of
  the 1,057 deal-linked activities resolved, and the 179 with no deal id stay
  blank. Refresh with `backfill_activity_contractor.py` (dry run by default; the
  dry run runs and rolls back, so it is a true preview). **Cost to serve still
  does NOT read it** (D116) — that was because it was blank, and it no longer is,
  so switching the allocation from venue-ownership to real attribution is now a
  live decision nobody has made.
- **A PAY PERIOD CAN BE CORRECTED IN PLACE, AND A RISE STILL CANNOT** (D136,
  D91's rule applied to `contractor_pay`). "Set or change pay" is add-only for a
  RISE; "Correct a pay period" edits in place for a record that was never true,
  and shows the money it restates before saving. Use it for D128's start dates.
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
- **AN ACTIVITY CAN NOW BE ADDED IN THE ADMIN WITH NO HUBSPOT DEAL** (D132) —
  "Add a missing activity" on Review and edit. For work that was never a deal: a
  distributor-driven reorder nobody visited for (D118), or a line found on an
  invoice afterwards. The row has **no `hubspot_deal_id`**, so the sync can
  neither revert nor duplicate it (D84). It picks `source_activity_type` from
  strings the rate card already knows (D74), refuses to create venues (D81),
  refuses an exact duplicate because the quantity is the multiplier (D65), and
  **prices the row by inserting it and rolling back** (D91) so charge, cost and
  margin are on screen before saving. `activities_date_not_future` is a CHECK
  constraint — an activity cannot be dated ahead of today.
- **A STAGED DEAL IS CORRECTED BESIDE ITSELF, NEVER INSIDE ITSELF** (D167).
  `staging.hubspot_deal_correction` holds a person's ruling and `promote()` lays
  it over HubSpot's values, so a miscategorised deal is fixed BEFORE it lands.
  **Editing `staging.hubspot_deals` destroys the zone it edits**: a BEFORE
  trigger recomputes `content_hash` FROM the edit so the row reads `in_sync`
  with a value HubSpot never sent, `apply()` overwrites it on the next pull, and
  nothing asks — `conflict` needs `hand_edited_at`, which lives on the ACTIVITY.
  A source checker fails on that shortcut. The correction's venue is a
  **`venue_id`, not a name**, because `_resolve_venue()` prefers the company id
  and would silently ignore a name. `based_on_hash` records WHICH version was
  ruled on, so a correction about superseded facts becomes a `conflict` instead
  of re-applying itself.
- **⚠️ `resolve_activity_type()` IS A WRITER AND LOOKS LIKE A READ** (D167). It
  CREATES and flags anything unrecognised — which is what `promote()` wants and
  what a report never does. A query written to LIST the rate card's vocabulary
  made nine junk `activity_types` rows. **49 rate-card strings currently have no
  type alias**, so they are the ones that will do it.
- **THE PULL CAN GO BY CLOSE DATE, NOT JUST BY LAST-MODIFIED.** On Review and
  edit, "A whole month" filters `closedate` in a half-open interval — so pulling
  in September for deals CLOSED in August catches ones edited after the 31st.
  The bound is `< the 1st of the next month`, never `<= the last day`:
  `closedate` is a timestamp, and the second form compares against midnight and
  silently cost 12 of June 2026's 103 deals.
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
- **THE FLASH IS THE ONLY SOURCE FOR REORDERS, AND IT IS READ ON THE FLASH PAGE**
  (D168). Upload the month's EOM CSV; the customer number `700xxxxxx` is the
  durable key and it hangs off the DISTRIBUTOR, not the brand, because it is the
  account's liquor licence - so one mapping serves every brand. ⚠️ **The grain is
  the MATCH GROUP**, a connected component of the venue/number graph, with both
  sides summed: Hampton bills on and off premise under two numbers and Aku Aku
  shares a licence with Stardust. ⚠️ **The month cannot be derived from the
  file** - July's flash was pulled on 8/2 and August's on 8/31 - so the operator
  picks it. Idempotency is `external_ref`, so re-uploading a month updates rather
  than duplicating, and anything already recorded never appears in the add list.
- **⚠️ THE FLASH DECIDES REORDER OR FIRST SALE, NOT OUR OWN HISTORY** (D173).
  Asking our activities "has this account bought before" answers NO for almost
  everybody, because a reorder arrives through the distributor's rep with no
  visit and was never logged (D118). June 2026 proposed **14 first-time case
  sales out of 18** where the distributor's FYTD and last-year columns say 51 of
  61 had bought before. Read the flash; keep our history as a second opinion
  only. ⚠️ In the FIRST month of a fiscal year FYTD equals MTD for everybody, so
  that month rests on the last-year columns alone.
- **⚠️ A VENUE WITH NO CUSTOMER NUMBER IS INVISIBLE TO THE FLASH** (D174), and
  its cases get proposed a SECOND time under whichever venue does hold the
  number. That is how June carried 6 cases at Secrets against a flash of 3.
  Read tab 3's *our cases at a venue with no customer number* BEFORE accepting
  anything on tab 2. And **check what `merge_venue()` does not rescue** before
  merging: `venue_note`, `venue_contact_link` and `venue_profile` cascade.
- **⚠️ A RUNNING STREAMLIT IS NOT THE CODE ON DISK** (D173). A fix committed at
  23:11 cannot explain an import that ran at 23:10, and the admin holds whatever
  it started with. When a fix "does not work", compare the two clocks before
  looking anywhere else -- and restart the admin after any page change.
- **A RETURN IS A NEGATIVE DEPLETION AND STAYS VISIBLE** (D169). `case_return`
  carries a case equivalent of **-1.0**, so the quantity stays positive (the
  CHECK forbids a negative one) and `sum(quantity * case_equivalent)` nets to
  zero by itself. Never net a return away silently: the brands read this data.
- **⚠️ CONTRACTOR PAY IS MODELLED EVEN WHEN NOBODY DRAWS IT** (D171). A
  contractor is who DID the work, not who was paid. Phil takes nothing on a
  reorder and Nicholas and Eric do get paid, and the rate stands either way so a
  month can answer what it would cost with someone hired into that seat.
  **Reorders therefore make activity margin NEGATIVE and that is correct** -
  `recurring case` is $0.00 charge and $5.00 pay for 44 North (D118). Do not
  "fix" it. And **a blank contractor is missing pay, never free work** (D135).
- **RULE IN THE TABLE, NOT IN A PICKER BESIDE IT** (D170). Operator preference,
  6 Sep 2026: *"can we just make the table able to be edited? That is so much
  easier for me instead of the drop down."* When a page asks for the same
  decision on many rows, put the deciding column IN the grid with
  `st.data_editor` and one Save, rather than a selectbox that walks one record
  at a time -- thirty accounts is thirty round trips otherwise. **Most of the
  time, not always**: a single-target action, or one whose inputs differ per
  row, is still better as a form. Two rules survive the change and both are
  load-bearing: nothing may be pre-selected on a grid that writes (a blank
  default means an unread row writes nothing), and the editor's `key` must
  carry the filter and the row count as well as the page's subject, because
  `st.data_editor` keeps edits by ROW POSITION and will re-project them onto
  whatever now sits in that row (D103).
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
- **THE INVOICE-VS-PORTAL RECONCILIATION IS DONE AND SAVED** (D107). Result at
  `portal_seed/reconciliation/invoice_vs_portal_2026-08-23.csv`; refresh with
  `python check_invoice_totals.py`. **Do not re-derive it by hand.** All 64
  invoices tie to their own stated SUBTOTAL — if that ever drops below 64 the
  parser broke, so fix the parser and never the numbers.
- **A BILLING NAME CAN COVER SEVERAL BRANDS** (D107). Coors Whiskey bills Five
  Trail, Barmen 1873 and its own retainer on ONE invoice and splits them
  nowhere — `brand_billing_member` says so, and the pool is the finest grain
  that exists. And **a name identifying one brand beats a shared payer**: Blue
  Run's invoices also say "Coors Whiskey Co", and a longest-match rule handed
  all ten of them to the wrong pool.
- **An invoice's structural charges are told from pass-throughs by SHAPE**
  (D107). A pass-through is a description and ONE amount; anything with QTY,
  RATE and AMOUNT is priced work. Vocabulary does not work — on the nested
  layout the retainer line is bare and its name is on a line the item scanner
  never sees.
- **The invoice wins and the PORTAL gets corrected** (D107, sharpening D56).
  The portal is not live; the invoices are sent and paid. But **never by
  creating duplicate deals**, and never by deleting Aug 2026 (billed in
  arrears) or Aspen Green Feb–May 2026 (`uninvoiced` on purpose, D71).
- **Never `disabled=<another widget>` inside `st.form`** (D92). A form does not
  rerun until submit, so the expression keeps the value it had at the start of
  the run and the widget can NEVER be enabled by clicking. It cost the Rate
  card's four money fields — unusable from the day they were written, on a page
  that rendered perfectly. Drop the form and use live widgets in a fragment.
  `test_admin_sql.py` checks for it now.
- **VERIFY RLS BY IMPERSONATION IN POSTGRES, NOT BY LOGGING IN** (D125). Never
  create a login to test with. `auth.uid()` reads `request.jwt.claims->>'sub'`,
  so `set local role authenticated` plus `set_config('request.jwt.claims', …,
  true)` inside a rolled-back transaction reproduces exactly what a browser
  session gets — and probes every staff table at once, which clicking cannot.
  **The control is the critical half**: assert `is_superuser = off` AND assert
  the impersonated counts DIFFER from the service_role baseline, or the check
  cannot fail and proves nothing (D114). It covers isolation completely and
  rendering not at all.
- **AND OPEN IT AS THE ROLE THE CHANGE WAS *NOT* ABOUT** (D154). A guard that
  says "not you" can never be exercised by the role it excludes, so the only
  eyes that can catch a fault in it belong to the role nobody re-checks —
  the feature was not for them. D153 was built for a contractor, verified as a
  contractor, and shipped a `ReferenceError` that fired **for admins only**,
  blanking the activity page for both of them. The page kept its heading and
  date, so it read as half-loaded rather than broken.
- **Open every admin page — AND EVERY TAB — in a browser before calling a
  session done** (D79, D89). **This covers the brand portal's pages too.** And
  where a page takes input, TYPE IN IT (D92) — opening a page is not using it.
  It is the highest-yield check in this project and nothing else covers it.
  SQL can prove the numbers and prove the isolation; only a browser proves the
  page renders. Tabs matter because `st.stop()` halts the WHOLE
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
- **BASE PAY IS ALLOCATED TO BRANDS IN EXACTLY ONE PLACE, AND IT IS NOT A VIEW**
  (D116, qualifying D67). The Analysis page's **Cost to serve** tab pushes each
  contractor's base pay down onto brands by their own share of activities.
  `v_month_business` still holds base pay one level up and every other margin
  figure in the app and the database excludes it. **Do not "promote" the
  allocation into a view** — D67's fear was that downstream numbers would
  inherit it silently, and the page-only split is what still guards that. Its
  weaknesses are on the page on purpose: it counts activities not hours, it
  attributes by who owns the venue NOW, and **serving a brand less makes it look
  more profitable** — Dame Mas reads −$11, +$18 or +$368 depending on window and
  method, so the honest word for it is **break-even**.
- **A REORDER IS NOT A VISIT, AND THAT IS WHY 228 CASES WENT UNBILLED** (D118).
  Reorders reach the venue through the DISTRIBUTOR'S rep, with no iHospitality
  visit — so there is nothing to log and no amount of contractor discipline
  finds them. **The distributor's depletion sheet is the only source**, and 44
  North's says 291 cases moved at our accounts Jan–Jul 2026 against 63 billed.
  The rate card makes it structural: `recurring case` charges **$0.00 and pays
  $5.00**. One reorder exists in 44 North's entire history. Never read a low
  reorder count as a recording failure.
- **CHECK WHETHER A BRAND IS FALLING THROUGH TO THE SHARED `(all brands)` PAY
  LINE** (D118, same shape as D94). Wodka charges $10.00 a case and has no pay
  rate of its own, so the shared `1st case sale` line pays **$25.00** — 61
  cases, **−$915**, while its reorders at $10/$5 are correct. A brand line that
  sets a CHARGE without a PAY silently inherits someone else's cost.
- **TAP AND KEG WORK IS BILLABLE AND KEEPS BEING FILED AS A FAVOUR** (D118).
  `tap cocktail` is **$200** for 44 North and $150 for Wodka; `market favor` is
  rate-carded at **$0.00** for every brand. 51 tap/keg activities sit in the
  $0.00 buckets against 9 billed correctly. If it involves building, batching or
  servicing a tap, it is a tap line — never a favour.
- **GRADING AND ROUTES ARE DESIGNED, NOT AGREED** (D117). Read D117 before
  handing anyone a grading sheet. **Cap A as a share of capacity, never a flat
  number** — ten A's is 71 percent of Phil. **A is a campaign, not a status.** A
  **90-day floor** on every venue that has ever bought is the only version whose
  arithmetic fits. And a B graded on POTENTIAL **drops to D after 90 days
  without a sale**, or the grade and its cost persist for ever.
- **AN INVOICE'S DISCOUNT AND ITS CARD FEE ARE NOT WORK** (D119).
  `TOTAL = SUBTOTAL − DISCOUNT + TAX`, and all three are payment mechanics.
  Reconcile against **`SUBTOTAL − expenses − payment fees`**, with the discount
  excluded entirely. Every Coors invoice carries an early-payment discount, and
  those nine discounts *were* the −$81.09 D115 recorded as a gap. A fee is the
  mirror image — usually charged and then discounted straight back off, so
  comparing TOTALS hides it and comparing SUBTOTALS leaves it in. The one
  definition handles both, and fixed seven months across three brands.
  **Fee lines are the ONLY keyword match allowed** (D93 bans the rest): they
  come from QuickBooks' product catalogue, not the operator's keyboard.
- **`quantity = 0` MEANS "THIS HAPPENED AND WAS NOT BILLED"** (D119, operator
  ruling). *"If it is in the workbook it's to be there, but if it isn't on the
  invoice then it wasn't billed. The invoices are the dues."* Since D65 the
  quantity is the multiplier, so zero keeps the row, its venue, its photo and
  its HubSpot deal while contributing nothing to the money. **Reach for it
  before considering a deletion** — it satisfies D85 and D107 at once and is
  reversible. Never delete real work to make a month tie.
- **A BRAND FALLING THROUGH TO THE SHARED `(all brands)` PAY LINE IS A FACT TO
  CHECK, NOT A FAULT TO FIX** (D119, correcting D118). Wodka's `1st case sale`
  pays $25.00 off the shared line and **that is correct** — *"reorder is $5,
  initial is $25"*. Handoff item A told the next session to lower it to $5 and
  would have cut $915 of real contractor pay. The −$915 is the CHARGE side:
  $25 to place a case, $10 billed. That is a priced decision for the operator
  (D60), not a data fault, and it carries no flag because it cannot.
- **THE CANARY POOLS BRANDS, AND ONE BRAND MUST RESOLVE TO ONE LABEL** (D119).
  A Coors invoice covers Barmen 1873, Five Trail and Coors Whiskey and splits
  them nowhere, so `canary()` derives a pool label and applies it to **both**
  sides of the comparison — pool one side only and the two do not meet. The
  join is on the brand, so two labels for one brand double-counts its activity
  silently. `verify_live.py` asserts it. Write pool recaps with
  `load_pool_recap.py`, never `parse_invoices.py --apply` (D108).
- **NOTHING BEFORE THE PORTAL'S OWN HORIZON** (D119, operator ruling).
  QuickBooks holds Coors invoices back to Dec 2024; the portal's activity
  starts 2025-06-06. Those six invoices, $17,036.02, are **not a gap** — there
  is no activity to compare them against and never will be. The horizon is read
  from `min(activity_date)`, never hardcoded (D60).
- **FOUR THINGS ON AN INVOICE ARE NOT WORK, AND EACH ONE FAKED A GAP** (D119).
  Beside the discount and the card fee: a **balance carried forward** is money
  already counted in the month it was first billed (Wodka's 3200, $90); a
  **goods invoice** — no commission, no retainer, and SALES TAX — is barrels
  shipped to the brand, not a month of work (3159 and 3178, $1,304.56); and an
  **ACTIVITY DATE equal to the issue date** says nothing about when the work
  happened, so the arrears rule applies (3203, which put $455 in the wrong
  month). **Tax is what tells goods from services** — 3203 has no commission
  and no retainer either, but it is two tasting events, untaxed, and stays in
  its month: *"Dame Mas has us charge for activities separately but they are
  logged."*
- **HEAVEN'S DOOR BILLS ACCOUNT VISITS AT $20** (D119). Every other brand's
  invoice reads "Sales call/buyer tasting - no charge"; Heaven's Door's reads
  the same words with a $20 rate, inside the consulting block. The rate card
  prices `account visit` at $0.00 for all eight brands, so those visits are
  invisible. Its commission ties EXACTLY in both checked months, so this and a
  "Smoke Tops" line are the whole of its difference.
- **THE RETAINER IS MODELLED NOW — `brand_retainer`, 13 rows across 8 brands.**
  This line used to say it was not, and stayed wrong long enough to mislead:
  revenue reads `v_brand_month_revenue` or `v_month_business`, both of which
  include it. What is still incomplete is the RECONCILIATION, not the schema.
  Never source revenue from `v_brand_money` — that is activity charge only, and
  the retainer is **69.2% of what iHospitality sells**.
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
- **NEVER RUN `parse_invoices.py --apply` FOR A PER-UNIT BRAND** (D108). Its
  double-count guard asks only `charge_pct is not null` — it recognises a month
  as already-priced only when the pricing is a PERCENTAGE, which is the Dame Mas
  model it was built for. Every other brand is priced per unit, so the guard sees
  nothing and the script writes a month-level commission row on top of work
  already there: **$11,667.10 of duplication for 44 North, $2,990 for Wodka,
  $5,652.10 for Blue Run.** Write `invoice_recap` directly instead. The guard
  needs widening to "any billable charge", not just a percentage one.
- **A SYNTHETIC `Invoice-derived` ROW IS A QUESTION, NOT A FAULT** (D108). 63 of
  them exist across nine brands, $7,035, all written in one pass on 21 Aug. Each
  claims the invoice billed work the portal never received. **That is true for
  some brands and false for others**, so there is exactly one test: *does the
  work already exist elsewhere in the portal?* Wodka's ten were duplicates and
  are gone; Blue Run's stand in for barrels and half cases that really are
  missing and must stay. **Do not bulk-delete them** — 44 North's June 2025 ties
  at exactly 0.00 and holds $660 of them.
- **THE WORKBOOK DECIDES ACTIVITY; QUICKBOOKS DECIDES TOTALS** (D110). Check the
  PDF parse against the QuickBooks totals BEFORE reasoning about lines — QB
  blanks service lines (D70) but its totals are complete, so it is the only
  independent proof that no invoice was missed. The operator's EOM workbooks are
  reliable for what happened and unreliable for what was billed: **barrels were
  never entered in them**, Blue Run's disagrees with QuickBooks on 6 of 14
  invoices, and Starr Rum's carries a November row for an invoice that does not
  exist.
- **`account sold` IS DECIDED BY THE INVOICE, NEVER BY THE LABEL** (D112). A
  contractor entered it for both visits and sales. The operator's test: *if the
  month bills cases nothing else accounts for, the row IS that case sale; if the
  billed cases are already accounted for, it is a visit.* There is **no
  `account_sold` activity type** and one must not be created — it is a raw SOURCE
  string that sits under Bottle Sale, Case Sale, Case Reorder or Account Visit
  depending on the brand.
- **A WRONG QUANTITY IS WRONG MONEY, AND IT LOOKS ORDINARY** (D113). Since D65
  the quantity is always the activity multiplier. Four rows have been found
  carrying inflated quantities — Pourhouse Lounge 12, Debauchery 3, Executive
  Cigar 6, Meg O'Malley's 6 — worth $1,110, every one a real activity with a real
  HubSpot deal. **The type and the quantity go wrong together**: two of those
  were also case sales filed as visits. Correct them, never delete (D85), and
  note the deal id — HubSpot still holds the wrong figure and a promote could
  revert it.
- **MONEY SITTING ON A VENUE-LESS ROW USUALLY MEANS A NULL `source_activity_type`**
  (D111). Starr Rum tied 7 of 7 on placeholder rows because 63 of its 84
  activities had no source string, so the rate card could not price them (D74).
  The fix is CLASSIFICATION, not deletion: classify the real rows, confirm the
  brand total does not move, and only then remove the placeholders.
- **CHANGING A DEPLETION TO A NON-DEPLETION LEAVES THE STATUS WRONG** (D86/D113).
  The trigger only ever ADVANCES, so it will not undo `placed`. Where the
  corrected row was a venue's ONLY depletion, walk the status back by hand —
  `status='pitched'`, `first_placed_on=null` — and guard it on `not exists` any
  other depletion.
- **THE CANARY COMPARES THE PORTAL AGAINST NUMBERS SOMEONE TYPED** (D114). Its
  invoice side is `invoice_recap`, so where a figure was transcribed from the
  same belief the portal holds, it ties by construction. It showed a false green
  and a false red on 44 North in one morning. It now reads `commission +
  billable + mileage` (all coalesced; `consulting` stays out because the retainer
  is not activity) — but **the circularity is not fixed**, and it **cannot show
  the Coors pool at all**, because `invoice_recap` is keyed on one brand and
  those invoices belong to three.

## Where things are

| Path | What |
|---|---|
| `portal/` | The sixteen portal pages, `portal.css`, `portal.js`, `sw.js`, `manifest.webmanifest`, `icons/`. Servable files only. |
| `portal/my-venues.html`, `my-pay.html` | The contractor's own surface (D137). Also on the admin rail (D140). |
| `portal/brands-info.html`, `training.html` | Deliberate "Coming soon" stubs — V2. |
| `portal/reset.html` | Set a new password. No `requireAuth()`, not in `ALLOWED` (D144). |
| `_headers` | Netlify response headers: the manifest's content type, `sw.js` not cached, `/portal/*` noindex (D148). |
| `_redirects` | Force-404s `docs/` and `CLAUDE.md`. **The `!` is required** or Netlify serves the file instead (D133). |
| `portal/sw.js` | Service worker. **Caches the SHELL ONLY, never a Supabase response** — read its header before touching it. Scope is `/portal/`, so it cannot reach the public site. |
| `portal/brands.html`, `brand.html`, `activity-detail.html` | The admin surface (D120). Staff-labelled "Admin"; RLS does the gating. |
| `css/site.css` | Shared tokens, nav, buttons, section base, footer, mobile nav. |
| `docs/` | The internal documents. **Force-404'd by `_redirects` — not public.** |
| `docs/PORTAL_PLAN.md` | Architecture doc — phases, locked decisions. |
| `docs/BRAND_SCORECARD_SPEC.md` | The client-facing scorecard: what it says, in what order. Read D160 with it. |
| `docs/FLASH_ACCOUNT_MATCHING.md` | Our accounts against the distributor's flash. 106 ruled pairs, 17 rejections. Read before touching any case figure. |
| `../../../44 North/ACCOUNT_MAP_44North.csv` | The same mapping as a lookup table. Open this one to check an account. |
| `../../../Invoicing/flash_match.py` | What actually runs the matching. Raises on an ambiguous name rather than guessing. |
| `../../../Invoicing/build_scorecard_v2.py` | Builds the month-dropdown scorecard tab. |
| `docs/SCORECARD_IMPLEMENTATION.md` | What changes upstream to feed it. ⚠️ Its territory backfill assumes a city column the activity log does not have. |
| `docs/HANDOFF.md` | Where the last session stopped, and the next prompt. |
| `docs/DATA_ACCESS_TIERS.md` | Reads / routine writes / dangerous writes, and where each belongs. **A design note, not a decision.** Read before V3. |
| `../../Hubspot/portal_seed/admin/` | The staff admin (Streamlit). Analysis, review, cleanup. |
| `../../Hubspot/portal_seed/promote.py` | Promote / reject / suppress a staged deal, **applying any correction** (D167). One definition, two callers. |
| `../../Hubspot/portal_seed/db/test/12_correction_test.sql` | The correction overlay's contract: applied, HubSpot untouched, stale ruling raises a conflict. |
| `../../Hubspot/portal_seed/create_portal_user.py` | Create / re-scope / deactivate a login. One definition; the CLI and the admin's Users page both call it. |
| `../../Hubspot/portal_seed/backfill_activity_contractor.py` | Who did the work, from the HubSpot deal owner (D139). |
| `../../Hubspot/portal_seed/` | Python tooling + `db/schema.sql`. Separate repo. |
| `../../Hubspot/.env` | HubSpot token, Supabase keys, `DATABASE_URL`. Not in git. |
