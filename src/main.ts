// 앱 진입점: 스테이지·화면·입력을 만들고 부팅한다.
import { App } from './app/app';
import { prof } from './app/profiler';
import { APP_NAME } from './app/meta';
import { createCalibrationScreen } from './screens/calibration';
import { createLoadingScreen, createPermissionScreen, createTitleScreen } from './screens/basic';
import { createMochiIntroScreen, createMochiStretchScreen, createMochiTouchScreen } from './screens/mochi';
import { GameView } from './game/gameView';
import { MochiView } from './mochi/mochiView';
import { createPausedScreen, createPlayingScreen, createResultScreen, createTutorialScreen } from './screens/play';
import type { ScreenCtx } from './screens/types';
import { DebugPanel } from './ui/debugPanel';
import { HandDebugPanel } from './ui/handDebug';
import { ScreenManager } from './ui/screenManager';
import { Stage } from './ui/stage';
import { FallbackInput } from './vision/inputFallback';
import './styles/main.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app 요소를 찾을 수 없습니다.');
document.title = APP_NAME;

const app = new App();
const stage = new Stage(root);
const ctx: ScreenCtx = { app, stage };
const manager = new ScreenManager(app, stage);
const game = new GameView(app, stage);
const mochiView = new MochiView(app, stage);
app.mochiView = mochiView;

for (const create of [
  createLoadingScreen, createTitleScreen, createPermissionScreen, createCalibrationScreen, createTutorialScreen,
  createPausedScreen, createResultScreen, createMochiIntroScreen, createMochiStretchScreen, createMochiTouchScreen,
]) {
  manager.register(create(ctx));
}
manager.register(createPlayingScreen(ctx, game.hud));

// 대체 입력: 입력 모드가 fallback일 때만 켠다
const fallback = new FallbackInput(stage.stage, app.hub, stage.toStage);
const syncFallback = (): void => {
  if (app.store.state.inputMode === 'fallback') fallback.enable();
  else fallback.disable();
};
app.store.subscribe((_s, changed) => {
  if (changed.includes('inputMode')) syncFallback();
});

// 개발 패널은 개발 서버(DEV)에서만 만든다: 배포 번들에는 포함되지 않는다(화면 위를 덮는 검은 패널과 주기적 갱신이 없다).
if (import.meta.env.DEV) {
  new DebugPanel(app, stage, game);
  new HandDebugPanel(app, stage);
}

// 검증용으로 콘솔·자동화에서 접근할 수 있게 노출한다(개발 단계 한정).
(window as unknown as { __mochi: unknown }).__mochi = { app, stage, manager, fallback, game, mochi: mochiView, prof };

manager.show('LOADING', null);
syncFallback();
