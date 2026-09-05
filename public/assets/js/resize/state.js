const SETTINGS_KEY = 'caffa-photo-resize-settings-v1';

export const defaultSettings = {
  cropEnabled: false,
  borderEnabled: false,
  borderColor: 'white',
  borderSize: 5,
  cropRatio: 'none',
  gridEnabled: false,
  watermarkEnabled: false,
  watermarkPosition: 'center',
  watermarkSize: 18,
  watermarkMargin: 3,
  watermarkAll: true,
  saveMode: 'quality',
  targetSizeMb: 19,
  removeMetadata: true,
  equipmentEnabled: false,
  equipmentImages: true,
  equipmentSettings: true,
  equipmentTheme: 'light',
  metadataOptions: ['gps','datetime','camera','lens','serial','copyright','iptc','xmp','exif','keywords','rating','label','lightroom','photoshop','thumbnail']
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...defaultSettings, ...saved, metadataOptions: Array.isArray(saved.metadataOptions) ? saved.metadataOptions : defaultSettings.metadataOptions };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function createPhotoState(file) {
  return {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    rotation: 0,
    cropShift: 0,
    watermarkX: 0.5,
    watermarkY: 0.5,
    exif: {},
    bodyRaw: '',
    lensRaw: '',
    body: null,
    lens: null
  };
}

export function disposePhotoState(photo) {
  if (photo?.url) URL.revokeObjectURL(photo.url);
}
