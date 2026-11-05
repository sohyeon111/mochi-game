// MediaPipe HandLandmarker 래퍼(Web Worker 전용). 얼굴 분석(FaceTracker)과 독립적이다: 서로의 Worker·초기화·실패에 영향을 주지 않는다.
// 메인 스레드 대체 경로는 두지 않는다(분석이 메인 스레드를 막기 때문). Worker를 못 쓰면 손 입력만 꺼지고 마우스·터치는 그대로 동작한다.
import { assetUrl } from '../app/assetUrl';
import { HAND_LM, VISION_ASSETS } from '../app/constants';
import { workerFrameSize } from './faceTracker';
import type { RawHand } from './types';

const hlog = (msg: string): void => {
  if (import.meta.env.DEV) console.info(`[hand] ${msg}`);
};

export type HandTrackerStatus = 'idle' | 'loading' | 'ready' | 'error';

const EMPTY_HAND: RawHand = { found: false, score: 0, tips: new Float32Array(10), flex: new Float32Array(5), palm: { x: 0.5, y: 0.5 }, scale: 0 };

/** Worker 결과(data 18개 + 선택적 21점)를 RawHand로 바꾼다. 필요한 값만 담은 가벼운 객체 */
export function rawHandFromWorker(found: boolean, score: number, data: Float32Array | null | undefined, lm?: Float32Array | null): RawHand {
  if (!found || !data || data.length < 18) return EMPTY_HAND;
  return {
    found: true,
    score,
    tips: data.subarray(0, 10),
    flex: data.subarray(10, 15),
    palm: { x: data[15] as number, y: data[16] as number },
    scale: data[17] as number,
    full: lm ?? null,
  };
}

interface Pending {
  resolve: (r: RawHand) => void;
  reject: (e: Error) => void;
}

export class HandTracker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private _status: HandTrackerStatus = 'idle';
  private _error = '';
  /** 마지막 Worker 분석 시간(ms)과 초기화 소요(ms) */
  lastMs = 0;
  initMs = 0;
  /** 추론에 쓰는 delegate(GPU/CPU). 개발 서버에서만 ?handdelegate=cpu 로 CPU를 강제할 수 있다 */
  delegate: 'GPU' | 'CPU' | '' = '';

  get status(): HandTrackerStatus {
    return this._status;
  }
  get error(): string {
    return this._error;
  }
  isReady(): boolean {
    return this._status === 'ready' && this.worker !== null;
  }
  /** 이 환경에서 손 분석을 시도할 수 있는지(Worker·ImageBitmap) */
  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
  }

  async init(): Promise<void> {
    if (this.isReady()) return;
    if (!HandTracker.supported()) {
      this._status = 'error';
      this._error = '이 브라우저는 손 인식을 지원하지 않아요';
      throw new Error(this._error);
    }
    this._status = 'loading';
    this._error = '';
    const t0 = performance.now();
    hlog(`초기화 시작: worker=${assetUrl(VISION_ASSETS.HAND_WORKER)} model=${assetUrl(VISION_ASSETS.HAND_MODEL)} wasm=${assetUrl(VISION_ASSETS.WASM_DIR)}`);
    try {
      await this.initWorker();
      this._status = 'ready';
      this.initMs = performance.now() - t0;
      hlog(`초기화 성공 (${this.initMs.toFixed(0)}ms)`);
    } catch (e) {
      this.dispose();
      this._status = 'error';
      this._error = e instanceof Error ? e.message : String(e);
      hlog(`초기화 실패 (${(performance.now() - t0).toFixed(0)}ms): ${this._error}`);
      throw e;
    }
  }

  private initWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const w = new Worker(assetUrl(VISION_ASSETS.HAND_WORKER));
      this.worker = w;
      hlog('Worker 생성됨, init 메시지 전송');
      const timer = window.setTimeout(() => reject(new Error('손 인식 Worker 초기화 시간 초과')), VISION_ASSETS.WORKER_INIT_TIMEOUT_MS);
      w.onerror = (ev) => {
        window.clearTimeout(timer);
        reject(new Error(`손 인식 Worker 오류: ${ev.message || '알 수 없음'}`));
      };
      w.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { type: string; message?: string; delegate?: 'GPU' | 'CPU' };
        if (m.type === 'ready') {
          window.clearTimeout(timer);
          this.delegate = m.delegate ?? '';
          hlog(`Worker 준비됨 (delegate ${this.delegate})`);
          w.onmessage = (e2: MessageEvent) => this.onMessage(e2.data);
          w.onerror = (e2) => this.failPending(new Error(`손 인식 Worker 오류: ${e2.message || '알 수 없음'}`));
          resolve();
        } else if (m.type === 'initError') {
          window.clearTimeout(timer);
          reject(new Error(m.message ?? '손 인식 초기화 실패'));
        }
      };
      w.postMessage({
        type: 'init',
        wasmBase: new URL(assetUrl(VISION_ASSETS.WASM_DIR), location.href).href,
        modelUrl: new URL(assetUrl(VISION_ASSETS.HAND_MODEL), location.href).href,
        joints: HAND_LM.JOINTS,
        tips: HAND_LM.TIPS,
        palm: HAND_LM.PALM,
        delegate: import.meta.env.DEV && new URLSearchParams(location.search).get('handdelegate') === 'cpu' ? 'CPU' : 'auto',
      });
    });
  }

  private onMessage(m: { type: string; id: number; delegate?: 'GPU' | 'CPU'; found?: boolean; score?: number; data?: Float32Array; lm?: Float32Array | null; ms?: number; message?: string }): void {
    if (m.type === 'delegate') {
      this.delegate = m.delegate ?? this.delegate;
      hlog(`GPU 추론 오류로 delegate를 ${this.delegate}로 전환`);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === 'result') {
      this.lastMs = m.ms ?? 0;
      p.resolve(rawHandFromWorker(!!m.found, m.score ?? 0, m.data, m.lm));
    } else {
      p.reject(new Error(m.message ?? '손 분석 오류'));
    }
  }

  private failPending(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private dispose(): void {
    this.failPending(new Error('Worker 종료'));
    this.worker?.terminate();
    this.worker = null;
  }

  /** 한 프레임 분석(줄인 비트맵을 Worker로 넘긴다). 메인 스레드는 막히지 않는다. full이면 21점 전체도 받는다(디버그 전용) */
  async detectAsync(video: HTMLVideoElement, nowMs: number, full = false): Promise<RawHand> {
    const w = this.worker;
    if (!w) return EMPTY_HAND;
    const size = workerFrameSize(video.videoWidth, video.videoHeight, VISION_ASSETS.WORKER_FRAME_MAX_W);
    const bitmap = await createImageBitmap(video, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'low' });
    return new Promise<RawHand>((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: 'frame', id, bitmap, ts: nowMs, full }, [bitmap]);
    });
  }

  close(): void {
    if (this.worker) this.worker.postMessage({ type: 'close' });
    this.dispose();
    this._status = 'idle';
  }
}
