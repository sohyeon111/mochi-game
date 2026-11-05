// TUTORIAL / PLAYING / PAUSED / RESULT 화면. 게임 진행은 src/game/ (GameView·GameEngine)가 담당한다.
import { FRUIT_IDS, GAME, ITEM_LABELS } from '../app/constants';
import type { Hud } from '../game/hud';
import { button, h } from '../ui/dom';
import type { Screen, ScreenCtx } from './types';

export function createTutorialScreen({ app }: ScreenCtx): Screen {
  const hint = h('p', { class: 'sub', text: '' });
  const badge = h('div', { class: 'badge', text: '입 닫힘' });
  const title = h('h2', { class: 'h2' }, '입을 크게 벌려 ', h('span', { class: 'accent', text: '20초' }), ' 안에', h('br'), '찹쌀떡 재료를 모으세요!');
  const rules = h('p', { class: 'sub accent-sub', text: '재료 10개를 먹으면 성공, 떡을 만질 수 있어요.\n쓰레기 3개를 먹으면 바로 실패에요.' });
  const start = button('시작하기', () => app.send('ready'));
  const el = h('section', { class: 'screen center' }, title, rules, badge, hint, start);

  let unsub: (() => void) | null = null;
  return {
    id: 'TUTORIAL', el, usesCamera: true, dim: 'dim', showMouth: true,
    enter: () => {
      hint.textContent =
        app.store.state.inputMode === 'camera'
          ? '입을 벌렸다 다물어 보세요. 아래 표시가 바뀌면 인식되고 있어요.'
          : '화면에서 마우스를 누르고 있거나 Space 키를 누르는 동안 입이 열려요. 터치는 화면을 누르고 있으면 돼요.';
      unsub = app.hub.subscribe((i) => {
        badge.textContent = i.isOpen ? '입 열림' : '입 닫힘';
        badge.classList.toggle('on', i.isOpen);
      });
    },
    exit: () => unsub?.(),
  };
}

/** PLAYING: 실제 게임 화면. 떨어지는 오브젝트는 게임 캔버스(GameView)가 그리고, 여기서는 HUD만 둔다. */
export function createPlayingScreen(_ctx: ScreenCtx, hud: Hud): Screen {
  const el = h('section', { class: 'screen playing' }, hud.el);
  return { id: 'PLAYING', el, usesCamera: true, dim: 'grad', showMouth: true };
}

export function createPausedScreen({ app }: ScreenCtx): Screen {
  const resume = button('계속하기', () => app.send('resume'));
  const el = h('section', { class: 'screen center' }, h('h2', { class: 'h2', text: '얼굴을 보여주세요' }), h('p', { class: 'sub', text: '얼굴이 다시 보이면 자동으로 이어져요.' }), resume);
  return { id: 'PAUSED', el, usesCamera: true, dim: 'dim', showMouth: true };
}

const FAIL_TEXT: Record<'trash' | 'timeout', string> = {
  trash: '쓰레기를 너무 많이 먹었어요.\n떡은 다음 기회에 만져요.',
  // 레퍼런스에 없는 문구(시간 초과) — 같은 어조로 새로 작성
  timeout: '시간이 다 됐어요.\n재료를 10개 모으지 못했어요. 다시 도전해 봐요!',
};

export function createResultScreen({ app }: ScreenCtx): Screen {
  const title = h('h2', { class: 'h2' });
  const sub = h('p', { class: 'sub accent-sub' });
  const summary = h('p', { class: 'result-summary' });
  const chips = h('div', { class: 'chips' });
  const toMochi = button('떡 만지러 가기', () => app.send('next'));
  const retry = button('다시하기', () => app.send('retry'));
  const home = button('처음으로', () => app.send('home'), 'btn btn-secondary');
  const el = h('section', { class: 'screen center' }, title, sub, summary, chips, h('div', { class: 'row' }, toMochi, retry, home));
  return {
    id: 'RESULT', el, usesCamera: true, dim: 'dim', showMouth: false,
    enter: () => {
      const r = app.store.state.roundResult;
      const success = r ? r.success : app.store.state.lastResult === 'success';
      title.textContent = success ? '성공!' : '으악 실패!';
      sub.textContent = success ? '재료만 잘 골랐어요!\n이제 맛있는 찹쌀떡이 만들어질 거예요.' : FAIL_TEXT[r?.failReason ?? 'trash'];
      toMochi.hidden = !success;
      retry.hidden = success;
      chips.replaceChildren();
      if (!r) {
        summary.textContent = '';
        return;
      }
      summary.textContent = `수집한 과일 ${r.fruitCount}개 (${r.fruitCount} / ${GAME.TARGET_FRUITS}) · 쓰레기 ${r.trashCount}번 · ${(r.elapsedMs / 1000).toFixed(1)}초`;
      for (const f of FRUIT_IDS) {
        const n = r.fruitCounts[f];
        const url = app.assets?.urls[`fruit_${f}`];
        const chip = h('div', { class: `chip${n === 0 ? ' zero' : ''}${r.representative === f ? ' rep' : ''}`, attrs: { 'data-fruit': f } });
        if (url) chip.append(h('img', { attrs: { src: url, alt: ITEM_LABELS[f] } }));
        chip.append(h('span', { class: 'chip-name', text: ITEM_LABELS[f] }), h('b', { class: 'chip-count', text: `×${n}` }));
        if (r.representative === f) chip.append(h('span', { class: 'chip-rep', text: '대표' }));
        chips.append(chip);
      }
    },
  };
}
