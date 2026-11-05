// 화면 전환, 웹캠 배경/오버레이 처리, 뒤로가기 버튼과 PLAYING 확인창, 입 위치 표시를 관리한다.
import type { App } from '../app/app';
import { BACK_BEHAVIOR, type State } from '../app/stateMachine';
import type { Screen } from '../screens/types';
import { button, h } from './dom';
import { MouthMarker } from './mouthMarker';
import type { Stage } from './stage';

export class ScreenManager {
  private screens = new Map<State, Screen>();
  private current: Screen | null = null;
  private backBtn: HTMLButtonElement;
  private confirm: HTMLElement;
  readonly marker: MouthMarker;

  constructor(private app: App, private stage: Stage) {
    this.marker = new MouthMarker(app.hub);
    this.backBtn = h('button', { class: 'back-btn', text: '‹', attrs: { type: 'button', 'aria-label': '뒤로가기' }, on: { click: () => this.onBack() } });
    this.confirm = h('div', { class: 'modal', attrs: { hidden: '' } },
      h('div', { class: 'modal-card' },
        h('h3', { class: 'h2', text: '정말 나갈까요?' }),
        h('p', { class: 'sub', text: '지금 나가면 이번 라운드가 끝나요. 그래도 나갈까요?' }),
        h('div', { class: 'row' },
          button('계속하기', () => this.setConfirm(false)),
          button('나가기', () => {
            this.setConfirm(false);
            this.app.send('home');
          }, 'btn btn-secondary'))));
    stage.overlayLayer.append(this.marker.canvas, this.backBtn, this.confirm);
    stage.bgLayer.append(app.video);
    app.machine.onTransition((from, to) => this.show(to, from));
    app.camera.onChange(() => this.updateBackground());
    app.store.subscribe((_s, changed) => {
      if (changed.includes('inputMode')) this.updateBackground();
    });
  }

  register(screen: Screen): void {
    screen.el.hidden = true;
    this.screens.set(screen.id, screen);
    this.stage.screenLayer.append(screen.el);
  }

  show(id: State, from: State | null): void {
    const next = this.screens.get(id);
    if (!next) return;
    this.setConfirm(false);
    this.current?.exit?.();
    if (this.current) this.current.el.hidden = true;
    this.current = next;
    next.el.hidden = false;
    this.stage.stage.dataset['screen'] = id;
    this.stage.dimLayer.dataset['dim'] = next.dim;
    this.marker.setVisible(next.showMouth);
    const back = BACK_BEHAVIOR[id];
    this.backBtn.hidden = back === 'none';
    this.updateBackground();
    next.enter?.(from ?? 'LOADING');
  }

  /** 웹캠 영상은 usesCamera 화면에서 스트림이 켜져 있을 때만 보인다 */
  private updateBackground(): void {
    const show = !!this.current?.usesCamera && this.app.camera.isActive() && this.app.store.state.inputMode === 'camera';
    this.app.video.classList.toggle('visible', show);
    this.stage.stage.classList.toggle('has-camera', show);
    // 카메라 화면인데 영상이 없을 때(대체 입력 모드 등)는 흰 글씨가 보이도록 어두운 배경을 깐다
    this.stage.stage.classList.toggle('dark-bg', !!this.current?.usesCamera && !show);
  }

  private onBack(): void {
    const id = this.app.machine.state;
    const rule = BACK_BEHAVIOR[id];
    if (rule === 'home') this.app.send('home');
    else if (rule === 'confirm') this.setConfirm(true);
  }

  /** 확인창을 열면 게임이 멈추고(uiPaused), 닫으면 이어진다 */
  private setConfirm(open: boolean): void {
    this.confirm.hidden = !open;
    this.app.store.set({ uiPaused: open });
  }
}
