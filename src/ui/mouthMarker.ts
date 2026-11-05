// 입 위치·열림 상태를 보여주는 표시(검증용). 카메라/대체 입력 모두 같은 MouthInput으로 그린다.
import { layout, onLayoutChange } from '../app/layout';
import { FONT_FAMILY } from '../app/constants';
import type { InputHub } from '../vision/inputHub';
import { h } from './dom';

export class MouthMarker {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private visible = false;

  constructor(private hub: InputHub) {
    this.canvas = h('canvas', { class: 'mouth-marker', attrs: { width: String(layout.w), height: String(layout.h) } });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    this.ctx = ctx;
    this.canvas.hidden = true;
    onLayoutChange(() => {
      this.canvas.width = layout.w;
      this.canvas.height = layout.h;
    });
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.canvas.hidden = !v;
    cancelAnimationFrame(this.raf);
    if (v) this.loop();
    else this.ctx.clearRect(0, 0, layout.w, layout.h);
  }

  private loop = (): void => {
    if (!this.visible) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, layout.w, layout.h);
    const i = this.hub.current();
    if (!i.faceDetected || i.radiusX <= 0) return;
    c.save();
    c.beginPath();
    c.ellipse(i.center.x, i.center.y, Math.max(6, i.radiusX), Math.max(6, i.radiusY), 0, 0, Math.PI * 2);
    c.lineWidth = 4;
    c.strokeStyle = i.isOpen ? '#2fbf71' : '#e0405a';
    c.fillStyle = i.isOpen ? 'rgba(47,191,113,0.28)' : 'rgba(224,64,90,0.16)';
    c.fill();
    c.stroke();
    c.fillStyle = '#fff';
    c.font = `20px ${FONT_FAMILY}`;
    c.textAlign = 'center';
    c.fillText(i.isOpen ? '열림' : '닫힘', i.center.x, i.center.y - Math.max(6, i.radiusY) - 10);
    c.restore();
  }
}
