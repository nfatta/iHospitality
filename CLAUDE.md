# CLAUDE.md — standing instructions

Read these three, in order, before doing anything: `PROGRESS.md` (where the build
is), `DECISIONS.md` (judgment calls already made), `PORTAL_PLAN.md` (the WHAT —
its decisions are locked). `BUILD-PLAYBOOK.md` is the HOW.

## What this repo is

The public iHospitality site (`ihospitality.vip`) plus the brand portal being
built inside it. Plain static HTML, inline CSS, **no build step, no npm** — that
is a locked decision, not an oversight. Netlify deploys from `main`.

## Running it

```bash
python -m http.server 8123
```

Or use the `ihospitality-static` config in `.claude/launch.json` via `preview_start`.

## Testing the database layer

```bash
bash portal/test/run.sh
```

Spins up a throwaway Postgres cluster, applies `portal/schema.sql` twice
(idempotency), runs the RLS isolation test, tears down. Needs no Supabase project
and no network. Run it after any schema change — the isolation test is the spec.

## Conventions that matter

- **The repo root is the Netlify publish directory.** Every committed file is
  served at `ihospitality.vip/<path>`. Before adding a file, ask whether it should
  be public. Non-public source under `portal/` is blocked by `_redirects`.
- **No secrets in this repo, ever.** `*.py`, `.env`, and `credentials.json` are
  gitignored specifically because a `git add -A` would otherwise publish them.
- **Python tooling lives in `../../Hubspot/`, not here** — see DECISIONS.md D1.
  The HubSpot token comes from `Hubspot/.env` via `python-dotenv`, never inline.
- **Two markets only:** `central_florida`, `palm_beach_county`. Never "South
  Florida" — the database enum enforces this so it cannot leak into brand-facing
  output.
- **Internal notes are not brand-facing.** `activities.notes` is internal;
  `activities.brand_visible_summary` is what a client reads. The brand-facing
  views never select `notes`. Do not add it to one.
- CSS/nav/footer are currently duplicated between `index.html` and `gallery.html`.
  Extracting them to `css/site.css` is the first task of Phase 4 — don't do it
  opportunistically before then.

## Where things are

| Path | What |
|---|---|
| `portal/schema.sql` | The database. Apply via the Supabase SQL editor. Idempotent. |
| `portal/test/` | Local verification harness. Not deployed. |
| `PORTAL_PLAN.md` | Architecture doc — phases, locked decisions. |
| `../../Hubspot/` | HubSpot exports and the extraction scripts (outside this repo). |
| `../../Hubspot/.env` | The HubSpot token. Not in git. |
