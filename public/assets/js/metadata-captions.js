// Caption text is shared by the visible previews and their copy buttons.
const BRAND_TAGS = {
  sony: ['sony', 'sonyalpha', 'sonykorea'],
  canon: ['canon', '캐논'],
  nikon: ['nikon', '니콘'],
  fujifilm: ['fujifilm', '후지필름'],
  hasselblad: ['hasselblad', '핫셀블라드'],
  leica: ['leica', 'leicacamera'],
  lumix: ['lumix', 'panasonic'],
  omsystem: ['omsystem', '오엠시스템'],
  olympus: ['olympus', '올림푸스'],
  ricohgr: ['ricohgr', 'grsnaps'],
  ricoh: ['ricoh', '리코'],
  pentax: ['pentax', '펜탁스'],
};
const BRAND_NAMES = {
  sony: 'Sony', canon: 'Canon', nikon: 'Nikon', fujifilm: 'FUJIFILM',
  hasselblad: 'Hasselblad', leica: 'Leica', lumix: 'Panasonic',
  omsystem: 'OM SYSTEM', olympus: 'Olympus', ricohgr: 'RICOH',
  ricoh: 'RICOH', pentax: 'PENTAX',
};

function text(value) {
  if (typeof value !== 'string') return '';
  const result = value.replace(/\0/g, '').trim();
  return /^(?:unknown|unidentified|undefined|null|none|n\/?a|not available|not specified|—|-|0)$/i.test(result) ? '' : result;
}

function number(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('numerator' in value && 'denominator' in value) {
      const numerator = number(value.numerator), denominator = number(value.denominator);
      return denominator ? numerator / denominator : NaN;
    }
    return NaN;
  }
  if (typeof value === 'string') {
    if (!value.trim()) return NaN;
    const ratio = value.match(/^\s*([+-]?[\d.]+)\s*\/\s*([+-]?[\d.]+)\s*$/);
    if (ratio) return Number(ratio[2]) ? Number(ratio[1]) / Number(ratio[2]) : NaN;
  }
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  const result = Number(value);
  return Number.isFinite(result) ? result : NaN;
}

const positive = value => {
  const result = number(value);
  return result > 0 && Number.isFinite(result) ? result : NaN;
};
const rounded = (value, digits = 1) => String(Number(value.toFixed(digits)));
const tag = value => text(value).normalize('NFKC').toLowerCase()
  .replace(/[αɑ]/g, 'a').replace(/[^\p{L}\p{N}_]/gu, '');

function styled(value, italic = false) {
  return [...value.toLowerCase()].map(char => {
    if (/[a-z]/.test(char)) return String.fromCodePoint((italic ? 0x1d656 : 0x1d5ee) + char.charCodeAt(0) - 97);
    if (/[0-9]/.test(char)) return String.fromCodePoint(0x1d7ec + Number(char));
    return char;
  }).join('');
}

function cameraBrand(make, model) {
  // Pentax bodies may identify their manufacturer as RICOH IMAGING.
  if (/\bpentax\b/i.test(`${make} ${model}`)) return 'pentax';
  if (/\bricoh\b/i.test(`${make} ${model}`)) {
    return /^(?:ricoh\s+)?gr(?:\s*(?:digital\b|(?:iii|ii|iv|vi|v|i)x?(?=\s|$)|\d+\b)|\s*$)/i.test(model) ? 'ricohgr' : 'ricoh';
  }
  const value = `${make} ${model}`;
  if (/\bsony\b|\bilce-/i.test(value)) return 'sony';
  if (/\bcanon\b/i.test(value)) return 'canon';
  if (/\bnikon\b/i.test(value)) return 'nikon';
  if (/\bfujifilm\b|\bfuji photo film\b/i.test(value)) return 'fujifilm';
  if (/\bhasselblad\b/i.test(value)) return 'hasselblad';
  if (/\bleica\b/i.test(value)) return 'leica';
  if (/\bpanasonic\b|\blumix\b/i.test(value)) return 'lumix';
  if (/\bom\s*(?:system|digital solutions)\b/i.test(value)) return 'omsystem';
  if (/\bolympus\b/i.test(value)) return 'olympus';
  return '';
}

function cameraName(make, model, brand) {
  if (!model) return BRAND_NAMES[brand] || make;
  const maker = BRAND_NAMES[brand] || make;
  if (!maker) return model;
  if (tag(model).startsWith(tag(maker))) return model;
  if (brand === 'lumix' && /^lumix\b/i.test(model)) return model;
  return `${maker} ${model}`;
}

function bodyTag(model, brand) {
  if (!model) return '';
  let value = model.replace(/^(?:sony|canon|nikon(?: corporation)?|fujifilm|hasselblad|leica|panasonic|lumix|om system|olympus|ricoh|pentax)\s+/i, '').trim();
  if (brand === 'sony') {
    const aliases = {
      ilce7m4: 'a7m4', a7m4: 'a7m4', a7iv: 'a7m4',
      ilce7rm5: 'a7r5', a7rv: 'a7r5', a7r5: 'a7r5',
      ilce1: 'a1', a1: 'a1', ilce9m3: 'a9iii', a9iii: 'a9iii',
    };
    return aliases[tag(value)] || tag(model);
  }
  if (brand === 'canon') {
    const numerals = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    value = value.replace(/mark\s*(VIII|VII|VI|IV|IX|III|II|I|V|X|\d+)\b/gi, (_, numeral) => `m${numerals[numeral.toUpperCase()] || numeral}`);
    return tag(value);
  }
  const prefix = { nikon: 'nikon', fujifilm: 'fujifilm', hasselblad: 'hasselblad', leica: 'leica', lumix: 'lumix', omsystem: 'omsystem', olympus: 'olympus', ricohgr: 'ricoh', ricoh: 'ricoh', pentax: 'pentax' }[brand];
  const result = tag(value);
  return prefix && !result.startsWith(prefix) ? `${prefix}${result}` : result;
}

function lensModel(exif) {
  // LensMake is a manufacturer, and Lens may be a numeric, unresolved EXIF ID.
  return [exif.LensModel, exif.Lens].map(text)
    .find(value => /\d/.test(value) && !/^\d+$/.test(value) && !/^unknown\b/i.test(value)) || '';
}

function lensTag(model, make, brand) {
  if (!model) return '';
  let value = model;
  const knownMaker = /\b(sigma|tamron|viltrox|samyang|rokinon|tokina|laowa|ttartisan|7artisans|zeiss|voigtlander|voigtländer|meike|sirui)\b/i;
  const thirdParty = make.match(knownMaker)?.[1] || model.match(knownMaker)?.[1];
  if (brand === 'sony' && !thirdParty && (!make || /^sony\b/i.test(make))) {
    const code = model.match(/\bSEL[A-Z0-9]+\b/i)?.[0];
    if (code) return tag(code);
    const range = model.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*MM/i);
    const prime = model.match(/(\d{2,3})\s*MM/i);
    // Keep the existing Sony caption shorthand and its familiar SEL tags.
    const gm = /\bGM\b/i.test(model) ? 'gm' : '';
    const mark = /\bII\b|(?:^|\s)2(?=\s|$)/i.test(model) ? '2' : '';
    if (range) return `sel${range[1]}${range[2]}${gm}${mark}`;
    if (prime) return `sel${prime[1]}${gm}${mark}`;
  }
  if (thirdParty && !tag(value).startsWith(tag(thirdParty))) value = `${thirdParty} ${value}`;
  // Keep the familiar short caption for this unambiguous Canon kit lens.
  if (!thirdParty && /^(?:canon\s+)?rf-s\s*18\s*-\s*45\s*mm\s*f\s*\/?\s*4\.5\s*-\s*6\.3\s+is\s+stm$/i.test(value)) return 'rf1845';
  // Keep other brands' focal length, aperture, manufacturer and generation.
  if (!thirdParty && make && !/^(?:sony|canon|nikon|fujifilm|olympus|om system|panasonic|leica|hasselblad|pentax|ricoh)\b/i.test(make) && !tag(value).startsWith(tag(make))) value = `${make} ${value}`;
  return tag(value.replace(/(\d)(?:\.0)?\s*mm(?=\b|f[\d/])/gi, '$1').replace(/(\d+)\.0(?=\s*[-–])/g, '$1'));
}

function phoneInfo(make, model) {
  const value = `${make} ${model}`;
  if (/\biphone\b/i.test(model)) return { maker: 'apple', body: tag(model.replace(/^apple\s+/i, '')) };
  if (/\bpixel\b/i.test(model)) return { maker: 'google', body: tag(model.replace(/^google\s+/i, '')) };
  if (/\bgalaxy\b/i.test(model) || (/\bsamsung\b/i.test(make) && /^(?:SM-|GT-)/i.test(model))) {
    const codes = { 'sm-f700': 'galaxyzflip', 'sm-f707': 'galaxyzflip5g', 'sm-f711': 'galaxyzflip3', 'sm-f721': 'galaxyzflip4', 'sm-f731': 'galaxyzflip5', 'sm-f741': 'galaxyzflip6', 'sm-f916': 'galaxyzfold2', 'sm-f926': 'galaxyzfold3', 'sm-f936': 'galaxyzfold4', 'sm-f946': 'galaxyzfold5', 'sm-f956': 'galaxyzfold6', 'sm-s911': 'galaxys23', 'sm-s916': 'galaxys23plus', 'sm-s918': 'galaxys23ultra', 'sm-s921': 'galaxys24', 'sm-s926': 'galaxys24plus', 'sm-s928': 'galaxys24ultra' };
    const code = model.toLowerCase().match(/^sm-[a-z]\d{3}/)?.[0];
    return { maker: 'samsung', body: codes[code] || tag(model.replace(/^samsung\s+/i, '')) };
  }
  if (/\b(xperia|huawei|xiaomi|redmi|oneplus|oppo|vivo|honor)\b/i.test(value)) return { maker: tag(make), body: tag(model) };
  return null;
}

function photoDate(value) {
  let parts;
  if (value instanceof Date && Number.isFinite(value.getTime())) parts = [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  else {
    const match = text(value).match(/^(\d{4})[:.-](\d{1,2})[:.-](\d{1,2})(?:\D|$)/);
    if (match) parts = match.slice(1).map(Number);
  }
  if (!parts) return '';
  const [year, month, day] = parts;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || month !== check.getUTCMonth() + 1 || day !== check.getUTCDate()) return '';
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function shutterText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 1) return `${rounded(seconds, 3)}s`;
  const denominator = Math.round(1 / seconds);
  if (Math.abs(1 / denominator - seconds) / seconds < 0.03) return `1/${denominator}s`;
  return `${rounded(seconds, 4)}s`;
}

export function buildMetadataCaptions(exif = {}) {
  if (!exif || typeof exif !== 'object') exif = {};
  const make = text(exif.Make), model = text(exif.Model), lens = lensModel(exif);
  const brand = cameraBrand(make, model), phone = phoneInfo(make, model);
  const camera = cameraName(make, model, brand);
  let fNumber = positive(exif.FNumber), shutter = positive(exif.ExposureTime);
  const apexAperture = number(exif.ApertureValue), apexShutter = number(exif.ShutterSpeedValue);
  if (!Number.isFinite(fNumber) && Number.isFinite(apexAperture)) fNumber = positive(2 ** (apexAperture / 2));
  if (!Number.isFinite(shutter) && Number.isFinite(apexShutter)) shutter = positive(2 ** -apexShutter);
  const iso = positive(exif.ISO ?? exif.ISOSpeedRatings ?? exif.PhotographicSensitivity);
  const focal = positive(exif.FocalLength);
  const takenAt = [exif.DateTimeOriginal, exif.CreateDate, exif.DateTime, exif.ModifyDate].map(photoDate).find(Boolean) || '';
  const hasMetadata = Boolean(camera || lens || [fNumber, shutter, iso, focal].some(Number.isFinite) || takenAt);
  if (!hasMetadata) return { instagram: '', blog: '', hasMetadata: false };

  const body = phone ? phone.body : bodyTag(model, brand);
  const shortLens = phone ? '' : lensTag(lens, text(exif.LensMake), brand);
  const baseTags = phone ? [phone.maker] : (BRAND_TAGS[brand] || []);
  const equipmentTags = [body, shortLens];
  const seen = new Set();
  const groups = [baseTags, equipmentTags].map(items => items.filter(value => {
    if (!value || seen.has(value) || seen.size >= 5) return false;
    seen.add(value);
    return true;
  }).map(value => `#${value}`).join(' ')).filter(Boolean);
  const equipment = [body ? styled(body) : '', shortLens ? styled(shortLens, true) : ''].filter(Boolean).join(' + ');
  const instagram = [equipment ? `📷${equipment}` : '', groups.join('\n')].filter(Boolean).join('\n\n');
  const title = [camera, !phone ? lens : ''].filter(Boolean).join(' + ');
  const settings = `F ${Number.isFinite(fNumber) ? rounded(fNumber) : '—'} | SS ${shutterText(shutter)} | ISO ${Number.isFinite(iso) ? rounded(iso) : '—'} | ${Number.isFinite(focal) ? `${rounded(focal)}mm` : '—'} (${takenAt || '—'})`;
  return { instagram, blog: [title, settings].filter(Boolean).join('\n'), hasMetadata };
}
