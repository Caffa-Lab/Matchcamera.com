import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const allowed = new Set(['index.html', 'body/index.html', 'lens/index.html', 'accessories/index.html', 'database/index.html']);
const expectedSrc = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6581176496481636';
const seen = new Set();
function checkPages(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { checkPages(file); continue; }
    if (!file.endsWith('.html')) continue;
    const name = relative(publicDir, file).replaceAll('\\', '/');
    const html = readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
      .filter(match => match[1].includes('googlesyndication.com'));
    assert.equal(scripts.length, allowed.has(name) ? 1 : 0, `AdSense scope: ${name}`);
    for (const script of scripts) {
      assert.equal(script[1], expectedSrc);
      assert.match(script[0], /\basync(?:\s|>)/);
      assert.match(script[0], /crossorigin="anonymous"/);
      assert.ok(script.index < html.indexOf('</head>'), `AdSense must be in head: ${name}`);
      seen.add(name);
    }
  }
}
checkPages(publicDir);
assert.deepEqual(seen, allowed);
assert.equal(readFileSync(resolve(publicDir, 'ads.txt'), 'utf8').trim(), 'google.com, pub-6581176496481636, DIRECT, f08c47fec0942fa0');
assert.match(readFileSync(resolve(publicDir, 'privacy/index.html'), 'utf8'), /광고 승인 전에도/);
assert.doesNotMatch(readFileSync(resolve(publicDir, 'privacy/index.html'), 'utf8'), /스크립트를 설치하지 않았습니다/);

const common = readFileSync(resolve(publicDir, 'assets/js/common.js'), 'utf8');
function loadFooter(hasAdSense) {
  const handlers = {};
  const button = { hidden: true, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const footer = { innerHTML: '', querySelector: () => button };
  const window = {};
  const document = {
    createElement: () => ({}),
    head: { appendChild() {} },
    querySelector: selector => selector === '[data-footer]' ? footer : selector.startsWith('script[') && hasAdSense ? {} : null,
  };
  vm.runInNewContext(common, { window, document, location: { pathname: '/body/' } });
  assert.match(footer.innerHTML, /href="\/privacy\/"/);
  return { window, button, handlers };
}

const noAds = loadFooter(false);
assert.equal(noAds.window.googlefc, undefined, 'Excluded pages must not initialize Google CMP');
assert.equal(noAds.button.hidden, true);
const blocked = loadFooter(true);
assert.equal(blocked.button.hidden, true, 'Blocked/unloaded Google must leave a hidden button');
blocked.window.googlefc.callbackQueue[0].CONSENT_API_READY();
assert.equal(blocked.button.hidden, true, 'Missing consent APIs must keep the button hidden');

const ready = loadFooter(true);
let revocations = 0;
let consentListener;
ready.window.googlefc.showRevocationMessage = () => { revocations += 1; };
ready.window.__tcfapi = (command, version, listener) => {
  assert.equal(command, 'addEventListener');
  assert.equal(version, 0);
  consentListener = listener;
};
ready.window.googlefc.callbackQueue[0].CONSENT_API_READY();
consentListener({ gdprApplies: false }, true);
assert.equal(ready.button.hidden, true);
consentListener({ gdprApplies: true }, false);
assert.equal(ready.button.hidden, true);
consentListener({ gdprApplies: true }, true);
assert.equal(ready.button.hidden, false);
ready.handlers.click();
assert.equal(revocations, 0, 'Revocation must go through the Google callback queue');
ready.window.googlefc.callbackQueue.at(-1).CONSENT_API_READY();
assert.equal(revocations, 1);
delete ready.window.googlefc.showRevocationMessage;
ready.handlers.click();
assert.equal(ready.button.hidden, true, 'Unavailable revocation must fail closed');
console.log('AdSense page scope, publisher ID, privacy disclosure and conditional CMP footer checks passed.');
