import {trackUsage} from './usage-events.js?v=20260915-phase1';
import {CONTACT_TYPES, readCorrectionContext, correctionContextText, contactDraft} from './product-feedback.js?v=20260915-phase1';

const boundForms = new WeakSet();

export function bindContactForm({document = globalThis.document, navigator = globalThis.navigator, location = globalThis.location, track = trackUsage} = {}) {
  const form = document?.querySelector('#contactForm');
  if (!form || boundForms.has(form)) return false;
  boundForms.add(form);
  const get = id => document.querySelector(`#${id}`);
  const fields = Object.fromEntries(['name', 'email', 'type', 'subject', 'message'].map(key => [key, get(`contact${key[0].toUpperCase()}${key.slice(1)}`)]));
  const status = get('contactStatus');
  const copyPanel = get('contactCopyPanel');
  const copyText = get('contactCopyText');
  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  const context = readCorrectionContext(location?.search || '');
  if (context) {
    fields.type.value = 'correction';
    fields.subject.value = `${context.product} 정보 수정`.slice(0, 160);
    fields.message.placeholder = '수정이 필요한 항목과 현재 표시 내용을 적어 주세요. 확인한 내용이나 출처가 있으면 함께 알려주세요.';
    get('contactProductText').textContent = correctionContextText(context);
    get('contactProductContext').hidden = false;
    void track('report_open', 'contact');
  } else {
    const type = new URLSearchParams((location?.search || '').slice(0, 4096)).get('type');
    if (Object.hasOwn(CONTACT_TYPES, type)) fields.type.value = type;
  }

  const draft = () => {
    const result = contactDraft(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])), context);
    if (!result.ok) {
      setStatus(result.error, true);
      fields[result.field]?.focus();
      return null;
    }
    return result;
  };

  form.addEventListener('input', () => {
    copyPanel.hidden = true;
    copyText.value = '';
    setStatus('');
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const result = draft();
    if (!result) return;
    setStatus('메일 앱에서 수신 주소와 내용을 확인한 뒤 실제로 보내 주세요. 앱이 열리지 않으면 문의 내용을 복사해 사용 중인 이메일에 붙여넣을 수 있습니다. 아직 접수된 상태는 아닙니다.');
    try { location.href = result.mailto; }
    catch { setStatus('메일 앱을 열지 못했습니다. 문의 내용을 복사해 admin@matchcamera.com으로 직접 보내 주세요. 아직 접수된 상태는 아닙니다.'); }
  });
  get('contactCopy').addEventListener('click', async () => {
    const result = draft();
    if (!result) return;
    copyText.value = result.copyText;
    copyPanel.hidden = false;
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(result.copyText);
      setStatus('문의 내용을 복사했습니다. 사용 중인 이메일에 붙여넣고 admin@matchcamera.com으로 보내 주세요. 복사만으로 문의가 접수되지는 않습니다.');
    } catch {
      copyText.focus();
      copyText.select();
      copyText.setSelectionRange(0, copyText.value.length);
      setStatus('자동 복사를 사용할 수 없습니다. 아래 선택된 내용을 직접 복사해 이메일로 보내 주세요. 아직 접수된 상태는 아닙니다.');
    }
  });
  return true;
}

if (typeof document !== 'undefined') bindContactForm();
