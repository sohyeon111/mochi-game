// LOADING / TITLE / PERMISSION 화면 (스타일 없는 임시 와이어프레임)
import { assetUrl } from '../app/assetUrl';
import { isLikelyMobile } from '../ui/stageScale';
import { artScale, artSpec, paintTitleArt } from '../ui/titleArt';
import { onLayoutChange } from '../app/layout';
import { button, h } from '../ui/dom';
import type { Screen, ScreenCtx } from './types';

export function createLoadingScreen({ app }: ScreenCtx): Screen {
  const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const status = h('p', { class: 'sub', text: '얼굴 인식 리소스를 불러오는 중이에요…' });
  const err = h('div', { class: 'error-box', attrs: { hidden: '' } });
  const retry = button('다시 시도', () => void run());
  const fallback = button('마우스·키보드로 시작하기', () => {
    app.useFallbackMode();
    app.send('useFallback');
  }, 'btn btn-secondary');
  fallback.hidden = !app.store.state.assetsLoaded;
  err.append(h('p', { class: 'err-text' }), h('div', { class: 'row' }, retry, fallback));
  const el = h('section', { class: 'screen center' }, h('h1', { class: 'h1', text: 'Mochi Game' }), status, bar, err);

  async function run(): Promise<void> {
    err.hidden = true;
    status.textContent = '얼굴 인식 리소스를 불러오는 중이에요…';
    fill.style.width = '5%';
    await app.boot();
  }

  app.setLoadingProgress((d, t) => {
    fill.style.width = `${Math.round((d / t) * 100)}%`;
  });
  app.store.subscribe((s, changed) => {
    if (changed.includes('assetsLoaded')) fallback.hidden = !s.assetsLoaded; // 게임 에셋이 없으면 대체 입력으로도 게임을 할 수 없다
    if (!changed.includes('loadError')) return;
    if (s.loadError) {
      status.textContent = '리소스를 불러오지 못했어요.';
      (err.querySelector('.err-text') as HTMLElement).textContent = `${s.loadError} — 인터넷 연결을 확인해 주세요.${s.assetsLoaded ? ' 마우스·키보드로 계속할 수도 있어요.' : ''}`;
      err.hidden = false;
    }
  });

  return { id: 'LOADING', el, usesCamera: false, dim: 'none', showMouth: false, enter: () => void run() };
}

export function createTitleScreen({ app }: ScreenCtx): Screen {
  const mobileNote = h('p', { class: 'notice', attrs: { hidden: '' }, text: '이 게임은 데스크톱 브라우저에서 가장 잘 동작해요. 휴대폰에서는 터치로 입을 대신할 수 있어요.' });
  // 표지 배경(PNG)과 나무 간판(SVG)은 사용자가 제공한 원본을 그대로 쓴다(public/assets/title/, 원본은 design/assets/).
  // 간판 문구는 SVG 안의 글자 그래픽이며, 접근성·검색용으로 같은 문구를 숨은 제목으로도 둔다. 문구는 수정하지 않는다.
  // 두 그림은 한 장의 정적 캔버스에 한 번만 그린다(ui/titleArt.ts): 합성 때마다 다시 계산되는 mask/filter를 쓰지 않는다.
  const art = h('canvas', { class: 'title-art', attrs: { width: String(artSpec().W), height: String(artSpec().H), 'aria-hidden': 'true' } });
  let paintedScale = 0;
  const paint = (): void => {
    const scale = artScale(window.devicePixelRatio || 1, window.innerWidth, window.innerHeight);
    if (Math.abs(scale - paintedScale) < 0.01) return;
    paintedScale = scale;
    paintTitleArt(art, assetUrl('assets/title/cover.png'), assetUrl('assets/title/sign.svg'), scale)
      .then((ok) => {
        if (!ok) app.log('TITLE 간판 그림이 정상적으로 그려지지 않았습니다(브라우저가 SVG 래스터 패턴을 그리지 못함)');
      })
      .catch((e: unknown) => app.log(`TITLE 그림 로드 실패: ${String(e)}`));
  };
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(paint, 300);
  });
  onLayoutChange(() => {
    art.width = artSpec().W;
    art.height = artSpec().H;
    paintedScale = 0; // 레이아웃이 바뀌면 같은 배율이어도 다시 그린다
    paint();
  });
  paint();
  const heading = h('h1', { class: 'sr-only', text: '홍익이네 쫀득 쫀득 과일 요거트 한정선' });
  const start = button('찹쌀떡 만들러 가기', () => app.send('start'));
  const el = h('section', { class: 'screen title' }, art, heading, mobileNote, start);
  return {
    id: 'TITLE', el, usesCamera: false, dim: 'none', showMouth: false,
    enter: () => {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      const mobile = isLikelyMobile(navigator.userAgent, navigator.maxTouchPoints, coarse);
      app.store.set({ mobileNotice: mobile });
      mobileNote.hidden = !mobile;
    },
  };
}

export function createPermissionScreen({ app }: ScreenCtx): Screen {
  // 카메라·얼굴 인식 초기화 로딩은 이 화면에서 한 번만 보여 준다(보정 화면에는 로딩이 없다)
  const stepCam = h('li', { class: 'init-step', text: '카메라 켜기' });
  const stepFace = h('li', { class: 'init-step', text: '얼굴 인식 준비' });
  const busyText = h('p', { class: 'sub busy-text' });
  const busy = h('div', { class: 'init-box', attrs: { hidden: '', role: 'status' } },
    h('div', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }), busyText, h('ol', { class: 'init-steps' }, stepCam, stepFace));
  const err = h('div', { class: 'error-box', attrs: { hidden: '' } }, h('p', { class: 'err-text' }));
  const allow = button('카메라 허용하기', () => void request());
  const fallback = button('마우스·키보드로 계속하기', () => {
    app.useFallbackMode();
    app.send('useFallback');
  }, 'btn btn-secondary');
  const info = h('p', { class: 'sub', text: '입을 벌리는 동작을 인식하려고 카메라를 사용해요. 영상은 이 브라우저 안에서만 처리되고 저장·전송되지 않아요.' });
  const el = h('section', { class: 'screen center' }, h('h2', { class: 'h2', text: '카메라를 사용해요' }), info, busy, err, h('div', { class: 'row' }, allow, fallback));

  async function request(): Promise<void> {
    allow.disabled = true;
    const ok = await app.startCamera();
    allow.disabled = false;
    if (ok) app.send('granted');
  }

  app.store.subscribe((s, changed) => {
    if (changed.includes('busyMessage')) {
      busy.hidden = !s.busyMessage;
      busyText.textContent = s.busyMessage ?? '';
      const faceStep = (s.busyMessage ?? '').includes('얼굴');
      stepCam.className = `init-step ${faceStep ? 'done' : 'active'}`;
      stepFace.className = `init-step ${faceStep ? 'active' : ''}`;
    }
    if (changed.includes('errorMessage')) {
      err.hidden = !s.errorMessage;
      (err.querySelector('.err-text') as HTMLElement).textContent = s.errorMessage ?? '';
    }
  });

  return {
    id: 'PERMISSION', el, usesCamera: false, dim: 'none', showMouth: false,
    enter: () => {
      app.store.set({ errorMessage: null, busyMessage: null });
      allow.disabled = false;
    },
  };
}
