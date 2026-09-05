export async function ensureReadWritePermission(directoryHandle) {
  const options = { mode: 'readwrite' };
  if ((await directoryHandle.queryPermission?.(options)) === 'granted') return true;
  if ((await directoryHandle.requestPermission?.(options)) === 'granted') return true;
  return false;
}

export async function buildFileIndex(rootHandle, { signal, onFolder, onFile } = {}) {
  const byName = new Map();
  const byPath = new Map();
  let folderCount = 0;
  let fileCount = 0;

  async function walk(directoryHandle, directoryPath = '') {
    if (signal?.aborted) throw new DOMException('작업이 중지되었습니다.', 'AbortError');
    folderCount += 1;
    onFolder?.({ directoryHandle, directoryPath, folderCount, fileCount });

    for await (const entry of directoryHandle.values()) {
      if (signal?.aborted) throw new DOMException('작업이 중지되었습니다.', 'AbortError');
      const path = directoryPath ? `${directoryPath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, path);
      } else {
        fileCount += 1;
        const record = {
          name: entry.name,
          lowerName: entry.name.toLowerCase(),
          path,
          lowerPath: path.toLowerCase(),
          dirPath: directoryPath,
          fileHandle: entry,
          dirHandle: directoryHandle
        };
        byPath.set(record.lowerPath, record);
        const list = byName.get(record.lowerName) || [];
        list.push(record);
        byName.set(record.lowerName, list);
        onFile?.({ ...record, folderCount, fileCount });
        if (fileCount % 100 === 0) await yieldToUi();
      }
    }
  }

  await walk(rootHandle);
  return { byName, byPath, folderCount, fileCount };
}

export function siblingPath(record, siblingName) {
  return (record.dirPath ? `${record.dirPath}/${siblingName}` : siblingName).toLowerCase();
}

export function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
