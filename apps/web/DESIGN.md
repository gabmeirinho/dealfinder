---
name: Dealfinder
description: A restrained local control desk for defining, prioritizing, and reviewing vehicle searches.
colors:
  ink: "#172126"
  navy: "#102735"
  paper: "#f5f8f6"
  mist: "#d7e3df"
  line: "#b8c8c3"
  coast: "#397079"
  signal: "#ef704f"
  success: "#27875d"
  warning: "#a86224"
  danger: "#a43e32"
  muted: "#596a70"
typography:
  display:
    fontFamily: '"Arial Narrow", "Aptos Narrow", "Roboto Condensed", sans-serif'
    fontSize: "clamp(3.6rem, 7vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Arial Narrow", "Aptos Narrow", "Roboto Condensed", sans-serif'
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: '"Arial Narrow", "Aptos Narrow", "Roboto Condensed", sans-serif'
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
    fontSize: "0.7rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.03em"
rounded:
  square: "0"
  indicator: "50%"
  pill: "999px"
  brand-mark: "50% 50% 50% 8px"
spacing:
  compact: "8px"
  control: "12px"
  standard: "18px"
  roomy: "24px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "12px 18px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.coast}"
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.navy}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "11px 17px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "11px 17px"
    height: "44px"
  field:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "9px 11px"
    height: "43px"
  chip-selected:
    backgroundColor: "{colors.coast}"
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    padding: "8px 10px"
  state-badge-active:
    backgroundColor: "#dceee5"
    textColor: "#166142"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
---

# Design System: Dealfinder

## Overview

**Creative North Star: "The Search Ledger"**

Dealfinder feels like a private operational ledger: quiet enough for sustained desktop work, exact enough for consequential search criteria, and local rather than corporate. Navy framing establishes the control desk; cool paper surfaces and a faint 28px ruling keep the workspace legible and tactile without turning it decorative.

The interface is dense but not compressed. Large condensed headings establish location, monospace labels carry machine state and measured values, and ordinary body copy remains calm and readable. Sharp dividers, flat surfaces, and a meaningful priority spine organize the work; signal coral is reserved for focus, capacity, priority, and states that deserve attention.

**Key Characteristics:**

- Navy shell around a cool ruled-paper workspace.
- Condensed display type paired with practical sans-serif body copy and monospace telemetry.
- Flat, square operational surfaces separated by lines rather than cards and shadows.
- A dark priority spine that makes ordering part of the information architecture.
- Coral signal marks used sparingly for consequential state and interaction.

## Colors

The palette combines blue-black structure, cool paper neutrals, a muted coastal teal, and one warm coral signal, with separate semantic colors for success, warning, and danger.

### Primary

- **Signal Coral** (`signal`): Marks focus rings, active navigation dots, capacity progress, hard constraints, and loading or attention indicators. Its rarity makes it consequential.
- **Ledger Navy** (`navy`): Frames the application, anchors primary actions, and forms the priority spine and major rules.

### Secondary

- **Coastal Teal** (`coast`): Supports links, selected choices, soft constraints, hover states, selection, and scrollbars without competing with signal coral.

### Tertiary

- **Local Green** (`success`): Active, verified, ready, and healthy state.
- **Caution Ochre** (`warning`): Unverified, stale, or cautionary state.
- **Destructive Brick** (`danger`): Validation errors and destructive actions only.

### Neutral

- **Carbon Ink** (`ink`): Default high-contrast reading color.
- **Cool Paper** (`paper`): Main workspace, sheet, and dialog surface.
- **Sea Mist** (`mist`): Quiet hover and supporting-state surface.
- **Ruled Line** (`line`): Structural dividers and rails.
- **Muted Slate** (`muted`): Secondary explanation and supporting copy.

### Named Rules

**The Signal Means Something Rule.** Use coral only for focus, priority, capacity, hard constraints, loading, or attention; it is not a general decoration color.

**The State Colors Stay Literal Rule.** Green confirms readiness, ochre asks for caution, and brick marks error or destruction. Do not exchange those meanings.

## Typography

**Display Font:** Arial Narrow, with Aptos Narrow, Roboto Condensed, and sans-serif fallbacks.

**Body Font:** Avenir Next, with Segoe UI and sans-serif fallbacks.

**Label/Mono Font:** UI monospace, with SFMono-Regular, Consolas, and monospace fallbacks.

**Character:** The condensed face reads like a ledger heading rather than a marketing headline. The body stack keeps instructions conversational, while monospace labels make counts, versions, priorities, and constraint strength feel operational and comparable.

### Hierarchy

- **Display** (700, fluid 3.6–6rem, 0.9 line-height): Page titles only; tightly tracked and visually dominant.
- **Headline** (700, 2rem, compact line-height): Editor and confirmation titles.
- **Title** (700, 1.35rem, -0.02em tracking): Section titles; search-row titles can scale from 1.5–2.1rem.
- **Body** (400, 1rem, 1.65 line-height): Explanations and longer instructions, generally constrained to about 660px or 60ch.
- **Label** (700, 0.7rem, 0.03em tracking): Uppercase capacity, state, metadata, and constraint labels with tabular numerals where comparison matters.

### Named Rules

**The Three-Voice Rule.** Condensed type names the work, body type explains it, and monospace type reports state or measurements.

## Layout

The desktop shell uses a sticky 76px top bar and a 220px sticky sidebar. The main workspace centers content at a 1500px maximum and uses fluid horizontal padding from 24–76px, with generous vertical separation between system health, page heading, capacity rail, and the search ledger.

Search rows are structured records, not freestanding cards: priority, core criteria, metadata, and actions occupy explicit columns divided by 1px rules. The leading 92px navy priority spine is visually continuous with the ledger hierarchy. Editor forms use a two-column section model with a 180px explanatory rail and a flexible field column; fields commonly follow an 8px label gap and 18–22px internal rhythm.

At 1180px, row actions move beneath the record. At 900px, the sidebar becomes a horizontal navigation rail and form sections stack. At 700px, the heading, health rail, search rows, metadata, and field grids collapse for narrow screens while the priority spine remains visible. At 440px, workspace gutters tighten to 16px and paired range inputs stack.

**The Ruled Surface Rule.** Establish hierarchy with grid tracks and 1px dividers; reserve the 3px navy rule for the beginning of a ledger or empty-state region.

## Elevation & Depth

The system is flat by default. Tonal shifts, borders, and the fixed navy frame create depth without ambient card shadows. Shadows appear only when a surface truly leaves the document plane: the right-side editor and the centered confirmation dialog.

### Shadow Vocabulary

- **Editor Lift** (`-18px 0 50px rgba(8, 25, 34, 0.22)`): Separates the sliding editor sheet from its scrim.
- **Decision Lift** (`0 18px 55px rgba(4, 19, 27, 0.28)`): Isolates consequential confirmation dialogs.
- **Status Halo** (`0 0 0 4px rgba(123, 214, 165, 0.13)`): Gives the tiny healthy-state dot enough visibility to read.

**The Flat Until Modal Rule.** Rows, controls, and status rails stay shadowless; only overlays receive structural elevation.

## Shapes

The dominant form language is square and exact. Buttons, fields, chips, segments, rows, sheets, dialogs, and message surfaces use hard corners (`0`). Curves are semantic exceptions: circular health dots, pill-shaped state badges and switches (`999px`), the empty-state orbit, and the asymmetric brand mark (`50% 50% 50% 8px`).

**The Curves Carry State Rule.** Rounded shapes identify status, toggles, orbit imagery, or the mark; they do not soften ordinary containers.

## Components

### Buttons

- **Shape:** Square, compact, and plainly mechanical (`0` radius).
- **Primary:** Paper text on navy, at least 46px high with 12px × 18px padding; hover shifts to coastal teal.
- **Secondary:** Transparent with a cool-gray 1px border, at least 44px high; hover fills with mist.
- **Danger:** White on destructive brick and reserved for confirmed destructive actions.
- **Text:** Coastal teal with a 1px underline; used for low-emphasis recovery or creation paths.
- **Focus:** Every interactive variant uses a 3px coral outline with a 3px offset.

### Chips

- **Style:** Square option chips use pale mist-paper, cool text, a 1px border, and 8px × 10px padding.
- **State:** Selected chips invert to coastal teal and paper. Hard/soft strength controls use distinct pale brick and pale teal fills. Pills are reserved for read-only state badges.

### Cards / Containers

- **Corner Style:** Square (`0` radius).
- **Background:** Search records use translucent cool paper and brighten to white on hover; paused records recede toward mist.
- **Shadow Strategy:** None at rest; use ruled dividers and the priority spine instead.
- **Border:** A 3px navy opening rule followed by 1px line-colored row dividers.
- **Internal Padding:** Core record cells use roughly 24–42px; metadata and actions are denser.

### Inputs / Fields

- **Style:** White, square, 43px minimum height, with 9px × 11px padding and a cool gray-green 1px stroke.
- **Focus:** A 3px coral outer outline; caret remains coral.
- **Error / Disabled:** Invalid fields use a brick border and warm-white fill. Disabled actions retain their structure at 45% opacity.

### Navigation

Navigation sits directly on the navy shell. Labels are compact sans-serif; the current destination brightens to white and receives a coral dot with a subtle halo. Disabled destinations recede to desaturated teal-gray. Below 900px, the vertical sidebar becomes a horizontally scrollable rail and decorative dots are removed.

### Priority Spine

Each saved search begins with a navy numerical rail that keeps ordering visually persistent. Two-digit tabular monospace numbers support scanning; square outlined arrow controls stay quiet until their border turns coral on hover. Paused rows desaturate the spine without removing it.

### Editor Sheet and Confirmation Dialog

The editor enters from the right over a dark scrim and keeps a sticky navy header and sticky paper action rail. The confirmation dialog centers a square decision surface over a stronger scrim; its warning or destructive icon block carries the relevant semantic tint. Both are the only structurally elevated surfaces.

## Do's and Don'ts

### Do:

- **Do** preserve the navy frame, cool paper field, and flat ruled-ledger construction when extending the application.
- **Do** keep coral rare and attach it to focus, priority, capacity, hard constraints, loading, or attention.
- **Do** use the priority spine when ordering is part of the operator's decision model.
- **Do** keep labels visible, focus rings explicit, numerals comparable, and reduced-motion behavior intact.
- **Do** collapse grids at the established 1180px, 900px, 700px, and 440px breakpoints according to content pressure.

### Don't:

- **Don't** introduce rounded cards, soft floating panels, or decorative shadows into the base workspace.
- **Don't** use signal coral as a broad brand wash or routine hover color.
- **Don't** replace dividers and grid tracks with isolated dashboard tiles.
- **Don't** use display type for explanatory copy or monospace type for long prose.
- **Don't** hide consequential state inside color alone; pair it with a label, message, or icon.
