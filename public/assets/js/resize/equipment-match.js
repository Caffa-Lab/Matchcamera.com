export function equipmentText(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\0/g, '').trim();
  return /^(?:unknown(?: lens)?|unidentified|undefined|null|none|n\/?a|not (?:available|specified|known)|(?:lens|camera) not (?:attached|available|specified)|no (?:lens|camera)(?: attached)?|(?:렌즈|카메라)?\s*정보\s*없음|알\s*수\s*없음|[-—?]+|0)$/i.test(text) ? '' : text;
}

export function productName(product) {
  return product?.officialName || product?.model || product?.modelCode || '';
}

const normalize = value => equipmentText(value).normalize('NFKC').toLowerCase()
  .replaceAll('α', 'a').replace(/[^a-z0-9가-힣]+/g, '');

// Catalog search aliases include series such as "E" and "RF". They help search,
// but they cannot identify the equipment used to take a photograph.
export function findProduct(raw, list, body = null) {
  if (/^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*mm(?:\s*f\/?\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)?$/i.test(equipmentText(raw))) return null;
  const target = normalize(raw);
  if (!/[a-z가-힣]/.test(target) || target.length < 2) return null;
  const matches = list.filter(product => {
    const generic = new Set([
      product.manufacturer, product.series, product.mount, product.lensFormat,
      product.sensorFormat, product.type,
    ].map(normalize).filter(Boolean));
    const identities = [productName(product), product.model, product.modelCode];
    const aliases = (product.exifAliases || []).filter(alias => !generic.has(normalize(alias)));
    return [...identities, ...aliases].some(alias => normalize(alias) === target);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && body?.mount && body.cameraSystem !== '일체형 카메라') {
    const sameMount = matches.filter(product => product.mount === body.mount);
    if (sameMount.length === 1) return sameMount[0];
  }
  return null;
}
