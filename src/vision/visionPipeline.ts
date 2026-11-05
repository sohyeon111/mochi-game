// 카메라 영상 → FaceLandmarker → 입 판정 → MouthInput. 프레임 루프와 얼굴 미검출 감시를 담당한다.
import { layout } from '../app/layout';
import { prof } from '../app/profiler';
import { MOUTH } from '../app/constants';
import type { FaceTracker } from './faceTracker';
import type { InputHub } from './inputHub';
import { MouthDetector } from './mouthDetector';
import { mouthAreaFromLandmarks } from './mouthPosition';
import type { MouthInput, RawFace } from './types';

export interface PipelineDebug {
  running: boolean;
  fps: number;
  frames: number;
  face: boolean;
  rawJawOpen: number;
  smoothedJawOpen: number;
  openness: number;
  isOpen: boolean;
  center: { x: number; y: number };
  radiusX: number;
  radiusY: number;
  lastDetectMs: number;
  videoW: number;
  videoH: number;
}

export interface PipelineEvents {
  onFaceLost?: () => void;
  onFaceBack?: () => void;
  /** 원시 jawOpen 표본(보정용). 얼굴이 있을 때만 호출. */
  onRaw?: (jawOpen: number, tMs: number) => void;
}

export class VisionPipeline {
  readonly debug: PipelineDebug = {
    running: false, fps: 0, frames: 0, face: false, rawJawOpen: 0, smoothedJawOpen: 0, openness: 0, isOpen: false,
    center: { x: layout.w / 2, y: layout.h / 2 }, radiusX: 0, radiusY: 0, lastDetectMs: 0, videoW: 0, videoH: 0,
  };
  events: PipelineEvents = {};

  private video: HTMLVideoElement | null = null;
  private running = false;
  /** Worker 모드: 분석 요청이 진행 중인지와, 시작/정지마다 올라가는 세대(늦게 온 이전 결과를 버리기 위함) */
  private inflight = false;
  private generation = 0;
  private handle = 0;
  private useRvfc = false;
  private lastVideoTime = -1;
  private fpsWindowStart = 0;
  private fpsCount = 0;
  private lastSeenFace = 0;
  private faceBackSince: number | null = null;
  private faceLostSent = false;
  private lastCenter = { x: layout.w / 2, y: layout.h / 2 };
  private lastRadius = { x: 0, y: 0 };

  constructor(
    private tracker: FaceTracker,
    private detector: MouthDetector,
    private hub: InputHub,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** 얼굴 미검출 상태가 확정(FACE_LOST_MS 이상)되어 있는지. 화면 진입 시점에 이미 얼굴이 없는 경우를 판단한다. */
  get faceIsLost(): boolean {
    return this.faceLostSent;
  }

  start(video: HTMLVideoElement): void {
    if (this.running) return;
    this.video = video;
    this.running = true;
    this.generation += 1;
    this.inflight = false;
    this.debug.running = true;
    this.detector.reset();
    this.lastVideoTime = -1;
    this.fpsWindowStart = performance.now();
    this.fpsCount = 0;
    this.lastSeenFace = performance.now();
    this.faceBackSince = null;
    this.faceLostSent = false;
    this.useRvfc = typeof video.requestVideoFrameCallback === 'function';
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.inflight = false;
    this.debug.running = false;
    if (this.video) {
      if (this.useRvfc && typeof this.video.cancelVideoFrameCallback === 'function') this.video.cancelVideoFrameCallback(this.handle);
    }
    if (!this.useRvfc) cancelAnimationFrame(this.handle);
    this.video = null;
    this.debug.face = false;
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
    if (this.tracker.usesWorker) {
      // Worker 모드: 분석 중이 아닐 때만 새 프레임을 보낸다(밀리면 건너뛰어 항상 최신 프레임을 쓴다). 메인 스레드는 막히지 않는다.
      if (!this.inflight && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        this.inflight = true;
        const gen = this.generation;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const t0 = performance.now();
        this.tracker
          .detectAsync(video, now)
          .then((raw) => {
            if (gen !== this.generation || !this.running) return;
            this.debug.lastDetectMs = this.tracker.lastWorkerMs;
            prof.add('faceDetect', performance.now() - t0); // 요청→응답 지연(메인 스레드를 막은 시간이 아니다)
            this.debug.videoW = vw;
            this.debug.videoH = vh;
            const tH = prof.t();
            this.handleFrame(raw, performance.now(), vw, vh);
            prof.end('faceHandle', tH);
            this.fpsCount += 1;
          })
          .catch((e: unknown) => console.warn('FaceLandmarker 분석 오류', e))
          .finally(() => {
            if (gen === this.generation) this.inflight = false;
          });
      }
    } else if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const t0 = performance.now();
      let raw: RawFace = { found: false, jawOpen: 0, landmarks: [] };
      try {
        raw = this.tracker.detect(video, now);
      } catch (e) {
        console.warn('FaceLandmarker 분석 오류', e);
      }
      this.debug.lastDetectMs = performance.now() - t0;
      prof.add('faceDetect', this.debug.lastDetectMs);
      this.debug.videoW = video.videoWidth;
      this.debug.videoH = video.videoHeight;
      const tH = prof.t();
      this.handleFrame(raw, now, video.videoWidth, video.videoHeight);
      prof.end('faceHandle', tH);
      this.fpsCount += 1;
    }
    if (now - this.fpsWindowStart >= 1000) {
      this.debug.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsWindowStart));
      this.fpsCount = 0;
      this.fpsWindowStart = now;
    }
    this.checkFaceLost(now);
    this.schedule();
  }

  private handleFrame(raw: RawFace, now: number, vw: number, vh: number): void {
    this.debug.frames += 1;
    this.debug.face = raw.found;
    let input: MouthInput;
    if (raw.found) {
      this.lastSeenFace = now;
      const out = this.detector.update(raw.jawOpen, now);
      const area = mouthAreaFromLandmarks(raw.landmarks, { w: vw, h: vh }, out.openness, true);
      if (area) {
        this.lastCenter = area.center;
        this.lastRadius = { x: area.radiusX, y: area.radiusY };
      }
      this.debug.rawJawOpen = raw.jawOpen;
      this.debug.smoothedJawOpen = out.smoothedRaw;
      this.debug.openness = out.openness;
      this.debug.isOpen = out.isOpen;
      input = {
        isOpen: out.isOpen, openness: out.openness, center: this.lastCenter, radiusX: this.lastRadius.x, radiusY: this.lastRadius.y,
        faceDetected: true, timestamp: now, source: 'camera',
      };
      this.events.onRaw?.(raw.jawOpen, now);
      // 얼굴이 다시 안정적으로 보이는지
      if (this.faceLostSent) {
        this.faceBackSince ??= now;
        if (now - this.faceBackSince >= MOUTH.FACE_BACK_MS) {
          this.faceLostSent = false;
          this.faceBackSince = null;
          this.events.onFaceBack?.();
        }
      }
    } else {
      // 얼굴이 없으면 입은 닫힌 것으로 본다(획득 불가). 마지막 위치는 유지.
      this.detector.reset();
      this.faceBackSince = null;
      this.debug.openness = 0;
      this.debug.isOpen = false;
      input = {
        isOpen: false, openness: 0, center: this.lastCenter, radiusX: this.lastRadius.x, radiusY: this.lastRadius.y,
        faceDetected: false, timestamp: now, source: 'camera',
      };
    }
    this.debug.center = this.lastCenter;
    this.debug.radiusX = this.lastRadius.x;
    this.debug.radiusY = this.lastRadius.y;
    this.hub.publish(input);
  }

  private checkFaceLost(now: number): void {
    if (!this.faceLostSent && now - this.lastSeenFace >= MOUTH.FACE_LOST_MS) {
      this.faceLostSent = true;
      this.faceBackSince = null;
      this.events.onFaceLost?.();
    }
  }
}
