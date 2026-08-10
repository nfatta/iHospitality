# portal/

The brand portal's database layer. See `../PORTAL_PLAN.md` for the full plan.

| File | What it is |
|---|---|
| `schema.sql` | The whole schema — tables, RLS, views, triggers, storage bucket. Apply via the Supabase SQL editor. Safe to re-run. |
| `test/00_supabase_stub.sql` | Fakes the bits Supabase provides (`auth.users`, `auth.uid()`, `storage.*`, the `anon`/`authenticated` roles) so the schema can be applied to a plain local Postgres. |
| `test/01_rls_test.sql` | The isolation test. Creates two brands and deliberately tries to read across them. |

## Applying to Supabase

Paste `schema.sql` into the Supabase SQL editor and run. It is idempotent —
re-running after an edit is the normal workflow. Skip the `test/` files; they
exist only for local verification.

## Verifying locally before you apply

Requires the Postgres client tools (already installed via scoop) and nothing else
— no Supabase project, no network.

```bash
bash portal/test/run.sh
```

That script starts a throwaway cluster in a temp directory on port 55432, applies
the stub and the schema twice (proving idempotency), runs the isolation test, and
shuts down. It touches no existing database.

## What the isolation test proves

Per `PORTAL_PLAN.md`: *"Do not treat this phase as done until you have actively
tried to break it and failed."*

- A brand user reading every table sees exactly their own rows — 1 of each in the
  fixture, never the other brand's.
- Naming the other brand's ID, slug, storage path, or HubSpot company ID
  explicitly still returns 0 rows.
- Internal `activities.notes` is not present in the brand-facing view at all.
- Every write from a brand login is refused — the portal is structurally
  read-only.
- An unauthenticated session sees 0 rows everywhere; the `anon` key is denied
  outright, including on the views.
- A staff login sees everything.
- The constraint guards fire: no future-dated activities, no `south_florida`
  market value, no brand user without a brand, no duplicate HubSpot deal ID, no
  malformed slug — while multiple NULL HubSpot IDs coexist, which is what makes
  field-created rows possible.

Last run: all passing.

## Still open (Phase 1)

- Confirm what HubSpot's `account sold` activity type actually means. It is
  currently mapped to `case_sale`; if it means "agreed to stock" it belongs with
  `brand_venue_status` instead.
- Map HubSpot deal stages (`Introductory meeting`, `Closed won`, `Finalizing
  terms`, `Strategy proposal`, `Strategy presentation`, `Campaign assessment`,
  `Objection handling`) onto `account_status_enum`. The trigger currently derives
  status from activity type alone, which is a reasonable default but ignores the
  stage data that already exists.
- `Dame Mas` and `Dame Mass` appear as separate brands in the exports. One is a
  typo; merge before seeding.
