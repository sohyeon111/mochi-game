import { describe, expect, it } from 'vitest';
import { MeshWarp, affineFromTriangles, toStage, type WarpViewData } from '../src/mochi/meshWarp';
import { QUALITY_TIERS, QualityController } from '../src/mochi/quality';
import { MOCHI } from '../src/app/constants';
import mochi from '../public/assets/render/mochi.json';

const views = (mochi as unknown as { views: Record<string, WarpViewData> }).views;
const place = { scale: 0.44, ox: 100, oy: 50 };

describe('메시 워프', () => {
  const warp = new MeshWarp(views['front'] as WarpViewData, place);
  const ringX = warp.ringRest.x.slice();
  const ringY = warp.ringRest.y.slice();

  it('링이 기준 위치면 정점도 기준 위치(항등)', () => {
    warp.update(ringX, ringY);
    for (let i = 0; i < warp.deformed.length; i++) expect(warp.deformed[i]).toBeCloseTo(warp.restStage[i] as number, 6);
  });

  it('링 전체가 평행 이동하면 링 안쪽 정점이 같은 양만큼 이동한다', () => {
    warp.update(ringX.map((v) => v + 30), ringY.map((v) => v - 12));
    // 실루엣 중심 부근 정점(가중치 합 1)을 확인
    const mid = Math.floor((warp.rows / 2) * warp.cols + warp.cols / 2);
    expect((warp.deformed[mid * 2] as number) - (warp.restStage[mid * 2] as number)).toBeCloseTo(30, 3);
    expect((warp.deformed[mid * 2 + 1] as number) - (warp.restStage[mid * 2 + 1] as number)).toBeCloseTo(-12, 3);
  });

  it('위쪽 링 점을 위로 올리면 위쪽 정점이 같이 올라가고 아래쪽 정점은 거의 안 움직인다', () => {
    const ry = ringY.slice();
    ry[0] = (ry[0] as number) - 80; // 링 0번 = 위쪽
    warp.update(ringX, ry);
    const rowOf = (v: number): number => Math.floor(v / warp.cols);
    let upMax = 0;
    let downMax = 0;
    for (let v = 0; v < warp.vertexCount; v++) {
      const dy = (warp.restStage[v * 2 + 1] as number) - (warp.deformed[v * 2 + 1] as number); // 위로 올라간 양
      if (rowOf(v) < warp.rows / 3) upMax = Math.max(upMax, dy);
      if (rowOf(v) > (warp.rows * 2) / 3) downMax = Math.max(downMax, Math.abs(dy));
    }
    expect(upMax).toBeGreaterThan(30);
    expect(downMax).toBeLessThan(3);
  });

  it('눌림(dent)은 눌린 점 주변 정점을 그쪽으로 끌어당긴다', () => {
    warp.update(ringX, ringY, null);
    const base = Float64Array.from(warp.deformed);
    const px = (warp.restStage[100 * 2] as number) + 20;
    const py = warp.restStage[100 * 2 + 1] as number;
    warp.update(ringX, ringY, { x: px, y: py, sigma: 60, amount: 0.2 });
    const d0 = Math.hypot((base[100 * 2] as number) - px, (base[100 * 2 + 1] as number) - py);
    const d1 = Math.hypot((warp.deformed[100 * 2] as number) - px, (warp.deformed[100 * 2 + 1] as number) - py);
    expect(d1).toBeLessThan(d0);
  });

  it('삼각형은 실루엣 근처 셀만 포함하고, stride가 클수록 줄어든다', () => {
    const t1 = warp.triangles(1).length;
    const t2 = warp.triangles(2).length;
    const t4 = warp.triangles(4).length;
    const t6 = warp.triangles(6).length;
    expect(t1).toBeLessThan((warp.cols - 1) * (warp.rows - 1) * 2); // 전체 셀보다 적다(여백 셀 제외)
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t4);
    expect(t4).toBeGreaterThan(t6);
    expect(t6).toBeGreaterThan(0);
  });

  it('모든 삼각형 인덱스가 유효하다', () => {
    for (const s of [1, 2, 3, 4, 6]) for (const t of warp.triangles(s)) for (const i of t) expect(i).toBeLessThan(warp.vertexCount);
  });

  it('스프라이트→논리 좌표 변환', () => {
    expect(toStage(place, 10, 20)).toEqual([100 + 4.4, 50 + 8.8]);
  });
});

describe('어파인 변환', () => {
  it('세 점 대응을 정확히 만족한다', () => {
    const m = affineFromTriangles(0, 0, 10, 0, 0, 10, 5, 5, 25, 15, -5, 35)!;
    const [a, b, c, d, e, f] = m;
    const map = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
    expect(map(0, 0)).toEqual([5, 5]);
    expect(map(10, 0)[0]).toBeCloseTo(25);
    expect(map(10, 0)[1]).toBeCloseTo(15);
    expect(map(0, 10)[0]).toBeCloseTo(-5);
    expect(map(0, 10)[1]).toBeCloseTo(35);
  });
  it('항등 변환', () => {
    const m = affineFromTriangles(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)!;
    expect(m.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it('퇴화(한 줄) 삼각형은 null', () => {
    expect(affineFromTriangles(0, 0, 1, 1, 2, 2, 0, 0, 1, 0, 2, 0)).toBeNull();
  });
});

describe('품질 단계 조절', () => {
  it('프레임이 계속 느리면 단계적으로 낮춘다(최저에서 멈춤)', () => {
    const q = new QualityController();
    expect(q.tierIndex).toBe(0);
    let changes = 0;
    for (let i = 0; i < 2000; i++) if (q.update(30, 30)) changes++;
    expect(changes).toBe(QUALITY_TIERS.length - 1);
    expect(q.tierIndex).toBe(QUALITY_TIERS.length - 1);
  });
  it('처리 시간이 길면(프레임 간격이 정상이어도) 낮춘다', () => {
    const q = new QualityController();
    for (let i = 0; i < 200; i++) q.update(16.7, 28);
    expect(q.tierIndex).toBeGreaterThanOrEqual(1);
  });
  it('낮춘 단계는 삼각형이 더 적다(stride 증가)', () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) expect(QUALITY_TIERS[i]!.stride).toBeGreaterThanOrEqual(QUALITY_TIERS[i - 1]!.stride);
    expect(QUALITY_TIERS[QUALITY_TIERS.length - 1]!.effects).toBe(false);
  });
  it('느린 프레임이 일부(드문)이면 낮추지 않는다', () => {
    const q = new QualityController();
    for (let i = 0; i < 1000; i++) q.update(16.7, i % 10 === 0 ? 30 : 3);
    expect(q.tierIndex).toBe(0);
  });
  it('한 번의 큰 멈춤(100ms 초과)은 무시한다', () => {
    const q = new QualityController();
    for (let i = 0; i < 100; i++) q.update(500, 500);
    expect(q.tierIndex).toBe(0);
  });
  it('vsync(16.7ms) 간격이어도 작업 시간 여유가 있으면 다시 올린다', () => {
    const q = new QualityController(3);
    for (let i = 0; i < MOCHI.QUALITY_UP_FRAMES + 5; i++) q.update(16.7, 1.5);
    expect(q.tierIndex).toBe(2);
  });
  it('한 단계 올렸을 때 예상 작업 시간이 예산을 넘으면 올리지 않는다', () => {
    const q = new QualityController(1);
    for (let i = 0; i < 1000; i++) q.update(16.7, 5); // stride 2→1: 예상 20ms > 예산
    expect(q.tierIndex).toBe(1);
  });
  it('최고 단계에서는 더 올리지 않는다', () => {
    const q = new QualityController(0);
    for (let i = 0; i < 1000; i++) q.update(16.7, 1);
    expect(q.tierIndex).toBe(0);
  });
  it('중간 부하에서는 단계를 유지한다', () => {
    const q = new QualityController(2);
    for (let i = 0; i < 1000; i++) q.update(16.7, 12);
    expect(q.tierIndex).toBe(2);
  });
});

describe('메시 변위 평활화(STRETCH 전용)', () => {
  const place = { scale: 0.44, ox: 0, oy: 0 };
  const make = (): MeshWarp => new MeshWarp(views['front'] as WarpViewData, place);

  it('평활화 0이면 기존 결과와 같다', () => {
    const a = make();
    const b = make();
    const rx = a.ringRest.x.map((x, i) => x + (i % 5 === 0 ? 30 : 0));
    const ry = a.ringRest.y.map((y) => y - 10);
    a.update(rx, ry, null);
    b.update(rx, ry, null, 0);
    expect(Array.from(a.deformed)).toEqual(Array.from(b.deformed));
  });

  it('기준 형태에서는 평활화해도 변하지 않는다', () => {
    const a = make();
    a.update(a.ringRest.x, a.ringRest.y, null, 2);
    for (let i = 0; i < a.deformed.length; i++) expect(Math.abs((a.deformed[i] as number) - (a.restStage[i] as number))).toBeLessThan(1e-9);
  });

  it('한 점만 크게 당겨도 이웃 정점 사이의 변위 차이가 줄어든다', () => {
    const rough = make();
    const smooth = make();
    const rx = [...rough.ringRest.x];
    const ry = [...rough.ringRest.y];
    ry[0] = (ry[0] as number) - 150; // 한 점만 위로
    rough.update(rx, ry, null, 0);
    smooth.update(rx, ry, null, 2);
    const maxStep = (m: MeshWarp): number => {
      let worst = 0;
      for (let r = 0; r < m.rows; r++) {
        for (let c = 0; c < m.cols - 1; c++) {
          const v = r * m.cols + c;
          const w = v + 1;
          const d1 = Math.hypot((m.deformed[v * 2] as number) - (m.restStage[v * 2] as number), (m.deformed[v * 2 + 1] as number) - (m.restStage[v * 2 + 1] as number));
          const d2 = Math.hypot((m.deformed[w * 2] as number) - (m.restStage[w * 2] as number), (m.deformed[w * 2 + 1] as number) - (m.restStage[w * 2 + 1] as number));
          worst = Math.max(worst, Math.abs(d1 - d2));
        }
      }
      return worst;
    };
    expect(maxStep(smooth)).toBeLessThan(maxStep(rough));
    expect(Array.from(smooth.deformed).every(Number.isFinite)).toBe(true);
  });
});
