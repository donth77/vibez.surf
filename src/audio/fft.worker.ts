import { fftMagnitudes, makeFftPlan, type FftPlan } from './fft';

interface InitMessage {
  type: 'init';
  windowSize: number;
}
interface RunMessage {
  type: 'run';
  jobId: number;
  /** Transferred. Length must equal `windowSize`. */
  chunk: Float32Array;
}
type IncomingMessage = InitMessage | RunMessage;

interface InitDoneMessage {
  type: 'ready';
}
interface RunDoneMessage {
  type: 'done';
  jobId: number;
  /** Transferred back. */
  result: Float32Array;
  /** Returned so the pool can reuse the buffer for the next job. */
  chunk: Float32Array;
}
export type WorkerMessage = InitDoneMessage | RunDoneMessage;

let plan: FftPlan | null = null;
let scratchRe: Float32Array | null = null;
let scratchIm: Float32Array | null = null;

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    plan = makeFftPlan(msg.windowSize);
    scratchRe = new Float32Array(msg.windowSize);
    scratchIm = new Float32Array(msg.windowSize);
    const reply: InitDoneMessage = { type: 'ready' };
    (self as unknown as Worker).postMessage(reply);
    return;
  }
  if (msg.type === 'run') {
    if (!plan || !scratchRe || !scratchIm) throw new Error('worker not initialised');
    const result = new Float32Array(plan.windowSize);
    fftMagnitudes(plan, msg.chunk, result, scratchRe, scratchIm);
    const reply: RunDoneMessage = {
      type: 'done',
      jobId: msg.jobId,
      result,
      chunk: msg.chunk,
    };
    (self as unknown as Worker).postMessage(reply, [result.buffer, msg.chunk.buffer]);
    return;
  }
};
