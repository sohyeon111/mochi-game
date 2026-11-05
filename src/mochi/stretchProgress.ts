// 늘리기 완료 판정 (SPEC 7.4): stretchRatio ≥ 0.30 을 한 번이라도 달성하면 완료로 래치한다. 순수 로직.
import { MOCHI } from '../app/constants';

/** 링 점 사이의 최대 거리(장축 길이) */
export function majorAxis(xs: readonly number[], ys: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const d = Math.hypot((xs[i] as number) - (xs[j] as number), (ys[i] as number) - (ys[j] as number));
      if (d > best) best = d;
    }
  }
  return best;
}

/** 단위 벡터 (ux,uy) 방향으로의 길이(링 점을 그 방향에 투영한 최댓값 − 최솟값) */
export function extentAlong(xs: readonly number[], ys: readonly number[], ux: number, uy: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const p = (xs[i] as number) * ux + (ys[i] as number) * uy;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return hi - lo;
}

/** 안전 최대 늘림 길이: 그 방향 기본 길이 × MAX_EXTENT_FACTOR */
export const maxExtentLength = (restExtent: number): number => restExtent * MOCHI.MAX_EXTENT_FACTOR;

/** (현재 길이 − 기본 길이) / (안전 최대 − 기본 길이). 줄어들면 0 */
export function stretchRatio(current: number, rest: number, max: number = maxExtentLength(rest)): number {
  const range = max - rest;
  if (range <= 1e-9) return 0;
  return Math.max(0, (current - rest) / range);
}

export const isValidStretch = (ratio: number): boolean => ratio >= MOCHI.STRETCH_COMPLETE_RATIO;

/** 한 번이라도 유효한 늘리기를 했는지 기억한다(놓아도 유지, 새 라운드에서 reset) */
export class StretchTracker {
  private _done = false;
  private _peak = 0;

  get done(): boolean {
    return this._done;
  }
  get peak(): number {
    return this._peak;
  }

  /** 새로 달성해 완료가 되는 순간에만 true를 돌려준다 */
  update(ratio: number): boolean {
    if (ratio > this._peak) this._peak = ratio;
    if (!this._done && isValidStretch(ratio)) {
      this._done = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this._done = false;
    this._peak = 0;
  }
}
