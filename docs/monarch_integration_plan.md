# Monarch-Informed Integration Plan

This plan focuses on lessons worth adopting from Monarch without breaking the app's local-only, single-user scope.

## Guiding Principle

Adopt workflow improvements, not product sprawl. The strongest gaps are around recurring review, transaction review state, and goal-oriented planning.

## Phase 1: Recurring Workflow

Status: in progress

Goals:
- Promote recurring payments from a budget subsection to a first-class workflow.
- Make likely subscriptions, fixed bills, and emerging recurring charges easy to review.
- Link recurring findings back into transactions and monthly planning.

Implementation:
- Add a dedicated `Recurring` workspace section in the frontend.
- Reuse `/api/budget/recurring` for initial delivery.
- Add navigation links from recurring candidates to filtered transactions.
- Keep the budget page recurring summary for continuity during migration.

Follow-up:
- Add recurring status controls such as `keep`, `cancel_review`, `paused`, `ignored`.
- Add notes and user confirmation for false positives.
- Add due-soon and recently-missed recurrence indicators.

## Phase 2: Review Queue

Status: planned

Goals:
- Introduce an explicit review workflow similar to Monarch's "reviewed transactions" model.
- Reduce trust friction by making unreviewed items obvious.
- Separate "categorized" from "reviewed" so users can confirm the feed is correct.

Implementation:
- Add transaction review fields and timestamps in the data model.
- Show dashboard and transactions KPIs for `needs review`.
- Add bulk review actions and smart filters.
- Consider marking auto-categorized rows as still needing review until confirmed.

## Phase 3: Goals and Sinking Funds

Status: planned

Goals:
- Turn planned savings into explicit goals with progress tracking.
- Support savings targets, debt payoff, and irregular future expenses.
- Connect accounts and monthly contributions to goals.

Implementation:
- Add goal entities, target amounts, target dates, and linked accounts.
- Allow monthly contribution plans and debt reduction goals.
- Surface goal progress on dashboard and budget pages.
- Support non-monthly expense planning and sinking-fund style rollovers.

## Phase 4: Budget Flexibility

Status: planned

Goals:
- Improve handling for variable and seasonal spending.
- Preserve current category budgeting while adding lighter-weight planning options.

Implementation:
- Expand rollover behavior and surface it more clearly in budget UI.
- Add non-monthly buckets for annual or seasonal expenses.
- Add saved budget presets and stronger month-over-month comparison.

## Phase 5: Dashboard Polish

Status: planned

Goals:
- Improve the daily check-in experience.
- Make the home page answer "what needs attention right now?"

Implementation:
- Add configurable widgets for recurring due soon, uncategorized, unreviewed, and sync health.
- Add saved insight presets and quick-jump filters into transactions.
- Add stronger anomaly callouts for unusual merchants or spend spikes.
