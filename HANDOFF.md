# HANDOFF — start here

Written at the close of **19 Aug 2026**. This is the "what now" document;
`PROGRESS.md` is the full build log and `DECISIONS.md` is why things are the way
they are. Read this first, then D54–D62.

---

## The one-paragraph version

The brand portal works and is finished for v1. On 19 Aug the **staff admin** was
built — a separate Streamlit app where Nicholas and Phil analyse the business and
clean the data after an import. It is the answer to *"when stuff is imported I
can clean up the data myself."* Nothing is on `ihospitality.vip` yet. The next
piece of work is **authentication on the admin**, and it is small.

---

## Run it

```bash
# the staff admin — analysis and data cleanup
cd "C:/Users/nicho/OneDrive/Documents/Ihospitality/Hubspot/portal_seed"
python -m streamlit run admin/app.py          # http://localhost:8501
```

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

> Read `CLAUDE.md`, `HANDOFF.md`, `PROGRESS.md` and D54–D62 in `DECISIONS.md`.
>
> We finished the staff admin yesterday (19 Aug). It runs with
> `streamlit run admin/app.py` and has no authentication at all — anyone who can
> reach port 8501 sees every brand's rate card side by side. That is the one
> thing standing between what we have and Phil being able to use it.
>
> Add authentication to the admin. Recommend an approach first — Streamlit's
> built-in `st.login()` OIDC against Google, versus putting it behind Tailscale
> so it is never publicly reachable at all — then implement whichever we agree
> on. Do not add any new features while doing it.
>
> Standing rules that outrank convenience: no hardcoded business data (D60), the
> distributor's depletion report is the truth and our records get corrected when
> they disagree (D56), and the brand portal stays read-only by construction (D61).
>
> Before you finish, re-run the checks: `python -m pytest test_normalize.py
> test_sync.py -q`, `python verify_live.py`, and confirm the Dame Mas invoice
> canary still ties on the admin's Health page.

---

## Where things stand

**Committed, both repos clean.**

| repo | branch | latest |
|---|---|---|
| website (`…/ihospitality/`) | `portal-v1` | `1eabc8a` — **2 commits unpushed** |
| `Hubspot/portal_seed/` | — | `1c5307e` — local only, no remote by design |

Pushing the website commits updates PR #1's Netlify preview. It does **not**
touch `ihospitality.vip`; only merging the PR does that.

**Verified at close:** 73 tests pass · schema + RLS suite passes · 0 grants to
`anon` · 0 write grants to `authenticated` · Dame Mas canary ties for Apr–Jul
2026 (April +$0.01, documented per-row rounding, D48).

---

## Will the admin be hosted on the website?

**No, and it cannot be.** The website repo root *is* the Netlify publish
directory, and Netlify serves static files — it cannot run a Python process. The
admin is a Streamlit server. They are different kinds of thing.

That separation is also deliberate (D61): the brand portal is read-only by
construction, and the admin needs writes.

To give Phil access, cheapest first:

| option | cost | notes |
|---|---|---|
| **Tailscale** | free | private network, never publicly reachable. Recommended for two people. |
| **Streamlit Community Cloud** | free | needs the repo on GitHub and `DATABASE_URL` in their secrets store. Public URL, so auth is mandatory first. |
| **Fly.io / Render** | ~$5–7/mo | a real host you control. |

It could still *feel* like part of the site — point `admin.ihospitality.vip` at
whichever host, via Netlify DNS. That is a DNS record, not a deploy.

---

## Open work, most useful first

1. **Auth on the admin.** See the prompt above. Nothing else should ship first.
2. **17 duplicate venue clusters** — Venues → Possible duplicates. 321 Liquor,
   Root+Branch, Squid Lips, Frigates and more. Probably the highest-value
   cleanup in the app: a split venue makes one reordering account look like two
   one-time accounts, which is exactly the repeat business a brand is paying to
   see.
3. **Jan–Mar 2026 is billed but empty** — $1,020.53 of commission against no
   priced activity. The depletion summaries for those months have never been
   loaded. Visible on the admin's Health page.
4. **12 duplicate activity pairs** — mostly 44 North HubSpot deals a day apart.
   Ruling stands (D59): flag, fix in HubSpot, let the sync carry it through.
   Never delete in the portal.
5. **5 activity types flagged for review**, 179 unpriced activities. Both have
   pages; some of the unpriced are expected and the Rate card page says which.
6. **Phase 3 — the HubSpot sync.** The data is still a one-time seed. Nothing
   new from HubSpot reaches the portal until this runs.
7. **Password reset for brand logins** (D18) and **deleting the two test
   logins** — both required before real brands are onboarded.
8. **Merge PR #1** when the portal should go live.

---

## Things that will bite you if you don't know them

- **The invoice is the truth (D56).** Commission bills off the distributor's
  depletion report. Where the portal disagrees, investigate the portal. Never
  "correct" the invoice, and never reconstruct billing from our own notes.
- **No hardcoded business data (D60).** Rates, classification rules, aliases and
  invoice figures all live in tables. `load_rate_card.py` is **retired** — its
  write path is deleted, and re-running it would have rolled every rate back to
  18 Aug.
- **The workbook and HubSpot date the same event differently (D59)** — workbook
  is the day the work happened, HubSpot the day the deal was entered, one day
  later. Match on a date *window*, never an exact date. An exact match imported
  9 duplicates in 29 rows before it was caught.
- **`market` is deliberately unused.** All 353 venues carry NULL on purpose;
  reporting groups by city. Do not "fix" it.
- **`activities.quantity` is SKU count, not bottles**, on many rows (D56). It
  affects what a brand sees, not what was billed.
- **A constraint that has never fired looks exactly like one that works (D62).**
  `rate_card` had a UNIQUE that excluded every shared line for months, because
  NULL ≠ NULL in Postgres. 46 duplicate rows had accumulated. Money was never
  wrong, so nothing surfaced it.
