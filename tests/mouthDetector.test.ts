import { describe, expect, it } from 'vitest';
import { CALIBRATION, MOUTH } from '../src/app/constants';
import { MouthDetector, computeCalibration, median, normalizeOpenness, percentile } from '../src/vision/mouthDetector';

const cal = { closedBase: 0.1, openMax: 0.6 };

describe('normalizeOpenness', () => {
  it('보정 범위를 0~1로 정규화하고 범위를 벗어나면 자른다', () => {
    expect(normalizeOpenness(0.1, cal)).toBe(0);
    expect(normalizeOpenness(0.6, cal)).toBe(1);
    expect(normalizeOpenness(0.35, cal)).toBeCloseTo(0.5);
    expect(normalizeOpenness(0.0, cal)).toBe(0);
    expect(normalizeOpenness(0.9, cal)).toBe(1);
  });
  it('범위가 0이면 0을 돌려준다', () => {
    expect(normalizeOpenness(0.5, { closedBase: 0.3, openMax: 0.3 })).toBe(0);
  });
});

describe('MouthDetector', () => {
  const feed = (d: MouthDetector, values: number[], start = 0, step = 16): ReturnType<MouthDetector['update']> => {
    let out = d.update(values[0] as number, start);
    values.slice(1).forEach((v, i) => (out = d.update(v, start + (i + 1) * step)));
    return out;
  };

  it('크게 벌리면 열림, 다물면 닫힘', () => {
    const d = new MouthDetector(cal);
    expect(feed(d, Array(20).fill(0.6)).isOpen).toBe(true);
    expect(feed(d, Array(40).fill(0.1), 400).isOpen).toBe(false);
  });

  it('히스테리시스: 열림 경계(0.6)와 닫힘 경계(0.35) 사이에서는 상태가 유지된다', () => {
    const d = new MouthDetector(cal);
    feed(d, Array(20).fill(0.6)); // 열림
    // openness 0.5 (raw 0.35) → 0.35 초과이므로 계속 열림
    expect(feed(d, Array(40).fill(0.1 + 0.5 * 0.5), 400).isOpen).toBe(true);
    const d2 = new MouthDetector(cal);
    feed(d2, Array(40).fill(0.1 + 0.5 * 0.5)); // openness 0.5 → 아직 닫힘(0.6 미만)
    expect(d2.update(0.1 + 0.5 * 0.5, 2000).isOpen).toBe(false);
  });

  it('최소 유지 시간: 전환 직후 80ms 안에는 다시 바뀌지 않는다', () => {
    const d = new MouthDetector(cal);
    // 처음 열림: 평활이 충분히 오른 뒤 열림 전환
    let t = 0;
    let out = d.update(0.1, t);
    for (let i = 0; i < 30 && !out.isOpen; i++) out = d.update(0.6, (t += 16));
    expect(out.isOpen).toBe(true);
    const openedAt = t;
    // 바로 닫는 값을 줘도 80ms 전에는 열림 유지
    out = d.update(0.1, openedAt + 10);
    expect(out.isOpen).toBe(true);
    // 충분히 시간이 지나고 평활이 내려가면 닫힘
    for (let i = 0; i < 40; i++) out = d.update(0.1, openedAt + 100 + i * 16);
    expect(out.isOpen).toBe(false);
    expect(MOUTH.MIN_HOLD_MS).toBe(80);
  });

  it('평활화: 한 프레임 튀는 값(노이즈)으로는 열림이 되지 않는다', () => {
    const d = new MouthDetector(cal);
    for (let i = 0; i < 10; i++) d.update(0.1, i * 16);
    expect(d.update(0.6, 170).isOpen).toBe(false);
    expect(d.update(0.1, 186).isOpen).toBe(false);
  });

  it('프레임 간격이 달라도 시간 기반으로 반응한다', () => {
    const fast = new MouthDetector(cal);
    const slow = new MouthDetector(cal);
    fast.update(0.1, 0);
    slow.update(0.1, 0);
    let a = fast.update(0.6, 100).openness;
    const b = slow.update(0.6, 100).openness;
    expect(a).toBeCloseTo(b);
    a = fast.update(0.6, 130).openness;
    expect(a).toBeGreaterThan(b);
  });

  it('reset 하면 상태를 초기화한다', () => {
    const d = new MouthDetector(cal);
    feed(d, Array(30).fill(0.6));
    d.reset();
    expect(d.update(0.1, 10_000).isOpen).toBe(false);
  });

  it('보정값 변경이 즉시 반영된다', () => {
    const d = new MouthDetector({ closedBase: 0, openMax: 1 });
    const before = d.update(0.5, 0).openness;
    d.setCalibration({ closedBase: 0, openMax: 0.5 });
    expect(d.update(0.5, 1000).openness).toBeGreaterThan(before);
  });
});

describe('보정 계산', () => {
  const closed = Array.from({ length: 40 }, (_, i) => 0.02 + (i % 3) * 0.005);
  const open = Array.from({ length: 40 }, (_, i) => 0.3 + i * 0.01);

  it('중앙값/상위 90% 계산', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  it('유효한 표본이면 보정값을 만든다', () => {
    const r = computeCalibration(closed, open);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cal.closedBase).toBeCloseTo(0.025, 2);
      expect(r.cal.openMax).toBeGreaterThan(0.6);
    }
  });

  it('표본이 부족하면 실패(samples)', () => {
    const r = computeCalibration(closed.slice(0, 3), open);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('samples');
  });

  it('벌림이 너무 작으면 실패(range)', () => {
    const small = Array.from({ length: 40 }, () => 0.06);
    const r = computeCalibration(closed, small);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('range');
    expect(CALIBRATION.MIN_RANGE).toBe(0.15);
  });
});
