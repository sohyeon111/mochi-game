// 모찌 레이어 텍스처 만들기(Canvas). 과일 레이어는 라운드 시작(INTRO 진입) 때 기본 형태로 한 번 합성해 두고, 메시로 워프해서 쓴다.
import type { FruitId } from '../app/constants';
import { gaussianBlurRGBA, premultiply, tintAndFade, unpremultiply } from './blur';
import { depthEffect, drawOrder, projectPiece, type FruitLayoutParams, type Piece3D, type ViewProjection } from './fruitLayout';

export const MILK_TINT: readonly [number, number, number] = [255, 236, 228];

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 막 이미지를 텍스처 크기로 그린 캔버스 */
export function imageLayer(img: HTMLImageElement, texScale: number): HTMLCanvasElement {
  const c = makeCanvas(img.naturalWidth * texScale, img.naturalHeight * texScale);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 뒷벽 + 우윳빛 채움(막 모양대로)을 한 장으로 합친다. 같은 메시로 워프되므로 미리 합쳐 두면 프레임당 워프가 한 번 줄어든다. */
export function backWithMilk(back: HTMLImageElement, skin: HTMLImageElement, texScale: number, milkFill: number): HTMLCanvasElement {
  const c = imageLayer(back, texScale);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const tint = makeCanvas(c.width, c.height);
  const tctx = tint.getContext('2d') as CanvasRenderingContext2D;
  tctx.drawImage(skin, 0, 0, tint.width, tint.height);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = `rgb(${MILK_TINT[0]},${MILK_TINT[1]},${MILK_TINT[2]})`;
  tctx.fillRect(0, 0, tint.width, tint.height);
  ctx.globalAlpha = Math.min(1, milkFill * 1.6); // 막 알파 × 1.6 근사(합성 테스트와 같은 값)
  ctx.drawImage(tint, 0, 0);
  ctx.globalAlpha = 1;
  return c;
}

export interface FruitImages {
  front: Record<string, HTMLImageElement>;
  top: Record<string, HTMLImageElement>;
}

/** 과일 조각들을 깊이 효과(흐림·우윳빛 섞임·투명도)와 함께 한 레이어로 합성한다 */
export function composeFruitLayer(
  pieces: readonly Piece3D[],
  view: 'front' | 'top',
  viewData: ViewProjection & { size: [number, number] },
  params: FruitLayoutParams,
  images: FruitImages,
  texScale: number,
): HTMLCanvasElement {
  const layer = makeCanvas(viewData.size[0] * texScale, viewData.size[1] * texScale);
  const lctx = layer.getContext('2d') as CanvasRenderingContext2D;
  lctx.imageSmoothingQuality = 'high';
  // 스프라이트는 프레임 1800px 기준(900px 기준 흐림 값의 2배)
  const frameScale = 2;
  for (const piece of drawOrder(pieces, view)) {
    const img = (view === 'front' ? images.front : images.top)[piece.type as FruitId];
    if (!img) continue;
    const pr = projectPiece(piece, view, viewData, params);
    const fx = depthEffect(pr.inside, params, frameScale);
    const s = piece.mult * params.pieceScale.base * pr.persp * texScale;
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    const sigma = fx.blurPx * texScale;
    const pad = Math.ceil(sigma * 3) + 2;
    const side = Math.ceil(Math.hypot(iw, ih)) + pad * 2;
    const tmp = makeCanvas(side, side);
    const tctx = tmp.getContext('2d') as CanvasRenderingContext2D;
    tctx.imageSmoothingQuality = 'high';
    tctx.translate(tmp.width / 2, tmp.height / 2);
    tctx.rotate((piece.rotDeg * Math.PI) / 180);
    if (piece.flip) tctx.scale(-1, 1);
    tctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    const id = tctx.getImageData(0, 0, tmp.width, tmp.height);
    premultiply(id.data);
    gaussianBlurRGBA(id.data, tmp.width, tmp.height, sigma);
    tintAndFade(id.data, fx.tint, fx.opacity, MILK_TINT);
    unpremultiply(id.data);
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.putImageData(id, 0, 0);
    lctx.drawImage(tmp, pr.sx * texScale - tmp.width / 2, pr.sy * texScale - tmp.height / 2);
  }
  return layer;
}
