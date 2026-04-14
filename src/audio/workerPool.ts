import FftWorker from './fft.worker?worker';
import type { WorkerMessage } from './fft.worker';

export interface FftJob {
  /** Transferred to a worker. Length must equal `windowSize`. */
  chunk: Float32Array;
}

export interface FftPoolOptions {
  windowSize: number;
  /** Optional override; otherwise computed per the §2 sizing rule. */
  workerCount?: number;
  /** Called after each chunk completes (0..total). */
  onProgress?: (done: number, total: number) => void;
}

interface InternalJob {
  index: number;
  chunk: Float32Array;
  resolve(result: Float32Array): void;
  reject(err: unknown): void;
}

interface WorkerSlot {
  worker: Worker;
  ready: Promise<void>;
  busy: boolean;
}

export class FftWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: InternalJob[] = [];
  private readonly windowSize: number;

  constructor(opts: FftPoolOptions) {
    this.windowSize = opts.windowSize;
    const cores = navigator.hardwareConcurrency ?? 4;
    const workerCount = opts.workerCount ?? Math.min(8, Math.max(1, cores - 1));

    for (let i = 0; i < workerCount; i++) {
      const w = new FftWorker();
      const ready = new Promise<void>((resolve) => {
        const onReady = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === 'ready') {
            w.removeEventListener('message', onReady);
            resolve();
          }
        };
        w.addEventListener('message', onReady);
      });
      w.postMessage({ type: 'init', windowSize: this.windowSize });
      this.slots.push({ worker: w, ready, busy: false });
    }
  }

  /**
   * Compute magnitudes for every chunk in `chunks`. Returns one Float32Array per
   * input chunk in input order. Each input chunk's underlying buffer is transferred
   * to a worker; do not reuse them after calling.
   */
  async run(
    chunks: Float32Array[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Float32Array[]> {
    await Promise.all(this.slots.map((s) => s.ready));
    const results = new Array<Float32Array>(chunks.length);
    let done = 0;
    return new Promise((resolveAll, rejectAll) => {
      const enqueue = (index: number) => {
        const chunk = chunks[index]!;
        const job: InternalJob = {
          index,
          chunk,
          resolve: (result) => {
            results[index] = result;
            done++;
            onProgress?.(done, chunks.length);
            if (done === chunks.length) resolveAll(results);
            else dispatch();
          },
          reject: rejectAll,
        };
        this.queue.push(job);
      };

      const dispatch = () => {
        for (const slot of this.slots) {
          if (slot.busy) continue;
          const job = this.queue.shift();
          if (!job) return;
          slot.busy = true;
          const onMsg = (e: MessageEvent<WorkerMessage>) => {
            const msg = e.data;
            if (msg.type !== 'done' || msg.jobId !== job.index) return;
            slot.worker.removeEventListener('message', onMsg);
            slot.busy = false;
            job.resolve(msg.result);
          };
          slot.worker.addEventListener('message', onMsg);
          slot.worker.postMessage(
            { type: 'run', jobId: job.index, chunk: job.chunk },
            [job.chunk.buffer],
          );
        }
      };

      for (let i = 0; i < chunks.length; i++) enqueue(i);
      dispatch();
    });
  }

  dispose() {
    for (const s of this.slots) s.worker.terminate();
    this.slots.length = 0;
  }
}
