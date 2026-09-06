# DATA ACCESS TIERS — where a thing is allowed to happen, and why

**Written 28 Aug 2026, from a late conversation. NOTHING HERE IS DECIDED AND
NOTHING IS BUILT.** No D-number, deliberately: the decision record is for calls
that have been made, and this is the shape of a question that keeps arriving
early. It is here so the V3 conversation starts from it rather than re-deriving
it under pressure.

The question that prompted it: *"I can see as we grow the need to integrate the
Streamlit app into the website for a more streamlined all-in-one data centre.
And brands will appreciate being able to run their own reports."*

---

## The framing that matters

**"Streamlit versus the website" is the wrong axis.** The real axis is **reads
versus writes**, and within writes, **routine versus dangerous.** Sorted that
way, most of the apparent problem dissolves and the part that remains is one
genuine decision rather than a migration.

| Tier | What is in it | Where it belongs | What it costs to move |
|---|---|---|---|
| **1 — Reads** | Health, Analysis, Cost to serve, every figure and table | **The portal, whenever there is time.** Already legal, already partly there | Nothing architectural. D123: everything asked for is already a view |
| **2 — Routine writes** | Correct a quantity, add a venue note, mark a row reviewed, log an activity | **`security definer` RPC — but only when V3 forces the question anyway** | Reopens D61 on purpose. See the warning below |
| **3 — Dangerous writes** | Rate card, Users, merges, promote/reject | **Stays on the laptop.** Possibly for ever | Nothing. This is the recommendation, not a limitation |

The tiers are about **blast radius**, not difficulty. Tier 3 is not hard to
build on the web; it is the set where being wrong is expensive and where "walk
to the laptop" is a perfectly good access control that costs nothing to keep.

---

## Tier 1 — the reads are already allowed, and half of them are already there

D63 split the admin by what is dangerous and sent **analysis to the website**
under the operator's own portal login. That is not a future plan; it shipped.
`portal/rate-card.html` exists, `is_staff()` is in every SELECT policy, and the
portal already queries 23 distinct tables and views straight from the browser
with RLS doing the gating.

So there is no architecture left to decide in Tier 1. Moving Health and Cost to
serve across is **work, not a decision** — with two rules already written down
that apply unchanged:

- **Cost to serve stays page-only** (D116). Computing it in the browser rather
  than promoting it into a view is what keeps D116 intact — and it means a
  SECOND implementation of the allocation, which can drift from the pandas one.
  It must carry its four caveats on screen or the grid silently flatters and
  penalises brands (D123).
- **Bounded reads** (D122). Order and slice in Postgres, filter server-side,
  build dropdowns from the small tables. Activities and photos are the two that
  grow.

---

## Tier 2 — the brands' own reports, which need nothing new

**This is a UI problem, not an architecture problem, and that is the whole
finding.** The hard, expensive, easy-to-get-wrong part of self-serve reporting
in any product is multi-tenant row isolation — and it is already solved here, in
the database, where the browser cannot reach around it.

**How other sites do it,** in descending order of how common and ascending order
of what it costs:

| Pattern | How it actually works | Verdict here |
|---|---|---|
| **Parameterised report templates** | A fixed set of reports with date / venue / type pickers, plus CSV export and optionally scheduled email | **Start here.** It is what people actually use — the same three reports, repeatedly |
| **Query builder over a curated field list** | Allowed dimensions and measures defined once; the UI composes the query; the user never writes SQL | Only if brands ask. Cube.js and dbt metrics are the packaged versions; a hand-written field map is the honest one |
| **Embedded BI with signed tokens** | The site mints a JWT carrying a tenant id; the vendor renders a dashboard in an iframe and applies a row filter derived from that claim | **A downgrade for us.** Isolation would live in a vendor's filter config and trust a token we mint. Ours lives in `venues_select` and the `activities` column grants and holds regardless of what the browser sends |
| **Raw SQL access** | A read replica, enterprise tier only | No |

**In this stack a reports page is `.from(view).select().gte().lte().order()`** —
the shape `photos.html` already uses. No build step, no npm, no new backend, no
vendor, and RLS is the security. CSV export from rows already fetched is about
fifteen lines of JavaScript. PDF is where people reach for a server and usually
should not.

⚠️ **Write the queries with no brand filter, as every other portal page does.**
RLS applies the restriction in Postgres. A `.eq('brand_id', …)` on a report page
would imply the isolation lives in the browser, and it does not.

---

## Tier 3 — the writes, and the one real decision

The browser cannot hold `service_role`; that is D61's structural guarantee and
the reason the admin is a separate Python app at all. Three ways a site can
write without it:

**(a) A serverless function holding the key.** Netlify or Supabase Edge
Functions. **D63 already considered and rejected this — on cost, not
feasibility:** ~1,439 lines of Python become ~3,000 lines of hand-written JS.
Scale changes that arithmetic. It does **not** change the real objection, which
was that it converts a structural guarantee into a code guarantee.

**(b) `security definer` RPC — the option not yet considered explicitly, and
the one that fits this stack.** Rather than granting `authenticated` write
access to TABLES — which D61 rightly forbids, because it would dissolve
read-only for brand logins too — expose **specific named operations** as
Postgres functions and let PostgREST call them:

```
select merge_venue(:keep, :drop);
```

The function is `security definer`, so it runs as owner. Its first line is
`if not is_staff() then raise exception`. A brand login calling it gets an
exception, not a partial write.

**The difference from a table grant is the surface**: one function with one
signature and one gate, versus `update activities set <anything>`. And the
writes are **already written this way** — `merge_venue()`,
`merge_activity_type()`, `set_role()` and `set_venue_city_from_hubspot()` all
exist as functions today. They are simply not reachable from PostgREST;
`portal.js` contains no `.rpc(` call at all.

⚠️ **THIS REOPENS D61 DELIBERATELY, AND D137'S WARNING APPLIES AT FULL
STRENGTH.** A definer view without its `where` clause is world-readable to every
logged-in brand; a definer FUNCTION without its role gate is a **write path** for
every logged-in brand, which is strictly worse. There is no RLS underneath
either. If this is ever built, the gate is the first line of the body, the test
asserts a brand call RAISES, and the test is proven able to fail (D114's rule).

**HANDOFF already says V3 — contractors logging their own work — requires
reopening D61 on purpose rather than by accident.** This is that same door.
The point of writing it down now is that it should be opened once, for a reason,
with the gate pattern settled in advance — not improvised the night someone
wants a save button.

**(c) Some writes simply stay local.** Rate card edits **restate history**
(D91). The pricing preview works by inserting and rolling back (D91, D132).
`create_portal_user.py` needs the service key. And D103 is the argument in one
line: a replayed Streamlit button press destroyed a real $1,246.50 depletion and
reported success. These operations are rare, consequential, and lose nothing by
requiring the operator's own machine.

---

## What this says to do, in order

1. **Brand reports** — independent of everything else, needs no new
   architecture, and is the item with a customer waiting for it.
2. **Tier 1 reads onto the portal** — as time allows, respecting D116 and D122.
3. **Tier 2 RPC** — do not build it for its own sake. Let V3 raise it, then
   settle the gate pattern once and apply it everywhere.
4. **Tier 3** — leave it alone. Revisit only if the operator is regularly unable
   to reach his own laptop, which is a different problem with different answers.

**And the standing reason none of this becomes a hosted dashboard tool:** the
admin's access control is that it is **not reachable**. Grafana, Metabase,
Retool and the rest each replace "unreachable" with "reachable but hopefully
configured correctly", for a database holding a contractor's pay rate beside the
margin on his own work. That is a worse category, not merely a costlier one.
Free and loopback are the same fact twice — the tools that charge, charge
because they are hosted.
