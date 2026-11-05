// 손가락 끝(영상 정규화 좌표) → 게임 논리 좌표(1280×720). 얼굴 입 위치와 같은 변환(좌우 반전 + object-fit: cover)을 쓴다. 순수 로직.
import { layout } from '../app/layout';
import { normalizedToStage } from './mouthPosition';
import type { Size } from './types';

/**
 * 손가락 끝 5개(정규화 [x,y]×5)를 스테이지 좌표 [x,y]×5로 바꿔 out에 쓴다(배열을 새로 만들지 않는다).
 * - mirror: 웹캠 영상은 거울처럼 좌우 반전해 보여 주므로 x를 뒤집는다(사용자가 보는 손 위치와 일치)
 * - cover: 영상 비율이 16:9가 아니면 잘리는 가장자리가 있다 → 잘린 바깥은 스테이지 밖 좌표가 된다(clamp는 호출자가 결정)
 */
export function tipsToStage(tips: ArrayLike<number>, video: Size, out: Float64Array, mirror = true, stage: Size = { w: layout.w, h: layout.h }): void {
  const p = { x: 0, y: 0 };
  for (let i = 0; i < 5; i++) {
    p.x = tips[i * 2] as number;
    p.y = tips[i * 2 + 1] as number;
    const s = normalizedToStage(p, video, mirror, stage);
    out[i * 2] = s.x;
    out[i * 2 + 1] = s.y;
  }
}

/** 화면(스테이지) 안쪽으로 얼마나 들어와 있는지: 가장자리에서의 여유(px). 음수면 밖 */
export function insideMargin(x: number, y: number, stage: Size = { w: layout.w, h: layout.h }): number {
  return Math.min(x, y, stage.w - x, stage.h - y);
}
