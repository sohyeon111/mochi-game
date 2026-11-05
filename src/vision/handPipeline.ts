// 카메라 영상 → HandLandmarker(Worker) → 손가락 접촉 판정. 얼굴 파이프라인(VisionPipeline)과 독립적이다.
// 분석이 진행 중이면 새 프레임을 보내지 않아 요청이 쌓이지 않고 항상 최신 프레임을 쓴다. 메인 스레드는 막히지 않는다.
import { prof } from '../app/profiler';
import type { HandContactEstimator } from './handContact';
import type { HandTracker } from './handTracker';
import type { RawHand } from './types';

export interface HandDebug {
  running: boolean;
  fps: number;
  ms: number;
  found: boolean;
  score: number;
  videoW: number;
  videoH: number;
  /** 마지막 21점(디버그 요청 시) */
  full: Float32Array | null;
  /** 오류 횟수(연속) */
  errors: number;
  // ---- 단계별 진단(개발 패널·콘솔 로그용). "추론이 실행되지 않음"과 "손이 감지되지 않음"을 구분한다 ----
  /** Worker로 프레임을 보낸 횟수 / 추론 결과를 받은 횟수(손이 없어도 증가) / 손이 감지된 결과 횟수 */
  sent: number;
  results: number;
  handsFound: number;
  /** 시간 초과로 버린 요청 수, 누적 오류 수, 마지막 오류 메시지 */
  timeouts: number;
  totalErrors: number;
  lastError: string;
  /** 마지막 전송·추론 결과 시각(performance.now, 0이면 없음) */
  lastSentAt: number;
  lastResultAt: number;
  /** 마지막 결과에서 받은 21점 수(디버그 요청 시) 와 손가락 끝 정규화 좌표 */
  lmCount: number;
  lastTips: number[];
  /** 영상 상태(마지막 틱 기준) */
  videoReady: number;
  videoPaused: boolean;
}

const hlog = (msg: string): void => {
  if (import.meta.env.DEV) console.info(`[hand] ${msg}`);
};

export class HandPipeline {
  readonly debug: HandDebug = {
    running: false, fps: 0, ms: 0, found: false, score: 0, videoW: 0, videoH: 0, full: null, errors: 0,
    sent: 0, results: 0, handsFound: 0, timeouts: 0, totalErrors: 0, lastError: '', lastSentAt: 0, lastResultAt: 0, lmCount: 0, lastTips: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], videoReady: 0, videoPaused: true,
  };
  /** 분석 요청이 이 시간(ms) 넘게 응답이 없으면 버리고 다시 보낸다(Worker·GPU가 멈춰도 파이프라인이 영원히 멈추지 않게) */
  static readonly REQUEST_TIMEOUT_MS = 2000;
  private sentAt = 0;
  private lastSummary = 0;
  private prevFound = false;
  /** 개발용: 21개 랜드마크 전체를 요청한다(켜면 Worker→메인 전송이 늘어난다) */
  wantFull = false;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private inflight = false;
  private generation = 0;
  private lastVideoTime = -1;
  private handle = 0;
  private useRvfc = false;
  private fpsStart = 0;
  private fpsCount = 0;

  constructor(private tracker: HandTracker, private estimator: HandContactEstimator) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(video: HTMLVideoElement): void {
    if (this.running || !this.tracker.isReady()) return;
    this.video = video;
    this.running = true;
    this.generation += 1;
    this.inflight = false;
    this.lastVideoTime = -1;
    this.fpsStart = performance.now();
    this.fpsCount = 0;
    this.debug.running = true;
    this.debug.errors = 0;
    this.debug.sent = this.debug.results = this.debug.handsFound = this.debug.timeouts = this.debug.totalErrors = 0;
    this.debug.lastError = '';
    this.prevFound = false;
    this.lastSummary = performance.now();
    this.estimator.reset();
    hlog(`파이프라인 시작: video ${video.videoWidth}x${video.videoHeight} readyState=${video.readyState} paused=${video.paused} 트랙=${(video.srcObject as MediaStream | null)?.getVideoTracks().map((t) => t.readyState).join(',') ?? '없음'}`);
    // 숨겨진 <video>에서는 requestVideoFrameCallback이 오지 않을 수 있어 항상 rAF로 새 프레임 여부를 확인한다(분석은 새 프레임일 때만)
    this.useRvfc = false;
    this.schedule();
  }

  stop(): void {
    if (!this.running && !this.debug.running) return;
    this.running = false;
    this.generation += 1;
    this.inflight = false;
    this.debug.running = false;
    hlog('파이프라인 정지');
    if (this.video && this.useRvfc && typeof this.video.cancelVideoFrameCallback === 'function') this.video.cancelVideoFrameCallback(this.handle);
    if (!this.useRvfc) cancelAnimationFrame(this.handle);
    this.video = null;
    this.estimator.reset();
  }

  private schedule(): void {
    if (!this.running || !this.video) return;
    if (this.useRvfc) this.handle = this.video.requestVideoFrameCallback(() => this.tick());
    else this.handle = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    const video = this.video;
    if (!this.running || !video) return;
    const now = performance.now();
    this.debug.videoReady = video.readyState;
    this.debug.videoPaused = video.paused;
    if (this.inflight && now - this.sentAt > HandPipeline.REQUEST_TIMEOUT_MS) {
      // 응답이 오지 않는다: 요청을 버리고 다음 프레임을 보낸다(늦게 온 응답은 세대가 달라 무시된다)
      this.debug.timeouts += 1;
      this.debug.lastError = `분석 응답 없음(${HandPipeline.REQUEST_TIMEOUT_MS}ms)`;
      hlog(`분석 시간 초과 ${this.debug.timeouts}회 — 요청을 버리고 재시도`);
      this.generation += 1;
      this.inflight = false;
    }
    if (!this.inflight && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.inflight = true;
      this.sentAt = now;
      this.debug.sent += 1;
      this.debug.lastSentAt = now;
      if (this.debug.sent === 1) hlog(`첫 프레임 전송: ${video.videoWidth}x${video.videoHeight}`);
      const gen = this.generation;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const t0 = performance.now();
      this.tracker
        .detectAsync(video, now, this.wantFull)
        .then((raw) => {
          if (gen !== this.generation || !this.running) return;
          this.debug.errors = 0;
          this.onResult(raw, vw, vh, t0);
        })
        .catch((e: unknown) => {
          this.debug.errors += 1;
          this.debug.totalErrors += 1;
          this.debug.lastError = e instanceof Error ? e.message : String(e);
          if (this.debug.errors === 1) {
            console.warn('HandLandmarker 분석 오류', e);
            hlog(`분석 오류: ${this.debug.lastError}`);
          }
          // 오류가 이어져도 접촉은 서서히 풀리고(손 없음 처리) 마우스·터치는 그대로 동작한다
          if (gen === this.generation) this.estimator.update(null, performance.now(), { w: vw, h: vh });
        })
        .finally(() => {
          if (gen === this.generation) this.inflight = false;
        });
    }
    if (now - this.fpsStart >= 1000) {
      this.debug.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsStart));
      this.fpsCount = 0;
      this.fpsStart = now;
    }
    if (import.meta.env.DEV && now - this.lastSummary >= 2000) {
      this.lastSummary = now;
      const d = this.debug;
      hlog(`요약: 전송 ${d.sent} / 추론결과 ${d.results} / 손 감지 ${d.handsFound} / 시간초과 ${d.timeouts} / 오류 ${d.totalErrors} | video ${d.videoW}x${d.videoH} rs=${d.videoReady} paused=${d.videoPaused} | 마지막 추론 ${d.lastResultAt ? Math.round(now - d.lastResultAt) + 'ms 전' : '없음'} | 신뢰도 ${d.score.toFixed(2)} ${d.found ? '손 있음' : '손 없음'}${d.sent > 0 && d.results === 0 ? ' ⚠ 추론 결과가 한 번도 오지 않음(Worker/모델 문제)' : ''}`);
    }
    this.schedule();
  }

  private onResult(raw: RawHand, vw: number, vh: number, t0: number): void {
    this.debug.ms = this.tracker.lastMs;
    this.debug.found = raw.found;
    this.debug.score = raw.score;
    this.debug.videoW = vw;
    this.debug.videoH = vh;
    this.debug.full = raw.full ?? null;
    this.debug.results += 1;
    this.debug.lastResultAt = performance.now();
    if (raw.found) this.debug.handsFound += 1;
    this.debug.lmCount = raw.full ? raw.full.length / 3 : raw.found ? 5 : 0;
    for (let i = 0; i < 10; i++) this.debug.lastTips[i] = raw.found ? (raw.tips[i] as number) : 0;
    if (this.debug.results === 1) hlog(`첫 추론 결과 수신: found=${raw.found} score=${raw.score.toFixed(2)} (${(performance.now() - t0).toFixed(0)}ms)`);
    if (raw.found !== this.prevFound) {
      this.prevFound = raw.found;
      hlog(raw.found ? `손 감지됨 (신뢰도 ${raw.score.toFixed(2)}, 검지 끝 ${raw.tips[2]?.toFixed(2)},${raw.tips[3]?.toFixed(2)})` : '손 사라짐');
    }
    prof.add('handRoundtrip', performance.now() - t0);
    const tU = prof.t();
    this.estimator.update(raw.found ? raw : null, performance.now(), { w: vw, h: vh });
    prof.end('handUpdate', tU);
    this.fpsCount += 1;
  }

  /** 테스트 전용: 영상 분석 없이 "실행 중" 상태만 만든다(이후 injectForTest로 합성 손 입력을 넣는다). 실제 웹캠 손 검증이 아니다 */
  startSynthetic(): void {
    this.running = true;
    this.debug.running = true;
    this.generation += 1;
    this.estimator.reset();
  }

  /** 개발·테스트용: 분석 없이 원시 결과를 직접 주입한다(합성 입력) */
  injectForTest(raw: RawHand | null, vw = 1280, vh = 720): void {
    this.estimator.update(raw, performance.now(), { w: vw, h: vh });
  }
}
