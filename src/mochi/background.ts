// MOCHI 화면 배경: 레퍼런스 사진 대신 Canvas로 직접 그린 따뜻한 벽 + 나무 책상(정면) / 나무 도마(위). 한 번 그려 두고 재사용한다.
import { layout } from '../app/layout';
import { mulberry32 } from '../game/rng';

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = layout.w;
  c.height = layout.h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

/** 나무 결: 가로로 흐르는 가는 선들과 옹이 */
function drawGrain(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, seed: number, strength: number): void {
  const rnd = mulberry32(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  for (let i = 0; i < 150; i++) {
    const y = y0 + rnd() * h;
    const amp = 2 + rnd() * 7;
    const freq = 0.004 + rnd() * 0.008;
    const ph = rnd() * 6.28;
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(98,56,24,${(0.05 + rnd() * 0.1) * strength})` : `rgba(255,224,170,${(0.04 + rnd() * 0.07) * strength})`;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    for (let x = x0; x <= x0 + w; x += 16) {
      const yy = y + Math.sin(x * freq + ph) * amp;
      if (x === x0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // 옹이
  for (let k = 0; k < 3; k++) {
    const kx = x0 + rnd() * w;
    const ky = y0 + rnd() * h;
    for (let r = 0; r < 5; r++) {
      ctx.strokeStyle = `rgba(90,50,20,${0.07 * strength})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 18 + r * 9, 7 + r * 3.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 정면(INTRO, STRETCH): 위쪽은 따뜻한 크림 벽, 아래쪽은 나무 책상 */
export function drawFrontBackground(horizonY: number): HTMLCanvasElement {
  const [c, ctx] = canvas();
  // 벽
  const wall = ctx.createLinearGradient(0, 0, 0, horizonY);
  wall.addColorStop(0, '#fff3e2');
  wall.addColorStop(1, '#f6dfc4');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, layout.w, horizonY);
  // 창에서 들어오는 빛(부드러운 원형)
  const glow = ctx.createRadialGradient(layout.w * 0.78, horizonY * 0.35, 20, layout.w * 0.78, horizonY * 0.35, 420);
  glow.addColorStop(0, 'rgba(255,255,240,0.65)');
  glow.addColorStop(1, 'rgba(255,255,240,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, layout.w, horizonY);
  // 책상
  const table = ctx.createLinearGradient(0, horizonY, 0, layout.h);
  table.addColorStop(0, '#c98d52');
  table.addColorStop(0.55, '#b5763f');
  table.addColorStop(1, '#8f5629');
  ctx.fillStyle = table;
  ctx.fillRect(0, horizonY, layout.w, layout.h - horizonY);
  drawGrain(ctx, 0, horizonY, layout.w, layout.h - horizonY, 1, 1);
  // 책상 모서리 하이라이트
  ctx.fillStyle = 'rgba(255,236,200,0.55)';
  ctx.fillRect(0, horizonY - 2, layout.w, 4);
  // 가장자리 비네팅
  const vg = ctx.createRadialGradient(layout.w / 2, layout.h / 2, layout.h * 0.45, layout.w / 2, layout.h / 2, layout.w * 0.72);
  vg.addColorStop(0, 'rgba(60,30,10,0)');
  vg.addColorStop(1, 'rgba(60,30,10,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, layout.w, layout.h);
  return c;
}
