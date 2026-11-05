/** 상대경로 리소스의 절대 URL (GitHub Pages 하위 경로(/mochi-game/)에서도 동작) */
export function assetUrl(rel: string): string {
  return new URL(rel, document.baseURI).href;
}
