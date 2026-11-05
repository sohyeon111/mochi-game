import { describe, expect, it } from 'vitest';
import { GAME } from '../src/app/constants';
import { circleOverlapsEllipse, findHits, mouthEllipse, spriteToWorld, worldCentroid, worldCircles } from '../src/game/collision';
import type { FallingObject, ShapeTable } from '../src/game/types';
import type { MouthInput } from '../src/vision/types';
import collisionJson from '../public/assets/render/collision.json';

// 실제 collision.json을 그대로 사용한다
const raw = collisionJson as unknown as { assets: Record<string, { size: [number, number]; centroid: [number, number]; circles: Array<{ x: number; y: number; r: number }>; hitScale: number }> };
const shapes: ShapeTable = Object.fromEntries(Object.entries(raw.assets).map(([k, v]) => [k, { w: v.size[0], h: v.size[1], centroid: v.centroid, circles: v.circles, hitScale: v.hitScale }]));

let seq = 0;
function obj(assetKey: string, x: number, y: number, over: Partial<FallingObject> = {}): FallingObject {
  const kind = assetKey.startsWith('fruit') ? 'fruit' : 'trash';
  return { seq: seq++, itemId: assetKey.split('_')[1] as never, kind, assetKey, x, y, baseX: x, vy: 0, scale: 0.34, rot: 0, swayAmp: 0, swayFreq: 1, swayPhase: 0, age: 0, handled: false, ...over };
}
const mouth = (x: number, y: number, open = true, rx = 60, ry = 40): MouthInput => ({ isOpen: open, openness: open ? 1 : 0, center: { x, y }, radiusX: rx, radiusY: ry, faceDetected: true, timestamp: 0, source: 'fallback' });

describe('원-타원 겹침', () => {
  const e = { x: 0, y: 0, rx: 60, ry: 40 };
  it('원의 중심이 타원 안이면 겹침', () => {
    expect(circleOverlapsEllipse({ x: 10, y: 5, r: 1 }, e)).toBe(true);
  });
  it('x축 방향: 경계에서 반지름만큼 떨어져 있으면 겹침/아니면 비겹침', () => {
    expect(circleOverlapsEllipse({ x: 60 + 19, y: 0, r: 20 }, e)).toBe(true);
    expect(circleOverlapsEllipse({ x: 60 + 25, y: 0, r: 20 }, e)).toBe(false);
  });
  it('y축 방향(더 짧은 반지름)도 정확하다', () => {
    expect(circleOverlapsEllipse({ x: 0, y: 40 + 9, r: 10 }, e)).toBe(true);
    expect(circleOverlapsEllipse({ x: 0, y: 40 + 15, r: 10 }, e)).toBe(false);
  });
  it('반지름 0 이하 타원은 겹치지 않는다', () => {
    expect(circleOverlapsEllipse({ x: 0, y: 0, r: 10 }, { x: 0, y: 0, rx: 0, ry: 10 })).toBe(false);
  });
});

describe('좌표 변환', () => {
  it('회전 0, 배율 1이면 스프라이트 중심이 오브젝트 위치', () => {
    const s = shapes['fruit_orange']!;
    const p = spriteToWorld(s.w / 2, s.h / 2, s, { x: 100, y: 200, scale: 1, rot: 0 });
    expect(p).toEqual({ x: 100, y: 200 });
  });
  it('90도 회전: 스프라이트 오른쪽 점이 아래로 간다', () => {
    const s = shapes['fruit_orange']!;
    const p = spriteToWorld(s.w / 2 + 10, s.h / 2, s, { x: 0, y: 0, scale: 1, rot: Math.PI / 2 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
  it('원 반지름에 배율·hitScale·전역 축소가 곱해진다', () => {
    const s = { ...shapes['fruit_orange']!, hitScale: 0.5 };
    const c = worldCircles(obj('fruit_orange', 0, 0, { scale: 2 }), s, 0.8)[0]!;
    expect(c.r).toBeCloseTo(s.circles[0]!.r * 2 * 0.5 * 0.8);
  });
  it('물체 중심은 실루엣 무게중심(스프라이트 박스 중심이 아님)', () => {
    const s = shapes['trash_sock']!;
    const c = worldCentroid(obj('trash_sock', 500, 300, { scale: 1 }), s);
    expect(c.x).toBeCloseTo(500 + s.centroid[0] - s.w / 2);
    expect(c.y).toBeCloseTo(300 + s.centroid[1] - s.h / 2);
    expect(Math.abs(c.y - 300)).toBeGreaterThan(10); // 양말은 무게중심이 박스 중심과 다르다
  });
});

describe('findHits', () => {
  it('입이 닫혀 있으면 겹쳐도 아무것도 맞지 않는다', () => {
    const o = obj('fruit_orange', 400, 400);
    expect(findHits([o], mouth(400, 400, false), shapes)).toHaveLength(0);
  });
  it('입이 열려 있고 겹치면 맞는다', () => {
    expect(findHits([obj('fruit_orange', 400, 400)], mouth(400, 400), shapes)).toHaveLength(1);
  });
  it('얼굴(입력)이 없으면 맞지 않는다', () => {
    const m = { ...mouth(400, 400), faceDetected: false };
    expect(findHits([obj('fruit_orange', 400, 400)], m, shapes)).toHaveLength(0);
  });
  it('이미 처리된 오브젝트는 다시 맞지 않는다', () => {
    const o = obj('fruit_orange', 400, 400, { handled: true });
    expect(findHits([o], mouth(400, 400), shapes)).toHaveLength(0);
  });
  it('멀리 있는 오브젝트는 맞지 않는다', () => {
    expect(findHits([obj('fruit_orange', 900, 100)], mouth(400, 400), shapes)).toHaveLength(0);
  });
  it('투명 여백은 충돌 영역이 아니다: 박스 모서리(생선뼈의 빈 부분)에는 맞지 않는다', () => {
    const s = shapes['trash_fishbone']!;
    // 생선뼈 스프라이트 박스의 오른쪽 위 모서리(실루엣 원이 없는 투명 영역)
    const o = obj('trash_fishbone', 600, 300, { scale: 0.34 });
    const corner = spriteToWorld(s.w - 6, 6, s, o);
    expect(findHits([o], mouth(corner.x, corner.y, true, 20, 14), shapes)).toHaveLength(0);
    // 같은 오브젝트의 실루엣 원 한가운데에는 맞는다
    const c = worldCircles(o, s)[0]!;
    expect(findHits([o], mouth(c.x, c.y, true, 20, 14), shapes)).toHaveLength(1);
  });
  it('여러 개가 겹치면 입 중심에 가까운 순서', () => {
    const near = obj('fruit_orange', 410, 400);
    const far = obj('fruit_orange', 460, 400);
    const mid = obj('trash_can', 430, 400);
    const hits = findHits([far, near, mid], mouth(400, 400, true, 90, 60), shapes);
    expect(hits.map((h) => h.object.seq)).toEqual([near.seq, mid.seq, far.seq].filter((s) => hits.some((h) => h.object.seq === s)));
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance);
    expect(hits[0]!.object.seq).toBe(near.seq);
  });
  it('거리가 같으면 먼저 생성된(seq가 작은) 오브젝트가 먼저', () => {
    // 실루엣 무게중심이 입 중심에서 정확히 같은 거리(좌우 대칭)가 되도록 배치한다
    const s = shapes['fruit_orange']!;
    const scale = 0.34;
    const place = (cx: number): FallingObject => obj('fruit_orange', cx - (s.centroid[0] - s.w / 2) * scale, 400 - (s.centroid[1] - s.h / 2) * scale, { scale });
    const a = place(380);
    const b = place(420);
    const hits = findHits([b, a], mouth(400, 400, true, 90, 60), shapes); // 일부러 b를 배열 앞에 둔다
    expect(hits).toHaveLength(2);
    expect(Math.abs(hits[0]!.distance - hits[1]!.distance)).toBeLessThan(1e-9);
    expect(hits[0]!.object.seq).toBe(Math.min(a.seq, b.seq));
  });
  it('작은 입도 충돌용 최소 반경이 적용된다', () => {
    const e = mouthEllipse(mouth(0, 0, true, 5, 3));
    expect(e.rx).toBe(GAME.MIN_MOUTH_RX);
    expect(e.ry).toBe(GAME.MIN_MOUTH_RY);
  });
  it('전역 축소(HIT_SHRINK)를 줄이면 가장자리 충돌이 사라진다', () => {
    const s = shapes['fruit_orange']!;
    const o = obj('fruit_orange', 400, 400);
    const c = worldCircles(o, s)[0]!;
    const m = mouth(c.x + c.r + 30, c.y, true, 40, 40); // 원 가장자리 바깥 30px에 입 중심
    expect(findHits([o], m, shapes, 1.0)).toHaveLength(1);
    expect(findHits([o], m, shapes, 0.3)).toHaveLength(0);
  });
});
