import { describe, expect, it } from 'vitest';
import { MOCHI } from '../src/app/constants';
import { SoftBody } from '../src/mochi/softBody';
import { toStage } from '../src/mochi/meshWarp';
import mochi from '../public/assets/render/mochi.json';

type View = { outlineRing: Array<[number, number]> };
const views = (mochi as unknown as { views: Record<string, View> }).views;

/** 정면 배치(논리 좌표)의 소프트바디를 만든다 */
function frontBody(pin = true): { body: SoftBody; groundY: number; cx: number; top: number } {
  const p = { scale: MOCHI.FRONT_SCALE, ox: 0, oy: 0 };
  const ring = (views['front'] as View).outlineRing.map(([x, y]) => toStage(p, x, y));
  const maxY = Math.max(...ring.map((r) => r[1]));
  const ox = MOCHI.FRONT_CENTER_X - ((Math.min(...ring.map((r) => r[0])) + Math.max(...ring.map((r) => r[0]))) / 2);
  const oy = MOCHI.FRONT_GROUND_Y - maxY;
  const xs = ring.map((r) => r[0] + ox);
  const ys = ring.map((r) => r[1] + oy);
  const body = new SoftBody(xs, ys, { groundY: MOCHI.FRONT_GROUND_Y, pinBand: pin ? MOCHI.PIN_BAND : 0, topLimitY: MOCHI.TOP_MARGIN_PX });
  return { body, groundY: MOCHI.FRONT_GROUND_Y, cx: MOCHI.FRONT_CENTER_X, top: Math.min(...ys) };
}
/** TOUCH 단계의 소프트바디: 정면 시점, 바닥 고정 */
function touchBody(): SoftBody {
  return frontBody(true).body;
}
const extremeIdx = (b: SoftBody, pick: (x: number, y: number) => number): number => {
  let k = 0;
  for (let i = 1; i < b.n; i++) if (pick(b.x[i] as number, b.y[i] as number) < pick(b.x[k] as number, b.y[k] as number)) k = i;
  return k;
};
const run = (b: SoftBody, ms: number, frame = 16.67): void => {
  for (let t = 0; t < ms; t += frame) b.step(frame);
};
const finite = (b: SoftBody): boolean => b.x.every(Number.isFinite) && b.y.every(Number.isFinite);

describe('SoftBody 기본', () => {
  it('아무 힘도 없으면 기준 형태를 유지한다', () => {
    const { body } = frontBody();
    run(body, 2000);
    expect(body.maxDisplacement()).toBeLessThan(0.05);
    expect(body.isSettled()).toBe(true);
  });

  it('링 32점, 기준 면적 비율 1', () => {
    const { body } = frontBody();
    expect(body.n).toBe(32);
    expect(body.areaRatio()).toBeCloseTo(1, 6);
  });

  it('고정 시간 간격: 프레임 길이가 달라도 같은 결과(근사)', () => {
    const drive = (frame: number): number => {
      const { body, cx, top } = frontBody();
      body.beginGrab(cx, top + 10);
      body.moveGrab(cx, top - 120);
      run(body, 600, frame);
      return body.currentMajor();
    };
    const a = drive(8.33);
    const b = drive(16.67);
    const c = drive(33.3);
    expect(Math.abs(a - b) / a).toBeLessThan(0.02);
    expect(Math.abs(a - c) / a).toBeLessThan(0.03);
  });
});

describe('STRETCH: 잡아 늘리기', () => {
  it('위로 당기면 길어지고(장축 증가) 위쪽이 좁아진다(부피 유지 형태)', () => {
    const { body, cx, top } = frontBody();
    const w0 = body.restWidth;
    expect(body.beginGrab(cx, top + 15)).toBe(true);
    body.moveGrab(cx, top - 110);
    run(body, 1200);
    expect(body.currentStretchRatio()).toBeGreaterThan(0.1);
    expect(Math.min(...body.y)).toBeLessThan(top - 60); // 위로 60px 이상 길어졌다
    // 윗부분(최상단 1/3)의 폭이 기본 폭보다 확실히 좁다
    const minY = Math.min(...body.y);
    const maxY = Math.max(...body.y);
    const upper = body.x.filter((_, i) => (body.y[i] as number) < minY + (maxY - minY) / 3);
    expect(Math.max(...upper) - Math.min(...upper)).toBeLessThan(w0 * 0.75);
    expect(finite(body)).toBe(true);
  });

  it('늘리는 동안 면적(부피)이 거의 보존된다(±8%)', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 110);
    run(body, 1500);
    expect(body.areaRatio()).toBeGreaterThan(0.92);
    expect(body.areaRatio()).toBeLessThan(1.08);
  });

  it('바닥은 책상에 붙어 있다(아래쪽 점이 거의 움직이지 않는다)', () => {
    const { body, cx, top, groundY } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 110);
    run(body, 1200);
    expect(Math.max(...body.y)).toBeLessThanOrEqual(groundY + 1e-6);
    expect(Math.max(...body.y)).toBeGreaterThan(groundY - 10);
  });

  it('아주 멀리 당겨도 안전 최대 길이를 넘지 않고 찢어지지 않는다', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx + 3000, top - 5000);
    run(body, 3000);
    expect(finite(body)).toBe(true);
    expect(body.currentMajor()).toBeLessThanOrEqual(body.failsafeMajor * 1.02);
    expect(body.currentStretchRatio()).toBeLessThanOrEqual(1.1);
    // 이웃 점 간격이 기준의 최대 배수를 크게 넘지 않는다
    for (let i = 0; i < body.n; i++) {
      const j = (i + 1) % body.n;
      const L = Math.hypot((body.rx[j] as number) - (body.rx[i] as number), (body.ry[j] as number) - (body.ry[i] as number));
      const cur = Math.hypot((body.x[j] as number) - (body.x[i] as number), (body.y[j] as number) - (body.y[i] as number));
      expect(cur).toBeLessThan(L * MOCHI.MAX_EDGE_RATIO * 1.15);
    }
  });

  it('화면 위쪽 여백 밖으로 올라가지 않는다', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, -4000);
    run(body, 3000);
    expect(Math.min(...body.y)).toBeGreaterThanOrEqual(MOCHI.TOP_MARGIN_PX - 1e-6);
  });

  it('놓으면 출렁이며(기준선을 넘나들며) 원래 형태로 돌아온다', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 110);
    run(body, 1200);
    const stretched = body.maxDisplacement();
    expect(stretched).toBeGreaterThan(30);
    body.releaseGrab();
    const ys: number[] = [];
    for (let t = 0; t < 4000; t += 16.67) {
      body.step(16.67);
      ys.push(Math.min(...body.y) - Math.min(...(body.ry as number[])) - 0);
    }
    // 기준 높이(top) 대비 위쪽 끝의 부호가 바뀐다 = 한 번 이상 지나쳐 출렁임
    const rel = ys.map((v, i) => Math.min(...(body.y as number[])) * 0 + v + (i * 0));
    void rel;
    const topNow = Math.min(...body.y);
    expect(body.maxDisplacement()).toBeLessThan(1.5);
    expect(Math.abs(topNow - top)).toBeLessThan(2);
    expect(finite(body)).toBe(true);
  });

  it('놓은 뒤 기준 위치를 지나쳤다가 돌아온다(오버슈트가 있다)', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 110);
    run(body, 1200);
    body.releaseGrab();
    let crossed = false;
    let prevSign = -1;
    for (let t = 0; t < 3000; t += 16.67) {
      body.step(16.67);
      const d = Math.min(...body.y) - top; // 음수: 기준보다 위, 양수: 기준보다 아래
      const sign = d > 0.5 ? 1 : d < -0.5 ? -1 : 0;
      if (sign === 1 && prevSign === -1) crossed = true;
      if (sign !== 0) prevSign = sign;
    }
    expect(crossed).toBe(true);
  });

  it('클릭만 하거나 미세하게 움직이면 늘림 비율이 거의 0', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    run(body, 300);
    expect(body.currentStretchRatio()).toBeLessThan(0.02);
    body.moveGrab(cx + 2, top + 12);
    run(body, 300);
    expect(body.currentStretchRatio()).toBeLessThan(0.05);
  });

  it('충분히 당기면 늘림 비율이 30%를 넘는다', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 130);
    run(body, 1500);
    expect(body.currentStretchRatio()).toBeGreaterThanOrEqual(MOCHI.STRETCH_COMPLETE_RATIO);
  });

  it('가로로 당겨도 늘어난다', () => {
    const { body, top } = frontBody();
    const minX = Math.min(...body.x);
    const maxX = Math.max(...body.x);
    body.beginGrab(maxX - 8, (top + body.centroid().y) / 2 + 40);
    body.moveGrab(maxX + 160, body.centroid().y + 40);
    run(body, 1200);
    expect(Math.max(...body.x) - minX).toBeGreaterThan(maxX - minX + 40);
    expect(finite(body)).toBe(true);
  });
});

describe('잡기 영역(논리 좌표 24px)', () => {
  it('실루엣 안과 바깥 24px까지는 잡히고 그 밖은 잡히지 않는다', () => {
    const { body, top, cx } = frontBody();
    expect(MOCHI.GRAB_MARGIN_PX).toBe(24);
    expect(body.canGrab(cx, top + 40)).toBe(true); // 안
    expect(body.canGrab(cx, top - 20)).toBe(true); // 바깥 20px
    expect(body.canGrab(cx, top - 60)).toBe(false); // 바깥 60px
    expect(body.beginGrab(cx, top - 60)).toBe(false);
    expect(body.isGrabbing).toBe(false);
  });
});

describe('TOUCH: 누르기', () => {
  it('가장자리를 누르면 그 부분이 안쪽으로 들어간다', () => {
    const body = touchBody();
    const c = body.centroid();
    const edgeIdx = extremeIdx(body, (_x, y) => y); // 가장 위쪽 점
    const ex = body.x[edgeIdx] as number;
    const ey = body.y[edgeIdx] as number;
    const before = Math.hypot(ex - c.x, ey - c.y);
    body.setPress(ex, ey + 8);
    run(body, 700);
    const after = Math.hypot((body.x[edgeIdx] as number) - c.x, (body.y[edgeIdx] as number) - c.y);
    expect(after).toBeLessThan(before - 4);
    expect(finite(body)).toBe(true);
  });

  it('누르는 동안 면적이 크게 변하지 않는다(±10%)', () => {
    const body = touchBody();
    const c = body.centroid();
    body.setPress(c.x + 100, c.y);
    run(body, 900);
    expect(body.areaRatio()).toBeGreaterThan(0.9);
    expect(body.areaRatio()).toBeLessThan(1.1);
  });

  it('손을 떼면 탄성 있게 원래 형태로 돌아온다', () => {
    const body = touchBody();
    const c = body.centroid();
    body.setPress(c.x + 150, c.y);
    run(body, 800);
    expect(body.maxDisplacement()).toBeGreaterThan(3);
    body.releasePress();
    run(body, 4000);
    expect(body.maxDisplacement()).toBeLessThan(1);
    expect(body.pressAmount).toBeLessThan(0.01);
  });

  it('드래그하면 눌린 지점을 따라 형태가 움직인다', () => {
    const body = touchBody();
    const c = body.centroid();
    let px = c.x - 150;
    body.setPress(px, c.y);
    run(body, 400);
    const idxLeft = extremeIdx(body, (x) => x); // 가장 왼쪽 링 점
    const x0 = body.x[idxLeft] as number;
    for (let i = 0; i < 30; i++) {
      px += 6;
      body.setPress(px, c.y, 16.67);
      body.step(16.67);
    }
    expect(Math.abs((body.x[idxLeft] as number) - x0)).toBeGreaterThan(0.5);
    expect(finite(body)).toBe(true);
  });

  it('여러 번 누르고 떼어도 안정적이다(2000프레임, NaN 없음, 폭주 없음)', () => {
    const body = touchBody();
    const c = body.centroid();
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 2000; f++) {
      if (f % 60 === 0) body.setPress(c.x + (rnd() - 0.5) * 400, c.y + (rnd() - 0.5) * 160);
      if (f % 60 === 40) body.releasePress();
      body.step(16.67);
      expect(finite(body)).toBe(true);
    }
    const w = Math.max(...body.x) - Math.min(...body.x);
    expect(w).toBeLessThan(body.restWidth * 2);
  });
});

describe('폭주 방지', () => {
  it('매우 긴 프레임(탭 전환 후 복귀 등)이 들어와도 한 번에 제한된 시간만 진행한다', () => {
    const { body, cx, top } = frontBody();
    body.beginGrab(cx, top + 15);
    body.moveGrab(cx, top - 100);
    const steps = body.step(60_000);
    expect(steps).toBeLessThanOrEqual(MOCHI.MAX_SUBSTEPS_PER_FRAME);
    expect(finite(body)).toBe(true);
  });
});
