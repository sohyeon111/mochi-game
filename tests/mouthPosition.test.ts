import { describe, expect, it } from 'vitest';
import { LIP, MOUTH_AREA } from '../src/app/constants';
import { coverMap, mouthAreaFromLandmarks, normalizedToStage } from '../src/vision/mouthPosition';
import type { Point } from '../src/vision/types';

describe('coverMap', () => {
  it('16:9 영상은 그대로 맞는다', () => {
    const m = coverMap({ w: 1280, h: 720 });
    expect(m.scale).toBe(1);
    expect(m.offsetX).toBe(0);
    expect(m.offsetY).toBe(0);
  });
  it('4:3 영상은 폭 기준으로 확대되고 위아래가 잘린다', () => {
    const m = coverMap({ w: 640, h: 480 });
    expect(m.scale).toBe(2); // 1280/640
    expect(m.offsetX).toBe(0);
    expect(m.offsetY).toBe((720 - 960) / 2); // -120
  });
  it('세로로 긴 영상은 높이 기준으로 확대되고 좌우가 잘린다', () => {
    const m = coverMap({ w: 480, h: 640 });
    expect(m.scale).toBeCloseTo(1280 / 480);
    expect(m.offsetX).toBe(0);
  });
});

describe('normalizedToStage', () => {
  it('좌우 반전: 영상의 왼쪽 끝은 스테이지 오른쪽 끝', () => {
    const v = { w: 1280, h: 720 };
    expect(normalizedToStage({ x: 0, y: 0 }, v)).toEqual({ x: 1280, y: 0 });
    expect(normalizedToStage({ x: 1, y: 1 }, v)).toEqual({ x: 0, y: 720 });
    expect(normalizedToStage({ x: 0.5, y: 0.5 }, v)).toEqual({ x: 640, y: 360 });
  });
  it('반전을 끄면 그대로', () => {
    expect(normalizedToStage({ x: 0.25, y: 0.5 }, { w: 1280, h: 720 }, false)).toEqual({ x: 320, y: 360 });
  });
  it('4:3 영상의 중앙은 스테이지 중앙', () => {
    const p = normalizedToStage({ x: 0.5, y: 0.5 }, { w: 640, h: 480 });
    expect(p.x).toBeCloseTo(640);
    expect(p.y).toBeCloseTo(360);
  });
});

function landmarks(points: Partial<Record<number, Point>>): Point[] {
  const arr: Point[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [i, p] of Object.entries(points)) arr[Number(i)] = p as Point;
  return arr;
}

describe('mouthAreaFromLandmarks', () => {
  const video = { w: 1280, h: 720 };
  const lm = landmarks({
    [LIP.CORNER_LEFT]: { x: 0.4, y: 0.6 },
    [LIP.CORNER_RIGHT]: { x: 0.6, y: 0.6 },
    [LIP.UPPER_INNER]: { x: 0.5, y: 0.56 },
    [LIP.LOWER_INNER]: { x: 0.5, y: 0.66 },
  });

  it('입 중심은 입꼬리 중점 x, 안쪽 입술 중점 y를 반전해 변환', () => {
    const a = mouthAreaFromLandmarks(lm, video, 1);
    expect(a).not.toBeNull();
    expect(a!.center.x).toBeCloseTo(1280 - 0.5 * 1280);
    expect(a!.center.y).toBeCloseTo(0.61 * 720);
  });

  it('반경: 입꼬리 간 절반 거리 × 배율, 열림이 크면 세로 반경 확보', () => {
    const open = mouthAreaFromLandmarks(lm, video, 1)!;
    expect(open.radiusX).toBeCloseTo(0.1 * 1280 * MOUTH_AREA.RX_SCALE);
    // 안쪽 절반 높이 = 0.05*720 = 36 → ×1.3 = 46.8, 최소값 = radiusX*0.45*1
    expect(open.radiusY).toBeCloseTo(Math.max(36 * MOUTH_AREA.RY_SCALE, open.radiusX * MOUTH_AREA.MIN_RY_RATIO));
  });

  it('닫혀 있으면(openness 0) 최소 세로 반경 보장은 적용되지 않는다', () => {
    const flat = landmarks({
      [LIP.CORNER_LEFT]: { x: 0.4, y: 0.6 }, [LIP.CORNER_RIGHT]: { x: 0.6, y: 0.6 },
      [LIP.UPPER_INNER]: { x: 0.5, y: 0.6 }, [LIP.LOWER_INNER]: { x: 0.5, y: 0.6 },
    });
    expect(mouthAreaFromLandmarks(flat, video, 0)!.radiusY).toBe(0);
  });

  it('랜드마크가 부족하면 null', () => {
    expect(mouthAreaFromLandmarks([], video, 1)).toBeNull();
  });
});
