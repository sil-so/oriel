# Oriel Design System

## Direction

Oriel uses a dense, neutral dark macOS productivity interface. The system should
feel calm, local, precise, and task-focused. Consistency matters more than visual
novelty.

The current implementation is a bundled static web UI in `index.html`, `css/`,
and `js/`. Shared primitives should be CSS class contracts and small existing
template/helper cleanups, not a new UI framework.

## Theme And Tokens

The neutral dark `graphite` theme is the only design target for this refactor.
`light` and `reference` remain selectable compatibility themes for existing
preferences and manual user choice, but they are not design targets for new UI
work. Do not spend time redesigning or polishing those compatibility themes
while the neutral system is being normalized.

Canonical token source:

- Color, radius, shadow, focus, and state tokens live in `css/index.css`.
- Tailwind utility use in markup and JS-rendered templates should resolve toward
  shared app classes instead of one-off arbitrary values.
- Hard-coded colors are allowed only for project identity swatches and chart
  series where dynamic color is the feature.

Color roles:

| Role | Token family | Use |
| --- | --- | --- |
| Canvas | `--surface-canvas` | App background and timeline field |
| Panel | `--surface-panel` | Main regions, sidebars, grouped settings |
| Raised | `--surface-raised` | Cards, popovers, elevated rows |
| Recessed | `--surface-recessed` | Inputs, inset controls, quiet containers |
| Hover | `--surface-hover` | Hover and active feedback |
| Modal | `--modal-surface` | Dialog panels |
| Border | `--border`, `--border-strong`, `--separator*` | Edges and dividers |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` | Content hierarchy |
| Accent | `--accent`, `--accent-strong`, `--accent-wash`, `--accent-border` | Primary action, selection, focus, links |
| Status | `--success`, `--warning`, `--danger`, `--danger-wash` | Semantic state only |
| Overlay | `--overlay` | Modal scrim |

Blue accent rules:

- Use blue for primary actions, selected/current state, keyboard focus, links,
  and project color when the project explicitly uses blue.
- Do not use blue as generic card decoration, inactive borders, arbitrary icons,
  or info-box chrome when another semantic token is clearer.
- Selected state should combine background, border, and/or icon affordance; do
  not communicate selection by color alone.

## Type, Spacing, Radius

Use one product UI type family: Inter with system fallbacks. Use fixed sizes,
not fluid `clamp()` scales.

| Role | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| Page title | 18px / 24px | 700 | Workspace headers only |
| Modal title | 16px / 22px | 700 | Dialog heading |
| Card title | 13px / 18px | 650-700 | Panels, stat cards, project cards |
| Section label | 11px / 16px | 700 | Short uppercase labels only |
| Body | 13px / 19px | 400 | Default app text |
| Body strong | 13px / 19px | 600 | Emphasis, row primary labels |
| Helper text | 12px / 16px | 400-500 | Settings help, empty states |
| Metadata | 10-11px / 14px | 500-700 | Dense labels, timestamps, pills |

Spacing scale:

`2, 4, 6, 8, 12, 16, 20, 24, 32`

Rules:

- App chrome height remains compact and stable.
- Panel padding is `20px` or `24px`.
- Card padding is `12px` or `16px` depending on density.
- Dense rows use `8-12px` vertical and `12-16px` horizontal padding.
- Modal header/body/footer spacing should be shared across all dialogs.
- Avoid nested cards. Use a divider, label, or inset surface only when it
  clarifies structure.

Radius scale:

| Role | Radius |
| --- | --- |
| Small controls | `6px` |
| Buttons / inputs | `8px` |
| Cards / panels | `10px` |
| Modals / popovers | `12px` |
| Pills / dots | `999px` |

## Component Contract

Buttons:

- `button-primary` is for the main action in a local context.
- `button-secondary` is for neutral actions.
- Destructive actions use danger tokens and clear labels.
- Every button needs default, hover, focus-visible, active, disabled, and loading
  affordances where applicable.

Icon buttons:

- Use one fixed hit area and one hover/focus treatment.
- Use Phosphor icons already bundled with the app.
- Icon-only controls need labels or titles.

Fields and selects:

- `field`, `custom-select`, and app-rendered select menus share height, radius,
  border, background, focus ring, disabled state, and placeholder contrast.
- Avoid native select popups where the current app-rendered menu pattern is
  already established.

Tabs:

- `app-tab-group` and `app-tab` define workspace, timeline mode, and settings
  tab treatment.
- Active state should match across all tab groups.

Panels and cards:

- `workspace-panel` is for major app regions.
- `surface-panel` is for grouped controls or sidebar cards.
- `project-card`, `report-panel`, AI cards, and stat cards should converge on
  the same surface, border, radius, padding, and hover model.

Modals:

- All modal overlays use the same scrim, z-index, placement, panel radius, and
  elevation.
- All modal panels use the same header row, close button placement, title style,
  scroll body behavior, and footer alignment.
- Top-align tall modals below the app chrome; center only compact confirmations.

Badges, pills, and metadata:

- Use shared pill styles for durations, status, activity mix, and metadata.
- Project color dots remain allowed because color identity is the content.

Callouts and danger zones:

- Info callouts use neutral or info tokens, not arbitrary blue boxes.
- Danger sections use danger tokens consistently and make irreversible behavior
  explicit.

Empty states:

- Empty states should be quiet, compact, and actionable when an action exists.
- Do not use decorative illustrations.

## Migration Rules

- Preserve functionality, stored data, privacy behavior, time calculations,
  capture logic, AI settings, exclusions, and project/report calculations.
- Replace repeated inline utility strings with shared classes when touching a
  surface.
- Migrate one surface family at a time: controls, modals/settings, timeline,
  projects/statistics/AI insights.
- When hard-coded values remain, document why they are data-driven, project
  identity, chart identity, or a temporary exception.
- Keep screenshots and local activity artifacts out of commits.

## Verification

For design-system implementation PRs, run:

```bash
git diff --check
npm test
swift test
```

Run `npm run build:assets` after Tailwind input, vendored assets, or dependency
changes. Run `./script/build_and_run.sh` and visually inspect the local app for
meaningful UI changes.
