# HANDOFF — start here

Written at the close of **19 Aug 2026** (second session that day). This is the
"what now" document; `PROGRESS.md` is the full build log and `DECISIONS.md` is
why things are the way they are. Read this first, then **D63, D64 and D65**.

---

## The one-paragraph version

The staff admin got authentication (D63 — it turned out to need a config line,
not a login) and HubSpot now lands in a **staging zone** that a person promotes
from (D64), so cleaning data is finally durable. Along the way, reading the
actual invoices exposed something larger: **the portal models roughly a tenth of
what the business actually bills.** Every brand is on a monthly retainer that
lives nowhere in the database, `invoice_recap` is loaded from spreadsheets that
disagree with QuickBooks, and `quantity` is not being multiplied where it should
be. None of that is a billing error — clients were charged correctly — but every
revenue and margin figure in the portal is wrong, and wrong low.

---

## Run it

```bash
# the staff admin — analysis, cleanup, and now review/promotion
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Hubspot/portal_seed"
python -m streamlit run admin/app.py          # http://127.0.0.1:8501
```

**Launch it from `portal_seed/` and nowhere else.** The admin has no login; its
access control is that it binds to loopback, and Streamlit resolves
`.streamlit/config.toml` against the *working directory*. From the wrong
directory that setting silently vanishes and the app publishes every brand's
rate card to whatever network you are on. `lib._require_loopback()` refuses to
render if that happens, but do not rely on being saved by it.

```bash
# the public site + brand portal
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Website/ihospitality-website_3_3_26/ihospitality"
python -m http.server 8123                    # portal at /portal/login.html
```

Health checks, all read-only:

```bash
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Hubspot/portal_seed" && python verify_live.py
```

---

## THE NEXT PROMPT

Paste this to pick up exactly where we stopped:

> Read `CLAUDE.md`, `HANDOFF.md`, and D63–D65 in `DECISIONS.md`.
>
> Two jobs, in this order.
>
> **1. Apply D65 — it is agreed and half-finished.** `quantity` is always the
> activity multiplier, but only 21 of 232 rate-card lines carry `per_unit`, so
> the portal understates revenue by $5,540. This is TWO changes and doing one
> without the other is worse than doing neither: set `per_unit` on the flat rate
> lines (rate-card data, no code — D60), **and** change `coalesce(a.quantity, 0)`
> to `coalesce(a.quantity, 1)` in `v_activity_money`, on the charge and cost
> branches both. Without the second, 10 rows with NULL quantity drop to $0 and
> $1,065 disappears. Show me the before/after per brand before committing.
>
> **2. Model the retainer.** Every brand pays a monthly retainer and the portal
> has nowhere to put it — `charge` comes from `rate_card` pricing an *activity*,
> and a retainer is not an activity. It is ~65% of what Dame Mas pays. Until
> this exists, every margin number in the admin is fiction. Recommend a shape
> first (a monthly billing table? a synthetic activity type? extend
> `invoice_recap` and read from it?) and let me pick.
>
> Standing rules that outrank convenience: the billing is the truth (D56), no
> hardcoded business data (D60), the brand portal stays read-only by
> construction (D61), and cleanup happens in the staging zone rather than by
> overwriting (D64).
>
> Before you finish: `python -m pytest test_normalize.py test_sync.py -q`,
> `bash db/test/run.sh`, `python verify_live.py`, and confirm the Dame Mas
> canary still ties on the admin's Health page.

---

## Where things stand

**Committed, both repos clean.**

| repo | branch | latest |
|---|---|---|
| website (`…/ihospitality/`) | `portal-v1` | `35cb8d5` — 3 commits unpushed |
| `Hubspot/portal_seed/` | `main` | `1a29694` — local only, no remote by design |

**Verified at close:** 73 pytest pass · offline schema/RLS/staging suite passes,
including all seven staging assertions · 0 grants to `anon`, 0 write grants to
`authenticated`, 0 grants on `staging` to browser roles · 1,084 activities ·
review queue `{in_sync: 1066}` · Dame Mas canary unchanged (4 of 7 tying, April
+$0.01 per D48, Jan–Mar the known hole).

---

## What changed on 19 Aug (second session)

**D63 — the admin is a laptop tool.** The planned work was "add authentication",
sized for Phil needing remote access. He does not: cleanup is the operator's
job, and what Phil wants is the *analysis*. That deleted a VM, Tailscale, a
hosting bill and a Google OAuth client. What was left was real though — Streamlit
binds to *all interfaces* by default, so on any untrusted network every brand's
rate card was readable by that LAN. Now pinned to `127.0.0.1` with a runtime
guard.

**D64 — HubSpot lands, a person promotes.** `sync_hubspot.py` used to upsert
straight into `activities`, overwriting nine columns every run. Every fix made
in the admin would have been silently reverted the first time the sync ran in
anger. Deals now land in `staging.hubspot_deals` and are promoted deliberately;
rows nobody edited still take HubSpot's updates automatically (which is what
keeps D59 working), rows you did edit stop and ask, and deleting a duplicate
tombstones the deal id so it cannot come back.

**D65 — `quantity` is always the multiplier.** Agreed, not yet applied. See the
next prompt.

**A `lib` bug fixed on the way.** `lib.query/execute/scalar` always passed a
params tuple, so psycopg treated a literal `%` as a placeholder — which broke
the entire Venues page (merge *and* edit) on a `like '%' || … || '%'`. Now
`params or None` in all three. Worth knowing because the failure mode is a page
that has always been broken and nobody opened.

---

## Open work, most useful first

1. **Apply D65** — $5,540 of understated revenue, and the coalesce trap.
2. **Model the retainer.** Every brand is on one. The portal has no concept of
   it, so margin is meaningless until it does.
3. **Load `invoice_recap` from QuickBooks, not the spreadsheets.** The workbooks
   are a lossy copy: August 2025's commission is typed as `375.75` where the
   invoice bills `354.75` (transposed digits), June 2026's expenses are $158
   over, October 2025's are $125 over, and a $455 Dame Mas tasting invoice
   (3203) is in neither the workbook nor the portal. QuickBooks also carries an
   `ACTIVITY DATE` custom field on every invoice, which states the work month
   explicitly — so the one-month billing lag needs no inference.
4. **Widen the Health canary.** `lib.canary()` compares only `invoice_recap.commission`.
   It reports "4 months tying" truthfully while ignoring consulting, billable,
   subtotal and total — i.e. most of the invoice.
5. **Run the sync for real.** It has never run with the staging code. Use
   `--month` on a single month first and watch the review queue.
6. **The Meg O'Malley's drink list** — HubSpot deal `51628024207` says quantity
   6; it should be **1**. Fix in HubSpot (D59); the sync will carry it through
   on its own because the row is not hand-edited.
7. **17 duplicate venue clusters** — including Meg O'Malley's, which exists
   twice (one copy with no city and no HubSpot id). The Venues page works again
   as of this session.
8. **Jan–Mar 2026 billed but empty** — $1,020.53 of commission against no priced
   activity; those depletion summaries were never loaded. Aug–Dec 2025 is the
   same story and was never even invoiced into `invoice_recap`.
9. **Seven 44 North activities have no venue** because the HubSpot deal carries
   no company association — the venue is named in the title every time.
10. **Staff analytics on the website** (the second half of D63). No new backend
    needed: `is_staff()` is already in every SELECT policy and
    `create_portal_user.py --staff` already makes the account.
11. **Phase 3 proper**, password reset for brand logins (D18), deleting the two
    test logins, and merging PR #1 when the portal should go live.

---

## Things that will bite you if you don't know them

- **The portal shows ~13% of the business.** QuickBooks, Jan 2025–Aug 2026:
  **$194,231** across 11 customers. The portal's lifetime charge is $24,754.
  Retainers are the bulk of the gap. Do not quote a portal revenue figure to
  anyone until items 1–3 above are done.
- **Five Trail and Barmen Bourbon are ONE QuickBooks customer** and two brands
  here. **Gin Lane 1751 ($6,661) is not in the portal at all.**
- **The invoice is the truth (D56)**, and QuickBooks is more the truth than the
  workbooks are.
- **The workbook month is not the invoice month.** Work in July 2025 is invoiced
  15 Aug 2025. QuickBooks states the work month in an `ACTIVITY DATE` custom
  field; use it rather than inferring the lag.
- **`invoice_recap.month` holds the WORKBOOK month**, so it is already on the
  work-month basis — do not shift it again.
- **No hardcoded business data (D60).** `load_rate_card.py` is retired.
- **A constraint that has never fired looks exactly like one that works (D62).**
  This session found two more of the same shape: the sync's overwrite (never run,
  so never noticed) and the Venues page's `%` bug (broken all along).
- **Local Postgres is not Supabase, in both directions (D6, D64).** A generated
  column the local stub accepted was refused live for not being immutable.
- **`market` is deliberately unused.** All venues carry NULL on purpose.
- **`activities.quantity` is SKU count on many rows (D56)** — and per D65 it
  multiplies regardless.

---

## Not yet tested by anything automatic

- The landing loop in `sync_hubspot.py.apply()` — the 73 tests cover pure logic
  only. The staging *state machine* is covered by `db/test/02_staging_test.sql`;
  the code that fills it is not.
- The sync against live HubSpot with the staging code. This is the real first
  test.
- The admin's Review-and-edit buttons were driven through `promote.py` directly
  rather than clicked.
- The backfill deliberately stamped a hash derived from *our* data, not
  HubSpot's, so the first real sync will likely re-promote those 1,066 rows as
  state `auto`. That is expected and harmless — none are hand-edited.
