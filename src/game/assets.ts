// 게임 에셋 로딩: manifest.json, collision.json, 오브젝트 스프라이트(정면). 모든 경로는 manifest 기준 상대경로.
import { RENDER_ASSET_DIR, FRUIT_IDS, TRASH_IDS } from '../app/constants';
import { assetUrl } from '../app/assetUrl';
import { baseScaleFromPxPerMeter, type SpriteDims } from './spawner';
import type { ShapeTable } from './types';

interface ManifestAsset {
  id: string;
  kind: string;
  view: string;
  file: string;
  size: [number, number];
}
interface Manifest {
  pxPerMeterFrame: number;
  assets: ManifestAsset[];
}
interface CollisionFile {
  assets: Record<string, { sprite: string; size: [number, number]; centroid: [number, number]; circles: Array<{ x: number; y: number; r: number }>; hitScale: number }>;
}

export interface GameAssets {
  shapes: ShapeTable;
  dims: SpriteDims;
  /** 에셋 키(fruit_strawberry …) → 이미지 */
  images: Record<string, HTMLImageElement>;
  /** 에셋 키 → 이미지 URL (결과 화면의 아이콘 등) */
  urls: Record<string, string>;
}

export const GAME_ASSET_COUNT = 2 + FRUIT_IDS.length + TRASH_IDS.length;

async function fetchJson<T>(rel: string): Promise<T> {
  const res = await fetch(assetUrl(`${RENDER_ASSET_DIR}/${rel}`), { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${rel} 로드 실패 (${res.status})`);
  return (await res.json()) as T;
}

function loadImage(url: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${label} 이미지 로드 실패`));
    img.src = url;
  });
}

/** manifest/collision/스프라이트 8장을 불러온다. 실패하면 예외. */
export async function loadGameAssets(onProgress?: (done: number, total: number) => void): Promise<GameAssets> {
  let done = 0;
  const step = (): void => onProgress?.(++done, GAME_ASSET_COUNT);
  onProgress?.(0, GAME_ASSET_COUNT);
  const manifest = await fetchJson<Manifest>('manifest.json');
  step();
  const collision = await fetchJson<CollisionFile>('collision.json');
  step();
  const baseScale = baseScaleFromPxPerMeter(manifest.pxPerMeterFrame);
  const shapes: ShapeTable = {};
  const dims: SpriteDims = { baseScale: {}, size: {} };
  const images: Record<string, HTMLImageElement> = {};
  const urls: Record<string, string> = {};
  const keys = [...FRUIT_IDS.map((i) => `fruit_${i}`), ...TRASH_IDS.map((i) => `trash_${i}`)];
  await Promise.all(
    keys.map(async (key) => {
      const c = collision.assets[key];
      if (!c) throw new Error(`collision.json에 ${key}가 없습니다`);
      // 스프라이트 파일 경로는 collision.json이 가리키는 값을 그대로 쓴다(manifest와 같은 파일)
      const url = assetUrl(`${RENDER_ASSET_DIR}/${c.sprite}`);
      shapes[key] = { w: c.size[0], h: c.size[1], centroid: c.centroid, circles: c.circles, hitScale: c.hitScale };
      dims.baseScale[key] = baseScale;
      dims.size[key] = { w: c.size[0], h: c.size[1] };
      urls[key] = url;
      images[key] = await loadImage(url, key);
      step();
    }),
  );
  return { shapes, dims, images, urls };
}
