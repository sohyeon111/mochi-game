// 개발·검증용 패널: 현재 상태, 카메라/얼굴 인식 상태, 입 판정 수치를 보여주고 화면 이동을 직접 시험할 수 있게 한다.
// F2 키 또는 DEV 버튼으로 펼친다(처음에는 접혀 있다). 개발 서버(DEV)에서만 만들어진다(main.ts).
import type { App } from '../app/app';
import type { GameView } from '../game/gameView';
import { STATES, type State } from '../app/stateMachine';
import { button, h } from './dom';
import type { Stage } from './stage';

export class DebugPanel {
  private body: HTMLElement;
  private info: HTMLPreElement;
  private toggle: HTMLButtonElement;

  constructor(private app: App, stage: Stage, game: GameView) {
    this.info = h('pre', { class: 'dbg-info' });
    const jump = h('div', { class: 'dbg-jump' });
    for (const s of STATES) jump.append(button(s, () => app.machine.devJump(s as State), 'dbg-btn'));
    const actions = h('div', { class: 'dbg-actions' },
      button('카메라 켜기', () => void app.startCamera(), 'dbg-btn'),
      button('카메라 끄기', () => app.releaseCamera(), 'dbg-btn'),
      button('대체 입력 모드', () => app.useFallbackMode(), 'dbg-btn'),
      button('충돌 형상 표시(C)', () => (game.debugCollision = !game.debugCollision), 'dbg-btn'),
      button('강제 성공(개발용)', () => game.forceEnd(true), 'dbg-btn'),
      button('강제 실패(개발용)', () => game.forceEnd(false), 'dbg-btn'),
      button('로그 복사', () => void navigator.clipboard?.writeText(app.logs.join('\n')), 'dbg-btn'));
    this.body = h('div', { class: 'dbg-body' }, this.info, h('div', { class: 'dbg-title', text: '화면 이동(개발용)' }), jump, actions);
    this.body.hidden = true; // 처음에는 접어 둔다(DEV 버튼 또는 F2로 펼침): 화면을 가리지 않고 갱신 비용도 없다
    this.toggle = h('button', { class: 'dbg-toggle', text: 'DEV', attrs: { type: 'button' }, on: { click: () => this.setOpen(this.body.hidden === true) } });
    const panel = h('div', { class: 'dbg' }, this.toggle, this.body);
    stage.overlayLayer.append(panel);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        this.setOpen(this.body.hidden === true);
      }
    });
    window.setInterval(() => this.refresh(), 200);
    this.refresh();
  }

  private setOpen(open: boolean): void {
    this.body.hidden = !open;
  }

  private refresh(): void {
    if (this.body.hidden === true) return;
    const a = this.app;
    const d = a.pipeline.debug;
    const cam = a.camera.snapshot();
    const cal = a.store.state.calibration ?? a.detector.calibration;
    this.info.textContent = [
      `화면: ${a.machine.state}`,
      `입력 모드: ${a.store.state.inputMode} / 권한: ${a.store.state.permission}`,
      `카메라: ${cam.status}${cam.error ? ` (${cam.error})` : ''} ${cam.width ? `${cam.width}x${cam.height}` : ''}`,
      `  getUserMedia 호출 ${a.camera.acquireCalls}회, 트랙 ${cam.trackCount}개`,
      `얼굴 인식: ${a.tracker.status}${a.tracker.delegate ? ` (${a.tracker.delegate})` : ''}${a.tracker.error ? ` ${a.tracker.error}` : ''}`,
      `파이프라인: ${d.running ? '실행 중' : '정지'} ${d.fps}fps, ${d.lastDetectMs.toFixed(1)}ms/프레임`,
      `얼굴: ${d.face ? '감지됨' : '없음'} / 입: ${d.isOpen ? '열림' : '닫힘'}`,
      `jawOpen 원시 ${d.rawJawOpen.toFixed(3)} / 평활 ${d.smoothedJawOpen.toFixed(3)} / openness ${d.openness.toFixed(2)}`,
      `입 중심 (${d.center.x.toFixed(0)}, ${d.center.y.toFixed(0)}) 반경 ${d.radiusX.toFixed(0)}×${d.radiusY.toFixed(0)}`,
      `보정: 다문 ${cal.closedBase.toFixed(3)} / 벌린 ${cal.openMax.toFixed(3)}${a.store.state.calibration ? '' : ' (기본값)'}`,
      `영상 ${d.videoW}x${d.videoH}`,
    ].join('\n');
  }
}
