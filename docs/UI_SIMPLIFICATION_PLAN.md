# UI Simplification Plan

## Current Redundancies Identified
- `/transactions` and `/categorize` both offered category editing and overlapping filters.
- Filtering controls were fragmented and repeated with different behavior.
- Auto-categorization controls lived only in the studio while transaction edits were split across pages.

## Consolidation Decisions
- Make `/categorize` the primary workflow for browsing + editing + insights.
- Keep `/transactions` as a route alias that redirects to `/categorize` for compatibility/bookmarks.
- Keep `/rules` as the single source of truth for manual rule lifecycle management.
- Keep `/analytics` for deeper exploratory charts, while `/categorize` focuses on edit-time feedback.

## Simplified Navigation Model
- Sidebar now presents one transaction workflow entry point (`/categorize`, labeled "Transactions").
- Users scroll through sections on one page via left jump navigation.

## Interaction Streamlining
- Shared `FilterBar` component with:
  - period presets + custom range
  - account subset controls (all/none/spending/credit cards + search)
  - hierarchical category filtering + uncategorized chip
  - pending/transfers toggles
  - one-click reset
- Filters persist in URL and local storage (URL wins).
- Debounced refresh and request cancellation prevent noisy refetches.

## Responsiveness Standards Applied
- API action buttons expose loading + disabled states.
- Auto-categorize and apply flows display success/error feedback and prevent double submit.
- Row-level category edits in studio are optimistic with rollback on failure.
