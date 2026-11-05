// 스테이지(논리 좌표계)를 만들고 창 크기에 맞춰 스케일한다.
//  - 가로 모드(PC·모바일 가로): 1280×720을 레터박스로 맞춘다(기존과 같다).
//  - 세로 모드(모바일 세로): 가로 720 고정, 세로는 화면 비율에 맞춘 값으로 전체 화면을 채운다(레터박스 없음, 별도 레이아웃).
// 방향 정책과 논리 크기는 app/layout.ts. 주소창 변화·safe area는 visualViewport와 env(safe-area-inset-*)로 처리한다.
import { applyLayout, decideLayoutMode, device, layout, layoutSizeFor } from '../app/layout';
import { clientToStage, computeStageTransform, isLikelyMobile, type StageTransform } from './stageScale';
import { h } from './dom';

/** 개발 서버에서만 ?mobile=1 로 데스크톱에서도 모바일 레이아웃 정책을 시험할 수 있다 */
function forcedMobile(): boolean | null {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(location.search).get('mobile');
  return v === '1' ? true : v === '0' ? false : null;
}

export class Stage {
  readonly viewport: HTMLElement;
  readonly stage: HTMLElement;
  /** 웹캠 영상 / 배경 */
  readonly bgLayer: HTMLElement;
  /** 오버레이(어둡게) */
  readonly dimLayer: HTMLElement;
  /** 게임 캔버스(떨어지는 오브젝트) 레이어 — 오버레이 위, 화면(UI) 아래 */
  readonly gameLayer: HTMLElement;
  /** 화면(UI) 레이어 */
  readonly screenLayer: HTMLElement;
  /** 입 위치 표시, 뒤로가기, 디버그 등 */
  readonly overlayLayer: HTMLElement;
  private safeProbe: HTMLElement;
  private t: StageTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private timer = 0;

  constructor(root: HTMLElement) {
    this.bgLayer = h('div', { class: 'layer layer-bg' });
    this.dimLayer = h('div', { class: 'layer layer-dim' });
    this.gameLayer = h('div', { class: 'layer layer-game' });
    this.screenLayer = h('div', { class: 'layer layer-screens' });
    this.overlayLayer = h('div', { class: 'layer layer-overlay' });
    this.stage = h('div', { class: 'stage' }, this.bgLayer, this.dimLayer, this.gameLayer, this.screenLayer, this.overlayLayer);
    // safe area(노치·홈 인디케이터) 여백을 읽기 위한 보이지 않는 요소
    this.safeProbe = h('div', { class: 'safe-probe', attrs: { 'aria-hidden': 'true' } });
    this.viewport = h('div', { class: 'viewport' }, this.stage, this.safeProbe);
    root.append(this.viewport);
    const relayout = (): void => this.layout();
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => {
      // 일부 브라우저는 회전 직후 크기가 늦게 갱신된다
      relayout();
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(relayout, 250);
    });
    window.visualViewport?.addEventListener('resize', relayout);
    // iOS Safari: 핀치 확대·고무줄 스크롤 같은 브라우저 기본 제스처가 게임 입력을 가로채지 않게 한다
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.layout();
  }

  /** 모바일(터치 기기)인지: UA·터치 지점·거친 포인터로 판정 */
  isMobile(): boolean {
    const forced = forcedMobile();
    if (forced !== null) return forced;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return isLikelyMobile(navigator.userAgent, navigator.maxTouchPoints, coarse);
  }

  layout(): void {
    const vv = window.visualViewport;
    const w = this.viewport.clientWidth || vv?.width || window.innerWidth;
    const hh = this.viewport.clientHeight || vv?.height || window.innerHeight;
    device.mobile = this.isMobile();
    const mode = decideLayoutMode(w, hh, device.mobile);
    const size = layoutSizeFor(mode, w, hh);
    applyLayout(mode, size.w, size.h);
    this.t = computeStageTransform(w, hh, layout.w, layout.h);
    this.stage.style.width = `${layout.w}px`;
    this.stage.style.height = `${layout.h}px`;
    this.stage.style.transform = `translate(${this.t.offsetX}px, ${this.t.offsetY}px) scale(${this.t.scale})`;
    this.stage.dataset.orient = layout.mode;
    // safe area(CSS px) → 스테이지 단위로 바꿔 CSS 변수로 둔다(세로 모드는 전체 화면이라 노치·홈 바 아래로 UI가 들어가지 않게 쓴다)
    const cs = getComputedStyle(this.safeProbe);
    const k = this.t.scale > 0 ? 1 / this.t.scale : 1;
    const px = (v: string): number => (Number.parseFloat(v) || 0) * k;
    this.stage.style.setProperty('--safe-top', `${px(cs.paddingTop).toFixed(1)}px`);
    this.stage.style.setProperty('--safe-bottom', `${px(cs.paddingBottom).toFixed(1)}px`);
    this.stage.style.setProperty('--safe-left', `${px(cs.paddingLeft).toFixed(1)}px`);
    this.stage.style.setProperty('--safe-right', `${px(cs.paddingRight).toFixed(1)}px`);
  }

  get transform(): StageTransform {
    return this.t;
  }

  /** 화면 좌표 → 스테이지 논리 좌표 (뷰포트가 창 전체이므로 client 좌표 그대로 사용) */
  toStage = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = this.viewport.getBoundingClientRect();
    return clientToStage(clientX - r.left, clientY - r.top, this.t);
  };
}
