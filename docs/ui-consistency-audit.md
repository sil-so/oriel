# UI Consistency Audit

Date: 2026-06-12

Sources: current `origin/main` code, existing local screenshots in the parent
workspace, and the design-system refactor brief. Screenshots are private review
inputs and must not be committed.

## Diagnosis

Oriel already has a solid neutral dark direction, but the UI is assembled from
too many local styling decisions. The code mixes CSS tokens, Tailwind utilities,
arbitrary values, and JS-generated class strings across the same visual roles.
The result is four overlapping systems:

- Activity Stream / Time Entries: dense rows, pills, exact geometry, compact
  popovers, strong selected states.
- Settings and preferences: looser cards, many nested panels, info/key states,
  custom select menus, provider configuration.
- Projects and statistics: dashboard-like cards, summary metrics, charts, and
  project color identity.
- Utility modals: time entry, project creation, rules, confirmation, project
  details, and AI detail dialogs with slightly different headers, spacing,
  close buttons, bodies, and footers.

The main problem is hierarchy and component vocabulary, not the neutral palette.

## Relevant Surfaces

| Surface | Primary files |
| --- | --- |
| App shell, top chrome, tabs, date navigation | `index.html`, `css/index.css`, `js/main.js` |
| Timeline and Activity Stream | `index.html`, `css/index.css`, `js/timeline.js` |
| Work Times, Unlogged Work, AI sidebar | `index.html`, `css/index.css`, `js/timeline.js`, `js/ai-sidebar.js` |
| Modals and confirmation flows | `index.html`, `css/index.css`, `js/modals.js`, `js/main.js` |
| Settings and provider sections | `index.html`, `css/index.css`, `js/main.js`, `js/ai-settings.js` |
| Projects and project details | `index.html`, `css/index.css`, `js/projects.js` |
| Statistics and charts | `index.html`, `css/index.css`, `js/reporting.js` |
| AI Insights workspace | `index.html`, `css/index.css`, `js/main.js`, `js/ai-sidebar.js` |
| Theme state | `index.html`, `css/index.css`, `js/state.js` |

## Findings

Theme and tokens:

- `css/index.css` defines a useful neutral token base, but also carries `light`
  and `reference` variants. Tests currently assert multiple themes, so removal
  should be intentional and separate from the docs foundation.
- `index.html` and `js/state.js` still initialize and persist theme choices.
  Preserve compatibility until a focused theme-removal PR updates behavior and
  tests.
- Token roles need clearer meaning: accent, focus, selection, info, and project
  identity should not all collapse into generic blue.

Hard-coded styles:

- `index.html` uses many arbitrary values such as `border-[#2d2f34]`,
  `bg-[#0d0e10]`, `text-[10px]`, `text-[11px]`, `rounded-xl`, `w-[650px]`,
  and `z-[100]`.
- JS templates in `js/timeline.js`, `js/projects.js`, `js/main.js`, and
  `js/reporting.js` repeat utility-heavy class strings for rows, cards, fields,
  and popover controls.
- Some chart/project colors are legitimate data identity; they should be
  explicitly exempt rather than treated as generic hard-coded UI color.

Typography:

- Uppercase metadata labels appear at several sizes and tracking levels.
- Modal titles, card titles, pane headers, helper copy, and metric labels use
  overlapping but inconsistent weights and sizes.
- Inline arbitrary font sizes make it hard to reason about hierarchy globally.

Surfaces and layout:

- `surface-panel`, `report-panel`, `project-card`, AI cards, sidebar cards, and
  popovers are close in intent but use separate padding, borders, radius, hover,
  and heading treatments.
- Settings contains nested panels that make grouping noisier than necessary.
- Timeline density is useful and should be preserved, but rows, badges, icons,
  and popover details need shared alignment rules.

Controls and states:

- Buttons generally use `button-primary` and `button-secondary`, but local
  icon buttons, date-picker buttons, dropdown rows, danger actions, and
  generated JS actions still carry one-off hover/focus classes.
- Focus visibility is present in many places but not consistently tokenized.
- Disabled and loading states are not consistently represented across AI,
  settings, modal, and sidebar actions.

Modals:

- Dialogs share `modal-overlay` and `modal-panel`, but each modal still defines
  its own header, body gaps, close button treatment, width, scroll behavior, and
  footer spacing.
- Tall settings/project/AI dialogs should share top-aligned scroll behavior.
  Compact confirmation dialogs can remain centered.
- Form labels, helper text, callouts, and danger actions need one modal-wide
  contract.

Accessibility and privacy:

- The app displays sensitive activity data, URLs, screenshots, projects, and
  billing context. Visual audit artifacts should stay local/private.
- State should not rely on color alone. Selection, provider key state, danger,
  success, and AI status need text/icon/shape affordances.
- Any UI work touching capture, exclusions, Keychain, AI, Logo.dev, screenshots,
  storage, exports, or logging must include explicit privacy/security PR notes.

## Canonical Component Inventory

Use or converge on these primitives:

- Button
- IconButton
- TextInput / NumberInput / DateInput
- Select and app-rendered select menu
- SegmentedTabs
- Modal
- Panel
- Card
- SectionHeader / SectionLabel
- Badge / Pill
- InfoCallout
- DangerZone
- EmptyState
- TimelineEntry / ActivityRow
- StatCard

In this codebase, primitives should normally be CSS classes plus small helper
cleanup in existing JS modules, not a new component framework.

## Migration Order

1. Product and design-system docs.
2. Token layer cleanup for color roles, type, spacing, radius, focus, and state.
3. Buttons, icon buttons, fields, selects, tabs, badges, and empty states.
4. Modal shell, headers, bodies, footers, callouts, and danger actions.
5. Settings sections and provider/key controls.
6. Timeline, Activity Stream, Work Times, Unlogged Work, and activity popovers.
7. Projects, project detail modal, statistics cards/charts, and AI Insights.
8. Theme compatibility cleanup once neutral `graphite` is fully coherent.

## Verification Commands

Baseline and docs-safe checks:

```bash
git diff --check
npm test
swift test
```

Additional checks by change type:

- Run `npm run build:assets` after Tailwind input, vendored frontend assets, or
  package dependency changes.
- Run `./script/build_and_run.sh --verify` after native packaging or launch-path
  changes.
- Run `./script/build_and_run.sh` and visually inspect the local app for
  meaningful UI changes.

## Acceptance Criteria

- Primary screens use one type scale, spacing scale, radius scale, surface
  model, control vocabulary, and modal structure.
- Blue accent usage is disciplined and semantically explainable.
- No new hard-coded UI colors, font sizes, radii, or spacing outside the token
  layer unless the value is data-driven or documented as a temporary exception.
- No behavior changes to capture, storage, time calculations, project logging,
  reporting, AI settings, exclusions, or privacy defaults.
- Private screenshots, local activity data, SQLite files, logs, archives, and
  credentials remain out of commits.
