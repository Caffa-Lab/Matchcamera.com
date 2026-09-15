export const CONTACT_TYPES = Object.freeze({
  correction: '제품 정보 수정', compatibility: '호환성 문의', error: '사이트 오류',
  partnership: '제휴/광고', other: '기타',
});
export const CONTACT_LIMITS = Object.freeze({name: 80, email: 254, subject: 160, message: 4000, product: 160, productId: 160});
const PRODUCT_PAGES = new Set(['/', '/body/', '/lens/', '/database/', '/compare/', '/builder/', '/accessories/']);
const singleLine = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const productIdValid = value => singleLine(value, CONTACT_LIMITS.productId) && /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value);

export function productPagePath(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  const path = value.split(/[?#]/, 1)[0];
  return PRODUCT_PAGES.has(path) ? path : '';
}

export function correctionUrl(product, pathname = '/') {
  const params = new URLSearchParams({type: 'correction'});
  const name = product?.officialName || product?.model || product?.modelCode || '';
  const id = product?.id || '';
  if (singleLine(name, CONTACT_LIMITS.product) && productIdValid(id)) {
    params.set('product', name.trim());
    params.set('productId', id);
    const page = productPagePath(pathname);
    if (page) params.set('page', page);
  }
  return `/contact/?${params}`;
}

export function readCorrectionContext(search = '') {
  if (typeof search !== 'string' || search.length > 4096) return null;
  const params = new URLSearchParams(search);
  if (params.get('type') !== 'correction') return null;
  const product = params.get('product') || '';
  const productId = params.get('productId') || '';
  const rawPage = params.get('page') || '';
  const page = productPagePath(rawPage);
  if (!singleLine(product, CONTACT_LIMITS.product) || !productIdValid(productId) || (rawPage && !page)) return null;
  return {product: product.trim(), productId, page};
}

export function correctionContextText(context) {
  if (!context) return '';
  return [`제품: ${context.product}`, `제품 ID: ${context.productId}`, context.page ? `확인한 화면: https://matchcamera.com${context.page}` : ''].filter(Boolean).join('\n');
}

export function contactDraft(fields, context = null) {
  const clean = {};
  for (const key of ['name', 'email', 'subject', 'message']) {
    if (typeof fields?.[key] !== 'string') return {ok: false, field: key, error: '입력 내용을 확인해 주세요.'};
    if (fields[key].length > CONTACT_LIMITS[key]) return {ok: false, field: key, error: `${CONTACT_LIMITS[key]}자 이내로 입력해 주세요.`};
    clean[key] = fields[key].trim();
  }
  if (!Object.hasOwn(CONTACT_TYPES, fields.type)) return {ok: false, field: 'type', error: '문의 유형을 선택해 주세요.'};
  if (!singleLine(clean.subject, CONTACT_LIMITS.subject)) return {ok: false, field: 'subject', error: '제목을 한 줄로 입력해 주세요.'};
  if (!clean.message || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean.message)) return {ok: false, field: 'message', error: '문의 내용을 입력해 주세요.'};
  if (clean.name && !singleLine(clean.name, CONTACT_LIMITS.name)) return {ok: false, field: 'name', error: '이름은 한 줄로 입력해 주세요.'};
  if (clean.email && (!singleLine(clean.email, CONTACT_LIMITS.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))) return {ok: false, field: 'email', error: '회신 이메일 주소를 확인해 주세요.'};
  const subject = `[Matchcamera 문의] ${clean.subject}`;
  const details = [`문의 유형: ${CONTACT_TYPES[fields.type]}`, clean.name ? `이름: ${clean.name}` : '', clean.email ? `회신 이메일: ${clean.email}` : '', correctionContextText(context)].filter(Boolean);
  const body = `${details.join('\n')}\n\n${clean.message}`;
  return {
    ok: true, subject, body,
    mailto: `mailto:admin@matchcamera.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    copyText: `받는 사람: admin@matchcamera.com\n제목: ${subject}\n\n${body}`,
  };
}
