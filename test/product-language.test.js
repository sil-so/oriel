import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('the shipped-facing interface uses Oriel-owned activity terminology', () => {
  const interfaceMarkup = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const timelineScript = fs.readFileSync(new URL('../web/js/timeline.js', import.meta.url), 'utf8');
  const modalScript = fs.readFileSync(new URL('../web/js/modals.js', import.meta.url), 'utf8');
  const shippedInterface = `${interfaceMarkup}\n${timelineScript}\n${modalScript}`;
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(interfaceMarkup, />Activity Stream</);
  assert.match(interfaceMarkup, />Recorded Activity</);
  assert.doesNotMatch(interfaceMarkup, /Activity Mix|Recorded Activity Breakdown/);
  assert.doesNotMatch(interfaceMarkup, />Memory Aid</);
  assert.doesNotMatch(interfaceMarkup, />Captured Activities/);
  assert.doesNotMatch(shippedInterface, /Review Passive Time|Keep Time|Keep Audible|Discard Silent/);
  assert.doesNotMatch(shippedInterface, /Source details|modal-source-fragment-row/);
  assert.match(readme, /Activity Stream Timeline/);
  assert.doesNotMatch(readme, /Activity Mix/);
  assert.doesNotMatch(readme, /Passive Attention Review/);
  assert.doesNotMatch(readme, /Memory Aid Timeline/);
});
