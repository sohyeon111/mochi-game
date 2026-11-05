// STRETCH 실루엣 회귀 테스트: 당겨도 끝이 뾰족한 삼각형이 되지 않고, 변형이 몸 전체에 분산되는지 확인한다.
// (이전 방식은 잡은 점 주변의 가우스 종 모양이라 변위가 몇 점에 몰려 꼭짓점 꺾임이 87~154°까지 나왔다)
import { describe, expect, it } from 'vitest';
import mochi from '../public/assets/render/mochi.json';
import { MOCHI } from '../src/app/constants';
import { toStage } from '../src/mochi/meshWarp';
import { SoftBody } from '../src/mochi/softBody';

const ringData = (mochi as unknown as { views: { front: { outlineRing: Array<[number, number]> } } }).views.front.outlineRing;

function make(): SoftBody {
  const p = { scale: MOCHI.FRONT_SCALE, ox: 0, oy: 0 };
  const ring = ringData.map(([x, y]) => toStage(p, x, y));
  const maxY = Math.max(...ring.map((r) => r[1]));
  const cx = (Math.min(...ring.map((r) => r[0])) + Math.max(...ring.map((r) => r[0]))) / 2;
  return new SoftBody(ring.map((r) => r[0] + MOCHI.FRONT_CENTER_X - cx), ring.map((r) => r[1] + MOCHI.FRONT_GROUND_Y - maxY), {
    groundY: MOCHI.FRONT_GROUND_Y, pinBand: MOCHI.PIN_BAND, topLimitY: MOCHI.TOP_MARGIN_PX,
  });
}

/** 한 꼭짓점에서 윤곽이 꺾이는 최대 각도(도). 원형은 360/32≈11°, 삼각형 끝은 90° 이상 */
function maxTurnDeg(b: SoftBody): number {
  let m = 0;
  for (let i = 0; i < b.n; i++) {
    const p = (i + b.n - 1) % b.n;
    const q = (i + 1) % b.n;
    const a1 = Math.atan2(b.y[i]! - b.y[p]!, b.x[i]! - b.x[p]!);
    const a2 = Math.atan2(b.y[q]! - b.y[i]!, b.x[q]! - b.x[i]!);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, (d * 180) / Math.PI);
  }
  return m;
}

/** 당기는 축 방향 앞쪽 끝에서 15% 안쪽 지점의 폭 / 전체 최대 폭 */
function tipWidthRatio(b: SoftBody, ux: number, uy: number): number {
  const proj = b.x.map((x, i) => x * ux + (b.y[i] as number) * uy);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const vx = -uy;
  const vy = ux;
  const target = hi - (hi - lo) * 0.15;
  const band = b.x.map((_, i) => i).filter((i) => Math.abs((proj[i] as number) - target) < (hi - lo) * 0.08);
  const perp = b.x.map((x, i) => x * vx + (b.y[i] as number) * vy);
  const all = Math.max(...perp) - Math.min(...perp);
  if (band.length < 2) return 0;
  return (Math.max(...band.map((i) => perp[i] as number)) - Math.min(...band.map((i) => perp[i] as number))) / all;
}

function pullBody(angleDeg: number, dist: number, ms = 1500): { b: SoftBody; ux: number; uy: number } {
  const b = make();
  const top = Math.min(...b.y);
  const cx = (Math.min(...b.x) + Math.max(...b.x)) / 2;
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // 당기는 방향의 반대쪽 모서리 안쪽을 잡는다(위로: 윗부분, 옆으로: 그쪽 옆구리)
  const sideX = ux * 0.9 > 0 ? cx + 120 : ux * 0.9 < -0.5 ? cx - 120 : cx;
  const gx = Math.abs(ux) > 0.9 ? sideX : cx + (ux < 0 ? -90 : ux > 0 ? 90 : 0);
  const gy = Math.abs(ux) > 0.9 ? top + 200 : top + 30;
  expect(b.beginGrab(gx, gy)).toBe(true);
  b.moveGrab(gx + ux * dist, gy + uy * dist);
  for (let t = 0; t < ms; t += 16.67) b.step(16.67);
  return { b, ux, uy };
}

const DIRECTIONS: Array<[string, number]> = [['위', -90], ['왼쪽 위', -135], ['오른쪽 위', -45], ['왼쪽', 180], ['오른쪽', 0]];
const MAX_TURN = 65; // 도. 원래 형태의 최대 꺾임(약 25°)의 2.5배 이내

describe('STRETCH 실루엣: 뾰족한 삼각형이 되지 않는다', () => {
  for (const [name, ang] of DIRECTIONS) {
    for (const dist of [60, 120, 400]) {
      it(`${name} 방향 ${dist}px 당김${dist >= 400 ? '(최대 변형 구간)' : ''}: 꺾임 ≤ ${MAX_TURN}°, 끝 폭 유지, 부피·한계 유지`, () => {
        const { b, ux, uy } = pullBody(ang, dist);
        expect(b.x.every(Number.isFinite) && b.y.every(Number.isFinite)).toBe(true);
        expect(maxTurnDeg(b)).toBeLessThan(MAX_TURN);
        // 끝 쪽 폭이 원래 형태 대비 너무 좁아지지 않는다(삼각형 끝이면 거의 0)
        expect(tipWidthRatio(b, ux, uy) / tipWidthRatio(make(), ux, uy)).toBeGreaterThan(0.35);
        expect(Math.abs(b.areaRatio() - 1)).toBeLessThan(0.14); // 늘어나는 길이를 한계의 ~95%까지 늘리면서(이전 ~80%) 대각선에서 +12~13%
        expect(b.currentStretchRatio()).toBeLessThanOrEqual(1.0 + 1e-6); // 기존 최대 변형 한계 유지
      });
    }
  }

  it('변위가 한 곳에 몰리지 않는다: 위로 당길 때 윤곽 점 대부분이 함께 올라간다', () => {
    const rest = make();
    const { b } = pullBody(-90, 120);
    const dy = b.y.map((y, i) => (rest.y[i] as number) - y); // 위로 이동한 양
    const maxUp = Math.max(...dy);
    // 앞쪽(위) 절반 점들이 최대 이동량의 25% 이상은 움직인다(가우스 종이면 옆 점들은 거의 0)
    const upperHalf = rest.y.map((y, i) => ({ y, i })).filter((o) => o.y < (Math.min(...rest.y) + Math.max(...rest.y)) / 2);
    const moved = upperHalf.filter((o) => (dy[o.i] as number) > maxUp * 0.25).length;
    expect(moved / upperHalf.length).toBeGreaterThan(0.8);
  });

  it('인접한 점 사이의 이동량 차이가 급격하지 않다(변형이 부드럽게 이어진다)', () => {
    const rest = make();
    const { b } = pullBody(-90, 300);
    const mag = b.x.map((x, i) => Math.hypot(x - (rest.x[i] as number), (b.y[i] as number) - (rest.y[i] as number)));
    const maxMove = Math.max(...mag);
    let maxJump = 0;
    for (let i = 0; i < b.n; i++) maxJump = Math.max(maxJump, Math.abs((mag[i] as number) - (mag[(i + 1) % b.n] as number)));
    expect(maxJump).toBeLessThan(maxMove * 0.4);
  });

  it('반대편(아래쪽)은 책상에 붙어 있고 폭은 위쪽에서 안쪽으로 수축한다', () => {
    const { b } = pullBody(-90, 200);
    expect(Math.max(...b.y)).toBeLessThanOrEqual(MOCHI.FRONT_GROUND_Y + 0.5);
    const tipY = Math.min(...b.y);
    const upperXs = b.x.filter((_, i) => (b.y[i] as number) < tipY + (MOCHI.FRONT_GROUND_Y - tipY) * 0.3);
    const rest = make();
    expect(Math.max(...upperXs) - Math.min(...upperXs)).toBeLessThan(Math.max(...rest.x) - Math.min(...rest.x));
  });

  it('놓으면 원래 형태로 돌아오고(복원), 복원 중에도 뾰족해지지 않는다', () => {
    const { b } = pullBody(-90, 300);
    b.releaseGrab();
    let worst = 0;
    for (let t = 0; t < 4000; t += 16.67) {
      b.step(16.67);
      worst = Math.max(worst, maxTurnDeg(b));
    }
    expect(worst).toBeLessThan(MAX_TURN + 10);
    expect(b.maxDisplacement()).toBeLessThan(1);
  });

  it('놓으면 한 번 지나쳤다가(출렁임) 돌아온다: 기준선 아래로 5~60px 오버슈트 후 정착', () => {
    const rest = make();
    const restTop = Math.min(...rest.y);
    const { b } = pullBody(-90, 200);
    b.releaseGrab();
    let below = -Infinity;
    for (let t = 0; t < 4000; t += 16.67) {
      b.step(16.67);
      below = Math.max(below, Math.min(...b.y) - restTop);
    }
    expect(below).toBeGreaterThan(5);
    expect(below).toBeLessThan(60);
    expect(b.isSettled(1.5, 20)).toBe(true);
  });

  it('드래그 도중 방향을 바꿔도(원을 그리듯) 꺾임이 커지지 않는다', () => {
    const b = make();
    const top = Math.min(...b.y);
    b.beginGrab(640, top + 30);
    let worst = 0;
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2;
      b.moveGrab(640 + Math.cos(a) * 90, top + 30 - 80 + Math.sin(a) * 60);
      for (let s = 0; s < 3; s++) b.step(16.67);
      worst = Math.max(worst, maxTurnDeg(b));
      expect(b.x.every(Number.isFinite)).toBe(true);
    }
    expect(worst).toBeLessThan(MAX_TURN + 10);
  });
});
