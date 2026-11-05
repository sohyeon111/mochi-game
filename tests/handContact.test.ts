// 손가락 접촉 판정(순수 로직): 좌표 변환, 누르기/주무르기 판정, 안전장치(주먹·손바닥·끊김·화면 밖)
import { describe, expect, it } from 'vitest';
import { HAND, STAGE_H, STAGE_W } from '../src/app/constants';
import { HandContactEstimator, makeContactBuffer, smoothstep01 } from '../src/vision/handContact';
import { insideMargin, tipsToStage } from '../src/vision/handMapping';
import { rawHandFromWorker } from '../src/vision/handTracker';
import type { RawHand } from '../src/vision/types';

const MOCHI_BOX = { x0: 400, y0: 200, x1: 880, y1: 640 };
const over = (x: number, y: number): boolean => x >= MOCHI_BOX.x0 && x <= MOCHI_BOX.x1 && y >= MOCHI_BOX.y0 && y <= MOCHI_BOX.y1;
const VIDEO = { w: 1280, h: 720 };

/** 스테이지 좌표(거울 반전 적용 후)가 (sx,sy)가 되는 정규화 영상 좌표 */
const norm = (sx: number, sy: number): [number, number] => [1 - sx / STAGE_W, sy / STAGE_H];

function hand(tipsStage: Array<[number, number]>, flex: number[] = [0.1, 0.1, 0.1, 0.1, 0.1], score = 0.95): RawHand {
  const tips = new Float32Array(10);
  tipsStage.forEach(([sx, sy], i) => {
    const [nx, ny] = norm(sx, sy);
    tips[i * 2] = nx;
    tips[i * 2 + 1] = ny;
  });
  return { found: true, score, tips, flex: Float32Array.from(flex), palm: { x: 0.5, y: 0.5 }, scale: 0.15 };
}
const FAR: [number, number] = [100, 100];
const tipsWithIndexAt = (x: number, y: number): Array<[number, number]> => [FAR, [x, y], FAR, FAR, FAR];

function run(est: HandContactEstimator, frames: number, make: (i: number) => RawHand | null, t0 = 1000, dt = 33): number {
  let t = t0;
  for (let i = 0; i < frames; i++) {
    est.update(make(i), t, VIDEO);
    t += dt;
  }
  return t;
}

function newEst(): HandContactEstimator {
  const e = new HandContactEstimator();
  e.overTest = over;
  return e;
}

describe('좌표 변환(손가락 끝 → 1280×720)', () => {
  it('좌우 반전: 영상의 왼쪽(x=0.1)은 화면의 오른쪽에 나온다', () => {
    const out = new Float64Array(10);
    tipsToStage([0.1, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], VIDEO, out, true);
    expect(out[0]).toBeCloseTo(STAGE_W * 0.9, 3);
    expect(out[2]).toBeCloseTo(STAGE_W * 0.1, 3);
    expect(out[1]).toBeCloseTo(STAGE_H * 0.5, 3);
  });

  it('16:9 영상이면 정규화 좌표가 그대로 비례하고, 모서리가 화면 모서리에 대응한다', () => {
    const out = new Float64Array(10);
    tipsToStage([0, 0, 1, 1, 0.5, 0.5, 0.25, 0.75, 0.75, 0.25], VIDEO, out, false);
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, STAGE_W, STAGE_H]);
    expect(out[6]).toBeCloseTo(STAGE_W * 0.25, 6);
    expect(out[7]).toBeCloseTo(STAGE_H * 0.75, 6);
  });

  it('4:3 영상은 object-fit: cover로 위아래가 잘린다: 영상 위쪽 가장자리는 화면 밖(음수)이고, 가운데는 가운데', () => {
    const out = new Float64Array(10);
    tipsToStage([0.5, 0, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5], { w: 640, h: 480 }, out, true);
    expect(out[1]).toBeLessThan(0); // 위쪽 가장자리는 화면 밖
    expect(out[3]).toBeCloseTo(STAGE_H / 2, 6);
    expect(out[5]).toBeGreaterThan(STAGE_H);
    expect(out[2]).toBeCloseTo(STAGE_W / 2, 6);
  });

  it('화면 가장자리 오차: 영상 가장자리 근처(0.01)가 화면 가장자리에서 12.8px 이내', () => {
    const out = new Float64Array(10);
    tipsToStage([0.01, 0.01, 0.99, 0.99, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], VIDEO, out, false);
    expect(Math.abs(out[0] as number)).toBeLessThan(13);
    expect(Math.abs((out[2] as number) - STAGE_W)).toBeLessThan(13);
    expect(insideMargin(out[0] as number, out[1] as number)).toBeGreaterThan(0);
    expect(insideMargin(-5, 100)).toBeLessThan(0);
  });
});

describe('rawHandFromWorker', () => {
  it('Worker 결과 18개 값을 필요한 필드로 나눈다', () => {
    const data = new Float32Array(18);
    data.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 0);
    data.set([0, 0.2, 0.4, 0.6, 0.8], 10);
    data.set([0.45, 0.55, 0.12], 15);
    const r = rawHandFromWorker(true, 0.9, data);
    expect(r.found).toBe(true);
    expect(Array.from(r.tips).map((v) => +v.toFixed(2))).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(Array.from(r.flex).map((v) => +v.toFixed(2))).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(r.palm.x).toBeCloseTo(0.45, 5);
    expect(r.scale).toBeCloseTo(0.12, 5);
    expect(rawHandFromWorker(false, 0, null).found).toBe(false);
  });
});

describe('누르기·주무르기 판정', () => {
  it('손가락을 찹쌀떡 위에 올려 두고 머물면 굽히거나 움직이지 않아도 작은 눌림으로 접촉이 시작된다', () => {
    const e = newEst();
    run(e, 30, () => hand(tipsWithIndexAt(640, 400)));
    const f = e.fingers[1]!;
    expect(f.active).toBe(true);
    expect(f.amount).toBeGreaterThan(0.25);
    expect(f.amount).toBeLessThan(HAND.CONTACT_BASE + 0.08); // 기본 눌림 수준(굽힘·속도 보조가 없으므로)
    expect(f.condOver && f.condDwell && !f.condFlex && !f.condSpeed).toBe(true); // 굽힘·속도는 필수가 아니다
    expect(e.fingers.filter((_, i) => i !== 1).every((x) => !x.active)).toBe(true); // 찹쌀떡 밖의 손가락은 접촉 없음
  });

  it('머문 시간이 DWELL을 채우기 전에는 접촉이 없고, 채운 뒤에 눌림이 부드럽게 오른다(갑자기 튀지 않음)', () => {
    const e = newEst();
    const tStart = run(e, 10, () => hand(tipsWithIndexAt(100, 400)), 1000);
    let t = tStart;
    const amounts: number[] = [];
    let firstActiveMs = -1;
    for (let i = 0; i < 30; i++) {
      e.update(hand(tipsWithIndexAt(640, 400)), t, VIDEO);
      amounts.push(e.fingers[1]!.amount);
      if (firstActiveMs < 0 && e.fingers[1]!.active) firstActiveMs = t - tStart;
      t += 33;
    }
    expect(firstActiveMs).toBeGreaterThanOrEqual(HAND.DWELL_MS - 40); // 첫 프레임의 dt가 바로 머문 시간에 더해진다
    expect(firstActiveMs).toBeLessThan(HAND.DWELL_MS + 400);
    for (let i = 1; i < amounts.length; i++) expect(Math.abs((amounts[i] as number) - (amounts[i - 1] as number))).toBeLessThan(0.2);
  });

  it('굽힘은 필수가 아니라 강도 보조: 굽히면 기본 눌림보다 깊어지고, 펴면 기본 눌림으로 돌아온다(접촉은 유지)', () => {
    const e = newEst();
    let t = run(e, 30, () => hand(tipsWithIndexAt(640, 400)));
    const base = e.fingers[1]!.amount;
    t = run(e, 30, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.8, 0.1, 0.1, 0.1]), t);
    expect(e.fingers[1]!.amount).toBeGreaterThan(base + 0.2);
    run(e, 40, () => hand(tipsWithIndexAt(640, 400)), t);
    expect(e.fingers[1]!.active).toBe(true);
    expect(e.fingers[1]!.amount).toBeLessThan(base + 0.1);
  });

  it('속도도 필수가 아니라 강도 보조: 움직이면 더 세게, 가만히 있어도 접촉은 유지', () => {
    const e = newEst();
    run(e, 30, () => hand(tipsWithIndexAt(640, 400)));
    const still = e.fingers[1]!.amount;
    run(e, 30, (i) => hand(tipsWithIndexAt(500 + ((i * 13) % 280), 420)), 4000);
    expect(e.fingers[1]!.amount).toBeGreaterThan(still + 0.05);
  });

  it('찹쌀떡 밖에서 손가락을 굽혀도 접촉하지 않는다', () => {
    const e = newEst();
    run(e, 30, () => hand(tipsWithIndexAt(200, 400), [0.1, 0.1, 0.1, 0.1, 0.1]));
    run(e, 30, () => hand(tipsWithIndexAt(200, 400), [0.1, 0.9, 0.1, 0.1, 0.1]), 3000);
    expect(e.fingers.every((f) => !f.active)).toBe(true);
  });

  it('위에 머문 뒤 손가락을 굽히면 접촉이 생기고, 눌림이 한 프레임에 크게 튀지 않는다', () => {
    const e = newEst();
    let t = run(e, 20, () => hand(tipsWithIndexAt(640, 400))); // 기준 굽힘 0.1에 적응
    const amounts: number[] = [];
    for (let i = 0; i < 40; i++) {
      e.update(hand(tipsWithIndexAt(640, 400), [0.1, 0.6, 0.1, 0.1, 0.1]), t, VIDEO);
      amounts.push((e.fingers[1] as { amount: number }).amount);
      t += 33;
    }
    expect(Math.max(...amounts)).toBeGreaterThan(0.4);
    expect(e.fingers[1]!.active).toBe(true);
    for (let i = 1; i < amounts.length; i++) expect(Math.abs((amounts[i] as number) - (amounts[i - 1] as number))).toBeLessThan(0.25);
    expect(e.fingers.filter((f, i) => i !== 1 && f.active).length).toBe(0); // 다른 손가락은 영향 없음
  });

  it('스치기: 위에 머문 시간이 DWELL보다 짧으면 굽혀도 접촉하지 않는다', () => {
    const e = newEst();
    run(e, 10, () => hand(tipsWithIndexAt(100, 400)), 1000); // 밖에서 기준 적응
    run(e, 2, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.9, 0.1, 0.1, 0.1]), 2000, 33); // 66ms만 머묾
    expect(e.fingers[1]!.active).toBe(false);
  });

  it('손가락을 찹쌀떡에서 떼면(밖으로 나가면) 접촉이 서서히 풀린다', () => {
    const e = newEst();
    let t = run(e, 30, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.7, 0.1, 0.1, 0.1]));
    expect(e.fingers[1]!.active).toBe(true);
    const before = e.fingers[1]!.amount;
    e.update(hand(tipsWithIndexAt(100, 100)), t, VIDEO);
    t += 33;
    expect(e.fingers[1]!.amount).toBeGreaterThan(before * 0.3); // 한 프레임에 0으로 떨어지지 않는다
    run(e, 40, () => hand(tipsWithIndexAt(100, 100)), t);
    expect(e.fingers[1]!.active).toBe(false);
    expect(e.fingers[1]!.amount).toBe(0);
  });

  it('누른 채 움직이면(주무르기) 접촉이 유지되고 이동 속도·방향이 전달되며 강도 상한을 넘지 않는다', () => {
    const e = newEst();
    run(e, 40, (i) => hand(tipsWithIndexAt(500 + ((i * 11) % 300), 420))); // 약 330px/s
    const f = e.fingers[1]!;
    expect(f.active).toBe(true);
    expect(f.amount).toBeLessThanOrEqual(HAND.CONTACT_BASE + (1 - HAND.CONTACT_BASE) * HAND.SPEED_BOOST + 0.05);
    expect(f.speed).toBeGreaterThan(HAND.MOTION_V0);
  });

  it('주먹을 쥐었다 펴면 기준 굽힘이 빨리 돌아와 곧바로 다시 누를 수 있다', () => {
    const e = newEst();
    let t = run(e, 20, () => hand(tipsWithIndexAt(640, 400)));
    t = run(e, 30, () => hand([[620, 400], [640, 400], [660, 400], [680, 400], [700, 400]], [0.5, 0.9, 0.9, 0.9, 0.9]), t);
    t = run(e, 14, () => hand(tipsWithIndexAt(640, 400)), t); // 펴기
    run(e, 30, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.8, 0.1, 0.1, 0.1]), t);
    expect(e.fingers[1]!.active).toBe(true);
  });

  it('손가락 여러 개가 각각 독립적으로 접촉한다(동시에 누르기)', () => {
    const e = newEst();
    const base: Array<[number, number]> = [[500, 300], [600, 420], [700, 420], FAR, FAR];
    let t = run(e, 20, () => hand(base));
    run(e, 40, () => hand(base, [0.1, 0.7, 0.7, 0.1, 0.1]), t);
    expect(e.fingers[0]!.active && e.fingers[1]!.active && e.fingers[2]!.active).toBe(true); // 위에 있는 세 손가락
    expect(e.fingers[3]!.active || e.fingers[4]!.active).toBe(false); // 밖에 있는 손가락은 접촉 없음
    const buf = makeContactBuffer();
    expect(e.sample(e.lastUpdate, buf)).toBe(3);
    expect(buf[1]!.x).not.toBeCloseTo(buf[2]!.x, 0);
  });
});

describe('손바닥·주먹은 눌림 입력이 되지 않는다', () => {
  it('손바닥 기준점이 찹쌀떡 위여도 손가락 끝이 밖이면 접촉이 없다', () => {
    const e = newEst();
    const h = hand([FAR, [100, 500], [120, 500], [140, 500], [160, 500]]);
    h.palm = { x: 0.5, y: 0.5 }; // 화면 가운데(찹쌀떡 위)
    run(e, 60, () => h);
    expect(e.fingers.every((f) => !f.active)).toBe(true);
  });

  it('손 크기(scale)가 커져도(카메라에 가까워져도) 눌림 정도는 달라지지 않는다(손바닥 크기로 누르기를 판정하지 않는다)', () => {
    const a = newEst();
    const b = newEst();
    run(a, 80, () => hand(tipsWithIndexAt(640, 400)));
    run(b, 80, (i) => ({ ...hand(tipsWithIndexAt(640, 400)), scale: 0.1 + i * 0.004 }));
    expect(b.fingers[1]!.amount).toBeCloseTo(a.fingers[1]!.amount, 6);
    // 손가락 끝이 모두 밖이면 손 크기가 아무리 변해도 접촉이 없다
    const c = newEst();
    run(c, 80, (i) => ({ ...hand([[100, 100], [120, 100], [140, 100], [160, 100], [180, 100]]), scale: 0.1 + i * 0.01 }));
    expect(c.fingers.every((f) => !f.active)).toBe(true);
  });

  it('주먹(검지~새끼 거의 다 굽음)이면 찹쌀떡 위여도 모든 접촉을 끈다', () => {
    const e = newEst();
    run(e, 20, () => hand(tipsWithIndexAt(640, 400)));
    run(e, 40, () => hand([[620, 400], [640, 400], [660, 400], [680, 400], [700, 400]], [0.5, 0.9, 0.9, 0.9, 0.9]), 4000);
    expect(e.fingers.every((f) => !f.active)).toBe(true);
  });
});

describe('안정성: 인식이 끊기거나 흔들려도', () => {
  function pressed(): { e: HandContactEstimator; t: number } {
    const e = newEst();
    let t = run(e, 20, () => hand(tipsWithIndexAt(640, 400)));
    t = run(e, 40, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.8, 0.1, 0.1, 0.1]), t);
    expect(e.fingers[1]!.active).toBe(true);
    return { e, t };
  }

  it('잠깐(GRACE 이내) 끊기면 위치를 유지하고 눌림이 서서히 풀린다(튀지 않는다)', () => {
    const { e, t } = pressed();
    const before = e.fingers[1]!.amount;
    const x0 = e.fingers[1]!.x;
    e.update(null, t, VIDEO);
    expect(e.tracking).toBe(false);
    expect(e.fingers[1]!.x).toBeCloseTo(x0, 6);
    expect(e.fingers[1]!.amount).toBeLessThanOrEqual(before);
    expect(e.fingers[1]!.amount).toBeGreaterThan(before * 0.4); // 한 번에 0으로 떨어지지 않는다
  });

  it('GRACE를 넘겨 끊기면 모든 접촉이 풀리고, 돌아오면 위치가 튀지 않고 눌림 0에서 다시 시작한다', () => {
    const { e, t } = pressed();
    const t2 = run(e, 8, () => null, t, 33);
    expect(e.fingers.every((f) => !f.active)).toBe(true);
    e.update(hand(tipsWithIndexAt(700, 450), [0.1, 0.8, 0.1, 0.1, 0.1]), t2, VIDEO);
    expect(e.fingers[1]!.active).toBe(false); // 돌아온 즉시 눌림이 생기지 않는다(DWELL 필요)
    expect(e.fingers[1]!.x).toBeCloseTo(STAGE_W * (1 - (1 - 700 / STAGE_W)), 0);
  });

  it('신뢰도가 낮으면 손이 없는 것으로 본다', () => {
    const { e, t } = pressed();
    run(e, 8, () => hand(tipsWithIndexAt(640, 400), [0.1, 0.8, 0.1, 0.1, 0.1], HAND.MIN_SCORE - 0.1), t);
    expect(e.tracking).toBe(false);
    expect(e.fingers.every((f) => !f.active)).toBe(true);
  });

  it('워치독: 갱신이 STALE_MS 넘게 없으면 샘플은 접촉 없음', () => {
    const { e } = pressed();
    const buf = makeContactBuffer();
    expect(e.sample(e.lastUpdate + 50, buf)).toBeGreaterThan(0);
    expect(e.sample(e.lastUpdate + HAND.STALE_MS + 50, buf)).toBe(0);
  });

  it('외삽: 검출 사이(최대 EXTRAPOLATE_MS)는 속도로 위치를 앞당기되 그 이상은 넘지 않는다', () => {
    const e = newEst();
    run(e, 30, (i) => hand(tipsWithIndexAt(500 + i * 8, 420)));
    const buf = makeContactBuffer();
    e.sample(e.lastUpdate, buf);
    const x0 = buf[1]!.x;
    e.sample(e.lastUpdate + 30, buf);
    const x30 = buf[1]!.x;
    e.sample(e.lastUpdate + 200, buf);
    const x200 = buf[1]!.x;
    expect(Math.abs(x30 - x0)).toBeGreaterThan(0);
    expect(Math.abs(x200 - x0)).toBeLessThanOrEqual(Math.abs(buf[1]!.vx) * (HAND.EXTRAPOLATE_MS / 1000) + 1e-6);
  });

  it('화면 밖 손가락은 접촉하지 않는다', () => {
    const e = newEst();
    run(e, 20, () => hand(tipsWithIndexAt(-60, 400)));
    run(e, 40, () => hand(tipsWithIndexAt(-60, 400), [0.1, 0.9, 0.1, 0.1, 0.1]), 4000);
    expect(e.fingers[1]!.active).toBe(false);
  });

  it('위치 떨림은 스무딩되고 속도는 상한을 넘지 않는다', () => {
    const e = newEst();
    run(e, 40, (i) => hand(tipsWithIndexAt(640 + (i % 2 ? 6 : -6), 400)));
    expect(Math.abs(e.fingers[1]!.x - 640)).toBeLessThan(5);
    run(e, 5, (i) => hand(tipsWithIndexAt(100 + i * 600, 400)), 5000, 10); // 순간이동에 가까운 점프
    expect(e.fingers[1]!.speed).toBeLessThanOrEqual(HAND.VEL_MAX + 1e-6);
  });

  it('smoothstep01은 0~1로 제한된다', () => {
    expect(smoothstep01(-1)).toBe(0);
    expect(smoothstep01(2)).toBe(1);
    expect(smoothstep01(0.5)).toBeCloseTo(0.5, 6);
  });
});
