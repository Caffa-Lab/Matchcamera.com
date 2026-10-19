import { EXIF_ARGS, fileProblem, interpretMetadata } from './result.js?v=20261020-shutter';

let parser;
self.onmessage = async ({ data }) => {
  const { id, file } = data;
  try {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    if (!parser) {
      self.postMessage({ id, type: 'progress', message: '분석 도구를 준비하고 원본을 확인하고 있습니다. 처음에는 약 25MB의 도구를 내려받아 시간이 걸릴 수 있습니다.' });
      parser = await import('../../vendor/exiftool/exiftool.js');
    } else self.postMessage({ id, type: 'progress', message: '원본 사진의 셔터 카운터를 확인하고 있습니다…' });
    // A stable internal name avoids exposing user filenames to parser arguments.
    const extension = file.name.split('.').at(-1).toLowerCase();
    const input = new File([file], `photo.${extension}`, { type: file.type });
    const output = await parser.parseMetadata(input, { args: EXIF_ARGS, transform: JSON.parse });
    if (!output.success) throw new Error('이 파일을 분석하지 못했습니다. 다른 원본 JPG 또는 RAW 파일로 확인해 주세요.');
    const result = interpretMetadata(output.data);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || '사진을 확인하지 못했습니다.' });
  }
};
