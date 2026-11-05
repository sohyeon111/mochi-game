// 한 라운드의 규칙 (SPEC 7.2): 20초, 과일 10개 성공, 쓰레기 3번째 즉시 실패, 시간 종료 시 미달 실패.
// DOM·렌더링에 의존하지 않는 순수 로직.
import { FRUIT_IDS, GAME, type FruitId } from '../app/constants';
import type { CollectedRecord, FailReason, RoundResult } from './types';

export type RoundStatus = 'running' | 'success' | 'fail';

export interface RoundState {
  status: RoundStatus;
  failReason: FailReason | null;
  /** 실제 경과 시간(ms): 프레임 수가 아니라 프레임 사이의 시간 간격의 합 */
  elapsedMs: number;
  fruitCount: number;
  trashCount: number;
  collected: CollectedRecord[];
  /** 이미 알린 카운트다운 숫자 */
  countdownSent: number[];
}

export function createRound(): RoundState {
  return { status: 'running', failReason: null, elapsedMs: 0, fruitCount: 0, trashCount: 0, collected: [], countdownSent: [] };
}

export const isFinished = (s: RoundState): boolean => s.status !== 'running';

export const remainingMs = (s: RoundState): number => Math.max(0, GAME.DURATION_MS - s.elapsedMs);

/** 남은 시간(초, 올림) — 20초 시작 → 0 */
export const remainingSeconds = (s: RoundState): number => Math.ceil(remainingMs(s) / 1000);

export type RoundEvent =
  | { type: 'countdown'; n: number }
  | { type: 'success' }
  | { type: 'fail'; reason: FailReason };

/** 한 프레임에서 인정하는 시간 간격(ms). 큰 멈춤은 잘라낸다. */
export function clampDt(dtMs: number): number {
  return Math.min(GAME.MAX_FRAME_DT_MS, Math.max(0, dtMs));
}

/**
 * 시간을 진행한다. 종료 시각에 도달하면 그 시점의 과일 수로 성공/실패를 확정한다.
 * (성공 조건은 과일 10개 즉시 성공이므로 여기서는 보통 미달 실패가 된다.)
 */
export function tick(s: RoundState, dtMs: number): { state: RoundState; events: RoundEvent[] } {
  if (isFinished(s)) return { state: s, events: [] };
  const events: RoundEvent[] = [];
  const elapsed = Math.min(GAME.DURATION_MS, s.elapsedMs + clampDt(dtMs));
  const next: RoundState = { ...s, elapsedMs: elapsed, countdownSent: [...s.countdownSent] };
  // 5,4,3,2,1 — 남은 시간이 n초 이하가 되는 순간 한 번씩
  const remainingSec = Math.ceil((GAME.DURATION_MS - elapsed) / 1000);
  for (let n = GAME.COUNTDOWN_FROM; n >= 1; n--) {
    if (remainingSec <= n && elapsed < GAME.DURATION_MS && !next.countdownSent.includes(n)) {
      next.countdownSent.push(n);
      events.push({ type: 'countdown', n });
    }
  }
  if (elapsed >= GAME.DURATION_MS) {
    if (next.fruitCount >= GAME.TARGET_FRUITS) {
      next.status = 'success';
      events.push({ type: 'success' });
    } else {
      next.status = 'fail';
      next.failReason = 'timeout';
      events.push({ type: 'fail', reason: 'timeout' });
    }
  }
  return { state: next, events };
}

export interface HitToProcess {
  seq: number;
  kind: 'fruit' | 'trash';
  itemId: string;
}

/**
 * 입 중심에 가까운 순서로 정렬된 충돌을 하나씩 처리한다.
 * 성공(과일 10개) 또는 실패(쓰레기 3개째)에 도달하면 **즉시 중단**하고 남은 충돌은 처리하지 않는다.
 * 반환의 processed는 실제로 처리된 충돌 seq들이다.
 */
export function processHits(s: RoundState, hits: readonly HitToProcess[]): { state: RoundState; processed: number[]; events: RoundEvent[] } {
  if (isFinished(s)) return { state: s, processed: [], events: [] };
  const next: RoundState = { ...s, collected: [...s.collected] };
  const processed: number[] = [];
  const events: RoundEvent[] = [];
  for (const h of hits) {
    processed.push(h.seq);
    if (h.kind === 'fruit') {
      next.fruitCount += 1;
      next.collected.push({ itemId: h.itemId as FruitId, seq: h.seq, at: next.elapsedMs });
      if (next.fruitCount >= GAME.TARGET_FRUITS) {
        next.status = 'success';
        events.push({ type: 'success' });
        break;
      }
    } else {
      next.trashCount += 1;
      if (next.trashCount >= GAME.TRASH_FAIL_COUNT) {
        next.status = 'fail';
        next.failReason = 'trash';
        events.push({ type: 'fail', reason: 'trash' });
        break;
      }
    }
  }
  return { state: next, processed, events };
}

/** 라운드 결과 집계: 종류별 개수, 대표 과일(최다, 동수면 먼저 수집), 수집한 다른 과일 보존 */
export function summarize(s: RoundState): RoundResult {
  const fruitCounts = Object.fromEntries(FRUIT_IDS.map((f) => [f, 0])) as Record<FruitId, number>;
  const firstOrder: FruitId[] = [];
  for (const c of s.collected) {
    fruitCounts[c.itemId] += 1;
    if (!firstOrder.includes(c.itemId)) firstOrder.push(c.itemId);
  }
  let representative: FruitId | null = null;
  for (const f of firstOrder) {
    // firstOrder는 먼저 수집한 순서이므로, 동수이면 앞선 과일이 유지된다(엄격히 더 많을 때만 교체)
    if (representative === null || fruitCounts[f] > fruitCounts[representative]) representative = f;
  }
  return {
    success: s.status === 'success',
    failReason: s.failReason,
    elapsedMs: s.elapsedMs,
    fruitCount: s.fruitCount,
    trashCount: s.trashCount,
    fruitCounts,
    firstOrder,
    representative,
    collected: [...s.collected],
  };
}
