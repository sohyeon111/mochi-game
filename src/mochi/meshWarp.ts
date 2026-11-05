// 링 변위 → 워프 메시 정점 변위 → 텍스처 삼각형. 순수 로직(그리기는 mochiRenderer). mochi.json의 warpMesh를 그대로 쓴다.
import { distanceToPolygonEdges, pointInPolygon } from './geometry';

export interface WarpViewData {
  size: [number, number];
  outlineRing: Array<[number, number]>;
  warpMesh: {
    cols: number;
    rows: number;
    bounds: [number, number, number, number];
    restVertices: Array<[number, number]>;
    ringWeights: Array<Array<[number, number]>>;
  };
}

/** 스프라이트 좌표 → 논리 좌표 배치 */
export interface Placement {
  scale: number;
  ox: number;
  oy: number;
}

export const toStage = (p: Placement, sx: number, sy: number): [number, number] => [p.ox + sx * p.scale, p.oy + sy * p.scale];

/** 눌림으로 생기는 보조 변위: 눌린 곳 주변 내용물이 누른 점 쪽으로 모인다(보조 변위, 외곽 링과 별개) */
export interface Dent {
  x: number;
  y: number;
  sigma: number;
  /** 0이면 없음. 정점이 눌린 점 쪽으로 이동하는 비율(최대 약 0.25) */
  amount: number;
}

export type Tri = readonly [number, number, number];

export class MeshWarp {
  readonly cols: number;
  readonly rows: number;
  readonly vertexCount: number;
  /** 스프라이트 좌표의 기준 정점 */
  readonly restSprite: Float64Array;
  /** 논리 좌표의 기준 정점 */
  readonly restStage: Float64Array;
  /** 현재(변형된) 논리 좌표 정점 */
  readonly deformed: Float64Array;
  private ringRestX: number[];
  private ringRestY: number[];
  /** 링 가중치를 한 덩어리 배열(CSR)로 편 것: 정점 v의 항목은 [wStart[v], wStart[v+1]) — 프레임마다 배열·반복자를 만들지 않는다 */
  private wStart: Uint32Array;
  private wIdx: Uint16Array;
  private wVal: Float64Array;
  private activeCache = new Map<number, Tri[]>();
  private adaptiveCache = new Map<number, Tri[]>();
  /** 기준 윤곽(스프라이트 좌표) — 적응형 메시의 "윤곽 근처" 판정용 */
  private ringSpriteX: number[];
  private ringSpriteY: number[];
  private nearVertex: Uint8Array;

  constructor(data: WarpViewData, readonly placement: Placement) {
    const m = data.warpMesh;
    this.cols = m.cols;
    this.rows = m.rows;
    this.vertexCount = m.cols * m.rows;
    this.restSprite = new Float64Array(this.vertexCount * 2);
    this.restStage = new Float64Array(this.vertexCount * 2);
    for (let i = 0; i < this.vertexCount; i++) {
      const v = m.restVertices[i] as [number, number];
      this.restSprite[i * 2] = v[0];
      this.restSprite[i * 2 + 1] = v[1];
      const [sx, sy] = toStage(placement, v[0], v[1]);
      this.restStage[i * 2] = sx;
      this.restStage[i * 2 + 1] = sy;
    }
    this.deformed = Float64Array.from(this.restStage);
    this.ringRestX = data.outlineRing.map((p) => toStage(placement, p[0], p[1])[0]);
    this.ringRestY = data.outlineRing.map((p) => toStage(placement, p[0], p[1])[1]);
    let total = 0;
    for (const w of m.ringWeights) total += w.length;
    this.wStart = new Uint32Array(this.vertexCount + 1);
    this.wIdx = new Uint16Array(total);
    this.wVal = new Float64Array(total);
    let k = 0;
    for (let v = 0; v < this.vertexCount; v++) {
      this.wStart[v] = k;
      for (const [idx, w] of m.ringWeights[v] as Array<[number, number]>) {
        this.wIdx[k] = idx;
        this.wVal[k] = w;
        k++;
      }
    }
    this.wStart[this.vertexCount] = k;
    // 실루엣 근처 정점(스프라이트 좌표 기준): 텍스처가 있는 셀만 그리기 위한 정보
    const rx = data.outlineRing.map((p) => p[0]);
    const ry = data.outlineRing.map((p) => p[1]);
    this.ringSpriteX = rx;
    this.ringSpriteY = ry;
    const cell = Math.hypot((m.bounds[2] - m.bounds[0]) / (m.cols - 1), (m.bounds[3] - m.bounds[1]) / (m.rows - 1));
    this.nearVertex = new Uint8Array(this.vertexCount);
    for (let i = 0; i < this.vertexCount; i++) {
      const px = this.restSprite[i * 2] as number;
      const py = this.restSprite[i * 2 + 1] as number;
      this.nearVertex[i] = pointInPolygon(px, py, rx, ry) || distanceToPolygonEdges(px, py, rx, ry) <= cell * 1.2 ? 1 : 0;
    }
  }

  get ringRest(): { x: readonly number[]; y: readonly number[] } {
    return { x: this.ringRestX, y: this.ringRestY };
  }

  private ringDX = new Float64Array(0);
  private ringDY = new Float64Array(0);
  private dispX = new Float64Array(0);
  private dispY = new Float64Array(0);
  private tmpX = new Float64Array(0);
  private tmpY = new Float64Array(0);

  /**
   * 소프트바디 링의 현재 위치(논리 좌표)로 정점을 갱신한다.
   * smoothPasses > 0이면 정점 변위를 이웃끼리 평균내어(격자 라플라시안) 이웃 셀 사이의 변형 차이를 줄인다.
   * 크게 늘어났을 때 셀마다 늘어나는 정도가 달라 윤곽이 꺾여 보이는(각진) 것을 완화한다. 0이면 기존과 동일.
   */
  update(ringX: readonly number[], ringY: readonly number[], dent?: Dent | readonly Dent[] | null, smoothPasses = 0, dentCount?: number): void {
    // 눌림 보조 변위: 마우스 눌림(하나) 또는 손가락 눌림(여러 개)
    const dents: readonly Dent[] | null = dent ? (Array.isArray(dent) ? (dent as readonly Dent[]) : [dent as Dent]) : null;
    const nd = dents ? Math.min(dents.length, dentCount ?? dents.length) : 0;
    const out = this.deformed;
    if (this.dispX.length !== this.vertexCount) {
      this.dispX = new Float64Array(this.vertexCount);
      this.dispY = new Float64Array(this.vertexCount);
      this.tmpX = new Float64Array(this.vertexCount);
      this.tmpY = new Float64Array(this.vertexCount);
    }
    // 링 변위(현재 − 기준)를 먼저 한 번만 계산해 두고 정점마다 가중합한다
    const n = this.ringRestX.length;
    if (this.ringDX.length !== n) {
      this.ringDX = new Float64Array(n);
      this.ringDY = new Float64Array(n);
    }
    for (let i = 0; i < n; i++) {
      this.ringDX[i] = (ringX[i] as number) - (this.ringRestX[i] as number);
      this.ringDY[i] = (ringY[i] as number) - (this.ringRestY[i] as number);
    }
    for (let v = 0; v < this.vertexCount; v++) {
      let dx = 0;
      let dy = 0;
      for (let k = this.wStart[v] as number, e = this.wStart[v + 1] as number; k < e; k++) {
        const i = this.wIdx[k] as number;
        const w = this.wVal[k] as number;
        dx += w * (this.ringDX[i] as number);
        dy += w * (this.ringDY[i] as number);
      }
      this.dispX[v] = dx;
      this.dispY[v] = dy;
    }
    for (let pass = 0; pass < smoothPasses; pass++) {
      const { cols, rows } = this;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = r * cols + c;
          let sx = 0;
          let sy = 0;
          let cnt = 0;
          if (c > 0) { sx += this.dispX[v - 1] as number; sy += this.dispY[v - 1] as number; cnt++; }
          if (c < cols - 1) { sx += this.dispX[v + 1] as number; sy += this.dispY[v + 1] as number; cnt++; }
          if (r > 0) { sx += this.dispX[v - cols] as number; sy += this.dispY[v - cols] as number; cnt++; }
          if (r < rows - 1) { sx += this.dispX[v + cols] as number; sy += this.dispY[v + cols] as number; cnt++; }
          this.tmpX[v] = 0.5 * (this.dispX[v] as number) + (0.5 * sx) / cnt;
          this.tmpY[v] = 0.5 * (this.dispY[v] as number) + (0.5 * sy) / cnt;
        }
      }
      this.dispX.set(this.tmpX);
      this.dispY.set(this.tmpY);
    }
    for (let v = 0; v < this.vertexCount; v++) {
      let x = (this.restStage[v * 2] as number) + (this.dispX[v] as number);
      let y = (this.restStage[v * 2 + 1] as number) + (this.dispY[v] as number);
      for (let d = 0; d < nd; d++) {
        const dn = (dents as readonly Dent[])[d] as Dent;
        if (dn.amount <= 0) continue;
        const ddx = dn.x - x;
        const ddy = dn.y - y;
        const g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * dn.sigma * dn.sigma));
        x += ddx * dn.amount * g;
        y += ddy * dn.amount * g;
      }
      out[v * 2] = x;
      out[v * 2 + 1] = y;
    }
  }

  /** 텍스처가 있는 셀만 모은 삼각형 목록. stride가 클수록 정점을 건너뛰어 삼각형이 줄어든다(품질 단계). */
  triangles(stride: number): Tri[] {
    const cached = this.activeCache.get(stride);
    if (cached) return cached;
    const idx = (n: number): number[] => {
      const a: number[] = [];
      for (let i = 0; i < n - 1; i += stride) a.push(i);
      a.push(n - 1);
      return [...new Set(a)];
    };
    const cs = idx(this.cols);
    const rs = idx(this.rows);
    const tris: Tri[] = [];
    for (let ri = 0; ri < rs.length - 1; ri++) {
      for (let ci = 0; ci < cs.length - 1; ci++) {
        const r0 = rs[ri] as number;
        const r1 = rs[ri + 1] as number;
        const c0 = cs[ci] as number;
        const c1 = cs[ci + 1] as number;
        const a = r0 * this.cols + c0;
        const b = r0 * this.cols + c1;
        const c = r1 * this.cols + c0;
        const d = r1 * this.cols + c1;
        if (!(this.nearVertex[a] || this.nearVertex[b] || this.nearVertex[c] || this.nearVertex[d])) continue;
        tris.push([a, b, c], [b, d, c]);
      }
    }
    this.activeCache.set(stride, tris);
    return tris;
  }

  /**
   * 적응형 삼각형 목록: 기준 윤곽 근처(bandSprite 이내, 윤곽 바깥 포함)는 모든 셀을 그대로 쓰고,
   * 윤곽에서 먼 안쪽은 2×2 셀을 한 덩어리로 합쳐 삼각형 수를 줄인다(변위가 부드러운 안쪽은 합쳐도 차이가 작다).
   * 합친 덩어리가 세밀한 이웃과 맞닿는 변에는 가운데 정점을 포함해(팬 삼각분할) 갈라짐(T-접합)이 생기지 않는다.
   * 격자가 짝수 칸(cols-1, rows-1이 짝수)이 아니면 전체 셀을 돌려준다.
   */
  adaptiveTriangles(bandSprite: number): Tri[] {
    const cached = this.adaptiveCache.get(bandSprite);
    if (cached) return cached;
    const { cols, rows } = this;
    if ((cols - 1) % 2 !== 0 || (rows - 1) % 2 !== 0) return this.triangles(1);
    const bc = (cols - 1) / 2;
    const br = (rows - 1) / 2;
    const v = (r: number, c: number): number => r * cols + c;
    const FINE = 2;
    const COARSE = 1;
    const kind = new Uint8Array(bc * br); // 0: 그리지 않음, 1: 합친 덩어리, 2: 세밀
    for (let bj = 0; bj < br; bj++) {
      for (let bi = 0; bi < bc; bi++) {
        let near = false;
        let fine = false;
        for (let dr = 0; dr <= 2; dr++) {
          for (let dc = 0; dc <= 2; dc++) {
            const i = v(bj * 2 + dr, bi * 2 + dc);
            if (this.nearVertex[i]) near = true;
            if (fine) continue;
            const px = this.restSprite[i * 2] as number;
            const py = this.restSprite[i * 2 + 1] as number;
            if (!pointInPolygon(px, py, this.ringSpriteX, this.ringSpriteY) || distanceToPolygonEdges(px, py, this.ringSpriteX, this.ringSpriteY) <= bandSprite) fine = true;
          }
        }
        kind[bj * bc + bi] = !near ? 0 : fine ? FINE : COARSE;
      }
    }
    const tris: Tri[] = [];
    const cell = (r: number, c: number): void => {
      const a = v(r, c);
      const b = v(r, c + 1);
      const c0 = v(r + 1, c);
      const d = v(r + 1, c + 1);
      if (!(this.nearVertex[a] || this.nearVertex[b] || this.nearVertex[c0] || this.nearVertex[d])) return;
      tris.push([a, b, c0], [b, d, c0]);
    };
    const kindAt = (bi: number, bj: number): number => (bi < 0 || bj < 0 || bi >= bc || bj >= br ? 0 : (kind[bj * bc + bi] as number));
    for (let bj = 0; bj < br; bj++) {
      for (let bi = 0; bi < bc; bi++) {
        const k = kind[bj * bc + bi] as number;
        if (k === 0) continue;
        const r0 = bj * 2;
        const c0 = bi * 2;
        if (k === FINE) {
          for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) cell(r0 + dr, c0 + dc);
          continue;
        }
        // 합친 덩어리: 세밀한 이웃과 맞닿는 변에만 가운데 정점을 넣는다
        const midTop = kindAt(bi, bj - 1) === FINE;
        const midRight = kindAt(bi + 1, bj) === FINE;
        const midBottom = kindAt(bi, bj + 1) === FINE;
        const midLeft = kindAt(bi - 1, bj) === FINE;
        if (!midTop && !midRight && !midBottom && !midLeft) {
          const a = v(r0, c0);
          const b = v(r0, c0 + 2);
          const c = v(r0 + 2, c0);
          const d = v(r0 + 2, c0 + 2);
          tris.push([a, b, c], [b, d, c]);
          continue;
        }
        const poly: number[] = [v(r0, c0)];
        if (midTop) poly.push(v(r0, c0 + 1));
        poly.push(v(r0, c0 + 2));
        if (midRight) poly.push(v(r0 + 1, c0 + 2));
        poly.push(v(r0 + 2, c0 + 2));
        if (midBottom) poly.push(v(r0 + 2, c0 + 1));
        poly.push(v(r0 + 2, c0));
        if (midLeft) poly.push(v(r0 + 1, c0));
        const center = v(r0 + 1, c0 + 1);
        for (let i = 0; i < poly.length; i++) tris.push([center, poly[i] as number, poly[(i + 1) % poly.length] as number]);
      }
    }
    this.adaptiveCache.set(bandSprite, tris);
    return tris;
  }
}

export type Affine = readonly [number, number, number, number, number, number];

/** 세 점 대응으로 어파인 변환(dst = [a c e; b d f] · [x y 1])을 구한다. canvas setTransform(a,b,c,d,e,f)과 같은 순서. */
export function affineFromTriangles(
  s0x: number, s0y: number, s1x: number, s1y: number, s2x: number, s2y: number,
  d0x: number, d0y: number, d1x: number, d1y: number, d2x: number, d2y: number,
): Affine | null {
  const det = (s1x - s0x) * (s2y - s0y) - (s2x - s0x) * (s1y - s0y);
  if (Math.abs(det) < 1e-9) return null;
  const a = ((d1x - d0x) * (s2y - s0y) - (d2x - d0x) * (s1y - s0y)) / det;
  const c = ((d2x - d0x) * (s1x - s0x) - (d1x - d0x) * (s2x - s0x)) / det;
  const b = ((d1y - d0y) * (s2y - s0y) - (d2y - d0y) * (s1y - s0y)) / det;
  const d = ((d2y - d0y) * (s1x - s0x) - (d1y - d0y) * (s2x - s0x)) / det;
  const e = d0x - a * s0x - c * s0y;
  const f = d0y - b * s0x - d * s0y;
  return [a, b, c, d, e, f];
}
