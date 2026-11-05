// 모찌 렌더러: 뒷벽 → 우윳빛(합쳐 둠) → 과일 → 막 순서로 같은 메시를 워프해 그린다. 과일은 워프된 막 알파로 클리핑한다.
import { frontLayout, layout } from '../app/layout';
import { FRUIT_IDS, MOCHI } from '../app/constants';
import type { FruitInput } from './scene';
import { backWithMilk, composeFruitLayer, imageLayer, makeCanvas } from './fruitLayer';
import { MeshWarp, affineFromTriangles, type Dent, type Placement } from './meshWarp';
import type { MochiAssets, MochiViewData } from './assets';
import type { QualityTier } from './quality';
import type { SoftBody } from './softBody';
import { layoutFruits, type Piece3D } from './fruitLayout';
import type { GameAssets } from '../game/assets';
import { withRingResolution } from './ringResample';
import { prof } from '../app/profiler';
import { MeshGL } from './glMesh';
import { resolveRingOptions } from './ringConfig';

interface Layers {
  /** 뒷벽 + 우윳빛 + (막 모양으로 자른) 내부 과일 */
  back: HTMLCanvasElement;
  skin: HTMLCanvasElement;
  texScale: number;
}

/** 스프라이트 → 논리 좌표 배치. 바닥(ground)에 맞춘다. */
export function placementFor(v: MochiViewData): Placement {
  const [x0, , x1, y1] = v.silhouetteBBox;
  const f = frontLayout(); // 가로: 기존 상수 / 세로: 화면 아래 책상 위에 더 크게
  const s = f.scale;
  return { scale: s, ox: f.centerX - ((x0 + x1) / 2) * s, oy: f.groundY - y1 * s };
}

interface Rect { x: number; y: number; w: number; h: number }

export class MochiRenderer {
  /** 세밀한 메시(약 1.5배, 33×27). STRETCH에서 크게 변형될 때만 쓰고, 윤곽 근처만 세밀하게(적응형) 그린다 */
  readonly warp: MeshWarp;
  /** 기본 해상도 메시(22×18, mochi.json과 같은 격자): 변형이 작을 때와 TOUCH에서 쓴다 */
  readonly coarse: MeshWarp;
  private fineActive = false;
  private glDents: Array<{ x: number; y: number; radius: number; alpha: number }> = [];
  private fineCellSprite = 1;
  /** WebGL 메시 그리기(있으면 Canvas 2D의 삼각형별 clip+drawImage 대신 쓴다). 못 쓰면 null */
  private gl: MeshGL | null = null;
  /** 개발·비교용: false면 GL이 있어도 Canvas 경로로 그린다 */
  glEnabled = true;
  /** 개발용: true면 적응형이 아니라 모든 셀을 세밀하게 그린다(품질 비교) */
  forceFullMesh = false;
  readonly placement: Placement;
  readonly viewData: MochiViewData;
  private layers: Layers | null = null;
  private bufS = makeCanvas(layout.w, layout.h);
  private bufM = makeCanvas(layout.w, layout.h);
  private bufB = makeCanvas(layout.w, layout.h);
  private pieces: Piece3D[] = [];
  /** 프레임마다 그린 삼각형 수(측정용) */
  lastTriangles = 0;

  constructor(private assets: MochiAssets, private gameAssets: GameAssets) {
    this.viewData = withRingResolution(assets.data.views.front, resolveRingOptions());
    this.placement = placementFor(this.viewData);
    this.warp = new MeshWarp(this.viewData, this.placement);
    const ro = resolveRingOptions();
    this.coarse = new MeshWarp(withRingResolution(assets.data.views.front, { ...ro, meshScale: 1, rebuild: true }), this.placement);
    const m = this.viewData.warpMesh;
    this.fineCellSprite = (m.bounds[2] - m.bounds[0]) / (m.cols - 1);
  }

  /** WebGL 그리기를 붙인다. 성공하면 true(이후 draw는 이 캔버스에 그리고 ctx에는 그리지 않는다) */
  attachGL(canvas: HTMLCanvasElement): boolean {
    this.gl = MeshGL.create(canvas);
    this.layers = null;
    return this.gl !== null;
  }

  /** 개발용: GL 작업이 끝날 때까지 기다린다(측정 전용) */
  finishGL(): void {
    this.gl?.finish();
  }

  /** 지금 WebGL로 그리고 있는지 */
  get usingGL(): boolean {
    return !!this.gl && this.glEnabled && !this.gl.isLost;
  }

  /** 지금 세밀한 메시로 그리는지(측정용) */
  get usingFineMesh(): boolean {
    return this.fineActive;
  }

  /** 소프트바디의 기준 링(논리 좌표)을 돌려준다 */
  restRing(): { x: number[]; y: number[] } {
    return { x: [...this.warp.ringRest.x], y: [...this.warp.ringRest.y] };
  }

  /** 라운드 결과에 따른 과일 배치(3D)를 받아 둔다. 레이어는 다음 그리기에서 만든다. */
  setPieces(pieces: Piece3D[]): void {
    this.pieces = pieces;
    this.layers = null;
  }

  invalidate(): void {
    this.layers = null;
  }

  private ensureLayers(tier: QualityTier): Layers {
    const texScale = this.placement.scale * 1.25 * tier.textureScale;
    if (this.layers && Math.abs(this.layers.texScale - texScale) < 1e-6) return this.layers;
    const a = this.assets;
    const skinImg = a.skin;
    const skin = imageLayer(skinImg, texScale);
    const back = backWithMilk(a.back, skinImg, texScale, a.data.fruitLayout.depthEffects.milkFill);
    const fruit = composeFruitLayer(
      this.pieces, 'front', this.viewData, a.data.fruitLayout,
      { front: Object.fromEntries(FRUIT_IDS.map((id) => [id, this.gameAssets.images[`fruit_${id}`] as HTMLImageElement])) , top: {} },
      texScale,
    );
    // 과일은 막 모양으로 잘라(기본 형태에서 한 번) 뒷벽에 합쳐 둔다: 같은 메시로 함께 워프되므로 프레임마다 과일 메시를 따로 그리고
    // 워프된 막으로 다시 자르던 것과 결과가 같고, 메시 그리기 1/3과 전체 화면 합성 패스가 사라진다.
    // 막 알파를 3번 겹쳐 중앙(알파 약 0.4)에서도 충분히 불투명하게(합성 테스트의 알파×1.6 근사)
    const fctx = fruit.getContext('2d') as CanvasRenderingContext2D;
    fctx.globalCompositeOperation = 'destination-in';
    const mask = makeCanvas(fruit.width, fruit.height);
    const mctx = mask.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < 3; i++) mctx.drawImage(skin, 0, 0, mask.width, mask.height);
    fctx.drawImage(mask, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    (back.getContext('2d') as CanvasRenderingContext2D).drawImage(fruit, 0, 0, back.width, back.height);
    this.layers = { texScale, skin, back };
    this.gl?.setTextures(back, skin);
    return this.layers;
  }

  /** 소프트바디의 현재 모양으로 모찌를 그린다 */
  draw(ctx: CanvasRenderingContext2D, body: SoftBody, tier: QualityTier, dents: readonly Dent[], nDents: number, stretch = false): void {
    const L = this.ensureLayers(tier);
    // 세밀한 메시는 STRETCH에서 크게 변형됐을 때만 쓴다(작은 변형에서는 두 메시의 차이가 몇 px 이하). 경계에 이력을 둬 깜빡이지 않게 한다
    if (stretch) {
      const d = body.maxDisplacement();
      if (!this.fineActive && d > MOCHI.MESH_FINE_ENTER_PX) this.fineActive = true;
      else if (this.fineActive && d < MOCHI.MESH_FINE_LEAVE_PX) this.fineActive = false;
    } else {
      this.fineActive = false;
    }
    const warp = this.fineActive ? this.warp : this.coarse;
    const tW = prof.t();
    warp.update(body.x, body.y, dents, stretch ? MOCHI.STRETCH_MESH_SMOOTH_PASSES : 0, nDents);
    prof.end('meshUpdate', tW);
    const adaptiveRef = this.fineActive && tier.stride === 1 && !this.forceFullMesh ? warp.adaptiveTriangles(MOCHI.MESH_BAND_CELLS * this.fineCellSprite) : null;
    const tris = adaptiveRef ?? warp.triangles(tier.stride);
    this.lastTriangles = tris.length * 3;
    if (this.usingGL && this.gl) {
      let nGl = 0;
      if (tier.effects) {
        for (let i = 0; i < nDents && nGl < 5; i++) {
          const d = dents[i] as Dent;
          if (d.amount <= 0.01) continue;
          const g = this.glDents[nGl] ?? (this.glDents[nGl] = { x: 0, y: 0, radius: 1, alpha: 0 });
          g.x = d.x;
          g.y = d.y;
          g.radius = d.sigma * 1.6;
          g.alpha = Math.min(0.42, d.amount * 1.8);
          nGl++;
        }
      }
      const tG = prof.t();
      this.gl.draw(warp, warp.restSprite, warp.deformed, L.texScale, `${this.fineActive ? 'f' : 'c'}|${adaptiveRef ? 'a' : tier.stride}`, tris, this.glDents, nGl);
      prof.end('glDraw', tG);
      return;
    }
    // 이번 프레임에 바뀌는 영역만 지우고 합성한다(윤곽 + 여유). 전체 화면(1280×720) 패스 8번을 영역 패스로 줄인다
    const R = this.dirtyRect(body, dents, nDents);

    // 뒷벽+과일 → bufB, 막 → bufS (같은 메시로 워프). 영역(R)만 지우고 합성한다
    const sctx = this.bufS.getContext('2d') as CanvasRenderingContext2D;
    const bctx = this.bufB.getContext('2d') as CanvasRenderingContext2D;
    const tM = prof.t();
    sctx.clearRect(R.x, R.y, R.w, R.h);
    bctx.clearRect(R.x, R.y, R.w, R.h);
    this.drawMesh(bctx, warp, L.back, L.texScale, tris);
    this.drawMesh(sctx, warp, L.skin, L.texScale, tris);
    prof.end('meshDraw', tM);
    const tC = prof.t();
    ctx.drawImage(this.bufB, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    ctx.drawImage(this.bufS, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    prof.end('composite', tC);

    // 눌린 곳의 안쪽 그림자(부가 효과): 막 모양 안에서만 보이게 한다
    if (tier.effects) for (let i = 0; i < nDents; i++) if ((dents[i] as Dent).amount > 0.01) this.drawDentShade(ctx, dents[i] as Dent, R);
  }

  /** 이번 프레임에 그려지는 화면 영역: 링의 외곽 상자 + 여유(메시 셀·막의 옅은 테두리), 화면 안으로 제한 */
  private dirtyRect(body: SoftBody, dents: readonly Dent[], nDents: number): Rect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < body.n; i++) {
      const x = body.x[i] as number;
      const y = body.y[i] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    for (let i = 0; i < nDents; i++) {
      const dent = dents[i] as Dent;
      const r = dent.sigma * 1.6;
      x0 = Math.min(x0, dent.x - r);
      x1 = Math.max(x1, dent.x + r);
      y0 = Math.min(y0, dent.y - r);
      y1 = Math.max(y1, dent.y + r);
    }
    const m = MOCHI.DIRTY_MARGIN_PX;
    const x = Math.max(0, Math.floor(x0 - m));
    const y = Math.max(0, Math.floor(y0 - m));
    const w = Math.min(layout.w, Math.ceil(x1 + m)) - x;
    const h = Math.min(layout.h, Math.ceil(y1 + m)) - y;
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  }

  private drawDentShade(ctx: CanvasRenderingContext2D, dent: Dent, R: Rect): void {
    const mctx = this.bufM.getContext('2d') as CanvasRenderingContext2D;
    mctx.clearRect(R.x, R.y, R.w, R.h);
    const r = dent.sigma * 1.6;
    const g = mctx.createRadialGradient(dent.x, dent.y, r * 0.1, dent.x, dent.y, r);
    const a = Math.min(0.42, dent.amount * 1.8);
    g.addColorStop(0, `rgba(150,92,84,${a})`);
    g.addColorStop(0.6, `rgba(190,130,120,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,235,230,0)');
    mctx.fillStyle = g;
    mctx.fillRect(dent.x - r, dent.y - r, r * 2, r * 2);
    mctx.globalCompositeOperation = 'destination-in';
    for (let i = 0; i < 3; i++) mctx.drawImage(this.bufS, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    mctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.bufM, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
  }

  /** 삼각형마다 어파인 변환 + 클리핑으로 텍스처를 워프해 그린다. 이음새가 보이지 않도록 삼각형을 아주 조금 키운다. */
  private drawMesh(ctx: CanvasRenderingContext2D, warp: MeshWarp, tex: HTMLCanvasElement, texScale: number, tris: ReturnType<MeshWarp['triangles']>): void {
    const rs = warp.restSprite;
    const df = warp.deformed;
    const tw = tex.width;
    const th = tex.height;
    ctx.imageSmoothingEnabled = true;
    // 'copy': 겹친 부분을 다시 칠하지 않고 덮어써서, 반투명 텍스처에서도 이음새가 이중으로 진해지거나 비지 않게 한다
    ctx.globalCompositeOperation = 'copy';
    for (const [a, b, c] of tris) {
      const m = affineFromTriangles(
        (rs[a * 2] as number) * texScale, (rs[a * 2 + 1] as number) * texScale,
        (rs[b * 2] as number) * texScale, (rs[b * 2 + 1] as number) * texScale,
        (rs[c * 2] as number) * texScale, (rs[c * 2 + 1] as number) * texScale,
        df[a * 2] as number, df[a * 2 + 1] as number, df[b * 2] as number, df[b * 2 + 1] as number, df[c * 2] as number, df[c * 2 + 1] as number,
      );
      if (!m) continue;
      const cx = ((df[a * 2] as number) + (df[b * 2] as number) + (df[c * 2] as number)) / 3;
      const cy = ((df[a * 2 + 1] as number) + (df[b * 2 + 1] as number) + (df[c * 2 + 1] as number)) / 3;
      ctx.save();
      ctx.beginPath();
      const grow = 0.7; // 'copy' 합성이라 겹쳐도 진해지지 않는다. 안티앨리어싱 틈을 덮을 만큼 키운다
      for (const [i, k] of [[a, 0], [b, 1], [c, 2]] as const) {
        const px = df[i * 2] as number;
        const py = df[i * 2 + 1] as number;
        const dx = px - cx;
        const dy = py - cy;
        const l = Math.hypot(dx, dy) || 1;
        const qx = px + (dx / l) * grow;
        const qy = py + (dy / l) * grow;
        if (k === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      // 텍스처 전체가 아니라 이 삼각형이 덮는 부분만 그린다(클립 밖은 어차피 보이지 않는다): 삼각형 수가 많아도 채우는 면적은 그대로
      const ax = (rs[a * 2] as number) * texScale;
      const ay = (rs[a * 2 + 1] as number) * texScale;
      const bx = (rs[b * 2] as number) * texScale;
      const by = (rs[b * 2 + 1] as number) * texScale;
      const cx2 = (rs[c * 2] as number) * texScale;
      const cy2 = (rs[c * 2 + 1] as number) * texScale;
      const sx0 = Math.max(0, Math.floor(Math.min(ax, bx, cx2)) - 3);
      const sy0 = Math.max(0, Math.floor(Math.min(ay, by, cy2)) - 3);
      const sx1 = Math.min(tw, Math.ceil(Math.max(ax, bx, cx2)) + 3);
      const sy1 = Math.min(th, Math.ceil(Math.max(ay, by, cy2)) + 3);
      if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  static piecesFor(fruits: FruitInput, seed: number, assets: MochiAssets): Piece3D[] {
    return layoutFruits(fruits.counts, fruits.firstOrder, seed, assets.data.fruitLayout).pieces;
  }
}
