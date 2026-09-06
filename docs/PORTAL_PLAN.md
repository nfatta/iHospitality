# iHospitality Brand Portal — Plan

> **Picking this up cold?** Read `PROGRESS.md` first, then `DECISIONS.md`, then
> this document. `CLAUDE.md` has the standing instructions.
>
> Plan written 7 Aug 2026. **Phases 0, 1, 2 and 4 were completed 10 Aug 2026.**
> The portal works end to end against a live Supabase project: a brand logs in
> and sees only their own data, verified in a browser with two real logins.
>
> **Next up: Phase 3** (the HubSpot sync script — the data is currently a
> one-time seed, so nothing new from HubSpot reaches the portal) or **Phase 5**
> (the Streamlit admin, which is also where a password-reset flow belongs).
>
> Two corrections to this plan, made during the build and already applied:
> - **File layout.** The plan puts `schema.sql`, the Python and the admin under
>   `portal/` in the website repo. They are not there. The website repo root is
>   the Netlify publish directory, so everything non-servable lives in
>   `Hubspot/portal_seed/` instead. See DECISIONS D1 and D12.
> - **Activity taxonomy.** The plan treats the HubSpot→`activity_type` mapping as
>   a question to answer once. It is instead admin-managed at runtime, because
>   the vocabulary keeps changing. See DECISIONS D4.
>
> Decisions already made, so they don't need relitigating:
> - **Supabase** (managed Postgres) for the database, auth, and photo storage — chosen because it is real SQL and Nicholas is learning SQL.
> - **Static HTML** for the brand-facing portal, matching the existing site (no build step, no npm).
> - **Streamlit** for the internal admin, reusing the Beachfly Inventory pattern Nicholas already built.
> - **One login per person**, mapped to a brand, isolated by Postgres row-level security.
> - **Photos are in v1.**
> - **HubSpot is the destination to leave**, not a permanent upstream — but the actual cutover is the last phase, not the first.
> - **Field entry on a phone is Phase 6**, not v1.

## Context

Brands currently have no way to see the work being done for them. Proof of activity lives in HubSpot (deals, notes, photo attachments), in a local photo library, and in Nicholas's head. Every proof-of-work conversation is manual.

The goal is a private portal where a brand logs in and sees their own activity log, their venue/account list, a summary dashboard, and the photos from their activations — walled off from every other brand.

The longer-term goal, stated explicitly: **move off HubSpot and make this iHospitality's own system of record and field tool.** So this is not a reporting mirror bolted onto HubSpot. It is the beginning of the replacement. The schema is designed as the system of record from day one; HubSpot is an *import feed* that can be switched off without redesigning anything downstream.

Field data entry on a phone is deliberately **not** in v1 — it is Phase 6, after the tables have proven themselves against real data.

### What already exists

| Asset | Location | Relevance |
|---|---|---|
| Public site | `index.html`, `gallery.html` (this repo) | Plain static HTML, inline CSS, no build step, no npm. Netlify-hosted, deploys from `main`. Design tokens at `index.html:99-107`. |
| HubSpot deal search | `C:\Users\nicho\OneDrive\Documents\Ihospitality\Hubspot\Hubspot_Automation\main.py` | Already searches deals by close date, pulls `dealname`, `closedate`, `brand`, `quantity`, `activity_type`, and the associated company. This is the activity log. |
| HubSpot notes + photos | `C:\Users\nicho\OneDrive\Documents\Ihospitality\Hubspot\automate_hurry\hubspot_extract.py` | Already walks deal → notes → attachments → downloads photos via signed URLs, with retry and rate-limit handling. 394 lines, works today. |
| Monthly CSV exports | `C:\Users\nicho\OneDrive\Documents\Ihospitality\Hubspot\` | Per-month deal exports back through 2025, several already enriched with notes. The Phase 2 seed data. |
| Streamlit app w/ auth | `C:\Users\nicho\OneDrive\Documents\Programming\Beachfly Inventory\app.py` | Precedent: a 67KB multi-page Streamlit app with `streamlit-authenticator` logins over Google Sheets. Proves the pattern and the skill. |

**The extraction layer is largely already written.** Both scripts currently terminate in a CSV. The work is redirecting them into Postgres.

---

## Architecture

Three pieces, one database.

```
        HubSpot (Phases 1-5)  ──sync──┐
                                      ▼
   Streamlit admin ──write──►  Supabase Postgres  ◄──read──  Brand portal
   (you, internal)             + Auth + Storage             (static HTML on
   Phase 5-6, replaces                                       ihospitality.vip)
   HubSpot as the source
```

**Database: Supabase.** Managed Postgres with authentication, file storage, and row-level security in one product. Chosen deliberately over alternatives because it is *real Postgres* — every query written here is transferable SQL, so learning and building are the same activity. It also removes the need to build login and photo hosting by hand.

**Brand portal: static HTML + the Supabase JS client from a CDN.** Matches how the site is already built — no build step, no npm, deploys through the existing Netlify pipeline. It can reuse the site's design tokens and the gallery lightbox so the portal feels like iHospitality rather than a generic dashboard.

**Admin/internal: Streamlit.** Reuses the Beachfly pattern directly, pointed at Postgres instead of Google Sheets. Streamlit is the wrong choice for a brand-facing luxury-brand experience and the right choice for an internal tool that has to be built fast and — in Phase 6 — used from a phone.

### Cost

Supabase free tier covers 500 MB database and 1 GB storage. Activity data will not approach that for years; **photos will**. The existing library is ~880 MB of originals. Plan on the $25/mo Pro tier once photos move in, or store web-optimized derivatives only (~200 KB each, which keeps thousands of photos inside the free tier). Recommend the latter to start.

---

## Phase 0 — Secure the HubSpot token (do first, ~15 min)

The private app token `pat-na1-f80a...` is hardcoded at `hubspot_extract.py:20` and `main.py:5`.

Verified 7 Aug 2026: **not committed to git and not on the live site.** But an untracked copy of `hubspot_extract.py` sits inside the website repo folder, which deploys to Netlify — one `git add -A` publishes it.

1. Delete the stray copy at the website repo root (the real one lives in `Hubspot/automate_hurry/`).
2. Add `*.py`, `.env`, and `credentials.json` to the website repo's `.gitignore`.
3. Move the token to a `.env` file read via `os.environ` / `python-dotenv` in both scripts.
4. Rotate the token in HubSpot, since it has been sitting in plaintext in a synced OneDrive folder.

---

## Phase 1 — Schema

Written as `schema.sql` in a new `portal/` directory, applied through the Supabase SQL editor. This file is the main SQL learning artifact — it should be commented heavily and kept in version control.

**Core tables**

| Table | Purpose | Key columns |
|---|---|---|
| `brands` | The brands represented | `id`, `name`, `slug`, `logo_url`, `is_active` |
| `venues` | Bars, restaurants, clubs — HubSpot Companies | `id`, `name`, `city`, `county`, `market`, `venue_type`, `hubspot_company_id` |
| `activities` | The backbone. One row per visit/tasting/placement — HubSpot Deals | `id`, `brand_id`, `venue_id`, `activity_date`, `activity_type`, `quantity`, `notes`, `hubspot_deal_id` |
| `photos` | Tied to the activity that produced them | `id`, `activity_id`, `storage_path`, `caption`, `consent_confirmed` |
| `brand_venue_status` | The account list — derived but stored | `brand_id`, `venue_id`, `status`, `first_placed_on`, `last_touched_on` |
| `profiles` | Maps a Supabase auth user to a brand | `user_id`, `brand_id`, `full_name`, `role` |

**Design decisions worth stating**

- `market` is an enum with exactly two values: `central_florida`, `palm_beach_county`. The database should enforce the positioning rule from the work log — there is no "South Florida" value, so the term cannot leak into brand-facing output.
- `hubspot_deal_id` / `hubspot_company_id` are **nullable** and unique. Nullable is the whole point: rows created in the field later have no HubSpot ID, which is what makes cutover possible without a schema change.
- `activity_type` starts as a lookup table rather than an enum, because HubSpot's values will need cleaning and new activity types will appear.
- `photos.consent_confirmed` carries forward the constraint already documented in `GALLERY_PLAN.md`: photos with identifiable people need consent tracking.

**Row-level security.** One login per person, mapped to a brand via `profiles`. Every brand-facing table gets an RLS policy restricting `SELECT` to rows whose `brand_id` matches the requesting user's profile. This is enforced by Postgres, not by application code — meaning even a bug in the portal's JavaScript cannot leak one brand's data to another. This is the single most important thing to get right and to test explicitly.

**Dashboard as SQL views.** The summary numbers should be views (`v_brand_monthly_summary`, `v_brand_venue_counts`), not JavaScript arithmetic. The portal then just selects from a view. This is where aggregation, `GROUP BY`, and joins get learned on data that matters.

---

## Phase 2 — Seed the database from HubSpot

A one-time backfill using the existing CSV exports already sitting in `Hubspot/` (monthly deal exports going back through 2025, several already enriched with notes).

`portal/seed_from_csv.py` — reads those CSVs, deduplicates brands and venues, and inserts. Expect real data cleaning here: inconsistent venue naming across months is the likely problem, and it must be resolved before brands ever see the data. Budget genuine time for this; it is usually the least glamorous and most important step.

---

## Phase 3 — The sync script

`portal/sync_hubspot.py`, built by merging the two existing scripts and swapping the CSV output for Postgres writes.

- Take the deal-search-by-date-range logic from `main.py:42-71` verbatim.
- Take `get_note_associations`, `get_note_content`, `get_file_details`, and `download_photo` from `hubspot_extract.py` — these are the parts that took real effort and need no changes beyond the token fix.
- Replace `df.to_csv(...)` with upserts keyed on `hubspot_deal_id`, so the script is safe to re-run.
- Photos upload to Supabase Storage instead of a local folder; store the path in `photos.storage_path`.
- Run it manually at first. Automate on a schedule only once it has run cleanly several times.

---

## Phase 4 — The brand portal (v1 ships here)

New files, matching the existing site's structure and design tokens:

| File | Purpose |
|---|---|
| `portal/login.html` | Email + password via Supabase Auth. No self-signup — accounts created by you. |
| `portal/index.html` | Dashboard: activations this month, venues touched, photos captured. Reads the views from Phase 1. |
| `portal/activity.html` | The activity log — dated, filterable by market and activity type. |
| `portal/venues.html` | Account list with status and last-touched date. |
| `portal/photos.html` | Private gallery, filtered to that brand, grouped by activity. |

Reuse rather than rebuild: lift the design tokens from `index.html:99-107` and the lightbox JS from `gallery.html:347-415`.

**One structural cleanup this forces, and it is overdue.** The CSS, nav, and footer are currently duplicated between `index.html` and `gallery.html`, so any brand change has to be made in two places. Adding five more pages makes that seven. Extract the shared CSS into `css/site.css` and link it from every page as the first step of this phase.

Also add `Disallow: /portal/` to `robots.txt` and keep portal pages out of `sitemap.xml`.

---

## Phase 5 — Streamlit admin

`portal/admin/app.py`, modelled directly on the Beachfly app. Log an activity, attach photos, manage venues and brand-venue status, create brand user accounts. At this point data can originate *outside* HubSpot for the first time — the point where the system stops being a mirror.

## Phase 6 — Field use and HubSpot cutover

Mobile-friendly entry (Streamlit works acceptably on a phone; a dedicated approach can be evaluated then). Once field entry is habitual and the data is trusted, the sync script is switched off and HubSpot is retired. Deliberately last: cutting over before the data is trusted is how these projects fail.

---

## Verification

- **RLS is the critical test.** Create two test brand users. Log in as each and confirm — in the browser, and by querying the API directly with that user's token — that neither can retrieve the other's activities, venues, or photos. Attempt it deliberately. Do not treat this phase as done until you have actively tried to break it and failed.
- **Sync is idempotent.** Run `sync_hubspot.py` twice over the same date range; row counts must not change and no duplicate photos may appear.
- **Seed accuracy.** Pick three months already exported to CSV and reconcile counts per brand against HubSpot directly.
- **Portal locally.** The existing dev server (`python -m http.server 8123`, per `.claude/launch.json`) serves the portal pages; Supabase is remote, so no local database is needed.
- **Public site unaffected.** After the CSS extraction, confirm `index.html` and `gallery.html` render identically to production.

## Open questions to resolve during Phase 1

- Which HubSpot deal stages map to which `activity_type` and `brand_venue_status` values — needs a look at the live pipeline.
- Whether brands should see internal deal notes verbatim, or a cleaned brand-facing summary field. **Recommendation: a separate `brand_visible_summary` column**, so internal candour is never accidentally published to a client.
