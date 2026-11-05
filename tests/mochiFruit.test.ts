import { describe, expect, it } from 'vitest';
import { FRUIT_IDS, type FruitId } from '../src/app/constants';
import { gaussianBlurRGBA, premultiply, tintAndFade, unpremultiply } from '../src/mochi/blur';
import { dominantFruit, drawOrder, layoutFruits, projectPiece, depthEffect, type FruitCounts, type FruitLayoutParams, type ViewProjection } from '../src/mochi/fruitLayout';
import { DEV_SAMPLE, emptyCounts, resolveMochiFruits } from '../src/mochi/sampleResult';
import type { RoundResult } from '../src/game/types';
import mochi from '../public/assets/render/mochi.json';

const data = mochi as unknown as { fruitLayout: FruitLayoutParams; views: Record<'front' | 'top', ViewProjection & { outlineRing: Array<[number, number]> }> };
const P = data.fruitLayout;
const counts = (o: Partial<FruitCounts>): FruitCounts => ({ ...emptyCounts(), ...o });
const ORDER: FruitId[] = ['kiwi', 'orange', 'strawberry', 'blueberry'];

describe('대표 과일', () => {
  it('최다 수집', () => {
    expect(dominantFruit(counts({ kiwi: 3, orange: 5, strawberry: 2 }), ['kiwi', 'orange', 'strawberry'])).toBe('orange');
  });
  it('동률이면 먼저 수집한 과일', () => {
    expect(dominantFruit(counts({ kiwi: 4, orange: 4, strawberry: 2 }), ['orange', 'kiwi', 'strawberry'])).toBe('orange');
    expect(dominantFruit(counts({ kiwi: 4, orange: 4, strawberry: 2 }), ['kiwi', 'orange', 'strawberry'])).toBe('kiwi');
  });
  it('수집이 없으면 null', () => {
    expect(dominantFruit(emptyCounts(), [])).toBeNull();
  });
});

describe('내부 과일 배치', () => {
  const c = counts({ kiwi: 4, orange: 3, strawberry: 2, blueberry: 1 });

  it('종류별 개수만큼 조각이 만들어진다', () => {
    const { pieces } = layoutFruits(c, ORDER, 11, P);
    expect(pieces).toHaveLength(10);
    for (const f of FRUIT_IDS) expect(pieces.filter((p) => p.type === f).length).toBe(c[f]);
  });

  it('수집하지 않은 과일은 나오지 않는다', () => {
    const { pieces } = layoutFruits(counts({ kiwi: 10 }), ['kiwi'], 3, P);
    expect(pieces.every((p) => p.type === 'kiwi')).toBe(true);
    expect(pieces).toHaveLength(10);
  });

  it('다른 종류의 과일도 함께 배치된다(대표 과일만이 아니다)', () => {
    const { pieces, dominant } = layoutFruits(c, ORDER, 5, P);
    expect(dominant).toBe('kiwi');
    expect(new Set(pieces.map((p) => p.type)).size).toBe(4);
  });

  it('대표 과일 조각이 같은 개수의 다른 과일보다 크다(보너스)', () => {
    const t = counts({ kiwi: 5, orange: 5 });
    let kiwi = 0;
    let orange = 0;
    for (let s = 1; s <= 30; s++) {
      const { pieces } = layoutFruits(t, ['kiwi', 'orange'], s, P);
      kiwi += pieces.filter((p) => p.type === 'kiwi').reduce((a, p) => a + p.mult, 0);
      orange += pieces.filter((p) => p.type === 'orange').reduce((a, p) => a + p.mult, 0);
    }
    expect(kiwi).toBeGreaterThan(orange);
  });

  it('블루베리는 작게(3알 묶음 보정), 5개 이상이면 더 작게', () => {
    const few = layoutFruits(counts({ blueberry: 2, kiwi: 8 }), ['kiwi', 'blueberry'], 2, P).pieces.filter((p) => p.type === 'blueberry');
    const many = layoutFruits(counts({ blueberry: 7, kiwi: 3 }), ['blueberry', 'kiwi'], 2, P).pieces.filter((p) => p.type === 'blueberry');
    const avg = (a: typeof few): number => a.reduce((s, p) => s + p.mult, 0) / a.length;
    expect(avg(few)).toBeLessThan(0.8);
    expect(avg(many)).toBeLessThan(0.8);
  });

  it('모든 조각이 모찌 내부 타원체 안쪽에 있다(실루엣을 벗어나지 않는다)', () => {
    const { R, H } = P.ellipsoid;
    for (let seed = 1; seed <= 60; seed++) {
      const mix = [counts({ kiwi: 10 }), counts({ blueberry: 10 }), c, counts({ strawberry: 1, kiwi: 1, orange: 1, blueberry: 7 })][seed % 4] as FruitCounts;
      const { pieces } = layoutFruits(mix, ORDER, seed, P);
      for (const p of pieces) {
        const rho = Math.sqrt((p.x / R) ** 2 + (p.d / R) ** 2 + (p.h / H) ** 2);
        expect(rho).toBeLessThanOrEqual(0.78);
        expect(p.h).toBeGreaterThan(0);
      }
    }
  });

  it('투영된 중심이 막 실루엣 안에 있다(정면·위)', () => {
    for (const view of ['front', 'top'] as const) {
      const v = data.views[view];
      const [x0, y0, x1, y1] = v.silhouetteBBox;
      for (let seed = 1; seed <= 40; seed++) {
        const { pieces } = layoutFruits(c, ORDER, seed, P);
        for (const p of pieces) {
          const pr = projectPiece(p, view, v, P);
          expect(pr.sx).toBeGreaterThan(x0);
          expect(pr.sx).toBeLessThan(x1);
          expect(pr.sy).toBeGreaterThan(y0);
          expect(pr.sy).toBeLessThan(y1);
          expect(pr.inside).toBeGreaterThanOrEqual(0);
          expect(pr.inside).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('같은 시드는 같은 배치, 다른 시드는 다른 배치(같은 입력이라도 매번 다름)', () => {
    const a = layoutFruits(c, ORDER, 7, P).pieces.map((p) => [p.type, p.x.toFixed(4), p.d.toFixed(4)]);
    const b = layoutFruits(c, ORDER, 7, P).pieces.map((p) => [p.type, p.x.toFixed(4), p.d.toFixed(4)]);
    const d = layoutFruits(c, ORDER, 8, P).pieces.map((p) => [p.type, p.x.toFixed(4), p.d.toFixed(4)]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(d);
  });

  it('깊이 효과: 안쪽일수록 더 흐리고 우윳빛이 섞이고 투명하다', () => {
    const near = depthEffect(0, P, 2);
    const far = depthEffect(1, P, 2);
    expect(far.blurPx).toBeGreaterThan(near.blurPx);
    expect(far.tint).toBeGreaterThan(near.tint);
    expect(far.opacity).toBeLessThan(near.opacity);
    // 기본 흐림(앞쪽)은 합성 테스트 값(3px@900 → 프레임 2배 = 6px)을 유지한다
    expect(near.blurPx).toBeCloseTo(6);
  });

  it('그리기 순서: 정면은 먼 것부터, 위는 낮은 것부터', () => {
    const { pieces } = layoutFruits(c, ORDER, 4, P);
    const f = drawOrder(pieces, 'front');
    for (let i = 1; i < f.length; i++) expect(f[i - 1]!.d).toBeGreaterThanOrEqual(f[i]!.d);
    const t = drawOrder(pieces, 'top');
    for (let i = 1; i < t.length; i++) expect(t[i - 1]!.h).toBeLessThanOrEqual(t[i]!.h);
  });

  it('수집이 없으면 조각도 없다', () => {
    expect(layoutFruits(emptyCounts(), [], 1, P).pieces).toEqual([]);
  });
});

describe('샘플 결과는 개발 환경에서만', () => {
  const real = {
    success: true, failReason: null, elapsedMs: 5000, fruitCount: 10, trashCount: 0,
    fruitCounts: counts({ orange: 6, kiwi: 4 }), firstOrder: ['orange', 'kiwi'], representative: 'orange', collected: [],
  } as RoundResult;

  it('실제 결과가 있으면 개발/배포 모두 그 결과를 쓴다', () => {
    for (const dev of [true, false]) {
      const r = resolveMochiFruits(real, dev);
      expect(r.counts.orange).toBe(6);
      expect(r.isSample).toBe(false);
    }
  });
  it('결과가 없을 때 DEV에서만 샘플(키위4·오렌지3·딸기2·블루베리1)', () => {
    const r = resolveMochiFruits(null, true);
    expect(r.isSample).toBe(true);
    expect(r.counts).toEqual(DEV_SAMPLE.counts);
    expect(r.counts).toEqual({ strawberry: 2, kiwi: 4, orange: 3, blueberry: 1 });
  });
  it('배포(비 DEV)에서 결과가 없으면 과일을 만들지 않는다', () => {
    const r = resolveMochiFruits(null, false);
    expect(r.isSample).toBe(false);
    expect(Object.values(r.counts).every((v) => v === 0)).toBe(true);
    expect(r.firstOrder).toEqual([]);
  });
});

describe('CPU 블러', () => {
  const make = (w: number, h: number): Uint8ClampedArray => new Uint8ClampedArray(w * h * 4);
  it('점 하나를 흐리면 퍼지지만 총합(알파)은 대체로 보존된다', () => {
    const w = 41;
    const h = 41;
    const d = make(w, h);
    const i = (20 * w + 20) * 4;
    d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 255;
    const before = d[i + 3] as number;
    gaussianBlurRGBA(d, w, h, 3);
    expect(d[i + 3]).toBeLessThan(before);
    expect(d[(20 * w + 24) * 4 + 3]).toBeGreaterThan(0);
    let sum = 0;
    for (let k = 3; k < d.length; k += 4) sum += d[k] as number;
    expect(sum).toBeGreaterThan(255 * 0.9);
    expect(sum).toBeLessThan(255 * 1.1);
  });
  it('sigma가 매우 작으면 그대로', () => {
    const d = make(5, 5);
    d[3] = 200;
    const copy = Uint8ClampedArray.from(d);
    gaussianBlurRGBA(d, 5, 5, 0.1);
    expect(d).toEqual(copy);
  });
  it('premultiply → unpremultiply 왕복', () => {
    const d = Uint8ClampedArray.from([200, 100, 50, 128, 10, 20, 30, 255]);
    const o = Uint8ClampedArray.from(d);
    premultiply(d);
    unpremultiply(d);
    for (let i = 0; i < d.length; i++) expect(Math.abs((d[i] as number) - (o[i] as number))).toBeLessThanOrEqual(2);
  });
  it('색 섞임·투명도: 불투명 흰 픽셀이 우윳빛으로 기울고 알파가 줄어든다', () => {
    const d = Uint8ClampedArray.from([100, 200, 50, 255]);
    tintAndFade(d, 0.5, 0.8, [255, 236, 228]);
    expect(d[3]).toBeCloseTo(255 * 0.8, 0);
    expect(d[0]).toBeGreaterThan(80);
    expect(d[2]).toBeGreaterThan(50 * 0.8);
  });
});
