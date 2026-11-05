// 외곽 링 해상도 변경: mochi.json의 32점 링을 N점으로 다시 뽑고, 워프 메시 가중치를 새 링 기준으로 다시 계산한다.
// 순수 로직(DOM 없음). 에셋(Blender 렌더·mochi.json)은 수정하지 않고 런타임에 파생한다.
//  - 링: 32점을 지나는 닫힌 Catmull-Rom 곡선(centripetal)을 호장(arc length) 기준 등간격으로 N점 샘플링 → 기본 실루엣이 그대로 둥글다.
//  - 가중치: scripts/blender/build_asset_data.py 와 같은 규칙(안쪽 = 평균값 좌표, 바깥 = 가장 가까운 구간 + 거리 감쇠)을 옮겨 왔다.
import type { WarpViewData } from './meshWarp';

type Pt = [number, number];

/** 닫힌 곡선(Catmull-Rom, centripetal)을 촘촘히(구간당 steps개) 샘플링한다. 원래 점은 항상 포함된다 */
function denseClosedSpline(ring: readonly Pt[], steps: number): Pt[] {
  const n = ring.length;
  const out: Pt[] = [];
  const knot = (a: Pt, b: Pt, t: number): number => t + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i + n - 1) % n] as Pt;
    const p1 = ring[i] as Pt;
    const p2 = ring[(i + 1) % n] as Pt;
    const p3 = ring[(i + 2) % n] as Pt;
    const t0 = 0;
    const t1 = knot(p0, p1, t0);
    const t2 = knot(p1, p2, t1);
    const t3 = knot(p2, p3, t2);
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      // Barry–Goldman 피라미드 공식
      const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
        const d = tb - ta || 1e-9;
        return [((tb - t) / d) * a[0] + ((t - ta) / d) * b[0], ((tb - t) / d) * a[1] + ((t - ta) / d) * b[1]];
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

/** 닫힌 링을 n점으로 다시 뽑는다(호장 등간격, 시작점은 원래 0번 점). n이 같으면 원본 그대로 돌려준다 */
export function resampleRing(ring: readonly Pt[], n: number): Pt[] {
  if (n === ring.length) return ring.map((p) => [p[0], p[1]] as Pt);
  const dense = denseClosedSpline(ring, 24);
  const m = dense.length;
  const cum: number[] = [0];
  for (let i = 0; i < m; i++) {
    const a = dense[i] as Pt;
    const b = dense[(i + 1) % m] as Pt;
    cum.push((cum[i] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[m] as number;
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (seg < m - 1 && (cum[seg + 1] as number) < target) seg++;
    const a = dense[seg] as Pt;
    const b = dense[(seg + 1) % m] as Pt;
    const len = (cum[seg + 1] as number) - (cum[seg] as number) || 1e-9;
    const f = (target - (cum[seg] as number)) / len;
    out.push([Math.round((a[0] + (b[0] - a[0]) * f) * 100) / 100, Math.round((a[1] + (b[1] - a[1]) * f) * 100) / 100]);
  }
  return out;
}

export function pointInRing(x: number, y: number, ring: readonly Pt[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i] as Pt;
    const [xj, yj] = ring[j] as Pt;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Floater 평균값 좌표(합 = 1): 링 안쪽 점이 링 점 변위를 부드럽게 보간한다 */
export function meanValueWeights(x: number, y: number, ring: readonly Pt[]): number[] {
  const n = ring.length;
  const vx: number[] = [];
  const vy: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Pt;
    vx.push(p[0] - x);
    vy.push(p[1] - y);
    d.push(Math.hypot(p[0] - x, p[1] - y));
  }
  let minI = 0;
  for (let i = 1; i < n; i++) if ((d[i] as number) < (d[minI] as number)) minI = i;
  if ((d[minI] as number) < 1e-6) {
    const w = new Array<number>(n).fill(0);
    w[minI] = 1;
    return w;
  }
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = (vx[i] as number) * (vy[j] as number) - (vy[i] as number) * (vx[j] as number);
    const dot = (vx[i] as number) * (vx[j] as number) + (vy[i] as number) * (vy[j] as number);
    t.push(Math.tan(Math.atan2(cross, dot) / 2));
  }
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = ((t[(i + n - 1) % n] as number) + (t[i] as number)) / (d[i] as number);
    w.push(v);
    sum += v;
  }
  return Math.abs(sum) > 1e-12 ? w.map((v) => v / sum) : new Array<number>(n).fill(1 / n);
}

/** 링 밖 정점: 가장 가까운 링 구간의 두 점을 따르되 거리에 따라 변위가 줄어든다 */
export function outsideWeights(x: number, y: number, ring: readonly Pt[], decayLen: number): number[] {
  const n = ring.length;
  let bestD = Infinity;
  let bestI = 0;
  let bestT = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / (abx * abx + aby * aby + 1e-12)));
    const dd = Math.hypot(a[0] + t * abx - x, a[1] + t * aby - y);
    if (dd < bestD) {
      bestD = dd;
      bestI = i;
      bestT = t;
    }
  }
  const w = new Array<number>(n).fill(0);
  w[bestI] = (w[bestI] as number) + (1 - bestT);
  w[(bestI + 1) % n] = (w[(bestI + 1) % n] as number) + bestT;
  const k = Math.exp(-bestD / decayLen);
  return w.map((v) => v * k);
}

/** 메시 정점들의 링 가중치(희소: [링 인덱스, 가중치][]). 너무 작은 가중치는 버리고 합은 유지한다(빌드 스크립트와 같은 규칙) */
export function buildRingWeights(ring: readonly Pt[], vertices: ReadonlyArray<Pt>, decayLen: number): Array<Array<[number, number]>> {
  return vertices.map(([x, y]) => {
    const w = pointInRing(x, y, ring) ? meanValueWeights(x, y, ring) : outsideWeights(x, y, ring, decayLen);
    const tot = w.reduce((a, b) => a + b, 0);
    const keep: Array<[number, number]> = [];
    let kept = 0;
    w.forEach((v, i) => {
      if (Math.abs(v) >= 0.003) {
        keep.push([i, v]);
        kept += v;
      }
    });
    const scale = Math.abs(kept) > 1e-9 ? tot / kept : 1;
    return keep.map(([i, v]) => [i, Math.round(v * scale * 1e4) / 1e4] as [number, number]);
  });
}

export interface RingOptions {
  /** 외곽 링 점 수(32 = mochi.json 그대로) */
  points: number;
  /** 워프 메시 격자 배수(1 = mochi.json 그대로, 2 = 가로세로 약 2배) */
  meshScale?: number;
  /**
   * 링 밖 정점의 변위 감쇠 길이(실루엣 폭 대비). 기본 0.22는 mochi.json 규칙.
   * 감쇠 기울기(최대 변위/감쇠 길이)가 1을 넘으면 끝 쪽 바깥 정점이 안쪽 정점보다 덜 움직여 셀이 겹친다(접힘). 최대 당김(폭의 약 45%)에서도 겹치지 않으려면 0.4 이상이 필요하다.
   */
  decayRatio?: number;
  /** true면 점 수·배수가 같아도 가중치를 다시 계산한다(비교용) */
  rebuild?: boolean;
}

/**
 * mochi.json의 시점 데이터를 링 해상도·메시 해상도를 바꾼 사본으로 만든다(원본 객체는 건드리지 않는다).
 * points가 원래 링 점 수이고 meshScale이 1이고 rebuild가 아니면 같은 객체를 그대로 돌려준다.
 */
export function withRingResolution<T extends WarpViewData & { silhouetteBBox: [number, number, number, number] }>(view: T, opt: RingOptions): T {
  const scale = opt.meshScale ?? 1;
  if (opt.points === view.outlineRing.length && scale === 1 && !opt.rebuild) return view;
  const ring = resampleRing(view.outlineRing, opt.points);
  const m = view.warpMesh;
  const cols = scale === 1 ? m.cols : Math.round((m.cols - 1) * scale) + 1;
  const rows = scale === 1 ? m.rows : Math.round((m.rows - 1) * scale) + 1;
  const [bx0, by0, bx1, by1] = m.bounds;
  let verts: Array<[number, number]>;
  if (scale === 1) {
    verts = m.restVertices;
  } else {
    verts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) verts.push([bx0 + ((bx1 - bx0) * c) / (cols - 1), by0 + ((by1 - by0) * r) / (rows - 1)]);
  }
  const sb = view.silhouetteBBox;
  const weights = buildRingWeights(ring, verts, (opt.decayRatio ?? 0.22) * (sb[2] - sb[0]));
  return { ...view, outlineRing: ring, warpMesh: { ...m, cols, rows, restVertices: verts, ringWeights: weights } };
}
