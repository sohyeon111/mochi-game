// 브라우저(Safari 등)의 canvas filter 지원 여부와 상관없이 쓰기 위한 CPU 블러. 라운드 시작 시 한 번만 쓴다. 순수 로직.

/** 알파가 곱해진(premultiplied) RGBA 데이터에 박스 블러 3회(가우시안 근사)를 적용한다. 반지름 0.5 미만이면 그대로. */
export function gaussianBlurRGBA(data: Uint8ClampedArray, w: number, h: number, sigma: number): void {
  if (sigma < 0.4) return;
  // 박스 3회 ≈ 가우시안: 박스 폭 = sqrt(12σ²/3 + 1)
  const boxW = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1)));
  const r = Math.floor(boxW / 2);
  if (r < 1) return;
  const tmp = new Float32Array(data.length);
  const src = Float32Array.from(data);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(src, tmp, w, h, r, true);
    boxPass(tmp, src, w, h, r, false);
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(src[i] as number)));
}

function boxPass(inp: Float32Array, out: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const lenMain = horizontal ? w : h;
  const lenCross = horizontal ? h : w;
  const strideMain = horizontal ? 4 : w * 4;
  const strideCross = horizontal ? w * 4 : 4;
  const inv = 1 / (2 * r + 1);
  for (let c = 0; c < lenCross; c++) {
    const base = c * strideCross;
    for (let ch = 0; ch < 4; ch++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += inp[base + Math.min(lenMain - 1, Math.max(0, i)) * strideMain + ch] as number;
      for (let i = 0; i < lenMain; i++) {
        out[base + i * strideMain + ch] = acc * inv;
        const add = Math.min(lenMain - 1, i + r + 1);
        const sub = Math.max(0, i - r);
        acc += (inp[base + add * strideMain + ch] as number) - (inp[base + sub * strideMain + ch] as number);
      }
    }
  }
}

/** premultiplied 데이터에 색 섞임(우윳빛)과 투명도를 적용: c' = c·(1−t) + TINT·t·a, a' = a·opacity */
export function tintAndFade(data: Uint8ClampedArray, tint: number, opacity: number, tintRGB: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] as number) / 255;
    data[i] = (data[i] as number) * (1 - tint) + tintRGB[0] * tint * a;
    data[i + 1] = (data[i + 1] as number) * (1 - tint) + tintRGB[1] * tint * a;
    data[i + 2] = (data[i + 2] as number) * (1 - tint) + tintRGB[2] * tint * a;
    // 투명도는 premultiplied 전체에 곱한다(색과 알파가 함께 줄어듦)
    data[i] = (data[i] as number) * opacity;
    data[i + 1] = (data[i + 1] as number) * opacity;
    data[i + 2] = (data[i + 2] as number) * opacity;
    data[i + 3] = (data[i + 3] as number) * opacity;
  }
}

/** Canvas ImageData(알파가 곱해지지 않은 값)를 premultiplied로 바꾼다 */
export function premultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] as number) / 255;
    data[i] = (data[i] as number) * a;
    data[i + 1] = (data[i + 1] as number) * a;
    data[i + 2] = (data[i + 2] as number) * a;
  }
}

/** premultiplied → Canvas ImageData 형식 */
export function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] as number) / 255;
    if (a > 0.003) {
      data[i] = (data[i] as number) / a;
      data[i + 1] = (data[i + 1] as number) / a;
      data[i + 2] = (data[i + 2] as number) / a;
    }
  }
}
