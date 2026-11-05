// 화면 레이아웃 모드와 논리 좌표 크기(런타임 값). 순수 로직(DOM 없음).
//  - landscape: PC와 모바일 가로 — 기존과 같은 1280×720 고정(16:9, 레터박스).
//  - portrait : 모바일(터치 기기) 세로 — 가로 720 고정, 세로는 화면 비율에 맞춰 1100~1600(전체 화면을 채운다. 레터박스 없음).
// 게임 코드는 STAGE_W/STAGE_H 상수 대신 layout.w / layout.h 를 읽는다. 모드가 바뀌면 onLayoutChange 구독자가 캔버스·배치를 다시 만든다.
import { STAGE_H, STAGE_W } from './constants';

export type LayoutMode = 'landscape' | 'portrait';

export const PORTRAIT_W = 720;
export const PORTRAIT_H_MIN = 1100;
export const PORTRAIT_H_MAX = 1600;
/** 세로 화면의 기본(9:16) 높이 */
export const PORTRAIT_H_DEFAULT = 1280;

export interface Layout {
  mode: LayoutMode;
  /** 논리 좌표계 크기 */
  w: number;
  h: number;
  /** 바뀔 때마다 올라가는 번호(캐시 무효화용) */
  version: number;
}

export const layout: Layout = { mode: 'landscape', w: STAGE_W, h: STAGE_H, version: 0 };

/** 모드와 창 크기에서 논리 크기를 정한다(순수 함수) */
export function layoutSizeFor(mode: LayoutMode, winW: number, winH: number): { w: number; h: number } {
  if (mode === 'landscape') return { w: STAGE_W, h: STAGE_H };
  const h = Math.floor((PORTRAIT_W * winH) / Math.max(1, winW)); // 내림: 스테이지가 화면보다 커지지 않아 배율이 정확히 winW/720
  return { w: PORTRAIT_W, h: Math.min(PORTRAIT_H_MAX, Math.max(PORTRAIT_H_MIN, h)) };
}

/**
 * 방향 정책: 창(화면)이 세로형이면 기기와 상관없이 세로 모드, 아니면 가로 모드다(PC에서 창을 좁혀도 반응형으로 바뀐다).
 * 정사각형에 가까운 창에서 모드가 깜빡이지 않도록 세로가 가로의 1.1배를 넘을 때만 세로로 본다. 가로 회전 안내는 없다.
 * isMobile은 모드에는 영향이 없고(손 인식 비활성화 등 다른 정책에만 쓴다), 호환을 위해 인자로 남겨 둔다.
 */
export function decideLayoutMode(winW: number, winH: number, _isMobile = false): LayoutMode {
  return winH > winW * 1.1 ? 'portrait' : 'landscape';
}

type Listener = (l: Layout) => void;
const listeners = new Set<Listener>();

/** 레이아웃 변경 구독. 해제 함수를 돌려준다 */
export function onLayoutChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 모드·크기를 적용한다. 바뀌었으면 true(구독자에게 알린다). 세로 높이가 이 값(px) 미만으로만 달라지면 무시해 주소창 변화 등에 불필요한 재배치를 막는다 */
export function applyLayout(mode: LayoutMode, w: number, h: number, minHeightDelta = 60): boolean {
  const modeChanged = mode !== layout.mode;
  if (!modeChanged && w === layout.w && Math.abs(h - layout.h) < minHeightDelta) return false;
  layout.mode = mode;
  layout.w = w;
  layout.h = h;
  layout.version += 1;
  for (const cb of [...listeners]) cb(layout);
  return true;
}

/** 테스트용: 가로 기본값으로 되돌린다 */
export function resetLayout(): void {
  layout.mode = 'landscape';
  layout.w = STAGE_W;
  layout.h = STAGE_H;
  layout.version = 0;
  listeners.clear();
}

/** 모드별 게임 조정값: 세로는 화면이 좁고 길어서 낙하 속도를 올리고 오브젝트를 약간 줄인다 */
export function gameTuning(): { speedScale: number; sizeScale: number; spawnMarginX: number } {
  return layout.mode === 'portrait' ? { speedScale: 1.4, sizeScale: 0.85, spawnMarginX: 80 } : { speedScale: 1, sizeScale: 1, spawnMarginX: 110 };
}

/** 모드별 찹쌀떡 배치(논리 좌표). 가로는 기존 상수와 같고, 세로는 화면 아래쪽 책상 위에 더 크게 놓는다 */
export function frontLayout(): { scale: number; centerX: number; groundY: number; horizonY: number } {
  if (layout.mode === 'portrait') {
    const groundY = Math.round(layout.h * 0.68);
    return { scale: 0.5, centerX: layout.w / 2, groundY, horizonY: groundY - 300 };
  }
  return { scale: 0.44, centerX: 640, groundY: 590, horizonY: 330 };
}

/** 이 기기가 모바일(터치 기기)인지: Stage가 화면 크기를 정할 때마다 갱신한다. 모바일은 손 인식(웹캠 손가락)을 쓰지 않는다 */
export const device = { mobile: false };
