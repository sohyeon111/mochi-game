// 모찌 에셋 로딩: mochi.json, 정면 막·뒷벽 2장. 정면 과일은 게임 에셋(GameAssets)을 재사용한다. (위 시점은 쓰지 않는다)
import { RENDER_ASSET_DIR } from '../app/constants';
import { assetUrl } from '../app/assetUrl';
import type { FruitLayoutParams, ViewProjection } from './fruitLayout';
import type { WarpViewData } from './meshWarp';

export interface MochiViewData extends WarpViewData, ViewProjection {
  size: [number, number];
  sprites: { skin: string; back: string };
}

export interface MochiData {
  worldDimsMeters: { width: number; height: number; radius: number };
  views: { front: MochiViewData };
  fruitLayout: FruitLayoutParams;
}

export interface MochiAssets {
  data: MochiData;
  skin: HTMLImageElement;
  back: HTMLImageElement;
}

export const MOCHI_ASSET_COUNT = 1 + 2;

const load = (url: string, label: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${label} 이미지 로드 실패`));
    img.src = url;
  });

export async function loadMochiAssets(onProgress?: (done: number, total: number) => void): Promise<MochiAssets> {
  let done = 0;
  const step = (): void => onProgress?.(++done, MOCHI_ASSET_COUNT);
  onProgress?.(0, MOCHI_ASSET_COUNT);
  const res = await fetch(assetUrl(`${RENDER_ASSET_DIR}/mochi.json`), { cache: 'force-cache' });
  if (!res.ok) throw new Error(`mochi.json 로드 실패 (${res.status})`);
  const data = (await res.json()) as MochiData;
  step();
  const url = (rel: string): string => assetUrl(`${RENDER_ASSET_DIR}/${rel}`);
  const [skin, back] = await Promise.all(
    [data.views.front.sprites.skin, data.views.front.sprites.back].map(async (rel) => {
      const img = await load(url(rel), rel);
      step();
      return img;
    }),
  );
  return { data, skin: skin as HTMLImageElement, back: back as HTMLImageElement };
}
