// 게임 캔버스 그리기: 떨어지는 오브젝트, 수집 효과, (개발용) 충돌 형상 오버레이.
import { layout } from '../app/layout';
import { FONT_FAMILY, GAME } from '../app/constants';
import { mouthEllipse, spriteToWorld, worldCentroid, worldCircles } from './collision';
import type { GameAssets } from './assets';
import type { FallingObject, ShapeTable } from './types';
import type { MouthInput } from '../vision/types';

export interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}

export interface Fx {
  pops: Pop[];
  /** 쓰레기를 먹었을 때 화면 가장자리 번쩍임 시작 시각 */
  flashAt: number;
}

export function drawObjects(ctx: CanvasRenderingContext2D, objects: readonly FallingObject[], assets: GameAssets): void {
  for (const o of objects) {
    const img = assets.images[o.assetKey];
    const shape = assets.shapes[o.assetKey];
    if (!img || !shape) continue;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    // 과일은 따뜻한 빛, 쓰레기는 어두운 그림자로 한눈에 구분
    if (o.kind === 'fruit') {
      ctx.shadowColor = 'rgba(255, 236, 190, 0.95)';
      ctx.shadowBlur = 22;
    } else {
      ctx.shadowColor = 'rgba(20, 10, 10, 0.65)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
    }
    const w = shape.w * o.scale;
    const h = shape.h * o.scale;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

export function drawFx(ctx: CanvasRenderingContext2D, fx: Fx, now: number): void {
  // 쓰레기 번쩍임(화면 테두리)
  const fAge = now - fx.flashAt;
  if (fAge >= 0 && fAge < GAME.FLASH_MS) {
    const a = 1 - fAge / GAME.FLASH_MS;
    const g = ctx.createRadialGradient(layout.w / 2, layout.h / 2, layout.h * 0.35, layout.w / 2, layout.h / 2, layout.w * 0.7);
    g.addColorStop(0, 'rgba(224,64,90,0)');
    g.addColorStop(1, `rgba(224,64,90,${0.55 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.w, layout.h);
  }
  fx.pops = fx.pops.filter((p) => now - p.born < GAME.POP_MS);
  for (const p of fx.pops) {
    const t = (now - p.born) / GAME.POP_MS;
    ctx.save();
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 5;
    ctx.font = `800 40px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    const y = p.y - 30 - t * 60;
    ctx.strokeText(p.text, p.x, y);
    ctx.fillText(p.text, p.x, y);
    ctx.restore();
  }
}

/** 개발용: 충돌 원, 무게중심, 입 영역(충돌용 최소 반경 적용)을 그린다 */
export function drawCollisionDebug(ctx: CanvasRenderingContext2D, objects: readonly FallingObject[], shapes: ShapeTable, mouth: MouthInput): void {
  ctx.save();
  ctx.lineWidth = 2;
  for (const o of objects) {
    const shape = shapes[o.assetKey];
    if (!shape) continue;
    ctx.strokeStyle = o.kind === 'fruit' ? '#2fbf71' : '#e0405a';
    for (const c of worldCircles(o, shape)) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const cen = worldCentroid(o, shape);
    ctx.fillStyle = '#2a6bff';
    ctx.fillRect(cen.x - 3, cen.y - 3, 6, 6);
    const tl = spriteToWorld(0, 0, shape, o);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(tl.x - 2, tl.y - 2, 4, 4);
  }
  const e = mouthEllipse(mouth);
  ctx.strokeStyle = mouth.isOpen ? '#ffd400' : '#ffffff';
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
