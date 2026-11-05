// TITLE 표지 그림: 사용자가 제공한 표지 PNG와 간판 SVG 원본을 **한 번만** 캔버스에 그려 두고 정적 이미지로 보여 준다.
// 이전에는 <img>에 mask-image(표지 좌우 페이드)와 filter: drop-shadow(1.5MB 래스터 내장 SVG 간판)를 걸었는데,
// 이런 효과는 합성(스크롤·다른 요소 갱신)마다 다시 계산되어 GPU/WebKit에서 느려지거나 검은 사각형으로 보일 수 있다.
// 지금은 원본 파일은 그대로 읽고(수정하지 않음), 페이드와 그림자는 처음 한 번만 그린다.
/** 표지 그림 배치 값(논리 좌표). 가로: 700×720 캔버스에 표지 640 + 간판 664, 좌우 크림색 페이드. 세로: 전체 화면(720×h)에 표지가 가득 차고(페이드 없음) 간판은 위쪽 */
import { layout } from '../app/layout';

export function artSpec(): { W: number; H: number; COVER_W: number; SIGN_W: number; FADE: number; SHADOW: { color: string; blur: number; offsetY: number } } {
  const shadow = { color: 'rgba(60, 30, 10, 0.35)', blur: 14, offsetY: 10 };
  if (layout.mode === 'portrait') return { W: layout.w, H: layout.h, COVER_W: layout.w, SIGN_W: 620, FADE: 0, SHADOW: shadow };
  return { W: 700, H: 720, COVER_W: 640, SIGN_W: 664, FADE: 0.2, SHADOW: shadow };
}

export interface ArtLayout {
  /** 표지: 원본 비율 유지, 위쪽 기준으로 잘라 COVER_W×H를 채운다(object-fit: cover; object-position: top) */
  cover: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
  sign: { dx: number; dy: number; dw: number; dh: number };
}

/** 이미지 크기에서 배치를 계산한다(순수 함수) */
export function computeArtLayout(coverW: number, coverH: number, signW: number, signH: number): ArtLayout {
  const { W, H, COVER_W, SIGN_W } = artSpec();
  const scale = Math.max(COVER_W / coverW, H / coverH);
  const sw = COVER_W / scale;
  const sh = H / scale;
  const sdw = SIGN_W;
  const sdh = (SIGN_W * signH) / signW;
  return {
    cover: { sx: (coverW - sw) / 2, sy: 0, sw, sh, dx: (W - COVER_W) / 2, dy: 0, dw: COVER_W, dh: H },
    sign: { dx: (W - sdw) / 2, dy: 0, dw: sdw, dh: sdh },
  };
}

/** 캔버스의 그리기 배율: 화면 배율(DPR × 스테이지 축소·확대)에 맞추되 상한을 둬 메모리를 아낀다 */
export function artScale(dpr: number, viewportW: number, viewportH: number): number {
  const stage = layout.mode === 'portrait' ? viewportW / layout.w : Math.min(viewportW / 1280, viewportH / 720);
  return Math.min(2.5, Math.max(1, dpr * stage));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

/** 표지와 간판을 캔버스에 그린다. 성공 여부(간판 나무 부분이 실제로 그려졌는지)를 돌려준다 */
export async function paintTitleArt(canvas: HTMLCanvasElement, coverUrl: string, signUrl: string, scale: number): Promise<boolean> {
  const [cover, sign] = await Promise.all([loadImage(coverUrl), loadImage(signUrl)]);
  const { W, H, FADE, SHADOW } = artSpec();
  const L = computeArtLayout(cover.naturalWidth, cover.naturalHeight, sign.naturalWidth || 492, sign.naturalHeight || 380);
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  canvas.style.width = `${W}px`; // 논리 좌표 크기로 표시(CSS의 고정 크기에 의존하지 않는다)
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = 'high';

  // 표지: 좌우를 크림색 배경으로 부드럽게 사라지게(알파 페이드)
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const t = tmp.getContext('2d');
  if (!t) return false;
  t.scale(scale, scale);
  t.imageSmoothingQuality = 'high';
  t.drawImage(cover, L.cover.sx, L.cover.sy, L.cover.sw, L.cover.sh, L.cover.dx, L.cover.dy, L.cover.dw, L.cover.dh);
  t.globalCompositeOperation = 'destination-in';
  if (FADE > 0) {
    const g = t.createLinearGradient(L.cover.dx, 0, L.cover.dx + L.cover.dw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(FADE, 'rgba(0,0,0,1)');
    g.addColorStop(1 - FADE, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = g;
    t.fillRect(0, 0, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tmp, 0, 0);

  // 간판: 원본 SVG 그대로, 그림자만 한 번 입힌다
  ctx.shadowColor = SHADOW.color;
  ctx.shadowBlur = SHADOW.blur * scale;
  ctx.shadowOffsetY = SHADOW.offsetY * scale;
  ctx.drawImage(sign, L.sign.dx * scale, L.sign.dy * scale, L.sign.dw * scale, L.sign.dh * scale);
  ctx.shadowColor = 'transparent';

  // 검증: 간판 아래쪽 가로 띠(글자가 거의 없는 나무 부분)에 불투명하고 밝은 갈색 픽셀이 있어야 한다.
  // 래스터 패턴이 그려지지 않으면 투명하거나 검정이다(한 점이 아니라 띠에서 가장 밝은 값을 보므로 글자·결에 영향받지 않는다)
  try {
    const x0 = Math.round((L.sign.dx + L.sign.dw * 0.3) * scale);
    const y0 = Math.round((L.sign.dy + L.sign.dh * 0.85) * scale);
    const w = Math.max(1, Math.round(L.sign.dw * 0.4 * scale));
    const h = Math.max(1, Math.round(L.sign.dh * 0.05 * scale));
    const d = ctx.getImageData(x0, y0, w, h).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i + 3] as number) > 200 && (d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number) > 300) bright++;
    return bright > (w * h) * 0.3;
  } catch {
    return true; // 읽기 실패(보안 등)면 판단하지 않는다
  }
}
