// jawOpen → 입 열림/닫힘. DOM·카메라에 의존하지 않는 순수 로직 (SPEC 5장).
import { CALIBRATION, MOUTH } from '../app/constants';
import type { Calibration } from './types';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 보정값으로 jawOpen을 0~1로 정규화한다. */
export function normalizeOpenness(raw: number, cal: Calibration): number {
  const range = cal.openMax - cal.closedBase;
  if (range <= 1e-6) return 0;
  return clamp01((raw - cal.closedBase) / range);
}

export const DEFAULT_CALIBRATION: Calibration = {
  closedBase: CALIBRATION.DEFAULT_CLOSED,
  openMax: CALIBRATION.DEFAULT_OPEN,
};

export interface DetectorOutput {
  /** 평활화 후 정규화된 열림 정도 */
  openness: number;
  /** 평활화된 원시 jawOpen */
  smoothedRaw: number;
  isOpen: boolean;
}

export class MouthDetector {
  private cal: Calibration;
  private smoothed: number | null = null;
  private lastT: number | null = null;
  private open = false;
  private lastChangeT = -Infinity;

  constructor(cal: Calibration = DEFAULT_CALIBRATION) {
    this.cal = cal;
  }

  setCalibration(cal: Calibration): void {
    this.cal = cal;
  }

  get calibration(): Calibration {
    return this.cal;
  }

  reset(): void {
    this.smoothed = null;
    this.lastT = null;
    this.open = false;
    this.lastChangeT = -Infinity;
  }

  /** 프레임마다 호출. tMs는 단조 증가하는 시간(ms). */
  update(rawJawOpen: number, tMs: number): DetectorOutput {
    // 시간 기반 지수이동평균: 프레임 속도가 달라도 같은 반응 속도
    if (this.smoothed === null || this.lastT === null) {
      this.smoothed = rawJawOpen;
    } else {
      const dt = Math.max(0, tMs - this.lastT);
      const alpha = 1 - Math.exp(-dt / MOUTH.EMA_TAU_MS);
      this.smoothed += (rawJawOpen - this.smoothed) * alpha;
    }
    this.lastT = tMs;

    const openness = normalizeOpenness(this.smoothed, this.cal);
    // 히스테리시스 + 최소 유지 시간
    if (tMs - this.lastChangeT >= MOUTH.MIN_HOLD_MS) {
      if (!this.open && openness > MOUTH.OPEN_ON) {
        this.open = true;
        this.lastChangeT = tMs;
      } else if (this.open && openness < MOUTH.OPEN_OFF) {
        this.open = false;
        this.lastChangeT = tMs;
      }
    }
    return { openness, smoothedRaw: this.smoothed, isOpen: this.open };
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[idx] as number;
}

export type CalibrationResult =
  | { ok: true; cal: Calibration }
  | { ok: false; reason: 'samples' | 'range'; cal: Calibration };

/** 보정 구간의 표본으로 보정값을 계산한다. 다문 구간은 중앙값, 벌린 구간은 상위 90% 값. */
export function computeCalibration(closedSamples: number[], openSamples: number[]): CalibrationResult {
  if (closedSamples.length < CALIBRATION.MIN_SAMPLES || openSamples.length < CALIBRATION.MIN_SAMPLES) {
    return { ok: false, reason: 'samples', cal: DEFAULT_CALIBRATION };
  }
  const closedBase = median(closedSamples);
  const openMax = percentile(openSamples, 0.9);
  const cal = { closedBase, openMax };
  if (openMax - closedBase < CALIBRATION.MIN_RANGE) return { ok: false, reason: 'range', cal };
  return { ok: true, cal };
}
