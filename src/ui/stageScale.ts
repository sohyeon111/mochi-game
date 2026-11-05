// 16:9 스테이지를 창 크기에 맞춰 레터박스로 스케일한다. 순수 로직.
import { layout } from '../app/layout';

export interface StageTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function computeStageTransform(winW: number, winH: number, stageW = layout.w, stageH = layout.h): StageTransform {
  const scale = Math.min(winW / stageW, winH / stageH);
  return {
    scale,
    offsetX: (winW - stageW * scale) / 2,
    offsetY: (winH - stageH * scale) / 2,
  };
}

/** 화면(client) 좌표 → 스테이지 논리 좌표 */
export function clientToStage(clientX: number, clientY: number, t: StageTransform): { x: number; y: number } {
  return { x: (clientX - t.offsetX) / t.scale, y: (clientY - t.offsetY) / t.scale };
}

/** 세로로 좁은 화면(휴대폰 세로)이면 가로 회전 안내를 보여야 한다 */
export function needsRotateNotice(winW: number, winH: number): boolean {
  return winH > winW && winW < 900;
}

/** 휴대폰·태블릿 등 거친 포인터(터치) 기기인지 — 데스크톱 권장 안내용 */
export function isLikelyMobile(userAgent: string, maxTouchPoints: number, coarsePointer: boolean): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (coarsePointer && maxTouchPoints > 0);
}
