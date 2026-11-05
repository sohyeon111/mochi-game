// 모찌 내부 과일 배치 (SPEC 7.4, 7.7). scripts/blender/verify_assets.py 의 layout3d 를 mochi.json 파라미터로 옮긴 것. 순수 로직.
//  - 획득한 종류·개수만큼 조각을 만들고, 대표 과일(최다, 동수면 먼저 수집)은 약간 크게
//  - 떡 내부 타원체 안에서 "가장 덜 겹치는 후보"를 고르는 방식(블루 노이즈)으로 배치, 일부 겹침 허용
//  - 정면·위 시점은 같은 3D 배치를 투영한다
import type { FruitId } from '../app/constants';
import { mulberry32 } from '../game/rng';

export interface FruitLayoutParams {
  ellipsoid: { R: number; H: number };
  candidates: number;
  innerMargin: { radial: number; radialSizeFactor: number; heightBase: number; heightRange: number };
  pieceBaseRadiusMeters: number;
  pieceScale: { base: number; randomRange: [number, number] };
  shareMultiplier: { min: number; max: number; dominantBonus: number };
  tooManyPiecesShrink: { whenTotalAbove: number; factor: number };
  blueberry: { scale: number; extraWhenCountAtLeast5: number };
  rotationDeg: [number, number];
  flipProbability: number;
  depthEffects: {
    blurBasePxAtFrame900: number;
    blurPerDepthPxAtFrame900: number;
    tintBase: number;
    tintPerDepth: number;
    opacityBase: number;
    opacityLossPerDepth: number;
    milkFill: number;
  };
}

export interface Piece3D {
  type: FruitId;
  /** 떡 중심 기준 좌우(m), 카메라에서 멀어지는 깊이(m), 높이(m) */
  x: number;
  d: number;
  h: number;
  /** 조각 반지름(m, 겹침 판단용) */
  r: number;
  mult: number;
  rotDeg: number;
  flip: boolean;
}

export type FruitCounts = Record<FruitId, number>;

/** 대표 과일: 가장 많이 수집, 동수이면 firstOrder에서 앞선 과일. 수집이 없으면 null */
export function dominantFruit(counts: FruitCounts, firstOrder: readonly FruitId[]): FruitId | null {
  let best: FruitId | null = null;
  for (const f of firstOrder) {
    if ((counts[f] ?? 0) <= 0) continue;
    if (best === null || counts[f] > counts[best]) best = f;
  }
  return best;
}

export function layoutFruits(counts: FruitCounts, firstOrder: readonly FruitId[], seed: number, p: FruitLayoutParams): { pieces: Piece3D[]; dominant: FruitId | null } {
  const rng = mulberry32(seed);
  const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
  const dominant = dominantFruit(counts, firstOrder);
  const sm = p.shareMultiplier;
  const raw: Array<{ type: FruitId; mult: number }> = [];
  for (const t of Object.keys(counts) as FruitId[]) {
    const c = counts[t];
    if (c <= 0) continue;
    const share = c / total;
    let mult = Math.min(sm.max, Math.max(sm.min, 0.9 + 0.45 * share));
    if (t === dominant) mult *= sm.dominantBonus;
    if (t === 'blueberry') {
      mult *= p.blueberry.scale; // 3알 묶음이라 작게
      if (c >= 5) mult *= p.blueberry.extraWhenCountAtLeast5;
    }
    for (let i = 0; i < c; i++) raw.push({ type: t, mult: mult * (p.pieceScale.randomRange[0] + (p.pieceScale.randomRange[1] - p.pieceScale.randomRange[0]) * rng()) });
  }
  raw.sort((a, b) => b.mult - a.mult);
  const { R, H } = p.ellipsoid;
  const im = p.innerMargin;
  const shrink = total <= p.tooManyPiecesShrink.whenTotalAbove ? 1 : p.tooManyPiecesShrink.factor;
  const placed: Piece3D[] = [];
  for (const q of raw) {
    const r = p.pieceBaseRadiusMeters * q.mult * shrink;
    const rhoMax = im.radial - (im.radialSizeFactor * r) / R;
    let best: [number, number, number] | null = null;
    let bestScore = -Infinity;
    for (let c = 0; c < p.candidates; c++) {
      let x: number, d: number, h: number;
      do {
        x = rng() * 2 - 1;
        d = rng() * 2 - 1;
        h = rng();
      } while (x * x + d * d + h * h > 1);
      const X = x * R * rhoMax;
      const D = d * R * rhoMax;
      const Hh = h * H * im.heightRange + im.heightBase;
      if ((X / R) ** 2 + (D / R) ** 2 + (Hh / H) ** 2 > (rhoMax * 0.92) ** 2) continue;
      let score = 1;
      for (const o of placed) score = Math.min(score, Math.hypot(X - o.x, D - o.d, Hh - o.h) - 0.78 * (r + o.r));
      if (score > bestScore) {
        bestScore = score;
        best = [X, D, Hh];
      }
    }
    // 후보가 모두 걸러진 극단적인 경우(거의 없음): 중앙 근처에 둔다
    const [X, D, Hh] = best ?? [0, 0, im.heightBase + 0.05];
    placed.push({
      type: q.type, x: X, d: D, h: Hh, r, mult: q.mult,
      rotDeg: p.rotationDeg[0] + (p.rotationDeg[1] - p.rotationDeg[0]) * rng(),
      flip: rng() < p.flipProbability,
    });
  }
  return { pieces: placed, dominant };
}

/** 투영에 필요한 시점별 값(mochi.json의 views.*) */
export interface ViewProjection {
  silhouetteBBox: [number, number, number, number];
  pxPerMeterAtBase: number;
  projection: { groundCenterY?: number; hkPxPerMeterVertical?: number; centerY?: number };
}

export interface Projected {
  /** 막 스프라이트 좌표(px)의 중심 위치 */
  sx: number;
  sy: number;
  /** 스프라이트 배율(원근 포함, 조각 크기 배율 제외) */
  persp: number;
  /** 앞쪽 표면에서 얼마나 안쪽인지 0~1 — 깊을수록 더 흐리고 우윳빛이 섞인다 */
  inside: number;
}

export const ELEVATION_RAD = (21 * Math.PI) / 180;

export function projectPiece(piece: Piece3D, view: 'front' | 'top', v: ViewProjection, p: FruitLayoutParams): Projected {
  const { R, H } = p.ellipsoid;
  const [x0, , x1] = v.silhouetteBBox;
  const cx = (x0 + x1) / 2;
  const k = v.pxPerMeterAtBase;
  if (view === 'front') {
    const yGc = v.projection.groundCenterY as number;
    const hk = v.projection.hkPxPerMeterVertical as number;
    const surf = -R * Math.sqrt(Math.max(0, 1 - (piece.x / R) ** 2 - (piece.h / H) ** 2));
    const inside = Math.min(1, Math.max(0, (piece.d - surf) / (2 * R)));
    return {
      sx: cx + piece.x * k,
      sy: yGc - piece.d * Math.sin(ELEVATION_RAD) * k - piece.h * hk,
      persp: 1.6 / (1.6 + piece.d * Math.cos(ELEVATION_RAD)),
      inside,
    };
  }
  const hs = H * Math.sqrt(Math.max(0, 1 - (piece.x / R) ** 2 - (piece.d / R) ** 2));
  return {
    sx: cx + piece.x * k,
    sy: (v.projection.centerY as number) - piece.d * k,
    persp: 1,
    inside: Math.min(1, Math.max(0, (hs - piece.h) / H)),
  };
}

/** 그리는 순서: 정면은 먼 것부터(d 큰 것), 위는 낮은 것부터(h 작은 것) */
export function drawOrder(pieces: readonly Piece3D[], view: 'front' | 'top'): Piece3D[] {
  return [...pieces].sort((a, b) => (view === 'front' ? b.d - a.d : a.h - b.h));
}

/** 조각 하나의 깊이 효과 값 */
export function depthEffect(inside: number, p: FruitLayoutParams, frameWidthScale: number): { blurPx: number; tint: number; opacity: number } {
  const de = p.depthEffects;
  return {
    blurPx: (de.blurBasePxAtFrame900 + de.blurPerDepthPxAtFrame900 * inside) * frameWidthScale,
    tint: de.tintBase + de.tintPerDepth * inside,
    opacity: de.opacityBase - de.opacityLossPerDepth * inside,
  };
}
