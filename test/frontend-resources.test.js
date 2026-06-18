import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('application markup loads bundled UI dependencies instead of runtime CDNs', () => {
  const markup = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(markup, /cdn\.tailwindcss\.com|unpkg\.com|fonts\.googleapis\.com/);
  assert.match(markup, /\/css\/vendor\.css/);
  assert.match(markup, /\/assets\/vendor\/phosphor/);
});

test('application chrome uses the bundled Oriel logo mark', () => {
  const markup = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../web/css/index.css', import.meta.url), 'utf8');

  assert.match(markup, /class="brand-mark"/);
  assert.match(css, /\/assets\/brand\/oriel-logo\.svg/);
  assert.doesNotMatch(markup, /ph-clock-countdown brand-mark/);
});

test('data client uses the native WebKit bridge when hosted by Oriel.app', async () => {
  const source = fs.readFileSync(new URL('../web/js/data-client.js', import.meta.url), 'utf8');
  const messages = [];
  const context = {
    window: {
      webkit: {
        messageHandlers: {
          oriel: {
            postMessage(message) {
              messages.push(message);
              return Promise.resolve({ ok: true, value: [{ id: 'project-1' }] });
            }
          }
        }
      }
    },
    fetch() {
      throw new Error('HTTP fallback should not be used under the native host');
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);

  const projects = await context.window.OrielData.request('projects.list', {});

  assert.deepEqual(projects, [{ id: 'project-1' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ operation: 'projects.list', payload: {} }]);
});

test('data client retains HTTP request support for the transitional browser runtime', async () => {
  const source = fs.readFileSync(new URL('../web/js/data-client.js', import.meta.url), 'utf8');
  const calls = [];
  const context = {
    window: {},
    fetch(url, options) {
      calls.push({ url, options });
      return Promise.resolve({ ok: true });
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);

  await context.window.OrielData.fetch('http://localhost:3000/api/status');

  assert.deepEqual(calls, [{ url: 'http://localhost:3000/api/status', options: undefined }]);
});

test('native icon rendering routes optional website icon access through the app scheme', () => {
  const utils = fs.readFileSync('web/js/utils.js', 'utf8');
  assert.match(utils, /oriel-icon:\/\/website/);
  assert.match(utils, /oriel-icon:\/\/app/);
});
