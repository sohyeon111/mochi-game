// 손가락 접촉을 기존 소프트바디(48점 링)에 전달: 국소 눌림, 여러 손가락, 방향성 있는 밀기, 원 그리기 출렁임, 복원, 안정성. TOUCH 마우스 입력은 그대로.
import { describe, expect, it } from 'vitest';
import { MOCHI } from '../src/app/constants';
import { SoftBody } from '../src/mochi/softBody';
import { makeBody, maxArcTurnDeg, perimeter } from './helpers/stretchHarness';

/** TOUCH와 같은 조건의 몸: 바닥 고정, 위쪽 제한 없음 */
function touchBody(): SoftBody {
  const s = makeBody(MOCHI.RING_POINTS);
  const b = new SoftBody(s.rx, s.ry, { groundY: MOCHI.FRONT_GROUND_Y, pinBand: MOCHI.PIN_BAND, topLimitY: -Infinity });
  return b;
}
const bbox = (b: SoftBody): { x0: number; x1: number; y0: number; y1: number; cx: number; cy: number } => ({
  x0: Math.min(...b.rx), x1: Math.max(...b.rx), y0: Math.min(...b.ry), y1: Math.max(...b.ry), cx: (Math.min(...b.rx) + Math.max(...b.rx)) / 2, cy: (Math.min(...b.ry) + Math.max(...b.ry)) / 2,
});
const contact = (id: number, x: number, y: number, vx = 0, vy = 0, amount = 0.9): { id: number; active: boolean; x: number; y: number; vx: number; vy: number; amount: number } => ({ id, active: true, x, y, vx, vy, amount });
const step = (b: SoftBody, ms: number): void => {
  for (let t = 0; t < ms; t += 16.67) b.step(16.67);
};
const disp = (b: SoftBody): number[] => b.x.map((x, i) => Math.hypot(x - (b.rx[i] as number), (b.y[i] as number) - (b.ry[i] as number)));

describe('손가락 하나로 누르기: 작은 영역만 눌린다', () => {
  it('오른쪽 가장자리를 콕 누르면 가까운 점만 움푹 들어가고 먼 점은 거의 움직이지 않는다', () => {
    const b = touchBody();
    const bb = bbox(b);
    const px = bb.x1 - 4;
    const py = bb.cy;
    for (let k = 0; k < 40; k++) {
      b.setFingerContacts([contact(1, px, py)]);
      b.step(16.67);
    }
    const d = disp(b);
    let nearMax = 0;
    let farMax = 0;
    b.rx.forEach((x, i) => {
      const dist = Math.hypot(x - px, (b.ry[i] as number) - py);
      if (dist < 40) nearMax = Math.max(nearMax, d[i] as number);
      if (dist > 110 && dist < 400) farMax = Math.max(farMax, d[i] as number); // 반대편 끝은 면적 보존으로 부풀 수 있어 제외
    });
    expect(nearMax).toBeGreaterThan(8); // 눈에 띄게 들어간다
    expect(farMax).toBeLessThan(nearMax * 0.2); // 중간 거리 이후는 거의 움직이지 않는다(국소적)
    // 안쪽(중심 쪽)으로 들어갔다
    const i0 = b.rx.reduce((best, x, i) => (Math.hypot(x - px, (b.ry[i] as number) - py) < Math.hypot((b.rx[best] as number) - px, (b.ry[best] as number) - py) ? i : best), 0);
    expect(b.x[i0] as number).toBeLessThan(b.rx[i0] as number);
  });

  it('반대편이 부푸는 정도도 마우스 눌림보다 작다(눌림이 국소적이라 면적 보상이 작다)', () => {
    const f = touchBody();
    const m = touchBody();
    const bb = bbox(f);
    for (let k = 0; k < 40; k++) {
      f.setFingerContacts([contact(1, bb.x1 - 4, bb.cy)]);
      f.step(16.67);
      m.setPress(bb.x1 - 4, bb.cy);
      m.step(16.67);
    }
    expect(Math.min(...f.x)).toBeGreaterThan(Math.min(...m.x));
  });

  it('마우스 눌림(기존)보다 눌리는 반경이 작다', () => {
    const f = touchBody();
    const m = touchBody();
    const bb = bbox(f);
    const px = bb.x1 - 4;
    for (let k = 0; k < 40; k++) {
      f.setFingerContacts([contact(1, px, bb.cy)]);
      f.step(16.67);
      m.setPress(px, bb.cy);
      m.step(16.67);
    }
    const count = (b: SoftBody): number => disp(b).filter((v) => v > 3).length;
    expect(count(f)).toBeLessThan(count(m));
  });
});

describe('손가락 여러 개 동시에', () => {
  it('서로 다른 두 위치를 동시에 누르면 각각 눌린다', () => {
    const b = touchBody();
    const bb = bbox(b);
    for (let k = 0; k < 40; k++) {
      b.setFingerContacts([contact(1, bb.x1 - 4, bb.cy), contact(2, bb.x0 + 4, bb.cy)]);
      b.step(16.67);
    }
    const d = disp(b);
    const near = (px: number, py: number): number => Math.max(...b.rx.map((x, i) => (Math.hypot(x - px, (b.ry[i] as number) - py) < 40 ? (d[i] as number) : 0)));
    expect(near(bb.x1 - 4, bb.cy)).toBeGreaterThan(6);
    expect(near(bb.x0 + 4, bb.cy)).toBeGreaterThan(6);
    expect(b.fingerPoints([])).toBe(2);
  });

  it('최대 5개까지 처리하고 범위 밖 번호는 무시한다', () => {
    const b = touchBody();
    const bb = bbox(b);
    b.setFingerContacts([0, 1, 2, 3, 4, 5, 9].map((id) => contact(id, bb.cx + id * 20, bb.cy)));
    step(b, 200);
    expect(b.fingerPoints([])).toBe(5);
    expect(b.x.every(Number.isFinite)).toBe(true);
  });
});

describe('손가락을 움직이면(주무르기) 방향을 따라 밀린다', () => {
  it('왼쪽으로 움직이는 손가락을 따라 가까운 윤곽이 왼쪽으로 밀리고, 오른쪽이면 반대', () => {
    for (const dir of [-1, 1]) {
      const b = touchBody();
      const bb = bbox(b);
      const x = bb.cx;
      const y = bb.cy;
      let before = 0;
      b.x.forEach((v, i) => (before += Math.abs(v - (b.rx[i] as number))));
      for (let k = 0; k < 30; k++) {
        b.setFingerContacts([contact(1, x + dir * k * 4, y, dir * 500, 0, 0.8)]);
        b.step(16.67);
      }
      const shift = b.x.reduce((a, v, i) => a + (v - (b.rx[i] as number)), 0) / b.n; // 평균 이동
      expect(shift * dir).toBeGreaterThan(0.5);
      expect(before).toBe(0);
    }
  });

  it('손가락 속도가 클수록 더 크게 밀린다', () => {
    const run = (v: number): number => {
      const b = touchBody();
      const bb = bbox(b);
      for (let k = 0; k < 20; k++) {
        b.setFingerContacts([contact(1, bb.cx, bb.cy, v, 0, 0.8)]);
        b.step(16.67);
      }
      return b.x.reduce((a, x) => a + x, 0) / b.n - b.rx.reduce((a, x) => a + x, 0) / b.n; // 평균 이동(오른쪽 +)
    };
    expect(run(900)).toBeGreaterThan(run(300));
    expect(run(300)).toBeGreaterThan(run(0) + 0.05);
  });

  it('원을 그리며 반복해서 움직이면 계속 출렁이지만 윤곽이 접히거나 폭주하지 않는다', () => {
    const b = touchBody();
    const bb = bbox(b);
    const per = perimeter(b);
    let worst = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let k = 0; k < 300; k++) {
      const a = k / 12;
      const x = bb.cx + 140 * Math.cos(a);
      const y = bb.cy + 100 * Math.sin(a);
      b.setFingerContacts([contact(1, x, y, -140 * Math.sin(a) * (60 / 12), 100 * Math.cos(a) * (60 / 12), 0.75)]);
      b.step(16.67);
      worst = Math.max(worst, maxArcTurnDeg(b, per));
      const mx = b.x.reduce((s, v) => s + v, 0) / b.n;
      minX = Math.min(minX, mx);
      maxX = Math.max(maxX, mx);
      expect(b.x.every(Number.isFinite)).toBe(true);
    }
    expect(maxX - minX).toBeGreaterThan(1); // 출렁인다(중심이 흔들린다)
    expect(worst).toBeLessThan(100); // 삼각형으로 접히지 않는다
    expect(Math.abs(b.areaRatio() - 1)).toBeLessThan(0.2);
  });

  it('손가락이 아주 빠르게 움직여도(속도 상한) 이웃 간격이 한계를 넘지 않고 유한하다', () => {
    const b = touchBody();
    const bb = bbox(b);
    for (let k = 0; k < 120; k++) {
      const x = bb.cx + (k % 2 ? 300 : -300);
      b.setFingerContacts([contact(1, x, bb.cy, (k % 2 ? 1 : -1) * 20000, 0, 1)]); // 비현실적으로 큰 속도
      b.step(16.67);
    }
    expect(b.x.every(Number.isFinite) && b.y.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < b.n; i++) {
      const j = (i + 1) % b.n;
      const L = Math.hypot((b.rx[j] as number) - (b.rx[i] as number), (b.ry[j] as number) - (b.ry[i] as number));
      const cur = Math.hypot((b.x[j] as number) - (b.x[i] as number), (b.y[j] as number) - (b.y[i] as number));
      expect(cur).toBeLessThan(L * MOCHI.MAX_EDGE_RATIO * 1.2);
    }
    expect(Math.max(...b.y)).toBeLessThanOrEqual(MOCHI.FRONT_GROUND_Y + 0.5); // 책상 아래로 내려가지 않는다
  });
});

describe('손가락을 떼면 복원된다', () => {
  it('눌렀다 떼면 3초 안에 원래 형태로 돌아와 정지하고, 복원 중에도 접히지 않는다', () => {
    const b = touchBody();
    const bb = bbox(b);
    const per = perimeter(b);
    for (let k = 0; k < 60; k++) {
      b.setFingerContacts([contact(1, bb.x1 - 4, bb.cy, -200, 40, 0.9), contact(2, bb.cx, bb.y0 + 10, 0, 300, 0.9)]);
      b.step(16.67);
    }
    expect(Math.max(...disp(b))).toBeGreaterThan(8);
    b.setFingerContacts([]);
    let worst = 0;
    let settledAt = -1;
    for (let t = 0; t < 5000; t += 16.67) {
      b.setFingerContacts([]);
      b.step(16.67);
      worst = Math.max(worst, maxArcTurnDeg(b, per));
      if (settledAt < 0 && b.isSettled()) settledAt = t;
    }
    expect(settledAt).toBeGreaterThan(0);
    expect(settledAt).toBeLessThan(3500);
    expect(worst).toBeLessThan(90);
    expect(Math.max(...disp(b))).toBeLessThan(2);
    expect(b.fingerPoints([])).toBe(0);
  });

  it('active가 아닌(꺼진) 접촉은 눌림 목표가 0이라 서서히 풀린다', () => {
    const b = touchBody();
    const bb = bbox(b);
    for (let k = 0; k < 30; k++) {
      b.setFingerContacts([contact(1, bb.x1 - 4, bb.cy)]);
      b.step(16.67);
    }
    expect(b.hasFingers).toBe(true);
    b.setFingerContacts([{ ...contact(1, bb.x1 - 4, bb.cy), active: false }]);
    step(b, 1500);
    expect(b.hasFingers).toBe(false);
  });
});

describe('기존 마우스 누르기는 그대로', () => {
  it('손가락 접촉이 없으면 setPress 결과가 이전과 같다(손가락 코드가 영향을 주지 않는다)', () => {
    const a = touchBody();
    const b = touchBody();
    const bb = bbox(a);
    for (let k = 0; k < 60; k++) {
      a.setPress(bb.x1 - 10, bb.cy);
      a.step(16.67);
      b.setPress(bb.x1 - 10, bb.cy);
      b.setFingerContacts([]); // 호출해도 아무 영향이 없어야 한다
      b.step(16.67);
    }
    expect(b.x).toEqual(a.x);
    expect(b.y).toEqual(a.y);
  });

  it('마우스와 손가락이 동시에 눌러도 서로 독립적으로 적용된다', () => {
    const b = touchBody();
    const bb = bbox(b);
    for (let k = 0; k < 40; k++) {
      b.setPress(bb.x0 + 6, bb.cy);
      b.setFingerContacts([contact(1, bb.x1 - 4, bb.cy)]);
      b.step(16.67);
    }
    const d = disp(b);
    const near = (px: number): number => Math.max(...b.rx.map((x, i) => (Math.abs(x - px) < 40 ? (d[i] as number) : 0)));
    expect(near(bb.x0)).toBeGreaterThan(6);
    expect(near(bb.x1)).toBeGreaterThan(6);
  });
});
