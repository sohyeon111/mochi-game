// MOCHI_INTRO: 떡 전체가 위에서 떨어져 바닥에서 튕기고 안정되는 강체 움직임. 변형(눌림·출렁임)은 소프트바디가 맡는다. 순수 로직.
import { MOCHI } from '../app/constants';

export class IntroDrop {
  /** 바닥 위치 기준 세로 오프셋(≤0, 위쪽이 음수) */
  y: number;
  vy = 0;
  bounces = 0;
  private _settled = false;
  private acc = 0;

  constructor(startAbovePx: number) {
    this.y = -Math.abs(startAbovePx);
  }

  get settled(): boolean {
    return this._settled;
  }

  /** dtMs만큼 진행하고 이번에 움직인 양(dy)을 돌려준다 */
  step(dtMs: number): number {
    const before = this.y;
    this.acc += Math.min(dtMs, 100);
    const h = 1000 / 240;
    while (this.acc >= h) {
      this.acc -= h;
      if (this._settled) continue;
      const dt = h / 1000;
      this.vy += MOCHI.GRAVITY_PX_S2 * dt;
      this.y += this.vy * dt;
      if (this.y >= 0) {
        this.y = 0;
        if (Math.abs(this.vy) < 90 || this.bounces >= 4) {
          this.vy = 0;
          this._settled = true;
        } else {
          this.vy = -this.vy * MOCHI.INTRO_RESTITUTION;
          this.bounces++;
        }
      }
    }
    return this.y - before;
  }
}
