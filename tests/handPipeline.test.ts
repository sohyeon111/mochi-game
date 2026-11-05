// 손 추적 파이프라인의 진단 카운터와 안전장치: "추론이 실행되지 않음"과 "손이 감지되지 않음"을 구분하고, 응답이 없어도 멈추지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandContactEstimator } from '../src/vision/handContact';
import { HandPipeline } from '../src/vision/handPipeline';
import type { HandTracker } from '../src/vision/handTracker';
import type { RawHand } from '../src/vision/types';

const NO_HAND: RawHand = { found: false, score: 0, tips: new Float32Array(10), flex: new Float32Array(5), palm: { x: 0.5, y: 0.5 }, scale: 0 };
const HAND: RawHand = { found: true, score: 0.9, tips: Float32Array.from([0.5, 0.5, 0.5, 0.3, 0.45, 0.3, 0.4, 0.3, 0.35, 0.3]), flex: new Float32Array(5), palm: { x: 0.5, y: 0.6 }, scale: 0.15 };

let rafCb: (() => void) | null = null;
let now = 0;

function makeVideo(): HTMLVideoElement {
  return { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0, paused: false, srcObject: null } as unknown as HTMLVideoElement;
}

function makeTracker(detect: (v: HTMLVideoElement, t: number, full: boolean) => Promise<RawHand>): HandTracker {
  return { isReady: () => true, detectAsync: detect, lastMs: 7 } as unknown as HandTracker;
}

/** rAF 한 틱: 영상 프레임을 새로 만들고(currentTime 증가) 콜백을 실행한다 */
function tick(video: HTMLVideoElement, dtMs = 16): void {
  now += dtMs;
  (video as { currentTime: number }).currentTime += 0.033;
  const cb = rafCb;
  rafCb = null;
  cb?.();
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  now = 1000;
  rafCb = null;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCb = null;
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HandPipeline 진단: 추론 미실행 vs 손 미감지', () => {
  it('손이 없어도 추론 결과는 계속 온다: results는 늘고 handsFound는 0(= 추론은 실행 중, 손이 안 보임)', async () => {
    const est = new HandContactEstimator();
    const video = makeVideo();
    const p = new HandPipeline(makeTracker(async () => NO_HAND), est);
    p.start(video);
    for (let i = 0; i < 5; i++) {
      tick(video);
      await flush();
    }
    expect(p.debug.sent).toBe(5);
    expect(p.debug.results).toBe(5);
    expect(p.debug.handsFound).toBe(0);
    expect(p.debug.found).toBe(false);
    expect(p.debug.lastResultAt).toBeGreaterThan(0);
    expect(est.tracking).toBe(false);
  });

  it('손이 감지되면 handsFound·신뢰도·손가락 끝 좌표·추적 상태가 갱신된다', async () => {
    const est = new HandContactEstimator();
    const video = makeVideo();
    const p = new HandPipeline(makeTracker(async () => HAND), est);
    p.start(video);
    for (let i = 0; i < 3; i++) {
      tick(video);
      await flush();
    }
    expect(p.debug.handsFound).toBe(3);
    expect(p.debug.found).toBe(true);
    expect(p.debug.score).toBeCloseTo(0.9, 5);
    expect(p.debug.lastTips[2]).toBeCloseTo(0.5, 5);
    expect(p.debug.lastTips[3]).toBeCloseTo(0.3, 5);
    expect(est.tracking).toBe(true);
    expect(est.fingers[1]!.hasPos).toBe(true);
  });

  it('추론이 실행되지 않는 경우(응답 없음): sent는 늘지만 results는 0, 시간 초과 후 요청을 버리고 다시 보낸다', async () => {
    const est = new HandContactEstimator();
    const video = makeVideo();
    let calls = 0;
    const p = new HandPipeline(makeTracker(() => { calls++; return new Promise<RawHand>(() => undefined); }), est); // 영원히 응답 없음
    p.start(video);
    tick(video);
    await flush();
    expect(p.debug.sent).toBe(1);
    expect(p.debug.results).toBe(0);
    // 응답 대기 중에는 새 프레임을 보내지 않는다(요청이 쌓이지 않음)
    for (let i = 0; i < 10; i++) tick(video);
    expect(calls).toBe(1);
    // 시간 초과 → 버리고 재전송
    tick(video, HandPipeline.REQUEST_TIMEOUT_MS + 50);
    await flush();
    expect(p.debug.timeouts).toBe(1);
    expect(calls).toBe(2);
    expect(p.debug.sent).toBe(2);
    expect(p.debug.results).toBe(0);
    expect(p.debug.lastError).toContain('응답 없음');
  });

  it('분석이 오류로 끝나면 오류가 기록되고 접촉은 풀리며 다음 프레임에서 다시 시도한다', async () => {
    const est = new HandContactEstimator();
    const video = makeVideo();
    let n = 0;
    const p = new HandPipeline(makeTracker(async () => { n++; if (n <= 2) throw new Error('bitmap 실패'); return HAND; }), est);
    p.start(video);
    for (let i = 0; i < 4; i++) {
      tick(video);
      await flush();
    }
    expect(p.debug.totalErrors).toBe(2);
    expect(p.debug.lastError).toContain('bitmap 실패');
    expect(p.debug.errors).toBe(0); // 성공하면 연속 오류가 0으로
    expect(p.debug.handsFound).toBe(2);
  });

  it('정지한 뒤 늦게 도착한 결과는 무시한다(세대 구분)', async () => {
    const est = new HandContactEstimator();
    const video = makeVideo();
    let release: (r: RawHand) => void = () => undefined;
    const p = new HandPipeline(makeTracker(() => new Promise<RawHand>((res) => { release = res; })), est);
    p.start(video);
    tick(video);
    p.stop();
    release(HAND);
    await flush();
    expect(p.debug.results).toBe(0);
    expect(est.tracking).toBe(false);
  });

  it('영상이 준비되지 않았으면(readyState<2) 프레임을 보내지 않고 videoReady로 드러난다', async () => {
    const video = makeVideo();
    (video as { readyState: number }).readyState = 1;
    const p = new HandPipeline(makeTracker(async () => HAND), new HandContactEstimator());
    p.start(video);
    for (let i = 0; i < 5; i++) tick(video);
    expect(p.debug.sent).toBe(0);
    expect(p.debug.videoReady).toBe(1);
  });

  it('같은 영상 프레임(currentTime 변화 없음)은 다시 분석하지 않는다', async () => {
    const video = makeVideo();
    let calls = 0;
    const p = new HandPipeline(makeTracker(async () => { calls++; return HAND; }), new HandContactEstimator());
    p.start(video);
    tick(video);
    await flush();
    now += 16;
    const cb = rafCb;
    rafCb = null;
    cb?.(); // currentTime 그대로
    await flush();
    expect(calls).toBe(1);
  });

  it('wantFull이면 21점 전체를 요청한다', async () => {
    const video = makeVideo();
    const seen: boolean[] = [];
    const p = new HandPipeline(makeTracker(async (_v, _t, full) => { seen.push(full); return HAND; }), new HandContactEstimator());
    p.wantFull = true;
    p.start(video);
    tick(video);
    await flush();
    expect(seen).toEqual([true]);
  });
});
