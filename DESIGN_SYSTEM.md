# Design System Contract — Rx Search & Rescue

Source of truth: `Rx Search and Rescue - Brand Identity.pdf` (palette, type,
product theme) and `- Screen Walkthrough.pdf` (7 screens). Tokens are defined
in `apps/web/src/app/globals.css` (@theme). Components live in
`apps/web/src/components/ui/*` (primitives) and `src/components/domain/*`
(product-specific). Hand-crafted shadcn-style: cva variants + Radix where a
primitive needs behavior. Screen agents import ONLY from these two dirs — no
raw one-off styling of buttons/chips/cells inside screens.

## Palette recap

- App bar & primary buttons: `deepwater` bg, white text; hover `harbor`.
- Page bg `fog`; cards white with `shadow-card`; borders `mist`.
- `rescue` orange: ONE action per screen (Run Comparison / Approve / Activate).
- Coverage: `covered` #1F7A4D, `restricted` #B97A0F, `notcovered` #C0392B —
  each with a `-soft` bg for chips/cells. Meaning-only.

## Primitives (ui/) — props contracts

- `Button` — variants: `primary` (deepwater), `rescue` (THE flare; max one per
  screen), `secondary` (white, mist border), `ghost`, `destructive`. Sizes sm/md.
- `Input`, `Select`, `Checkbox`, `RadioGroup`, `Label`, `Textarea` — standard
  shadcn shapes, mist borders, harbor focus ring.
- `Card`, `CardHeader`, `CardContent` — white, radius-card, shadow-card.
- `Table`, `THead`, `TRow`, `TCell` — fog header row with eyebrow-style column
  labels, mist row dividers, hover fog.
- `Dialog`, `Popover`, `Tooltip`, `Tabs`, `Separator` — Radix-based.
- `toast` via sonner, styled to brand.

## Domain components (domain/) — props contracts

- `StatusChip status: "new"|"in_review"|"approved"|"delivered"` — workflow
  chips (screen 1). Mono uppercase 11px. new=fog/steel, in_review=restricted-soft,
  approved=covered-soft, delivered=covered-soft w/ check.
- `RestrictionChip kind: "pa"|"st"|"ql"|"custom" label?: string` — restricted-soft.
- `CoverageCell tier?: number copayCents?: number|null coinsurancePct?: number|null
  coverage: CoverageStatus substitutionNote?: string onClick?` — THE signature
  surface: mono `T2 · $8` on white; `covered_equivalent` shows note line;
  `not_on_formulary` renders notcovered-soft bg + `NOT ON FORMULARY` mono. Click
  opens provenance popover (children slot).
- `NetworkStatusChip status: NetworkStatus` — `In network · Preferred`
  (covered-soft) / `In network · Standard` (restricted-soft) / `Not in network`
  (notcovered-soft).
- `PlanCard` — screen 3 card: checkbox, plan name, carrier, `CURRENT PLAN`
  badge, PREMIUM / RX DEDUCTIBLE / pharmacy-status columns (eyebrow labels +
  mono values), warning badge slot (missing formulary/costs).
- `PlanSummaryCard` — screen 4 strip: plan name, carrier, pharmacy status line,
  COVERED `7 of 7` / RESTRICTIONS / EST. MONTHLY mono stats, optional
  `BEST COVERAGE` badge (covered-soft, only computed—never decorative).
- `ChannelSwitcher value: PharmacyChannel|"client" onChange` — radio row from
  screen 4: client pharmacy (labeled with its name) / preferred retail /
  standard retail / mail order 90-day.
- `AppShell` — deepwater app bar: logo lockup left (ring + "RX SEARCH & RESCUE"
  Archivo), Dashboard/Admin nav, user name right. Content max-w-6xl.
- `PdfPane src` — left pane of intake review; placeholder box + page nav ok in v1.
- `EmptyState`, `PageHeader title actions` — consistent page scaffolding.

## Logo

`components/brand/LogoMark.tsx` — inline SVG: rescue-orange ring with 4 gaps at
the diagonals + white "Rx" (Archivo Black) center, per brand PDF. Also a
`LogoLockup` horizontal variant for the app bar. No gradients, no shadows.

## Typography rules

- Screen titles: Archivo 800, deepwater.
- Eyebrow labels (PREMIUM, COVERED, table headers): `text-eyebrow` utility.
- Data values (money, tiers, dates, ZIPs): `text-data` (Plex Mono 500/600).
- Body/labels: Public Sans 400/600.

## Layout

- Screens are full-width tables/grids inside `max-w-6xl mx-auto px-6 py-8`.
- Density: compact but calm — row height ~44px, cell padding 12px, generous
  whitespace between sections (space-y-8).
