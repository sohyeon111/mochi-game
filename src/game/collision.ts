// 입 영역(타원) ↔ 오브젝트 실루엣(여러 개의 원) 충돌 판정. DOM 없는 순수 로직 (SPEC 7.2, 7.2.1).
// - 투명 여백이 아니라 collision.json의 실루엣 기반 원만 충돌 영역으로 쓴다.
// - "물체 중심"은 실루엣 무게중심이다.
import { GAME } from '../app/constants';
import type { MouthInput } from '../vision/types';
import type { FallingObject, ShapeMeta, ShapeTable } from './types';

export interface WorldCircle {
  x: number;
  y: number;
  r: number;
}

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** 스프라이트 좌표(좌상단 기준) 한 점을 오브젝트의 현재 위치·크기·회전으로 변환 */
export function spriteToWorld(px: number, py: number, shape: ShapeMeta, o: Pick<FallingObject, 'x' | 'y' | 'scale' | 'rot'>): { x: number; y: number } {
  const lx = (px - shape.w / 2) * o.scale;
  const ly = (py - shape.h / 2) * o.scale;
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
}

export function worldCircles(o: FallingObject, shape: ShapeMeta, shrink: number = GAME.HIT_SHRINK): WorldCircle[] {
  return shape.circles.map((c) => {
    const p = spriteToWorld(c.x, c.y, shape, o);
    return { x: p.x, y: p.y, r: c.r * o.scale * shape.hitScale * shrink };
  });
}

export function worldCentroid(o: FallingObject, shape: ShapeMeta): { x: number; y: number } {
  return spriteToWorld(shape.centroid[0], shape.centroid[1], shape, o);
}

/** 원과 타원이 겹치는지. 타원 경계까지의 거리를 1차 근사(Sampson)로 구한다. */
export function circleOverlapsEllipse(c: WorldCircle, e: Ellipse): boolean {
  if (e.rx <= 0 || e.ry <= 0) return false;
  const dx = c.x - e.x;
  const dy = c.y - e.y;
  const f = Math.sqrt((dx / e.rx) ** 2 + (dy / e.ry) ** 2); // 1이면 경계
  if (f <= 1) return true; // 원의 중심이 타원 안
  // f(p)=sqrt(..)의 기울기 크기로 경계까지의 거리를 근사
  const gx = dx / (e.rx * e.rx * f);
  const gy = dy / (e.ry * e.ry * f);
  const grad = Math.hypot(gx, gy);
  if (grad < 1e-12) return false;
  return (f - 1) / grad <= c.r;
}

/** 입 충돌 영역: 너무 작은 입은 플레이가 가능하도록 최소 반경을 보장한다 */
export function mouthEllipse(m: MouthInput): Ellipse {
  return {
    x: m.center.x,
    y: m.center.y,
    rx: Math.max(m.radiusX, GAME.MIN_MOUTH_RX),
    ry: Math.max(m.radiusY, GAME.MIN_MOUTH_RY),
  };
}

export interface Hit {
  object: FallingObject;
  /** 입 중심과 물체 중심(실루엣 무게중심) 사이 거리 */
  distance: number;
}

/**
 * 입과 겹친 처리 전 오브젝트를 **입 중심에 가까운 순서**로 돌려준다. 거리가 같으면 먼저 생성된(seq가 작은) 것이 먼저.
 * 입이 닫혀 있거나 얼굴(입력)이 없으면 아무것도 돌려주지 않는다.
 */
export function findHits(objects: readonly FallingObject[], mouth: MouthInput, shapes: ShapeTable, shrink: number = GAME.HIT_SHRINK): Hit[] {
  if (!mouth.isOpen || !mouth.faceDetected) return [];
  const e = mouthEllipse(mouth);
  const hits: Hit[] = [];
  for (const o of objects) {
    if (o.handled) continue;
    const shape = shapes[o.assetKey];
    if (!shape) continue;
    const overlaps = worldCircles(o, shape, shrink).some((c) => circleOverlapsEllipse(c, e));
    if (!overlaps) continue;
    const cen = worldCentroid(o, shape);
    hits.push({ object: o, distance: Math.hypot(cen.x - mouth.center.x, cen.y - mouth.center.y) });
  }
  hits.sort((a, b) => a.distance - b.distance || a.object.seq - b.object.seq);
  return hits;
}
