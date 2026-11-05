// MOCHI_INTRO / MOCHI_STRETCH / MOCHI_TOUCH 화면 UI. 캔버스·물리·입력은 src/mochi/mochiView.ts가 담당하고,
// 여기서는 안내 문구와 버튼만 둔다. 화면 이동은 기존 FSM 이벤트(done / next / again / needPermission / home)를 그대로 쓴다.
import { button, h } from '../ui/dom';
import type { Screen, ScreenCtx } from './types';

const sampleBadge = (): HTMLElement => h('p', { class: 'dev-badge', attrs: { hidden: '' }, text: '개발용 샘플 결과(키위4·오렌지3·딸기2·블루베리1)' });

export function createMochiIntroScreen({ app }: ScreenCtx): Screen {
  const badge = sampleBadge();
  const el = h('section', { class: 'screen mochi-ui' }, h('h2', { class: 'mochi-title', text: '찹쌀떡이 완성됐어요!' }), badge);
  return {
    id: 'MOCHI_INTRO', el, usesCamera: false, dim: 'light', showMouth: false,
    enter: () => {
      badge.hidden = !(app.mochiView?.usingSample ?? false);
    },
  };
}

export function createMochiStretchScreen({ app }: ScreenCtx): Screen {
  const done = button('다 만졌어요', () => app.send('next'));
  done.hidden = true;
  done.classList.add('btn-pop');
  const badge = sampleBadge();
  const el = h('section', { class: 'screen mochi-ui' },
    h('h2', { class: 'mochi-title', text: '찹쌀떡을 마음껏 쭉쭉 늘려보세요!' }), badge, h('div', { class: 'row bottom' }, done));
  app.store.subscribe((s, changed) => {
    if (changed.includes('stretchedOnce')) done.hidden = !s.stretchedOnce;
  });
  return {
    id: 'MOCHI_STRETCH', el, usesCamera: false, dim: 'light', showMouth: false,
    enter: () => {
      done.hidden = !app.store.state.stretchedOnce;
      badge.hidden = !(app.mochiView?.usingSample ?? false);
    },
  };
}

export function createMochiTouchScreen({ app }: ScreenCtx): Screen {
  const msg = h('p', { class: 'notice', attrs: { hidden: '' } });
  const again = button('다시 하기', async () => {
    again.disabled = true;
    msg.hidden = false;
    msg.textContent = '카메라를 다시 준비하는 중이에요…';
    // 권한이 이미 허용돼 있으면 프롬프트·PERMISSION 화면 없이 재취득 (SPEC 6장)
    const ok = await app.reacquireSilently();
    again.disabled = false;
    msg.hidden = true;
    app.send(ok ? 'again' : 'needPermission');
  });
  const home = button('처음으로', () => app.send('home'), 'btn btn-secondary');
  const el = h('section', { class: 'screen mochi-ui touch' },
    h('h2', { class: 'mochi-title', text: '찹쌀떡을 자유롭게 만져보세요' }), msg, h('div', { class: 'row bottom' }, again, home));
  return { id: 'MOCHI_TOUCH', el, usesCamera: false, dim: 'light', showMouth: false, enter: () => { again.disabled = false; msg.hidden = true; } };
}
