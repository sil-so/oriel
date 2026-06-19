import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const css = fs.readFileSync('web/css/index.css', 'utf8');

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `expected ${selector} declarations`);
  return match[1];
}

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\}`));
  assert.ok(match, `expected ${selector} rule`);
  return match[0];
}

test('graphite token foundation exposes explicit semantic and layout roles', () => {
  const root = declarationsFor(':root');
  const expectedTokens = [
    '--surface-canvas',
    '--surface-panel',
    '--surface-raised',
    '--surface-recessed',
    '--surface-hover',
    '--modal-surface',
    '--control-surface',
    '--text-primary',
    '--text-secondary',
    '--text-tertiary',
    '--border',
    '--border-strong',
    '--separator',
    '--separator-soft',
    '--separator-muted',
    '--separator-strong',
    '--focus-ring',
    '--focus-ring-offset',
    '--selected-surface',
    '--selected-border',
    '--selected-shadow',
    '--info-surface',
    '--info-border',
    '--info-text',
    '--danger',
    '--danger-wash',
    '--danger-border',
    '--overlay',
    '--shadow-float',
    '--shadow-popover',
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
    '--radius-pill',
    '--z-base',
    '--z-raised',
    '--z-sticky',
    '--z-sticky-raised',
    '--z-timeline-overlay',
    '--z-chrome',
    '--z-dropdown',
    '--z-popover',
    '--z-modal',
    '--z-tooltip',
    '--z-confirm'
  ];

  for (const token of expectedTokens) {
    assert.match(root, new RegExp(`${token}:`), `expected ${token}`);
  }
});

test('compatibility themes keep semantic token overrides available', () => {
  const light = declarationsFor(':root[data-theme="light"]');
  const reference = declarationsFor(':root[data-theme="reference"]');
  const expectedThemeTokens = [
    '--focus-ring',
    '--selected-surface',
    '--selected-border',
    '--selected-shadow',
    '--info-surface',
    '--info-border',
    '--info-text',
    '--danger-border',
    '--overlay',
    '--shadow-popover'
  ];

  for (const token of expectedThemeTokens) {
    assert.match(light, new RegExp(`${token}:`), `expected light ${token}`);
    assert.match(reference, new RegExp(`${token}:`), `expected reference ${token}`);
  }
});

test('focus, selected state, and overlay stacking consume token roles', () => {
  assert.match(
    ruleFor(`.app-control:focus-visible,
.field:focus,
.custom-select:focus,
button:focus-visible`),
    /outline:\s*2px solid var\(--focus-ring\)/
  );
  assert.match(ruleFor('.activity-block.selected'), /border-color:\s*var\(--selected-border\)/);
  assert.match(ruleFor('.activity-block.selected'), /background:\s*var\(--selected-surface\)/);
  assert.match(ruleFor('.activity-block.selected'), /box-shadow:\s*var\(--selected-shadow\)/);
  assert.match(ruleFor('.modal-overlay'), /z-index:\s*var\(--z-modal\)/);
  assert.match(ruleFor('.settings-floating-tooltip'), /z-index:\s*var\(--z-tooltip\)/);
  assert.match(ruleFor('.confirm-modal-overlay'), /z-index:\s*var\(--z-confirm\)/);
});
