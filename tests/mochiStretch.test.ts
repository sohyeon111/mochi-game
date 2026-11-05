import { describe, expect, it } from 'vitest';
import { MOCHI } from '../src/app/constants';
import { StretchTracker, extentAlong, isValidStretch, majorAxis, maxExtentLength, stretchRatio } from '../src/mochi/stretchProgress';
import { distanceToPolygonEdges, isNearPolygon, pointInPolygon, signedArea } from '../src/mochi/geometry';

describe('늘림 비율(30% 판정)', () => {
  it('장축은 점 사이 최대 거리', () => {
    expect(majorAxis([0, 3, 0], [0, 0, 4])).toBe(5);
  });
  it('기본 길이면 0, 안전 최대면 1', () => {
    expect(stretchRatio(100, 100, 200)).toBe(0);
    expect(stretchRatio(200, 100, 200)).toBe(1);
    expect(stretchRatio(130, 100, 200)).toBeCloseTo(0.3);
  });
  it('줄어들면 0', () => {
    expect(stretchRatio(80, 100, 200)).toBe(0);
  });
  it('안전 최대 길이 = 그 방향 기본 길이 × 배율', () => {
    expect(maxExtentLength(100)).toBeCloseTo(100 * MOCHI.MAX_EXTENT_FACTOR);
  });
  it('방향별 길이: 위아래 방향과 좌우 방향', () => {
    const xs = [0, 10, 10, 0];
    const ys = [0, 0, 4, 4];
    expect(extentAlong(xs, ys, 0, -1)).toBe(4);
    expect(extentAlong(xs, ys, 1, 0)).toBe(10);
  });
  it('30% 경계: 0.29는 불인정, 0.30은 인정', () => {
    expect(isValidStretch(0.29)).toBe(false);
    expect(isValidStretch(0.3)).toBe(true);
    expect(isValidStretch(0.9)).toBe(true);
    expect(MOCHI.STRETCH_COMPLETE_RATIO).toBe(0.3);
  });
});

describe('StretchTracker', () => {
  it('30% 미만(클릭·미세 이동)은 완료가 되지 않는다', () => {
    const t = new StretchTracker();
    expect(t.update(0)).toBe(false);
    expect(t.update(0.05)).toBe(false);
    expect(t.update(0.29)).toBe(false);
    expect(t.done).toBe(false);
    expect(t.peak).toBeCloseTo(0.29);
  });
  it('30% 이상을 처음 달성하는 순간 한 번만 true', () => {
    const t = new StretchTracker();
    expect(t.update(0.31)).toBe(true);
    expect(t.update(0.5)).toBe(false);
    expect(t.done).toBe(true);
  });
  it('놓아서 비율이 0으로 돌아와도 완료는 유지', () => {
    const t = new StretchTracker();
    t.update(0.4);
    t.update(0);
    expect(t.done).toBe(true);
  });
  it('reset 하면 초기화(새 라운드)', () => {
    const t = new StretchTracker();
    t.update(0.8);
    t.reset();
    expect(t.done).toBe(false);
    expect(t.peak).toBe(0);
  });
});

describe('기하', () => {
  const sq = { x: [0, 10, 10, 0], y: [0, 0, 10, 10] };
  it('면적(부호 있음)', () => {
    expect(Math.abs(signedArea(sq.x, sq.y))).toBe(100);
  });
  it('안/밖 판정', () => {
    expect(pointInPolygon(5, 5, sq.x, sq.y)).toBe(true);
    expect(pointInPolygon(15, 5, sq.x, sq.y)).toBe(false);
  });
  it('변까지의 거리', () => {
    expect(distanceToPolygonEdges(15, 5, sq.x, sq.y)).toBeCloseTo(5);
    expect(distanceToPolygonEdges(13, 14, sq.x, sq.y)).toBeCloseTo(5);
  });
  it('여유(margin) 안이면 near', () => {
    expect(isNearPolygon(30, 5, sq.x, sq.y, 24)).toBe(true);
    expect(isNearPolygon(40, 5, sq.x, sq.y, 24)).toBe(false);
    expect(isNearPolygon(5, 5, sq.x, sq.y, 0)).toBe(true);
  });
});
