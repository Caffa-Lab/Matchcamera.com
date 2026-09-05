const XMP_NS = 'http://ns.adobe.com/xap/1.0/';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const X_NS = 'adobe:ns:meta/';

export async function updateXmpSidecar({ rawRecord, existingXmpRecord, ratingMode, rating, labelMode, backup, timestamp }) {
  let sourceText = '';
  let xmpHandle;
  let created = false;

  if (existingXmpRecord) {
    const file = await existingXmpRecord.fileHandle.getFile();
    sourceText = await file.text();
    xmpHandle = existingXmpRecord.fileHandle;
    if (backup) await createBackup(existingXmpRecord.dirHandle, existingXmpRecord.name, sourceText, timestamp);
  } else {
    const stem = rawRecord.name.replace(/\.[^.]+$/, '');
    xmpHandle = await rawRecord.dirHandle.getFileHandle(`${stem}.xmp`, { create: true });
    sourceText = createMinimalXmp();
    created = true;
  }

  const { text, previousLabel } = updateXmpText(sourceText, { ratingMode, rating, labelMode });
  const writable = await xmpHandle.createWritable();
  await writable.write(text);
  await writable.close();
  return { created, fileName: xmpHandle.name, previousLabel, appliedLabel: labelMode };
}

export function updateXmpText(source, { ratingMode, rating, labelMode }) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(source || createMinimalXmp(), 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error('기존 XMP XML을 해석하지 못했습니다. 원본은 수정하지 않았습니다.');

  const xmpMeta = documentNode.getElementsByTagNameNS(X_NS, 'xmpmeta')[0] || documentNode.documentElement;
  let rdf = documentNode.getElementsByTagNameNS(RDF_NS, 'RDF')[0];
  if (!rdf) {
    rdf = documentNode.createElementNS(RDF_NS, 'rdf:RDF');
    xmpMeta.appendChild(rdf);
  }
  let description = documentNode.getElementsByTagNameNS(RDF_NS, 'Description')[0];
  if (!description) {
    description = documentNode.createElementNS(RDF_NS, 'rdf:Description');
    description.setAttributeNS(RDF_NS, 'rdf:about', '');
    rdf.appendChild(description);
  }

  const previousLabel = description.getAttributeNS(XMP_NS, 'Label') || '';
  if (ratingMode !== 'unchanged') description.setAttributeNS(XMP_NS, 'xmp:Rating', String(rating));
  if (labelMode === 'clear') description.removeAttributeNS(XMP_NS, 'Label');
  else if (labelMode !== 'unchanged') description.setAttributeNS(XMP_NS, 'xmp:Label', labelMode);

  const serialized = new XMLSerializer().serializeToString(documentNode);
  const text = serialized.startsWith('<?xpacket') ? serialized : `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${serialized}\n<?xpacket end="w"?>`;
  return { text, previousLabel };
}

function createMinimalXmp() {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Matchcamera RAW Rating Web">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

async function createBackup(directoryHandle, originalName, sourceText, timestamp) {
  const backupHandle = await directoryHandle.getFileHandle(`${originalName}.bak-${timestamp}`, { create: true });
  const writable = await backupHandle.createWritable();
  await writable.write(sourceText);
  await writable.close();
}
