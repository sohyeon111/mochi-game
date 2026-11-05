// STRETCH 변형 측정 도우미(테스트·비교 리포트 공용): 링 해상도를 바꿔 몸을 만들고, 방향·거리로 당긴 뒤 윤곽 지표를 잰다.
import mochi from '../../public/assets/render/mochi.json';
import { MOCHI } from '../../src/app/constants';
import { toStage, type WarpViewData } from '../../src/mochi/meshWarp';
import { withRingResolution } from '../../src/mochi/ringResample';
import { SoftBody } from '../../src/mochi/softBody';

type FrontView = WarpViewData & { silhouetteBBox: [number, number, number, number] };
export const frontView = (mochi as unknown as { views: { front: FrontView } }).views.front;

export const viewWith = (points: number, meshScale = 1, decayRatio = 0.22, rebuild = false): FrontView => withRingResolution(frontView, { points, meshScale, decayRatio, rebuild });

/** 스프라이트 → 논리 좌표 배치(mochiRenderer.placementFor와 같다) */
export function placement(v: FrontView): { scale: number; ox: number; oy: number } {
  const [x0, , x1, y1] = v.silhouetteBBox;
  const s = MOCHI.FRONT_SCALE;
  return { scale: s, ox: MOCHI.FRONT_CENTER_X - ((x0 + x1) / 2) * s, oy: MOCHI.FRONT_GROUND_Y - y1 * s };
}

export function makeBody(points: number): SoftBody {
  const v = viewWith(points);
  const p = placement(v);
  const ring = v.outlineRing.map(([x, y]) => toStage(p, x, y));
  return new SoftBody(ring.map((r) => r[0]), ring.map((r) => r[1]), {
    groundY: MOCHI.FRONT_GROUND_Y, pinBand: MOCHI.PIN_BAND, topLimitY: MOCHI.TOP_MARGIN_PX,
  });
}

export const DIRECTIONS: Array<[string, number]> = [['위', -90], ['왼쪽 위', -135], ['오른쪽 위', -45], ['왼쪽', 180], ['오른쪽', 0]];

/** 방향(도)·거리로 당긴 뒤 ms만큼 진행한다. 잡는 위치는 mochiStretchShape.test와 같은 규칙 */
export function pull(points: number, angleDeg: number, dist: number, ms = 1500): { b: SoftBody; ux: number; uy: number; rest: SoftBody } {
  const b = makeBody(points);
  const rest = makeBody(points);
  const top = Math.min(...b.y);
  const cx = (Math.min(...b.x) + Math.max(...b.x)) / 2;
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const sideX = ux * 0.9 > 0 ? cx + 120 : ux * 0.9 < -0.5 ? cx - 120 : cx;
  const gx = Math.abs(ux) > 0.9 ? sideX : cx + (ux < 0 ? -90 : ux > 0 ? 90 : 0);
  const gy = Math.abs(ux) > 0.9 ? top + 200 : top + 30;
  if (!b.beginGrab(gx, gy)) throw new Error('잡기 실패');
  b.moveGrab(gx + ux * dist, gy + uy * dist);
  for (let t = 0; t < ms; t += 16.67) b.step(16.67);
  return { b, ux, uy, rest };
}

/** 점 i에서 호장 s만큼 떨어진 윤곽 위의 점(dir=+1/-1) */
function walk(b: SoftBody, i: number, s: number, dir: 1 | -1): [number, number] {
  let left = s;
  let cur = i;
  let cx = b.x[i] as number;
  let cy = b.y[i] as number;
  for (let k = 0; k < b.n; k++) {
    const nx = (cur + dir + b.n) % b.n;
    const tx = b.x[nx] as number;
    const ty = b.y[nx] as number;
    const seg = Math.hypot(tx - cx, ty - cy);
    if (seg >= left) {
      const f = left / (seg || 1);
      return [cx + (tx - cx) * f, cy + (ty - cy) * f];
    }
    left -= seg;
    cx = tx;
    cy = ty;
    cur = nx;
  }
  return [cx, cy];
}

export function perimeter(b: SoftBody): number {
  let p = 0;
  for (let i = 0; i < b.n; i++) p += Math.hypot((b.x[(i + 1) % b.n] as number) - (b.x[i] as number), (b.y[(i + 1) % b.n] as number) - (b.y[i] as number));
  return p;
}

/**
 * 링 점 수와 무관한 "뾰족함" 지표: 윤곽을 따라 앞뒤 호장 s(기본 형태 둘레의 6%)만큼 떨어진 두 점과 이루는 꺾임 각도(도)의 최댓값.
 * 점 수가 달라도 같은 모양이면 같은 값이 나오고, 끝이 뾰족해질수록 커진다(직선 0°, 삼각형 끝 100°+).
 */
export function maxArcTurnDeg(b: SoftBody, restPerimeter: number, frac = 0.06): number {
  const s = restPerimeter * frac;
  let m = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.y[i]! > MOCHI.FRONT_GROUND_Y - 30) continue; // 책상에 붙은 바닥 모서리는 제외
    const [ax, ay] = walk(b, i, s, -1);
    const [cx, cy] = walk(b, i, s, 1);
    const a1 = Math.atan2((b.y[i] as number) - ay, (b.x[i] as number) - ax);
    const a2 = Math.atan2(cy - (b.y[i] as number), cx - (b.x[i] as number));
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, (d * 180) / Math.PI);
  }
  return m;
}

/** 끝에서 15% 안쪽 지점의 폭 / 전체 폭(당기는 축 기준) */
export function tipWidthRatio(b: SoftBody, ux: number, uy: number): number {
  const proj = b.x.map((x, i) => x * ux + (b.y[i] as number) * uy);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const vx = -uy;
  const vy = ux;
  const target = hi - (hi - lo) * 0.15;
  const perp = b.x.map((x, i) => x * vx + (b.y[i] as number) * vy);
  const all = Math.max(...perp) - Math.min(...perp);
  // 점 수에 의존하지 않도록 윤곽선을 선분으로 보고 target 높이를 가로지르는 교점의 perp 범위를 쓴다
  const hits: number[] = [];
  for (let i = 0; i < b.n; i++) {
    const j = (i + 1) % b.n;
    const p0 = proj[i] as number;
    const p1 = proj[j] as number;
    if ((p0 - target) * (p1 - target) <= 0 && p0 !== p1) {
      const f = (target - p0) / (p1 - p0);
      hits.push((perp[i] as number) + ((perp[j] as number) - (perp[i] as number)) * f);
    }
  }
  if (hits.length < 2) return 0;
  return (Math.max(...hits) - Math.min(...hits)) / all;
}

/** 윤곽 점의 이웃 이동량 차이 최댓값 / 최대 이동량(점 수 무관: 호장 기준 환산 없이 비율만 본다) */
export function neighborJumpRatio(b: SoftBody, rest: SoftBody): number {
  const mag = b.x.map((x, i) => Math.hypot(x - (rest.x[i] as number), (b.y[i] as number) - (rest.y[i] as number)));
  const mx = Math.max(...mag, 1e-9);
  let j = 0;
  for (let i = 0; i < b.n; i++) j = Math.max(j, Math.abs((mag[i] as number) - (mag[(i + 1) % b.n] as number)));
  return j / mx;
}

// ---------------------------------------------------------------- 메시 워프가 실제로 그리는 윤곽
import { MeshWarp } from '../../src/mochi/meshWarp';
import { resampleRing } from '../../src/mochi/ringResample';

/**
 * 기본 윤곽(스프라이트 좌표) 위의 조밀한 점들이 워프 메시를 거쳐 어디에 그려지는지(논리 좌표)를 구한다.
 * 텍스처의 실루엣이 이 윤곽을 따라 그려지므로, 화면에 보이는 외곽선 = 이 점들을 이은 선이다.
 * (링은 매끈해도 메시 셀이 크면 이 선이 꺾여 보인다)
 */
export function mappedOutline(warp: MeshWarp, view: FrontView, samples = 360): Array<[number, number]> {
  const rest = resampleRing(view.outlineRing, samples);
  const m = view.warpMesh;
  const [bx0, by0, bx1, by1] = m.bounds;
  const out: Array<[number, number]> = [];
  for (const [sx, sy] of rest) {
    const fx = ((sx - bx0) / (bx1 - bx0)) * (m.cols - 1);
    const fy = ((sy - by0) / (by1 - by0)) * (m.rows - 1);
    const c = Math.min(m.cols - 2, Math.max(0, Math.floor(fx)));
    const r = Math.min(m.rows - 2, Math.max(0, Math.floor(fy)));
    const u = fx - c;
    const v = fy - r;
    const idx = (rr: number, cc: number): number => rr * m.cols + cc;
    const a = idx(r, c);
    const b = idx(r, c + 1);
    const cI = idx(r + 1, c);
    const d = idx(r + 1, c + 1);
    const P = (i: number): [number, number] => [warp.deformed[i * 2] as number, warp.deformed[i * 2 + 1] as number];
    // MeshWarp.triangles 와 같은 분할: [a,b,c] 와 [b,d,c]
    if (u + v <= 1) {
      const [ax, ay] = P(a); const [bx, by] = P(b); const [cx, cy] = P(cI);
      out.push([ax + (bx - ax) * u + (cx - ax) * v, ay + (by - ay) * u + (cy - ay) * v]);
    } else {
      const [bx, by] = P(b); const [dx, dy] = P(d); const [cx, cy] = P(cI);
      out.push([bx + (dx - bx) * (1 - v) + (cx - bx) * (1 - u), by + (dy - by) * (1 - v) + (cy - by) * (1 - u)]);
    }
  }
  return out;
}

/** 폐곡선(점열)의 호장 s 기준 꺾임 최대(도). 바닥 접촉 구간(y > ground-30)은 제외 */
export function polylineMaxTurnDeg(pts: ReadonlyArray<[number, number]>, frac = 0.06): number {
  const n = pts.length;
  let per = 0;
  for (let i = 0; i < n; i++) per += Math.hypot((pts[(i + 1) % n] as [number, number])[0] - (pts[i] as [number, number])[0], (pts[(i + 1) % n] as [number, number])[1] - (pts[i] as [number, number])[1]);
  const s = per * frac;
  const walkP = (i: number, dir: 1 | -1): [number, number] => {
    let left = s;
    let cur = i;
    let [cx, cy] = pts[i] as [number, number];
    for (let k = 0; k < n; k++) {
      const nx = (cur + dir + n) % n;
      const [tx, ty] = pts[nx] as [number, number];
      const seg = Math.hypot(tx - cx, ty - cy);
      if (seg >= left) return [cx + ((tx - cx) * left) / (seg || 1), cy + ((ty - cy) * left) / (seg || 1)];
      left -= seg;
      cx = tx;
      cy = ty;
      cur = nx;
    }
    return [cx, cy];
  };
  let m = 0;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i] as [number, number];
    if (py > MOCHI.FRONT_GROUND_Y - 30) continue;
    const [ax, ay] = walkP(i, -1);
    const [cx, cy] = walkP(i, 1);
    let d = Math.abs(Math.atan2(cy - py, cx - px) - Math.atan2(py - ay, px - ax));
    if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, (d * 180) / Math.PI);
  }
  return m;
}

/** 두 폐곡선 사이의 최대 거리(a의 각 점에서 b 폴리라인까지) */
export function maxDeviation(a: ReadonlyArray<[number, number]>, b: ReadonlyArray<[number, number]>): number {
  let worst = 0;
  for (const [x, y] of a) {
    let best = Infinity;
    for (let i = 0; i < b.length; i++) {
      const p = b[i] as [number, number];
      const q = b[(i + 1) % b.length] as [number, number];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const t = Math.min(1, Math.max(0, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy + 1e-12)));
      best = Math.min(best, Math.hypot(p[0] + t * dx - x, p[1] + t * dy - y));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

export function makeWarp(points: number, meshScale: number, decayRatio = 0.22, rebuild = false): { warp: MeshWarp; view: FrontView } {
  const view = viewWith(points, meshScale, decayRatio, rebuild);
  return { warp: new MeshWarp(view, placement(view)), view };
}
