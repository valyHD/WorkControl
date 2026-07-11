---
name: workcontrol-ui-modernization
description: Use automatically when the user asks to modernize, style, reorganize, simplify, make responsive, or improve WorkControl dashboards, cards, forms, tables, charts, or page clarity without losing behavior. Combine with workcontrol-create-feature when new product logic is required. Do not use for isolated bugs, Firebase-only changes, or deployment.
---

# WorkControl UI Modernization

## Expected input

- The target page or module, visual goals, screenshots or references, and behavior that must remain unchanged.
- Known desktop, mobile, browser, accessibility, or assistant-integration requirements.

## Mandatory workflow

1. Read the root and applicable module `AGENTS.md` files and inspect the current page, styles, shared components, design tokens, routes, tests, and responsive behavior.
2. Inventory every action, field, state, permission, filter, table column, download, navigation target, error, and empty state before editing.
3. Identify the hierarchy problem and propose a page structure using the existing WorkControl design system: header, KPI summary, quick actions, filters, content, tables or charts, and empty or error states as appropriate.
4. Preserve all existing functionality and data flow. Reorganize presentation in small steps and reuse shared components rather than copying page-specific variants.
5. Keep the UI mobile-first, readable, keyboard accessible, and consistent across supported browsers. Prevent overflow, overlap, layout shift, hidden actions, and nested decorative cards.
6. Make primary actions obvious and status colors semantic. Keep dense operational pages scannable without turning them into marketing layouts.
7. Add stable `data-assistant-action`, `data-assistant-field`, and `data-assistant-section` attributes to important controls and sections where the assistant depends on them.
8. Preserve loading, disabled, validation, success, error, confirmation, and permission states. Do not mask unavailable behavior with visual-only controls.
9. Update focused component tests and run Playwright at representative desktop and mobile viewports, including scrolling, open overlays, and navigation.
10. Run `npm run lint`, `npm run test:run`, and `npm run build`.

## Final checks

- Compare the before and after action inventory; nothing may be lost or made unreachable.
- Verify long Romanian labels, touch targets, focus states, downloads, forms, tables, and maps where relevant.
- Inspect screenshots for overflow, overlap, inconsistent colors, and assistant overlays.

## Forbidden

- Do not change business rules, Firebase contracts, permissions, or routing semantics for visual convenience.
- Do not duplicate shared components, hide features, use arbitrary DOM manipulation, or add nonfunctional controls.
- Do not commit, push, or deploy unless separately requested.

## Output

Report the original UX problems, preserved action inventory, files changed, responsive and accessibility decisions, tests and viewport checks, results, and remaining visual risks.
