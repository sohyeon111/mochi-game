// 입술 랜드마크 → 논리 좌표(1280×720)의 입 중심·충돌 타원. 순수 로직 (SPEC 5장 6항).
import { layout } from '../app/layout';
import { LIP, MOUTH_AREA } from '../app/constants';
import type { Point, Size } from './types';

export interface CoverMap {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 영상(vw×vh)을 object-fit: cover로 스테이지에 채울 때의 배율과 오프셋 */
export function coverMap(video: Size, stage: Size = { w: layout.w, h: layout.h }): CoverMap {
  const scale = Math.max(stage.w / video.w, stage.h / video.h);
  return {
    scale,
    offsetX: (stage.w - video.w * scale) / 2,
    offsetY: (stage.h - video.h * scale) / 2,
  };
}

/** 정규화(0~1) 영상 좌표 → 스테이지 좌표. mirror면 좌우 반전(셀카처럼 보이게). */
export function normalizedToStage(p: Point, video: Size, mirror = true, stage: Size = { w: layout.w, h: layout.h }): Point {
  const m = coverMap(video, stage);
  const x = m.offsetX + p.x * video.w * m.scale;
  const y = m.offsetY + p.y * video.h * m.scale;
  return { x: mirror ? stage.w - x : x, y };
}

export interface MouthArea {
  center: Point;
  radiusX: number;
  radiusY: number;
}

/**
 * 안쪽 입술 랜드마크로 입 중심과 충돌 타원을 만든다.
 * - 중심: 입꼬리 중점의 x, 안쪽 윗/아랫입술 중점의 y
 * - radiusX: 입꼬리 간 절반 거리 × RX_SCALE
 * - radiusY: 입술 안쪽 절반 높이 × RY_SCALE, 단 열렸을 때 radiusX × MIN_RY_RATIO × openness 보다 작지 않게
 */
export function mouthAreaFromLandmarks(
  lm: readonly Point[],
  video: Size,
  openness: number,
  mirror = true,
  stage: Size = { w: layout.w, h: layout.h },
): MouthArea | null {
  const upper = lm[LIP.UPPER_INNER];
  const lower = lm[LIP.LOWER_INNER];
  const left = lm[LIP.CORNER_LEFT];
  const right = lm[LIP.CORNER_RIGHT];
  if (!upper || !lower || !left || !right) return null;

  const m = coverMap(video, stage);
  const center = normalizedToStage({ x: (left.x + right.x) / 2, y: (upper.y + lower.y) / 2 }, video, mirror, stage);
  const halfW = (Math.abs(right.x - left.x) / 2) * video.w * m.scale;
  const halfH = (Math.abs(lower.y - upper.y) / 2) * video.h * m.scale;
  const radiusX = halfW * MOUTH_AREA.RX_SCALE;
  const radiusY = Math.max(halfH * MOUTH_AREA.RY_SCALE, radiusX * MOUTH_AREA.MIN_RY_RATIO * Math.min(1, Math.max(0, openness)));
  return { center, radiusX, radiusY };
}
