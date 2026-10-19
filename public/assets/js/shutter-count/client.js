export class ShutterReader {
  constructor(workerFactory = () => new Worker(new URL('./worker.js?v=20261020-shutter', import.meta.url), { type: 'module' })) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
  }
  read(file, onProgress = () => {}) {
    if (this.pending) return Promise.reject(new Error('이전 사진 분석이 끝난 뒤 다시 시도해 주세요.'));
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) this.worker = this.workerFactory();
        const worker = this.worker;
        const id = ++this.sequence;
        const finish = (error, result) => {
          if (this.pending?.id !== id) return;
          clearTimeout(this.pending.timer);
          this.pending = null;
          error ? reject(error) : resolve(result);
        };
        this.pending = { id, finish, timer: setTimeout(() => this.cancel('분석 시간이 초과되었습니다. 파일 크기를 확인하거나 다른 원본 사진으로 다시 시도해 주세요.'), 120_000) };
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker || this.pending?.id !== id || data.id !== id) return;
          if (data.type === 'progress') onProgress(data.message);
          else if (data.type === 'result') finish(null, data.result);
          else if (data.type === 'error') { finish(new Error(data.message)); this.disposeWorker(); }
        };
        worker.onerror = event => {
          event.preventDefault?.();
          if (this.worker === worker && this.pending?.id === id) this.cancel('분석 도구를 실행하지 못했습니다. 최신 브라우저에서 새로고침 후 다시 시도해 주세요.');
        };
        worker.postMessage({ id, file });
      } catch (error) {
        if (this.pending) this.pending.finish(error);
        else reject(error);
        this.disposeWorker();
      }
    });
  }
  disposeWorker() { this.worker?.terminate(); this.worker = null; }
  cancel(message = '분석을 취소했습니다.') {
    this.pending?.finish(new Error(message));
    this.disposeWorker();
  }
}
