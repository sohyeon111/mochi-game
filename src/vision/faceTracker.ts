// MediaPipe FaceLandmarker 래퍼. wasm·모델은 public/mediapipe/ 에서 상대경로로 불러온다(CDN 의존 없음).
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { assetUrl } from '../app/assetUrl';
import { LIP, VISION_ASSETS } from '../app/constants';
import type { Point, RawFace } from './types';

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type Delegate = 'GPU' | 'CPU' | null;

export { assetUrl };

/** LOADING 단계에서 wasm과 모델을 미리 받아 브라우저 캐시에 올린다. 실패하면 예외. */
export async function prefetchVisionAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const files = [
    `${VISION_ASSETS.WASM_DIR}/vision_wasm_internal.js`,
    `${VISION_ASSETS.WASM_DIR}/vision_wasm_internal.wasm`,
    VISION_ASSETS.MODEL,
  ];
  let done = 0;
  onProgress?.(0, files.length);
  for (const f of files) {
    const res = await fetch(assetUrl(f), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`${f} 로드 실패 (${res.status})`);
    await res.arrayBuffer();
    done += 1;
    onProgress?.(done, files.length);
  }
}

/** Worker가 돌려주는 결과(입 판정에 필요한 4점 + jawOpen)를 RawFace로 바꾼다. 필요한 인덱스만 채운 희소 배열이라 478점 객체를 만들지 않는다 */
export function rawFaceFromWorker(found: boolean, jaw: number, pts: ArrayLike<number>): RawFace {
  if (!found) return { found: false, jawOpen: 0, landmarks: [] };
  const lm: Point[] = [];
  lm[LIP.UPPER_INNER] = { x: pts[0] as number, y: pts[1] as number };
  lm[LIP.LOWER_INNER] = { x: pts[2] as number, y: pts[3] as number };
  lm[LIP.CORNER_LEFT] = { x: pts[4] as number, y: pts[5] as number };
  lm[LIP.CORNER_RIGHT] = { x: pts[6] as number, y: pts[7] as number };
  return { found: true, jawOpen: jaw, landmarks: lm };
}

/** Worker로 보낼 프레임 크기: 가로 상한(maxW) 이하로 줄이고 비율은 유지한다 */
export function workerFrameSize(w: number, h: number, maxW: number): { w: number; h: number } {
  if (w <= maxW) return { w, h };
  return { w: maxW, h: Math.max(1, Math.round((h * maxW) / w)) };
}

interface Pending {
  resolve: (r: RawFace) => void;
  reject: (e: Error) => void;
}

export class FaceTracker {
  /** 개발·비교용: false면 Worker 없이 메인 스레드에서 분석한다(기존 방식). 개발 서버에서만 ?facew=0 으로 끌 수 있다 */
  preferWorker = !(import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('facew') === '0');
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  /** 마지막 Worker 분석 시간(ms) */
  lastWorkerMs = 0;
  private landmarker: FaceLandmarker | null = null;
  private _status: TrackerStatus = 'idle';
  private _delegate: Delegate = null;
  private _error = '';

  get status(): TrackerStatus {
    return this._status;
  }
  get delegate(): Delegate {
    return this._delegate;
  }
  get error(): string {
    return this._error;
  }
  isReady(): boolean {
    return this._status === 'ready' && (this.landmarker !== null || this.worker !== null);
  }
  /** Worker에서 분석하는지(true면 detectAsync, false면 detect를 쓴다) */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  /** 초기화. GPU가 안 되면 CPU로 한 번 더 시도한다. 이미 준비됐으면 아무것도 하지 않는다. */
  async init(): Promise<void> {
    if (this.isReady()) return;
    this._status = 'loading';
    this._error = '';
    // 분석은 영상 프레임마다 메인 스레드를 8~17ms 막아 게임 프레임을 끊으므로 Worker에서 돌린다. 불가능하면 기존 방식으로 대체한다.
    if (this.preferWorker && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        await this.initWorker();
        this._status = 'ready';
        return;
      } catch (e) {
        console.warn('FaceLandmarker Worker 초기화 실패, 메인 스레드로 대체합니다.', e);
        this.disposeWorker();
      }
    }
    try {
      const fileset = await FilesetResolver.forVisionTasks(assetUrl(VISION_ASSETS.WASM_DIR));
      const make = (delegate: 'GPU' | 'CPU') =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assetUrl(VISION_ASSETS.MODEL), delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
      try {
        this.landmarker = await make('GPU');
        this._delegate = 'GPU';
      } catch (gpuErr) {
        console.warn('FaceLandmarker GPU 초기화 실패, CPU로 재시도합니다.', gpuErr);
        this.landmarker = await make('CPU');
        this._delegate = 'CPU';
      }
      this._status = 'ready';
    } catch (e) {
      this._status = 'error';
      this._error = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  private initWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const w = new Worker(assetUrl(VISION_ASSETS.WORKER));
      this.worker = w;
      const timer = window.setTimeout(() => reject(new Error('Worker 초기화 시간 초과')), VISION_ASSETS.WORKER_INIT_TIMEOUT_MS);
      w.onerror = (ev) => {
        window.clearTimeout(timer);
        reject(new Error(`Worker 오류: ${ev.message || '알 수 없음'}`));
      };
      w.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { type: string; delegate?: Delegate; message?: string };
        if (m.type === 'ready') {
          window.clearTimeout(timer);
          this._delegate = m.delegate ?? 'CPU';
          w.onmessage = (e2: MessageEvent) => this.onWorkerMessage(e2.data);
          w.onerror = (e2) => this.failPending(new Error(`Worker 오류: ${e2.message || '알 수 없음'}`));
          resolve();
        } else if (m.type === 'initError') {
          window.clearTimeout(timer);
          reject(new Error(m.message ?? 'Worker 초기화 실패'));
        }
      };
      w.postMessage({ type: 'init', wasmBase: new URL(assetUrl(VISION_ASSETS.WASM_DIR), location.href).href, modelUrl: new URL(assetUrl(VISION_ASSETS.MODEL), location.href).href });
    });
  }

  private onWorkerMessage(m: { type: string; id: number; found?: boolean; jaw?: number; pts?: Float32Array; ms?: number; message?: string }): void {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === 'result') {
      this.lastWorkerMs = m.ms ?? 0;
      p.resolve(rawFaceFromWorker(!!m.found, m.jaw ?? 0, m.pts ?? []));
    } else {
      p.reject(new Error(m.message ?? 'Worker 분석 오류'));
    }
  }

  private failPending(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private disposeWorker(): void {
    this.failPending(new Error('Worker 종료'));
    this.worker?.terminate();
    this.worker = null;
  }

  /** (Worker 모드) 한 프레임을 분석한다: 영상을 줄인 비트맵으로 만들어 Worker로 넘기고 결과를 기다린다. 메인 스레드는 막히지 않는다. */
  async detectAsync(video: HTMLVideoElement, nowMs: number): Promise<RawFace> {
    const w = this.worker;
    if (!w) return { found: false, jawOpen: 0, landmarks: [] };
    const size = workerFrameSize(video.videoWidth, video.videoHeight, VISION_ASSETS.WORKER_FRAME_MAX_W);
    const bitmap = await createImageBitmap(video, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'low' });
    return new Promise<RawFace>((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: 'frame', id, bitmap, ts: nowMs, lips: [LIP.UPPER_INNER, LIP.LOWER_INNER, LIP.CORNER_LEFT, LIP.CORNER_RIGHT] }, [bitmap]);
    });
  }

  /** 한 프레임 분석. 얼굴이 없으면 found: false */
  detect(video: HTMLVideoElement, nowMs: number): RawFace {
    if (!this.landmarker) return { found: false, jawOpen: 0, landmarks: [] };
    const r = this.landmarker.detectForVideo(video, nowMs);
    const lm = r.faceLandmarks?.[0];
    if (!lm || lm.length === 0) return { found: false, jawOpen: 0, landmarks: [] };
    const cats = r.faceBlendshapes?.[0]?.categories ?? [];
    const jaw = cats.find((c) => c.categoryName === 'jawOpen')?.score ?? 0;
    return { found: true, jawOpen: jaw, landmarks: lm.map((p) => ({ x: p.x, y: p.y })) };
  }

  /** 자원 해제 (SPEC: 카메라 해제 시 FaceLandmarker close()) */
  close(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'close' });
      this.disposeWorker();
    }
    this.landmarker?.close();
    this.landmarker = null;
    this._status = 'idle';
    this._delegate = null;
  }
}
