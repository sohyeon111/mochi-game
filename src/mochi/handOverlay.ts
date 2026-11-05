// 손가락 끝 표시: 웹캠 영상은 찹쌀떡 화면에 보이지 않으므로, 사용자가 자신의 손가락이 화면의 어디에 있는지 알 수 있게 손가락 끝에 점을 그린다.
// 누르는 중이면 점이 커지고 고리가 생긴다. 손바닥은 그리지 않는다. 바뀐 것이 있을 때만 다시 그린다(정지 중 비용 없음).
import { layout } from '../app/layout';
import { FINGER_NAMES, FONT_FAMILY } from '../app/constants';
import type { FingerContact } from '../vision/handContact';
import { h } from '../ui/dom';

export class HandOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lastKey = '';

  constructor() {
    this.canvas = h('canvas', { class: 'mochi-canvas mochi-hand', attrs: { width: String(layout.w), height: String(layout.h), 'aria-hidden': 'true' } });
    this.canvas.hidden = true;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    this.ctx = ctx;
  }

  /** 캔버스 크기가 바뀐 뒤 다시 그리게 한다 */
  reset(): void {
    this.lastKey = '';
  }

  /**
   * status: 'off' 손 추적이 꺼져 있음(아무것도 그리지 않음) / 'searching' 추적 중이지만 손이 안 보임(안내 문구) / 'tracking' 손이 보임(손가락 끝 점).
   * 점의 위치·눌림이 바뀐 때만 다시 그린다.
   */
  draw(status: 'off' | 'searching' | 'tracking' | 'note', fingers: ReadonlyArray<FingerContact>, text = ''): void {
    if (status === 'searching' || status === 'note') {
      const msg = status === 'searching' ? '카메라에 손을 보여 주세요 — 손가락으로도 만질 수 있어요' : text;
      const key = `${status}:${msg}`;
      if (this.lastKey !== key) {
        this.lastKey = key;
        const c = this.ctx;
        c.clearRect(0, 0, layout.w, layout.h);
        c.font = `700 ${status === 'note' ? 17 : 20}px ${FONT_FAMILY}`;
        c.textAlign = 'center';
        c.lineWidth = 5;
        c.strokeStyle = 'rgba(255, 246, 234, 0.9)';
        c.fillStyle = status === 'note' ? 'rgba(150, 60, 50, 0.9)' : 'rgba(92, 54, 30, 0.85)';
        c.strokeText(msg, layout.w / 2, 112, layout.w - 80);
        c.fillText(msg, layout.w / 2, 112, layout.w - 80);
      }
      this.canvas.hidden = false;
      return;
    }
    if (status === 'off') {
      if (this.lastKey !== '') {
        this.ctx.clearRect(0, 0, layout.w, layout.h);
        this.lastKey = '';
      }
      this.canvas.hidden = true;
      return;
    }
    this.canvas.hidden = false;
    let key = '';
    for (const f of fingers) key += `${Math.round(f.x)},${Math.round(f.y)},${f.active ? Math.round(f.amount * 10) : -1};`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const c = this.ctx;
    c.clearRect(0, 0, layout.w, layout.h);
    for (const f of fingers) {
      if (f.x < -40 || f.y < -40 || f.x > layout.w + 40 || f.y > layout.h + 40) continue;
      const r = 11 + (f.active ? 8 * f.amount : 0);
      c.beginPath();
      c.arc(f.x, f.y, r, 0, Math.PI * 2);
      c.fillStyle = f.active ? 'rgba(255, 110, 130, 0.85)' : 'rgba(255, 190, 200, 0.8)';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = f.active ? 'rgba(168, 40, 70, 0.95)' : 'rgba(150, 70, 80, 0.9)';
      c.stroke();
      if (f.active) {
        c.beginPath();
        c.arc(f.x, f.y, r + 7, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255, 138, 152, 0.45)';
        c.stroke();
      }
    }
  }

  /** 손가락 이름(디버그·접근성용) */
  static name(id: number): string {
    return FINGER_NAMES[id] ?? '';
  }
}
