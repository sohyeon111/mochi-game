// 외곽 링 해상도(32/48/64점)·메시 워프 구조 비교 테스트.
//  - 링 리샘플링/가중치 재계산이 기본 실루엣을 유지하는가
//  - 점 수가 달라도(32/48/64) 같은 방향·거리에서 둥근 끝, 한계 이내의 늘어남, 부피 유지가 되는가
//  - 메시가 링의 변형을 화면 윤곽(렌더링되는 외곽선)에 충실히 전달하는가
//  - 놓은 뒤 복원, 성능
import { describe, expect, it } from 'vitest';
import { MOCHI } from '../src/app/constants';
import { MeshWarp } from '../src/mochi/meshWarp';
import { resolveRingOptions } from '../src/mochi/ringConfig';
import { buildRingWeights, meanValueWeights, resampleRing, withRingResolution } from '../src/mochi/ringResample';
import {
  DIRECTIONS, frontView, makeBody, makeWarp, mappedOutline, maxArcTurnDeg, maxDeviation, perimeter, placement, polylineMaxTurnDeg, pull,
  tipWidthRatio, viewWith,
} from './helpers/stretchHarness';

import rendererSrc from '../src/mochi/mochiRenderer.ts?raw';
import warpSrc from '../src/mochi/meshWarp.ts?raw';
import viewSrc from '../src/mochi/mochiView.ts?raw';

const SOURCES: Record<string, string> = { 'mochiRenderer.ts': rendererSrc, 'meshWarp.ts': warpSrc, 'mochiView.ts': viewSrc };
const NS = [32, 48, 64];

/** 기준과 방향이 반대(또는 면적 0)가 된 삼각형 수: 겹쳐 그려져 각진 면/격자처럼 보이는 원인 */
function foldedTriangles(warp: MeshWarp): number {
  const det = (x: Float64Array, i: number, j: number, k: number): number => (x[j * 2]! - x[i * 2]!) * (x[k * 2 + 1]! - x[i * 2 + 1]!) - (x[k * 2]! - x[i * 2]!) * (x[j * 2 + 1]! - x[i * 2 + 1]!);
  let n = 0;
  for (const [a, b, c] of warp.triangles(1)) if (det(warp.restStage, a, b, c) * det(warp.deformed, a, b, c) <= 0) n++;
  return n;
}
const polyArea = (r: ReadonlyArray<[number, number]>): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as [number, number];
    const q = r[(i + 1) % r.length] as [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
};

describe('링 리샘플링: 기본 둥근 실루엣을 유지한다', () => {
  it('32점이면 mochi.json 링과 가중치를 그대로 쓴다(기존 동작 보존)', () => {
    expect(withRingResolution(frontView, { points: 32 })).toBe(frontView);
    expect(resampleRing(frontView.outlineRing, 32)).toEqual(frontView.outlineRing);
  });

  for (const n of [48, 64]) {
    it(`${n}점: 점 수, 호장 간격, 면적, 원래 링 점과의 거리`, () => {
      const r = resampleRing(frontView.outlineRing, n);
      expect(r.length).toBe(n);
      const edge = r.map((p, i) => Math.hypot((r[(i + 1) % n] as [number, number])[0] - p[0], (r[(i + 1) % n] as [number, number])[1] - p[1]));
      const mean = edge.reduce((a, b) => a + b, 0) / n;
      expect(Math.max(...edge)).toBeLessThan(mean * 1.1); // 점이 한쪽에 몰리지 않는다(호장 등간격)
      expect(Math.min(...edge)).toBeGreaterThan(mean * 0.8);
      // 기본 실루엣(32점 링)과 면적 차이 1% 이내
      expect(Math.abs(polyArea(r) / polyArea(frontView.outlineRing) - 1)).toBeLessThan(0.01);
      // 원래 링의 각 점이 새 링의 윤곽에서 3px(스프라이트) 이내
      for (const [x, y] of frontView.outlineRing) {
        let best = Infinity;
        for (let i = 0; i < n; i++) {
          const p = r[i] as [number, number];
          const q = r[(i + 1) % n] as [number, number];
          const dx = q[0] - p[0];
          const dy = q[1] - p[1];
          const t = Math.min(1, Math.max(0, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)));
          best = Math.min(best, Math.hypot(p[0] + t * dx - x, p[1] + t * dy - y));
        }
        expect(best).toBeLessThan(3);
      }
      // 기본 형태의 꺾임: 한 꼭짓점의 꺾임이 32점 링보다 작거나 같다(더 둥글다)
      const turn = (ring: ReadonlyArray<[number, number]>): number => {
        let m = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[(i + ring.length - 1) % ring.length] as [number, number];
          const c = ring[i] as [number, number];
          const q = ring[(i + 1) % ring.length] as [number, number];
          let d = Math.abs(Math.atan2(q[1] - c[1], q[0] - c[0]) - Math.atan2(c[1] - p[1], c[0] - p[0]));
          if (d > Math.PI) d = 2 * Math.PI - d;
          m = Math.max(m, (d * 180) / Math.PI);
        }
        return m;
      };
      expect(turn(r)).toBeLessThanOrEqual(turn(frontView.outlineRing) + 0.5);
    });
  }
});

describe('워프 가중치 재계산', () => {
  it('mochi.json과 같은 규칙: 32점·감쇠 규칙이면 기존 가중치와 같은 변위를 낸다', () => {
    const ring = frontView.outlineRing;
    const m = frontView.warpMesh;
    const sb = frontView.silhouetteBBox;
    const w = buildRingWeights(ring, m.restVertices, 0.22 * (sb[2] - sb[0]));
    const disp = ring.map((_, i) => [Math.sin(i) * 40, Math.cos(i * 1.7) * 40] as [number, number]);
    let worst = 0;
    for (let v = 0; v < m.restVertices.length; v++) {
      const f = (weights: Array<[number, number]>): [number, number] => weights.reduce((a, [i, k]) => [a[0] + k * (disp[i] as [number, number])[0], a[1] + k * (disp[i] as [number, number])[1]], [0, 0] as [number, number]);
      const a = f(w[v] as Array<[number, number]>);
      const b = f(m.ringWeights[v] as Array<[number, number]>);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    expect(worst).toBeLessThan(0.5); // px(반올림 오차 수준)
  });

  it('링 안쪽 정점의 평균값 좌표는 합이 1이고 링 위의 점은 그 링 점만 따른다', () => {
    const ring = viewWith(48).outlineRing;
    const w = meanValueWeights(ring[5]![0] * 0.5 + ring[29]![0] * 0.5, ring[5]![1] * 0.5 + ring[29]![1] * 0.5, ring);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    const onRing = meanValueWeights(ring[7]![0], ring[7]![1], ring);
    expect(onRing[7]).toBeCloseTo(1, 6);
  });

  it('링 밖 정점은 감쇠 길이가 길수록 덜 줄어든다(합 ≤ 1, 길이 0.6이 0.22보다 크거나 같다)', () => {
    const legacy = withRingResolution(frontView, { points: 48, meshScale: 1.5, decayRatio: 0.22 });
    const long = withRingResolution(frontView, { points: 48, meshScale: 1.5, decayRatio: MOCHI.MESH_DECAY_RATIO });
    const sum = (a: Array<[number, number]>): number => a.reduce((s, [, k]) => s + k, 0);
    let longer = 0;
    for (let i = 0; i < long.warpMesh.restVertices.length; i++) {
      const s1 = sum(long.warpMesh.ringWeights[i] as Array<[number, number]>);
      const s0 = sum(legacy.warpMesh.ringWeights[i] as Array<[number, number]>);
      expect(s1).toBeGreaterThanOrEqual(s0 - 1e-3);
      if (s1 > s0 + 0.05) longer++;
    }
    expect(longer).toBeGreaterThan(0);
  });

  it('원인 확인: mochi.json의 감쇠(0.22)는 최대 당김에서 끝 쪽 셀이 접히고, 0.6은 접히지 않는다', () => {
    const count = (decay: number, ang: number): number => {
      const { b } = pull(MOCHI.RING_POINTS, ang, 400);
      const { warp } = makeWarp(MOCHI.RING_POINTS, MOCHI.MESH_SCALE, decay, true);
      warp.update(b.x, b.y, null, 0); // 평활화 없이: 구조 자체의 접힘만 본다
      return foldedTriangles(warp);
    };
    expect(count(0.22, 180) + count(0.22, -135)).toBeGreaterThan(5);
    for (const [, ang] of DIRECTIONS) expect(count(MOCHI.MESH_DECAY_RATIO, ang)).toBe(0);
  });

  it('메시 배수 1.5: 격자가 같은 범위를 덮고 정점 수가 늘어난다', () => {
    const a = frontView.warpMesh;
    const b = viewWith(48, 1.5).warpMesh;
    expect(b.bounds).toEqual(a.bounds);
    expect(b.restVertices.length).toBe(b.cols * b.rows);
    expect(b.cols * b.rows).toBeGreaterThan(a.cols * a.rows * 2);
    expect(b.restVertices[0]).toEqual([a.bounds[0], a.bounds[1]]);
    expect(b.restVertices.at(-1)).toEqual([a.bounds[2], a.bounds[3]]);
  });
});

describe('설정: 기본값과 개발용 비교 주소', () => {
  it('기본 해상도는 constants의 값이다', () => {
    const o = resolveRingOptions('');
    expect(o.points).toBe(MOCHI.RING_POINTS);
    expect(o.meshScale).toBe(MOCHI.MESH_SCALE);
  });
  it('개발 모드에서 ?ring=64&mesh=2 로 덮어쓸 수 있고, 잘못된 값은 무시한다', () => {
    expect(resolveRingOptions('?ring=64&mesh=2')).toMatchObject({ points: 64, meshScale: 2 });
    expect(resolveRingOptions('?ring=7&mesh=9')).toMatchObject({ points: MOCHI.RING_POINTS, meshScale: MOCHI.MESH_SCALE });
  });
});

describe('32/48/64점 비교: 방향·거리별 변형 형태', () => {
  for (const n of NS) {
    describe(`${n}점`, () => {
      const per = perimeter(makeBody(n));
      for (const [name, ang] of DIRECTIONS) {
        for (const dist of [120, 400]) {
          it(`${name} ${dist}px${dist >= 400 ? '(최대 변형)' : ''}: 둥근 끝, 한계 이내, 부피 유지, 윤곽 연속`, () => {
            const { b, ux, uy, rest } = pull(n, ang, dist);
            expect(b.x.every(Number.isFinite) && b.y.every(Number.isFinite)).toBe(true);
            // 점 수와 무관한 꺾임(호장 6% 기준): 위/대각선 70°, 옆 당김 100° 미만(둥근 끝이라도 호장 창에 따라 90° 안팎)
            expect(maxArcTurnDeg(b, per)).toBeLessThan(Math.abs(ux) > 0.9 ? 100 : 90);
            expect(tipWidthRatio(b, ux, uy) / tipWidthRatio(rest, ux, uy)).toBeGreaterThan(0.45);
            expect(Math.abs(b.areaRatio() - 1)).toBeLessThan(0.14);
            expect(b.currentStretchRatio()).toBeLessThanOrEqual(1.0 + 1e-6);
            if (dist >= 400) expect(b.currentStretchRatio()).toBeGreaterThan(0.88); // 늘어나는 느낌이 이전(≈0.8)보다 약해지지 않는다
            // 몸통과 끝 사이: 인접 점의 이동량이 급하게 변하지 않는다
            const mag = b.x.map((x, i) => Math.hypot(x - (rest.x[i] as number), (b.y[i] as number) - (rest.y[i] as number)));
            const mx = Math.max(...mag);
            let jump = 0;
            for (let i = 0; i < b.n; i++) jump = Math.max(jump, Math.abs((mag[i] as number) - (mag[(i + 1) % b.n] as number)));
            expect(jump / mx).toBeLessThan(0.4);
          });
        }
      }
    });
  }

  it('점 수가 달라도 같은 모양이다(점 수에 의존하지 않는 지표가 서로 가깝다)', () => {
    for (const [, ang] of DIRECTIONS) {
      const per = perimeter(makeBody(32));
      const rows = NS.map((n) => {
        const { b, ux, uy, rest } = pull(n, ang, 400);
        return { t: maxArcTurnDeg(b, per), w: tipWidthRatio(b, ux, uy) / tipWidthRatio(rest, ux, uy), r: b.currentStretchRatio(), a: b.areaRatio() };
      });
      const span = (k: 't' | 'w' | 'r' | 'a'): number => Math.max(...rows.map((o) => o[k])) - Math.min(...rows.map((o) => o[k]));
      expect(span('t')).toBeLessThan(14);
      expect(span('w')).toBeLessThan(0.08);
      expect(span('r')).toBeLessThan(0.06);
      expect(span('a')).toBeLessThan(0.03);
    }
  });

  it('점이 촘촘할수록 인접 점의 이동량 변화가 부드럽다(32 ≥ 48 ≥ 64)', () => {
    const jumps = NS.map((n) => {
      let s = 0;
      for (const [, ang] of DIRECTIONS) {
        const { b, rest } = pull(n, ang, 400);
        const mag = b.x.map((x, i) => Math.hypot(x - (rest.x[i] as number), (b.y[i] as number) - (rest.y[i] as number)));
        const mx = Math.max(...mag);
        let j = 0;
        for (let i = 0; i < b.n; i++) j = Math.max(j, Math.abs((mag[i] as number) - (mag[(i + 1) % b.n] as number)));
        s += j / mx;
      }
      return s / DIRECTIONS.length;
    });
    expect(jumps[1]).toBeLessThan(jumps[0] as number);
    expect(jumps[2]).toBeLessThan(jumps[1] as number);
  });
});

describe('책상에 붙은 쪽: 옆으로 당겨도 쐐기가 되지 않는다', () => {
  it('왼쪽으로 당기면 윗면이 책상 쪽으로 내려오고 끝 높이(단면)가 유지된다', () => {
    const { b, rest } = pull(MOCHI.RING_POINTS, 180, 400);
    expect(Math.max(...b.y)).toBeLessThanOrEqual(MOCHI.FRONT_GROUND_Y + 0.5);
    // 낮아졌지만(옆으로 늘어난 만큼) 완전히 납작해지지 않는다
    const h = Math.max(...b.y) - Math.min(...b.y);
    const h0 = Math.max(...rest.y) - Math.min(...rest.y);
    expect(h).toBeLessThan(h0);
    expect(h).toBeGreaterThan(h0 * 0.55);
    // 책상에 붙은 점은 옆으로 미끄러져 바닥이 넓어진다
    expect(Math.min(...b.x)).toBeLessThan(Math.min(...rest.x) - 100);
  });
});

describe('메시 워프: 링의 변형이 화면 윤곽에 충실히 전달된다', () => {
  const cases: Array<[string, number]> = [['위', -90], ['왼쪽 위', -135], ['왼쪽', 180]];
  for (const [name, ang] of cases) {
    it(`${name} 최대 당김: 렌더 윤곽이 링에서 크게 벗어나지 않고 꺾임도 링 수준이다`, () => {
      const n = MOCHI.RING_POINTS;
      const { b } = pull(n, ang, 400);
      const ringPts = b.x.map((x, i) => [x, b.y[i]] as [number, number]);
      const fine = makeWarp(n, MOCHI.MESH_SCALE, MOCHI.MESH_DECAY_RATIO, true);
      fine.warp.update(b.x, b.y, null, MOCHI.STRETCH_MESH_SMOOTH_PASSES);
      const old = makeWarp(32, 1);
      const oldBody = pull(32, ang, 400).b;
      old.warp.update(oldBody.x, oldBody.y, null, MOCHI.STRETCH_MESH_SMOOTH_PASSES);
      const devNew = maxDeviation(mappedOutline(fine.warp, fine.view), ringPts);
      const devOld = maxDeviation(mappedOutline(old.warp, old.view), oldBody.x.map((x, i) => [x, oldBody.y[i]] as [number, number]));
      expect(devNew).toBeLessThan(devOld * 0.75); // 기존(22×18, 감쇠 있음) 35~46px → 약 20~25px
      expect(devNew).toBeLessThan(28);
      const turnRender = polylineMaxTurnDeg(mappedOutline(fine.warp, fine.view));
      const turnRing = polylineMaxTurnDeg(ringPts);
      expect(turnRender).toBeLessThan(turnRing + 12);
      expect(turnRender).toBeLessThan(105);
    });
  }

  it('삼각형이 뒤집히거나 접히지 않는다(모든 방향 최대 당김, 평활화 유무와 무관)', () => {
    const n = MOCHI.RING_POINTS;
    for (const [, ang] of DIRECTIONS) {
      const { b } = pull(n, ang, 400);
      for (const passes of [0, MOCHI.STRETCH_MESH_SMOOTH_PASSES]) {
        const { warp } = makeWarp(n, MOCHI.MESH_SCALE, MOCHI.MESH_DECAY_RATIO, true);
        warp.update(b.x, b.y, null, passes);
        expect(foldedTriangles(warp)).toBe(0);
      }
    }
  });

  /** 실제로 그려지는 인접 셀(텍스처가 있는 실루엣 근처)끼리 면적 늘어남 비율의 최대 차이(상대) */
  const maxCellScaleJump = (warp: MeshWarp): number => {
    const { cols, rows } = warp;
    const area = (x: Float64Array, i: number): number => {
      const idx = [i, i + 1, i + cols + 1, i + cols];
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const p = idx[k] as number;
        const q = idx[(k + 1) % 4] as number;
        s += (x[p * 2] as number) * (x[q * 2 + 1] as number) - (x[q * 2] as number) * (x[p * 2 + 1] as number);
      }
      return Math.abs(s / 2);
    };
    const scale = (r: number, c: number): number => area(warp.deformed, r * cols + c) / area(warp.restStage, r * cols + c);
    const drawn = new Set<number>();
    for (const [a] of warp.triangles(1)) drawn.add(a);
    let worst = 0;
    for (let r = 0; r < rows - 2; r++) {
      for (let c = 0; c < cols - 2; c++) {
        if (![r * cols + c, r * cols + c + 1, (r + 1) * cols + c].every((i) => drawn.has(i))) continue;
        const s0 = scale(r, c);
        const sr = scale(r, c + 1);
        const sd = scale(r + 1, c);
        worst = Math.max(worst, Math.abs(s0 - sr) / Math.max(s0, sr), Math.abs(s0 - sd) / Math.max(s0, sd));
      }
    }
    return worst;
  };

  it('인접 셀의 늘어남 정도가 급격히 달라지지 않는다(특정 셀에 변형이 집중되지 않는다): 기존 구성보다 고르다', () => {
    for (const ang of [-90, 180]) {
      const n = MOCHI.RING_POINTS;
      const { b } = pull(n, ang, 400);
      const now = makeWarp(n, MOCHI.MESH_SCALE, MOCHI.MESH_DECAY_RATIO, true);
      now.warp.update(b.x, b.y, null, MOCHI.STRETCH_MESH_SMOOTH_PASSES);
      const old = makeWarp(32, 1);
      const ob = pull(32, ang, 400).b;
      old.warp.update(ob.x, ob.y, null, 0); // 기존: 32점, 22×18, 감쇠 0.22, 평활화 없음
      expect(maxCellScaleJump(now.warp)).toBeLessThan(maxCellScaleJump(old.warp));
      expect(maxCellScaleJump(now.warp)).toBeLessThan(0.5);
    }
  });

  it('렌더 코드에 메시 격자를 그리는 디버그 표시가 없다(선 긋기/테두리 호출 없음)', () => {
    for (const f of ['mochiRenderer.ts', 'meshWarp.ts', 'mochiView.ts']) {
      const src = SOURCES[f] as string;
      expect(src, f).not.toMatch(/\.stroke\(|strokeRect|strokeStyle/);
    }
  });
});

describe('놓은 뒤 복원과 성능', () => {
  for (const n of NS) {
    it(`${n}점: 최대 당김을 놓으면 접힘 없이 원래 형태로 돌아온다`, () => {
      const per = perimeter(makeBody(n));
      const { b, rest } = pull(n, -90, 400);
      b.releaseGrab();
      let worst = 0;
      let settledAt = -1;
      for (let t = 0; t < 5000; t += 16.67) {
        b.step(16.67);
        worst = Math.max(worst, maxArcTurnDeg(b, per));
        if (settledAt < 0 && b.isSettled()) settledAt = t;
      }
      expect(worst).toBeLessThan(85);
      expect(settledAt).toBeGreaterThan(0);
      expect(settledAt).toBeLessThan(3000);
      for (let i = 0; i < b.n; i++) expect(Math.hypot(b.x[i]! - rest.x[i]!, b.y[i]! - rest.y[i]!)).toBeLessThan(2);
    });
  }

  it('좌우로 당겼다 놓아도 접힘 없이 복원된다', () => {
    const n = MOCHI.RING_POINTS;
    const per = perimeter(makeBody(n));
    const { b, rest } = pull(n, 180, 400);
    b.releaseGrab();
    let worst = 0;
    for (let t = 0; t < 5000; t += 16.67) {
      b.step(16.67);
      worst = Math.max(worst, maxArcTurnDeg(b, per));
    }
    expect(worst).toBeLessThan(90);
    expect(b.isSettled()).toBe(true);
    for (let i = 0; i < b.n; i++) expect(Math.hypot(b.x[i]! - rest.x[i]!, b.y[i]! - rest.y[i]!)).toBeLessThan(2);
  });

  it('64점에서도 소프트바디 한 프레임(2 서브스텝)이 충분히 빠르다(< 1ms)', () => {
    const b = makeBody(64);
    const top = Math.min(...b.y);
    b.beginGrab(640, top + 30);
    b.moveGrab(680, top - 250);
    for (let i = 0; i < 60; i++) b.step(16.67); // 예열
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) b.step(16.67);
    expect((performance.now() - t0) / 300).toBeLessThan(1);
  });

  it('메시 갱신은 1.5배 격자·48점에서도 프레임당 1ms 미만, 삼각형 수는 3000 이하', () => {
    const n = MOCHI.RING_POINTS;
    const { b } = pull(n, -90, 400);
    const view = withRingResolution(frontView, { points: n, meshScale: MOCHI.MESH_SCALE, decayRatio: MOCHI.MESH_DECAY_RATIO });
    const warp = new MeshWarp(view, placement(view));
    for (let i = 0; i < 30; i++) warp.update(b.x, b.y, null, 2);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) warp.update(b.x, b.y, null, 2);
    expect((performance.now() - t0) / 200).toBeLessThan(1);
    expect(warp.triangles(1).length * 3).toBeLessThanOrEqual(3000);
  });
});

describe('TOUCH(누르기)는 링 해상도와 무관하게 같은 반응을 한다', () => {
  const pressRun = (n: number, edge: boolean): { disp: number; area: number; settleMs: number } => {
    const b = makeBody(n);
    const cx = (Math.min(...b.x) + Math.max(...b.x)) / 2;
    const midY = (Math.min(...b.y) + Math.max(...b.y)) / 2;
    b.setPress(edge ? Math.max(...b.x) - 5 : cx, midY);
    for (let t = 0; t < 700; t += 16.67) b.step(16.67);
    const disp = b.maxDisplacement();
    const area = b.areaRatio();
    b.releasePress();
    let settleMs = -1;
    for (let t = 0; t < 5000; t += 16.67) {
      b.step(16.67);
      if (settleMs < 0 && b.isSettled()) settleMs = t;
    }
    return { disp, area, settleMs };
  };

  for (const edge of [true, false]) {
    it(`${edge ? '가장자리' : '중앙'} 누르기: 32/48/64점의 변위·면적·정착 시간이 비슷하다`, () => {
      const r = NS.map((n) => pressRun(n, edge));
      const span = (k: 'disp' | 'area' | 'settleMs'): number => Math.max(...r.map((o) => o[k])) - Math.min(...r.map((o) => o[k]));
      expect(r.every((o) => o.settleMs > 0)).toBe(true);
      expect(span('disp')).toBeLessThan(Math.max(...r.map((o) => o.disp)) * 0.2);
      expect(span('area')).toBeLessThan(0.03);
      expect(span('settleMs')).toBeLessThan(900);
    });
  }
});

describe('적응형 메시: 윤곽 근처만 세밀, 안쪽은 합친다(갈라짐 없이)', () => {
  const { warp, view } = makeWarp(MOCHI.RING_POINTS, MOCHI.MESH_SCALE, MOCHI.MESH_DECAY_RATIO, true);
  const cell = (view.warpMesh.bounds[2] - view.warpMesh.bounds[0]) / (view.warpMesh.cols - 1);
  const band = MOCHI.MESH_BAND_CELLS * cell;
  const full = warp.triangles(1);
  const adaptive = warp.adaptiveTriangles(band);
  const area = (t: readonly [number, number, number]): number => {
    const x = warp.restStage;
    const [a, b, c] = t;
    return Math.abs(((x[b * 2] as number) - (x[a * 2] as number)) * ((x[c * 2 + 1] as number) - (x[a * 2 + 1] as number)) - ((x[c * 2] as number) - (x[a * 2] as number)) * ((x[b * 2 + 1] as number) - (x[a * 2 + 1] as number))) / 2;
  };

  it('칸 수가 짝수(2×2 합치기 가능)이고 삼각형이 전체보다 적다', () => {
    expect((warp.cols - 1) % 2).toBe(0);
    expect((warp.rows - 1) % 2).toBe(0);
    expect(adaptive.length).toBeLessThan(full.length * 0.9);
    expect(adaptive.length).toBeGreaterThan(full.length * 0.4);
  });

  it('기준 형태에서 덮는 면적이 전체 셀과 같다(빠지거나 겹치는 곳이 없다)', () => {
    const sum = (ts: ReadonlyArray<readonly [number, number, number]>): number => ts.reduce((a, t) => a + area(t), 0);
    expect(sum(adaptive)).toBeCloseTo(sum(full), 3);
  });

  it('갈라짐(T-접합)이 없다: 어떤 정점도 다른 삼각형의 변 한가운데에 놓이지 않는다', () => {
    const x = warp.restStage;
    const used = new Set<number>();
    for (const t of adaptive) t.forEach((i) => used.add(i));
    let bad = 0;
    for (const [a, b, c] of adaptive) {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const px = x[p * 2] as number;
        const py = x[p * 2 + 1] as number;
        const dx = (x[q * 2] as number) - px;
        const dy = (x[q * 2 + 1] as number) - py;
        const len2 = dx * dx + dy * dy;
        for (const v of used) {
          if (v === p || v === q) continue;
          const t = (((x[v * 2] as number) - px) * dx + ((x[v * 2 + 1] as number) - py) * dy) / len2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          const dist = Math.abs(((x[v * 2] as number) - px) * dy - ((x[v * 2 + 1] as number) - py) * dx) / Math.sqrt(len2);
          if (dist < 1e-6) bad++;
        }
      }
    }
    expect(bad).toBe(0);
  });

  it('최대 당김에서도 접히지 않고, 세밀한 전체 메시와 정점 위치가 같다(같은 정점을 쓴다)', () => {
    for (const [, ang] of DIRECTIONS) {
      const { b } = pull(MOCHI.RING_POINTS, ang, 400);
      warp.update(b.x, b.y, null, MOCHI.STRETCH_MESH_SMOOTH_PASSES);
      const det = (i: number, j: number, k: number, x: Float64Array): number => ((x[j * 2] as number) - (x[i * 2] as number)) * ((x[k * 2 + 1] as number) - (x[i * 2 + 1] as number)) - ((x[k * 2] as number) - (x[i * 2] as number)) * ((x[j * 2 + 1] as number) - (x[i * 2 + 1] as number));
      let flipped = 0;
      for (const [a, c, d] of adaptive) if (det(a, c, d, warp.restStage) * det(a, c, d, warp.deformed) <= 0) flipped++;
      expect(flipped).toBe(0);
    }
  });

  it('윤곽 근처(링 위의 기준점)는 모두 세밀한 삼각형이 덮는다', () => {
    // 기준 윤곽 위 점이 속한 격자 칸은 합친 덩어리의 일부가 아니다 = 그 칸의 모든 정점이 삼각형에 쓰인다
    const used = new Set<number>();
    for (const t of adaptive) t.forEach((i) => used.add(i));
    const { cols } = warp;
    const [bx0, by0, bx1, by1] = view.warpMesh.bounds;
    for (const [sx, sy] of resampleRing(view.outlineRing, 120)) {
      const c = Math.min(view.warpMesh.cols - 2, Math.floor(((sx - bx0) / (bx1 - bx0)) * (cols - 1)));
      const r = Math.min(view.warpMesh.rows - 2, Math.floor(((sy - by0) / (by1 - by0)) * (view.warpMesh.rows - 1)));
      for (const i of [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1]) expect(used.has(i)).toBe(true);
    }
  });
});

describe('MeshWarp.update 최적화(가중치 CSR 배열): 원래 계산과 같은 결과', () => {
  it('무작위 링 변위에서 정점 위치가 가중치 정의대로의 직접 계산과 같다', () => {
    const { warp, view } = makeWarp(MOCHI.RING_POINTS, MOCHI.MESH_SCALE, MOCHI.MESH_DECAY_RATIO, true);
    const rest = warp.ringRest;
    const rx = rest.x.map((x, i) => x + Math.sin(i * 1.3) * 35);
    const ry = rest.y.map((y, i) => y + Math.cos(i * 0.7) * 35);
    warp.update(rx, ry, null, 0);
    for (let v = 0; v < warp.vertexCount; v += 7) {
      let dx = 0;
      let dy = 0;
      for (const [i, w] of view.warpMesh.ringWeights[v] as Array<[number, number]>) {
        dx += w * ((rx[i] as number) - (rest.x[i] as number));
        dy += w * ((ry[i] as number) - (rest.y[i] as number));
      }
      expect(warp.deformed[v * 2]).toBeCloseTo((warp.restStage[v * 2] as number) + dx, 6);
      expect(warp.deformed[v * 2 + 1]).toBeCloseTo((warp.restStage[v * 2 + 1] as number) + dy, 6);
    }
  });
});
