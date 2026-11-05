// PLAYING HUD (DOM): 남은 시간, 재료 n/10 게이지, 쓰레기 n/3 게이지, 카운트다운, 시작·종료 배너.
// 구성은 레퍼런스 3번 화면을 가로형으로 옮긴 것이다(DESIGN_GUIDE 2.2, 7장).
import { GAME } from '../app/constants';
import { h } from '../ui/dom';

export interface HudSnapshot {
  remainingSec: number;
  fruitCount: number;
  trashCount: number;
  /** 5~1 카운트다운 숫자, 없으면 null */
  countdown: number | null;
  /** 시작/종료 배너 문구, 없으면 null */
  banner: string | null;
  bannerKind: 'start' | 'success' | 'fail';
}

export const formatTime = (sec: number): string => `00:${String(Math.max(0, sec)).padStart(2, '0')}`;

function gauge(total: number): { el: HTMLElement; slots: HTMLElement[] } {
  const slots = Array.from({ length: total }, () => h('span', { class: 'slot' }));
  return { el: h('div', { class: 'gauge' }, ...slots), slots };
}

export class Hud {
  readonly el: HTMLElement;
  private timer = h('div', { class: 'hud-timer', text: formatTime(GAME.DURATION_MS / 1000) });
  private fruitGauge = gauge(GAME.TARGET_FRUITS);
  private trashGauge = gauge(GAME.TRASH_FAIL_COUNT);
  private fruitNum = h('b', { text: '0' });
  private trashNum = h('b', { text: '0' });
  private countdown = h('div', { class: 'hud-countdown', attrs: { hidden: '' } });
  private banner = h('div', { class: 'hud-banner', attrs: { hidden: '' } });
  private last = '';

  constructor() {
    const row = (label: string, g: { el: HTMLElement }, num: HTMLElement, total: number): HTMLElement =>
      h('div', { class: 'hud-row' }, h('span', { class: 'hud-label', text: label }), g.el, h('span', { class: 'hud-count' }, num, ` / ${total}`));
    this.el = h('div', { class: 'hud' }, this.timer,
      h('div', { class: 'hud-rows' },
        row('재료', this.fruitGauge, this.fruitNum, GAME.TARGET_FRUITS),
        row('쓰레기', this.trashGauge, this.trashNum, GAME.TRASH_FAIL_COUNT)),
      this.countdown, this.banner);
  }

  update(s: HudSnapshot): void {
    const key = JSON.stringify(s);
    if (key === this.last) return; // 바뀐 것이 없으면 DOM을 건드리지 않는다
    this.last = key;
    this.timer.textContent = formatTime(s.remainingSec);
    this.timer.classList.toggle('urgent', s.remainingSec <= GAME.COUNTDOWN_FROM && s.remainingSec > 0);
    this.fruitGauge.slots.forEach((el, i) => el.classList.toggle('on', i < s.fruitCount));
    this.trashGauge.slots.forEach((el, i) => el.classList.toggle('on', i < s.trashCount));
    this.fruitNum.textContent = String(s.fruitCount);
    this.trashNum.textContent = String(s.trashCount);
    this.countdown.hidden = s.countdown === null;
    this.countdown.textContent = s.countdown === null ? '' : String(s.countdown);
    this.banner.hidden = s.banner === null;
    this.banner.textContent = s.banner ?? '';
    this.banner.dataset['kind'] = s.bannerKind;
  }
}
