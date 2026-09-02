# iHospitality Brand Scorecard: Implementation Plan

Everything decided in the Sept 2 session. Read this first, then `brand-scorecard-spec.md` for the report structure itself.

---

## Current setup (confirmed, do not rebuild)

- Master activity sheet in Google Drive, all brands
- Separate pricing sheet
- Per brand files pulling from both via IMPORTRANGE across separate files
- Brand files contain that brand's activity rows, not just summaries
- Future months hidden, unhidden monthly on publish
- Sheet is protected, Nicholas is the only editor
- Invoice carries a link to the brand's Google Sheet, no PDF sent

This architecture is correct. Nothing here gets replaced.

**Rejected options and why:**
- Google Slides skin: unnecessary, brands view the sheet directly
- New tooling: portal replaces this anyway, no throwaway work
- PDF export: not the delivery model

---

## What actually changes

Three additions upstream, one new tab per brand file.

### 1. Master sheet: add two columns

Add at the **far right end** of the existing columns. Do not insert in the middle, it can shift or break the IMPORTRANGE references in the brand files. Confirm each brand file still resolves after adding.

| Column | Type | Notes |
|---|---|---|
| `charged` | TRUE / FALSE | Currently lives as "N/C" text inside notes. Must be its own column or nothing can count it. |
| `territory` | orlando_metro / palm_beach / other | Currently implied by city. Needs to be explicit for territory line itemization. |

### 2. Master sheet: new placements tab

Activity logs record events. Live placements need **state**. A drink list that came off at a menu reprint has to be markable inactive, otherwise the count only climbs and stops meaning anything.

| Field | Type |
|---|---|
| account | string |
| brand | string |
| placement_type | drink list / tap / printed feature |
| date_placed | date |
| status | active / inactive |
| date_ended | date, blank if active |

This is the only genuinely new structure in the whole plan.

### 3. Pricing sheet: collapse duplicate activity types

Roughly 25 types currently, several overlapping:
- `drink list 1` / `drink list 2` / `drink list N/C`
- `account visit` / `account visit (PK)`
- `tasting event` / `tasting event N/C` / `Tasting Event Split`

If N/C is the same service at zero charge, it should not be a separate type. Same type, `charged = FALSE`. Collapsing now keeps reporting categories clean and stops identical work splitting across two rows.

### 4. Brand files: new scorecard tab

- First tab position, always unhidden
- Shows the most recent published month
- Brand lands on outcomes, scrolls down into activity rows if they want detail
- Just SUMIFS and COUNTIFS against activity rows already in the file, no new plumbing
- Protect the range

**New monthly publish routine:** enter data → scorecard populates → unhide that month's detail tab.

---

## Backfill

The scorecard is much stronger with YTD figures and a retention rate, and both need history.

- `charged`: mostly find and replace, the N/C markers are already in the notes text
- `territory`: derivable from the city column
- `placements`: the slow one, requires judgment on what is still live

One time cost. Turns twelve months of existing work into a year end roll up usable in renewal conversations.

**Do this before the pricing conversation, not after.**

---

## Google Sheets formatting notes

For making the scorecard tab look like a report rather than a spreadsheet:

- **Turn off gridlines.** View → Show → Gridlines. Does most of the work.
- **Narrow columns as a layout grid.** Set columns to 20 to 30px, merge across to build blocks. Four narrow columns merged = one metric card.
- **Metric cards:** merge ~4 cols x 3 rows. Light gray fill, no border. Row 1 = 10pt gray label, row 2 = 24pt number, row 3 = 9pt secondary line. Blank narrow spacer column between cards.
- **Row heights are your padding.** Sheets has no cell padding. Empty 6px rows above and below content blocks.
- **Borders only where meaningful.** Bottom border only, light gray, for list row dividers. Never the all borders button.
- **Two font weights.** Regular and bold. Gray ~60% for labels, near black for numbers.

Limits: no rounded corners, no true cell padding. Gets ~85% of the mockup.

---

## Formula notes

All of this works with standard formulas, no Apps Script:

- Dropdowns: Data validation
- Dynamic brand/month filtering: SUMIFS, COUNTIFS referencing the dropdown cells
- Named account lists: FILTER, spills variable length automatically
- Rate lookups: XLOOKUP against the pricing sheet
- Uncharged value: SUMIFS with `charged = FALSE` as a criterion

**Retention is the awkward one.** Comparing active placements this month vs last gets ugly nested in one expression. Use a helper column on the placements tab computing active status per month, then count against that.

**Validate every percentage.** Compute as `(current - prior) / prior * 100`, never hand entered. Negative changes display with a minus sign. The old format had several percentages that did not match their own underlying numbers, which destroys client trust in the entire document.

---

## Why this matters commercially

Context for the pricing work this supports:

- Four brands total. Concentration risk: losing one costs 25% of revenue.
- Palm Beach rep costs $700/month plus commissions. $8,400/year. One brand converting at $1,250/month covers him nearly twice over. This is **not** a crisis, and "unsustainable" overstates it. Do not negotiate from fear.
- All current contracts read "Orlando metropolitan" or "Central Florida." Palm Beach is unambiguously out of scope. The contract language is an asset.
- Palm Beach sells as a **second product**, not a price increase. The brand can decline it and keep Orlando at $1,200. Removes the confrontation.
- Say the six month pilot was free, explicitly. Establishes reciprocity and frames the ask as a fair transition.
- Lead with what the pilot produced, not with the territory framing.
- The `uncharged_value` figure is the single strongest price justification available. It is currently invisible.

**Structural point:** territory expansion is additive revenue. It does not fix the four brand concentration problem. Landing a fifth brand at correct pricing fixes both, and risks no existing relationship. Harder, slower, and probably the right answer.

---

## Build order

1. Collapse pricing sheet activity types
2. Add `charged` and `territory` to master, far right
3. Verify brand file IMPORTRANGE still resolves
4. Create placements tab
5. Backfill `charged` and `territory`
6. Build scorecard tab in one brand file, get the numbers right
7. Format it
8. Clone to remaining three brands
9. Backfill placements
10. Build the annual roll up

Steps 1 through 6 are the ones that matter. Everything after is repetition.
