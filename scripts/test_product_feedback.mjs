import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CONTACT_LIMITS, correctionUrl, readCorrectionContext, productPagePath, contactDraft} from '../public/assets/js/product-feedback.js';
import {bindContactForm} from '../public/assets/js/contact.js';
import {openProductDetail} from '../public/assets/js/product-detail.js';

const products = JSON.parse(await fs.readFile(new URL('../public/data/product-index.json', import.meta.url), 'utf8'));
const product = products.find(p => p.officialName === 'Canon EOS R50');
assert(product);
const link = correctionUrl(product, '/body/?q=private-search#private-fragment');
const parsed = new URL(link, 'https://matchcamera.com');
assert.equal(parsed.pathname, '/contact/');
assert.equal(parsed.searchParams.get('product'), product.officialName);
assert.equal(parsed.searchParams.get('productId'), product.id);
assert.equal(parsed.searchParams.get('page'), '/body/');
assert.doesNotMatch(link, /private/);
const context = readCorrectionContext(parsed.search);
assert.deepEqual(context, {product: product.officialName, productId: product.id, page: '/body/'});
for (const p of products) {
  const url = new URL(correctionUrl(p, '/database/'), 'https://matchcamera.com');
  assert.equal(readCorrectionContext(url.search)?.productId, p.id, `catalog product ${p.id} should be reportable`);
}

for (const page of ['https://evil.example/body/', '//evil.example/', 'javascript:alert(1)', '/body/../admin/', '/admin/', '/body/%2e%2e/admin/', '\\evil.example\\body']) {
  assert.equal(productPagePath(page), '', page);
  const params = new URLSearchParams({type: 'correction', product: product.officialName, productId: product.id, page});
  assert.equal(readCorrectionContext(`?${params}`), null);
}
assert.equal(readCorrectionContext(''), null);
assert.equal(readCorrectionContext('?type=correction'), null);
assert.equal(readCorrectionContext('?type=error&product=Canon&productId=canon'), null);
for (const [key, value] of [['product', 'x'.repeat(CONTACT_LIMITS.product + 1)], ['product', 'Canon\nbcc:evil'], ['productId', '<script>'], ['productId', 'x'.repeat(CONTACT_LIMITS.productId + 1)]]) {
  const params = new URLSearchParams({type: 'correction', product: product.officialName, productId: product.id, page: '/body/'});
  params.set(key, value);
  assert.equal(readCorrectionContext(`?${params}`), null);
}
assert.equal(readCorrectionContext(`?${'x'.repeat(5000)}`), null);

const generalFields = {name: '', email: '', type: 'other', subject: '다운로드 문의', message: '결과 파일을 어디에서 찾나요?'};
const generalDraft = contactDraft(generalFields);
assert.equal(generalDraft.ok, true, 'name and reply email must be optional');
assert.doesNotMatch(generalDraft.body, /이름:|회신 이메일:|제품 ID:/);
const draft = contactDraft({...generalFields, type: 'correction', subject: '가격 확인', message: '현재 가격과 출처를 확인해 주세요.\nhttps://example.com/?x=1&bcc=ignored'}, context);
const mail = new URL(draft.mailto);
assert.equal(mail.protocol, 'mailto:');
assert.equal(mail.pathname, 'admin@matchcamera.com');
assert.deepEqual([...mail.searchParams.keys()], ['subject', 'body'], 'message input cannot inject mail headers');
assert.equal(mail.searchParams.get('body'), draft.body);
assert.match(draft.body, /제품: Canon EOS R50/);
assert.match(draft.body, /확인한 화면: https:\/\/matchcamera.com\/body\//);
for (const [key, value] of [['subject', '  '], ['message', '\n  '], ['subject', 'title\r\nbcc:evil'], ['type', 'constructor'], ['email', 'wrong-email'], ['name', 'person\nsecond'], ['message', '\u0000']]) {
  assert.equal(contactDraft({...generalFields, [key]: value}).ok, false, `${key} invalid input must be rejected`);
}
for (const key of ['name', 'email', 'subject', 'message']) {
  assert.equal(contactDraft({...generalFields, [key]: 'x'.repeat(CONTACT_LIMITS[key] + 1)}).ok, false);
}

class Element {
  value = ''; textContent = ''; hidden = true; placeholder = ''; listeners = new Map();
  classList = {toggle() {}};
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  set innerHTML(_) { throw new Error('Contact query data must not reach innerHTML'); }
}
function contactDOM(search = '', clipboard = null) {
  const ids = ['contactForm', 'contactName', 'contactEmail', 'contactType', 'contactSubject', 'contactMessage', 'contactStatus', 'contactCopyPanel', 'contactCopyText', 'contactProductText', 'contactProductContext', 'contactCopy'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const calls = [];
  const location = {search, href: ''};
  const document = {querySelector: selector => nodes[selector.slice(1)] || null};
  const options = {document, location, navigator: {clipboard}, track: (...args) => calls.push(args)};
  const setFields = values => Object.entries(values).forEach(([key, value]) => nodes[`contact${key[0].toUpperCase()}${key.slice(1)}`].value = value);
  return {nodes, calls, location, document, options, setFields};
}

const report = contactDOM(parsed.search);
assert.equal(bindContactForm(report.options), true);
assert.equal(bindContactForm(report.options), false, 'rebinding must not duplicate report_open');
assert.deepEqual(report.calls, [['report_open', 'contact']], 'metrics contain only two fixed labels');
assert.equal(report.nodes.contactType.value, 'correction');
assert.match(report.nodes.contactSubject.value, /Canon EOS R50/);
assert.equal(report.nodes.contactMessage.value, '', 'a prefilled context is not a completed report');
assert.equal(report.nodes.contactProductContext.hidden, false);
assert.match(report.nodes.contactProductText.textContent, /Canon EOS R50/);
report.nodes.contactForm.listeners.get('submit')({preventDefault() {}});
assert.equal(report.location.href, '', 'empty message cannot open a draft');
report.nodes.contactMessage.value = '출처의 가격과 표시 내용이 다릅니다.';
report.nodes.contactForm.listeners.get('submit')({preventDefault() {}});
assert.match(report.location.href, /^mailto:admin@matchcamera.com/);
assert.match(report.nodes.contactStatus.textContent, /아직 접수된 상태는 아닙니다/);
await report.nodes.contactCopy.listeners.get('click')();
assert.equal(report.nodes.contactCopyPanel.hidden, false);
assert.equal(report.nodes.contactCopyText.selected, true, 'blocked clipboard provides selectable text');
assert.deepEqual(report.nodes.contactCopyText.selection, [0, report.nodes.contactCopyText.value.length]);
assert.match(report.nodes.contactCopyText.value, /제품: Canon EOS R50/);
report.nodes.contactForm.listeners.get('input')();
assert.equal(report.nodes.contactCopyPanel.hidden, true, 'editing clears an old copy draft');
assert.equal(report.nodes.contactCopyText.value, '');

let copied = '';
const plain = contactDOM('', {writeText: async text => { copied = text; }});
bindContactForm(plain.options);
plain.setFields(generalFields);
await plain.nodes.contactCopy.listeners.get('click')();
assert.deepEqual(plain.calls, [], 'general contact must not be counted as a product report');
assert.equal(copied, generalDraft.copyText);
assert.match(plain.nodes.contactStatus.textContent, /복사만으로 문의가 접수되지는 않습니다/);
assert.equal(plain.location.href, '', 'copying never sends or opens email');

const maliciousName = '<img src=x onerror=alert(1)> "Camera"';
const maliciousLink = correctionUrl({id: 'test-camera', officialName: maliciousName}, '/lens/?token=secret');
const malicious = contactDOM(new URL(maliciousLink, 'https://matchcamera.com').search);
bindContactForm(malicious.options);
assert.match(malicious.nodes.contactProductText.textContent, /<img src=x onerror=alert\(1\)>/);
assert.equal(malicious.nodes.contactSubject.value, `${maliciousName} 정보 수정`);
assert.deepEqual(malicious.calls, [['report_open', 'contact']]);
const invalid = contactDOM('?type=correction&product=Canon&productId=canon&page=https%3A%2F%2Fevil.example');
bindContactForm(invalid.options);
assert.equal(invalid.nodes.contactProductContext.hidden, true);
assert.deepEqual(invalid.calls, []);

// Exercise the actual dialog renderer: the new link must retain product context
// while preserving existing current/launch price details and escaping labels.
const content = {innerHTML: ''};
const dialog = {open: false, querySelector: selector => selector === '.product-detail-content' ? content : null, showModal() { this.open = true; }};
const oldDocument = globalThis.document;
const oldLocation = globalThis.location;
globalThis.document = {querySelector: () => dialog};
globalThis.location = {pathname: '/body/', search: '?secret=1', hash: '#secret'};
try {
  openProductDetail({...product, koreaPriceDetails: {offers: [{kind: 'launch', amount: 999000, sourceUrl: 'https://example.com/launch'}]}});
  assert.match(content.innerHTML, /제품 정보 수정 제보/);
  assert.match(content.innerHTML, /한국 출시가/);
  assert.match(content.innerHTML, /999,000원/);
  const href = content.innerHTML.match(/href="([^"]+)">제품 정보 수정 제보/)[1].replaceAll('&amp;', '&');
  const dialogContext = readCorrectionContext(new URL(href, 'https://matchcamera.com').search);
  assert.equal(dialogContext.productId, product.id);
  assert.equal(dialogContext.page, '/body/');
  assert.doesNotMatch(href, /secret/);
} finally {
  if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
}

console.log('Product feedback passed: bounded product context, safe links and text, optional identity, validation, mail draft, clipboard fallback, fixed report metrics and retained price details.');
