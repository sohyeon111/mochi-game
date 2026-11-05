import type { App } from '../app/app';
import type { State } from '../app/stateMachine';
import type { Stage } from '../ui/stage';

export interface ScreenCtx {
  app: App;
  stage: Stage;
}

export type DimKind = 'none' | 'dim' | 'grad' | 'light';

export interface Screen {
  id: State;
  el: HTMLElement;
  /** 웹캠 영상을 배경으로 보이는 화면인지 */
  usesCamera: boolean;
  /** 배경 어둡게 처리(레퍼런스: 균일 70% / 상단 그라데이션 / 거의 없음) */
  dim: DimKind;
  /** 입 위치 표시를 보이는 화면인지 */
  showMouth: boolean;
  enter?(from: State): void;
  exit?(): void;
}
