import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('zoom control displays minute intervals without a Zoom prefix', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /#zoom-dropdown-container\s*\{[\s\S]*width:\s*118px;/);
  assert.match(css, /#zoom-dropdown-btn\s*\{[\s\S]*height:\s*32px;/);
  assert.doesNotMatch(html, /Zoom: (?:1|5|10|15|30|60) min/);
  assert.match(html, /id="zoom-dropdown-label">5 min<\/span>/);

  for (const value of [1, 5, 10, 15, 30, 60]) {
    assert.match(html, new RegExp(`data-value="${value}"[\\s\\S]*?<span>${value} min<\\/span>`));
  }
});
