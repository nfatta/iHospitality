# iHospitality Photo Gallery — Implementation Plan

**Audience:** Opus (project manager), delegating to Sonnet and Haiku subagents.
**Goal:** Add a photo gallery as a **separate page** (`gallery.html`) to the iHospitality static site, populated with the best 20–30 photos curated from the `Photos/` folder. Deployed via git → Netlify.

---

## Decisions already made by the site owner (Nicholas)

| Decision | Answer |
|---|---|
| Curation pool | **Everything** — all ~290 photos: the 96 loose files in `Photos/` AND all brand/month folders under `Photos/Hubspot_photos/` |
| Final gallery size | **20–30 photos** |
| Gallery style | **Filterable category grid + click-to-enlarge lightbox**, matching the site's existing dark/gold premium aesthetic |
| Image serving | **Web-optimized copies only** — originals never committed or served |
| Curated originals | Copied untouched into their own folder, accompanied by an `EDITS.md` listing minor edits needed before posting |

---

## Ground truth about the repo (verified)

- Static site: a single `index.html` (~42KB) with **all CSS inline** in a `<style>` block. Fonts: Cormorant Garamond + Inter via Google Fonts. Palette: dark sections, gold accents (`.btn-gold`, `.nav-cta`, etc.).
- Nav is anchor-based: The Market / Services / Brands / About / Partner With Us, plus a hamburger mobile nav (`toggleNav()` / `closeNav()` inline JS).
- Existing site images live in `images/` (~25 files: logos, hero, section photos).
- `Photos/` is **880MB, ~294 files** and currently **untracked** in git:
  - 96 loose files at top level (mostly `YYYYMMDD_HHMMSS.jpg` phone photos, plus 13 `.HEIC`, 2 `.MP4`, 2 `.MOV`)
  - `Photos/Hubspot_photos/<Brand>/<Month>/` — brands: `44N`, `AspenGreen`, `BarmenFive`, `Bluerun`, `DameMas`, `Wodka` (~198 files)
  - A few non-photo strays (`.txt`, `.skill`, `.ps1`) — ignore them
- Git status has **unrelated pending changes**: `index.html` modified, `images/market.jpeg` deleted, `images/Ten_to_one.png` untracked. **Do not bundle these into gallery commits** — see Phase 5.
- Platform: Windows 11, repo lives inside OneDrive (watch for transient file locks during batch operations).

---

## Hard constraints (non-negotiable)

1. **Never commit `Photos/` wholesale.** 880MB would wreck the repo and Netlify deploys. First action of Phase 0 is adding `Photos/` to `.gitignore`.
2. Only web-optimized copies in `images/gallery/` get committed. Target: **≤ 400KB per full-size image, ≤ 60KB per thumbnail**, total committed payload under ~12MB.
3. Curation requires **actually viewing every image** (Read tool renders JPGs). No selecting by filename.
4. People appear in these photos (events, tastings, bar staff). Any photo where an identifiable person is prominent must be **flagged in EDITS.md for Nicholas to confirm consent** before it goes live.
5. Videos (`.mp4`, `.mov`) are out of scope — skip them.
6. Checkpoint with Nicholas at the end of Phase 1 (selection approval) **before** building the page.

---

## Phase 0 — Setup (Haiku)

1. Add `.gitignore` at repo root (create if missing) containing:
   ```
   Photos/
   ```
2. Create working directories:
   - `Photos/website_selects/` — curated originals + `EDITS.md` (local only; inside the ignored tree, so it can never leak into git)
   - `images/gallery/` and `images/gallery/thumbs/` — the committed, optimized output
3. Enumerate every image: `find Photos -type f` filtered to `.jpg/.jpeg/.heic` (case-insensitive), excluding `website_selects/`. Write the list with file sizes to a manifest (e.g., `Photos/website_selects/_manifest.txt`). Expect ~287 candidates.
4. **HEIC handling:** the Read tool cannot render HEIC. Check whether ImageMagick is available (`magick -version`). If yes, convert the 13 HEICs to temp JPGs (scratchpad, not the repo) for review. If no ImageMagick and no other converter works, log the 13 HEICs as "not reviewed — needs conversion tooling" in EDITS.md and move on; 274 JPGs is plenty of pool.

## Phase 1 — Curation (Sonnet for review, Opus for final cut)

**Review pass (Sonnet, vision):**
- Split the manifest into batches of ~12–15 images. For each batch, a Sonnet task Reads every image and scores it 1–5 on:
  - **Technical:** sharp, well-exposed, not noisy/blurry
  - **Composition:** clean framing, uncluttered background
  - **Content:** professional and on-brand for a premium spirits brokerage — bottles, bars, tastings, events, displays, brand activations. Reject: personal/off-topic shots, visible personal info (license plates, documents, screens), unflattering candids
  - Assign a **category tag** from a fixed set: `Events`, `Tastings`, `Brand Activations`, `On-Premise` (bars/restaurants/placements), `Behind the Scenes`
  - Note the **brand** if identifiable (folder path is a strong hint for Hubspot_photos)
  - Flag `people: prominent/background/none`
- Each batch appends structured rows (filename, scores, category, brand, people-flag, one-line note) to a shared CSV/JSON in the scratchpad. Batches are independent — run several in parallel.

**Final cut (Opus):**
- Merge batch results, rank, and select **20–30**, balancing: category spread (every filter category populated with ≥3 photos if possible), brand spread across the six Hubspot brands, and variety (avoid near-duplicates — many burst shots share timestamps, e.g., the `20241121_1858xx` cluster).
- Copy the selects **unmodified** into `Photos/website_selects/`.
- Write `Photos/website_selects/EDITS.md`: one section per photo with original path, category, suggested caption/alt text, why it was chosen, the consent flag if people are prominent, and **minor edits needed before posting** (e.g., "crop out exit sign top-left", "straighten ~2° CW", "brighten shadows", "none").

**⛔ CHECKPOINT:** Present the selection to Nicholas (contact-sheet style summary + EDITS.md). Wait for approval and any swaps before Phase 2.

## Phase 2 — Optimization (Haiku, script-driven)

1. For each approved photo, produce into `images/gallery/`:
   - Full size: longest edge **1600px**, JPEG quality ~80, target ≤ 400KB
   - Thumbnail into `images/gallery/thumbs/`: longest edge **600px**, quality ~75, target ≤ 60KB
2. Rename to clean, SEO-friendly kebab-case: `<category>-<brand-or-descriptor>-NN.jpg` (e.g., `tasting-wodka-01.jpg`). Record the original→new mapping at the bottom of EDITS.md.
3. Tooling: prefer ImageMagick (`magick input -auto-orient -resize 1600x1600> -quality 80 output`). If unavailable, use a PowerShell System.Drawing script — **but it ignores EXIF orientation, so verify no image comes out rotated**. `-auto-orient` (or equivalent) is mandatory: phone photos rely on EXIF rotation.
4. Verify: every output renders (Read a sample), sizes are within budget, count matches the approved list, total `images/gallery/` weight reported.

## Phase 3 — Build the gallery page (Sonnet, Opus reviews)

**`gallery.html`** — a new self-contained page (own `<style>` block, same approach as index.html):
- Copy the nav, footer, fonts, and palette from `index.html` so the two pages are visually identical. Nav links on gallery.html point back to `index.html#market`, `index.html#services`, etc. Keep the hamburger mobile nav working (copy its JS).
- Page header consistent with the site's section style (`section-label` + `section-title` pattern), e.g., label "Our Work" / title "iHospitality in the Field".
- **Filter bar:** pill-style buttons — All + the categories actually used. Vanilla JS show/hide by `data-category`. Style to match `.btn-outline-gold` / gold-accent aesthetic.
- **Grid:** responsive CSS grid or column-based masonry, thumbnails with `loading="lazy"`, `alt` text from EDITS.md captions.
- **Lightbox:** vanilla JS overlay loading the 1600px version — prev/next arrows, keyboard (←/→/Esc), click-backdrop to close, caption bar. No external libraries.
- No frameworks, no CDN JS — keep the site dependency-free like index.html.

**`index.html`** — minimal touch: add "Gallery" to the desktop nav `ul`, the mobile nav, and the footer links if present. Nothing else.

## Phase 4 — QA (Sonnet)

- Serve locally and check in the browser pane: desktop + mobile widths, filters, lightbox interactions, keyboard nav, no console errors, no broken images.
- Confirm nav round-trips: index → gallery → back to each index section.
- Lighthouse-style sanity: total gallery-page transfer on first load (thumbs only) should be well under ~3MB.

## Phase 5 — Ship (Opus)

- Commit **only**: `.gitignore`, `gallery.html`, `index.html` (nav edits), `images/gallery/**`, `GALLERY_PLAN.md`. 
- The pre-existing unrelated changes (modified `index.html` hunks from before this work, deleted `images/market.jpeg`, untracked `images/Ten_to_one.png`) — ask Nicholas whether to include, commit separately, or leave. Since `index.html` already has uncommitted edits, confirm with him before the first commit that those edits should ship.
- Push to `master` (note: repo's default branch config says `main` but current branch is `master` and recent commits are on it — push to `master` as the site currently deploys from it; verify on Netlify after push).
- Verify the live Netlify URL renders the gallery.

---

## Delegation guide

| Task | Model | Why |
|---|---|---|
| Orchestration, final photo cut, commit hygiene, checkpoint with user | Opus | Judgment + accountability |
| Photo review batches (vision), gallery.html build, QA | Sonnet | Strong vision + frontend quality |
| File enumeration, folder setup, copy/resize scripts, verification counts | Haiku | Mechanical, cheap, parallel |

## Risk register

- **880MB accidentally committed** → .gitignore is Phase 0 step 1; verify with `git status` before every commit.
- **EXIF rotation lost during resize** → mandatory auto-orient; visually spot-check outputs.
- **Identifiable people without consent** → flagged per-photo in EDITS.md; Nicholas decides at checkpoint.
- **HEIC unreadable** → convert if ImageMagick present, else log and skip (JPG pool is large).
- **OneDrive file locks** during batch copy/resize → retry once on failure; keep temp conversion work in the scratchpad, not the synced tree.
- **Near-duplicate burst shots** → dedupe by timestamp clusters during final cut.
