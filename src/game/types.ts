import type { FruitId, ItemId } from '../app/constants';

export type ObjectKind = 'fruit' | 'trash';

export interface FallingObject {
  /** 생성 순서(동거리일 때 먼저 생성된 것이 우선) */
  seq: number;
  itemId: ItemId;
  kind: ObjectKind;
  /** 에셋 키: fruit_strawberry 처럼 collision.json의 키 */
  assetKey: string;
  /** 흔들림이 적용된 현재 중심 위치 (논리 좌표) */
  x: number;
  y: number;
  baseX: number;
  vy: number;
  /** 스프라이트 px → 스테이지 px 배율(기본 배율 × 크기 배율) */
  scale: number;
  rot: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  /** 생성 후 경과(ms) */
  age: number;
  /** 한 번 처리되면 true — 이후 충돌하지 않는다 */
  handled: boolean;
}

export interface CollectedRecord {
  itemId: FruitId;
  seq: number;
  /** 수집 시점의 경과 시간(ms) */
  at: number;
}

export type FailReason = 'trash' | 'timeout';

/** 라운드 결과 (RESULT 화면과 다음 단계의 떡 내부 과일 배치가 사용) */
export interface RoundResult {
  success: boolean;
  failReason: FailReason | null;
  elapsedMs: number;
  fruitCount: number;
  trashCount: number;
  /** 종류별 수집 개수(0도 포함) */
  fruitCounts: Record<FruitId, number>;
  /** 처음 수집한 순서(중복 제거) */
  firstOrder: FruitId[];
  /** 대표 과일: 가장 많이 수집, 동수이면 먼저 수집. 수집한 과일이 없으면 null */
  representative: FruitId | null;
  /** 수집한 모든 과일(순서대로) — 다른 과일 정보도 보존 */
  collected: CollectedRecord[];
}

/** 충돌 에셋 정보(collision.json 한 항목) */
export interface ShapeMeta {
  /** 스프라이트 크기(여백 제거 후 px) */
  w: number;
  h: number;
  /** 실루엣 무게중심(스프라이트 px) — "물체 중심" */
  centroid: [number, number];
  circles: Array<{ x: number; y: number; r: number }>;
  hitScale: number;
}

export type ShapeTable = Record<string, ShapeMeta>;
