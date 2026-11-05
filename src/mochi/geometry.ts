// 모찌에서 쓰는 순수 기하 함수.
export interface Pt {
  x: number;
  y: number;
}

/** 부호 있는 다각형 면적(신발끈 공식) */
export function signedArea(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (xs[i] as number) * (ys[j] as number) - (xs[j] as number) * (ys[i] as number);
  }
  return a / 2;
}

export function pointInPolygon(px: number, py: number, xs: readonly number[], ys: readonly number[]): boolean {
  let inside = false;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xs[i] as number;
    const yi = ys[i] as number;
    const xj = xs[j] as number;
    const yj = ys[j] as number;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** 점에서 다각형 변까지의 최단 거리 */
export function distanceToPolygonEdges(px: number, py: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = xs[i] as number;
    const ay = ys[i] as number;
    const bx = xs[j] as number;
    const by = ys[j] as number;
    const abx = bx - ax;
    const aby = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby + 1e-12)));
    best = Math.min(best, Math.hypot(px - (ax + t * abx), py - (ay + t * aby)));
  }
  return best;
}

/** 다각형 안이거나, 바깥으로 margin 이내이면 true. margin은 호출하는 쪽의 좌표계 단위(논리 px). */
export function isNearPolygon(px: number, py: number, xs: readonly number[], ys: readonly number[], margin: number): boolean {
  return pointInPolygon(px, py, xs, ys) || distanceToPolygonEdges(px, py, xs, ys) <= margin;
}

export function centroidOf(xs: readonly number[], ys: readonly number[]): Pt {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xs.length; i++) {
    sx += xs[i] as number;
    sy += ys[i] as number;
  }
  return { x: sx / xs.length, y: sy / xs.length };
}
