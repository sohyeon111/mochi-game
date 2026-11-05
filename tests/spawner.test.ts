import { describe, expect, it } from 'vitest';
import { FRUIT_IDS, GAME, STAGE_H, STAGE_W, TRASH_IDS } from '../src/app/constants';
import { mulberry32 } from '../src/game/rng';
import { Spawner, assetKeyOf, baseScaleFromPxPerMeter, isOffscreen, stepObject, swayTilt, swayX, type SpriteDims } from '../src/game/spawner';
import type { FallingObject } from '../src/game/types';

const keys = [...FRUIT_IDS.map((i) => `fruit_${i}`), ...TRASH_IDS.map((i) => `trash_${i}`)];
const dims: SpriteDims = {
  baseScale: Object.fromEntries(keys.map((k) => [k, baseScaleFromPxPerMeter(1547.34)])),
  size: Object.fromEntries(keys.map((k) => [k, { w: 300, h: 300 }])),
};

function simulate(seed: number, totalMs = GAME.DURATION_MS, step = 16): FallingObject[] {
  const sp = new Spawner(mulberry32(seed), dims);
  const all: FallingObject[] = [];
  for (let t = 0; t < totalMs; t += step) all.push(...sp.update(step));
  return all;
}

describe('스포너', () => {
  it('Blender 실제 치수 기준 배율: 스테이지 px/m ÷ 스프라이트 px/m', () => {
    expect(baseScaleFromPxPerMeter(1547.34)).toBeCloseTo(GAME.STAGE_PX_PER_METER / 1547.34);
  });

  it('20초 동안 과일이 최소 보장 개수 이상 나온다(여러 시드)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fruits = simulate(seed).filter((o) => o.kind === 'fruit').length;
      expect(fruits).toBeGreaterThanOrEqual(GAME.MIN_GUARANTEED_FRUITS);
    }
  });

  it('쓰레기도 나오고 재료:쓰레기 비율이 대략 7:3', () => {
    let f = 0;
    let t = 0;
    for (let seed = 1; seed <= 40; seed++) for (const o of simulate(seed)) (o.kind === 'fruit' ? f++ : t++);
    expect(t).toBeGreaterThan(0);
    const ratio = f / (f + t);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.85);
  });

  it('8종이 모두 등장한다', () => {
    const seen = new Set(Array.from({ length: 10 }, (_, i) => simulate(i + 1)).flat().map((o) => o.itemId));
    expect(seen.size).toBe(8);
  });

  it('오브젝트마다 크기와 낙하 속도가 다르고 범위 안이다', () => {
    const objs = simulate(7);
    const base = baseScaleFromPxPerMeter(1547.34);
    const scales = new Set(objs.map((o) => o.scale.toFixed(4)));
    const speeds = new Set(objs.map((o) => o.vy.toFixed(1)));
    expect(scales.size).toBeGreaterThan(objs.length * 0.8);
    expect(speeds.size).toBeGreaterThan(objs.length * 0.8);
    for (const o of objs) {
      expect(o.scale).toBeGreaterThanOrEqual(base * GAME.SIZE_FACTOR[0] - 1e-9);
      expect(o.scale).toBeLessThanOrEqual(base * GAME.SIZE_FACTOR[1] + 1e-9);
      expect(o.vy).toBeGreaterThanOrEqual(GAME.FALL_SPEED[0]);
      expect(o.vy).toBeLessThanOrEqual(GAME.FALL_SPEED[1]);
    }
  });

  it('화면 위쪽에서 생성되고 x는 화면 안', () => {
    for (const o of simulate(3)) {
      expect(o.y).toBeLessThan(0);
      expect(o.baseX).toBeGreaterThan(0);
      expect(o.baseX).toBeLessThan(STAGE_W);
    }
  });

  it('seq는 생성 순서대로 증가한다', () => {
    const objs = simulate(5);
    for (let i = 1; i < objs.length; i++) expect(objs[i]!.seq).toBe(objs[i - 1]!.seq + 1);
  });

  it('같은 시드는 같은 결과(재현 가능)', () => {
    const a = simulate(11).map((o) => [o.itemId, o.baseX.toFixed(2), o.vy.toFixed(2)]);
    const b = simulate(11).map((o) => [o.itemId, o.baseX.toFixed(2), o.vy.toFixed(2)]);
    expect(a).toEqual(b);
  });
});

describe('이동·흔들림·제거', () => {
  const sp = new Spawner(mulberry32(2), dims);
  const o = sp.update(1000)[0]!;

  it('아래로 떨어진다(속도 × 시간)', () => {
    const y0 = o.y;
    stepObject(o, 500);
    expect(o.y).toBeCloseTo(y0 + (o.vy * 500) / 1000);
  });

  it('좌우로 흔들린다: x가 baseX ± 진폭 안에서 변한다', () => {
    const xs: number[] = [];
    for (let t = 0; t < 4000; t += 50) xs.push(swayX(o, t));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(o.swayAmp * 0.5);
    for (const x of xs) expect(Math.abs(x - o.baseX)).toBeLessThanOrEqual(o.swayAmp + 1e-9);
    for (let t = 0; t < 4000; t += 50) expect(Math.abs(swayTilt(o, t))).toBeLessThanOrEqual(GAME.TILT_RAD + 1e-9);
  });

  it('화면 아래로 벗어나면 제거 대상, 화면 안이면 아님', () => {
    const inside = { ...o, y: STAGE_H - 50 };
    expect(isOffscreen(inside, dims)).toBe(false);
    const outside = { ...o, y: STAGE_H + 600 };
    expect(isOffscreen(outside, dims)).toBe(true);
  });

  it('assetKey 규칙', () => {
    expect(assetKeyOf('fruit', 'orange')).toBe('fruit_orange');
    expect(assetKeyOf('trash', 'can')).toBe('trash_can');
  });
});
