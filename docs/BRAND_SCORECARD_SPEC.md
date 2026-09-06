# Brand Scorecard Report Spec

Monthly client facing report for iHospitality brand partners. Replaces the current activity summary format.

## Purpose

The current report answers "what did we do." This one answers "what did the brand get." That distinction drives every decision below.

Two audiences read it:
1. The brand manager, who needs something they can forward to their own boss
2. The person approving the invoice, who needs to see value before they see a number

## Core principles

1. **Outcomes first, invoice last.** Billing appears at the bottom, never the top.
2. **Scope isolation.** Only report on territory iHospitality actually covers. Statewide or other territory numbers appear at the bottom clearly labeled as context, or not at all.
3. **Named accounts beat totals.** A brand manager can picture "Salty Fox, Melbourne." They cannot picture "4 new accounts."
4. **Uncharged work is visible.** Every no charge service is valued at rate card and totaled. This is the single strongest price justification.
5. **Territory is line itemized.** Each territory is a separate product the brand can accept or decline.
6. **No self blame commentary.** State causes, not apologies. If numbers moved, say why.

## Report structure, in order

### 1. Header
- Territory and channel scope, for example "Central Florida on premise"
- Brand name, month, year
- Firm name and territory

### 2. Metric cards (2x2 grid)

| Metric | Definition | Secondary line |
|---|---|---|
| Live placements | Drink lists, taps, and printed features currently active | Change vs prior month |
| Accounts retained | Accounts with active programming that stayed active | Count as "51 of 56" |
| New doors opened | Accounts placing a first order this period | YTD running total |
| Cases moved | Cases sold in the period | YTD running total |

Live placements is the headline metric, not cases. Cases fluctuate with distributor ordering cycles and make performance look erratic. Placements are what the firm controls.

### 3. Uncharged support value (accent block)
- Dollar total of all no charge work delivered this period, valued at rate card
- One line breakdown of what it covered, for example "6 keg builds, 2 staff trainings, 1 tasting event"

Source: every activity log row marked N/C, market favors, or no charge. Multiply by the rate card price for that service type.

### 4. New this month
Named account list. Each row: account name and city, plus what happened. Keep the right side short.

### 5. In the pipeline
Named accounts in development but not yet closed. Include expected timing where known. This is what makes the report forward looking rather than a receipt.

### 6. Needs attention
One short paragraph. Losses, risks, and the recommended action. Neutral tone, cause stated, recommendation attached.

### 7. Billing summary
Line itemized, at the bottom, above a total:
- Retainer per territory, one line each
- Billable services for the period
- Total

## Data model

Activity log rows are the source of truth. Each row needs:

```
date          (date)
account       (string)
city          (string)
territory     (enum: orlando_metro, palm_beach, other)
channel       (enum: on_premise, off_premise)
brand         (string)
activity_type (enum, matches rate card)
notes         (string)
qty           (int)
charged       (bool)
rate          (currency, from rate card, applies whether charged or not)
image_ref     (string, optional)
```

The `charged` boolean is what makes the uncharged value calculation possible. Do not omit it.

## Computed fields

- `uncharged_value` = sum of `qty * rate` where `charged = false`
- `billable_total` = sum of `qty * rate` where `charged = true`
- `new_doors` = distinct accounts whose first ever activity row falls in this period
- `retained` = accounts with an active placement in both this period and the prior period
- `retention_rate` = retained / accounts active in prior period
- `live_placements` = count of placements with status active, not a sum of placements ever created

Live placements needs its own state. A drink list that came off the menu at a reprint must be marked inactive, otherwise the number only ever goes up and becomes meaningless.

## Filtering rules

Every figure on the report filters to:
- The single brand the report is for
- The territories that brand is paying for
- The channel iHospitality covers

Never mix in statewide numbers or other reps' activity inside the main body.

## Validation

Percentage changes must be computed, never hand entered. Every displayed percentage should be derived as `(current - prior) / prior * 100` and rounded to one decimal. Every negative change displays with a minus sign. Add a test for this. The prior format had several percentages that did not match their own underlying numbers, which destroys client trust in the whole document.

## Also build

**Annual roll up.** Same structure, twelve month totals, with a year over year comparison. The renewal conversation happens against this document and it does not currently exist.

## Reference implementation

The visual mockup uses:
- Metric cards: muted 13px label, 24px medium weight number, 12px secondary line
- Accent block for uncharged value, blue tint background
- Bordered cards for named account lists
- Hairline dividers between rows
- Billing block separated by a top border

Adapt to whatever design system the portal uses. The ordering matters more than the styling.
