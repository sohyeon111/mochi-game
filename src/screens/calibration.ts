// CALIBRATION: ① 입 다물기 → ② 입 벌리기를 차례로 측정해 개인별 보정값을 만든다 (SPEC 5장 4항).
// 카메라·얼굴 인식 초기화는 PERMISSION에서 끝난 상태로 들어오므로 여기에는 로딩 표시가 없다.
// 각 단계는 '조건을 실제로 만족하는 동안에만' 진행 링이 차오른다(조건 밖에서는 천천히 줄어든다).
import { CALIBRATION, FLOW } from '../app/constants';
import { median } from '../vision/mouthDetector';
import { button, h } from '../ui/dom';
import type { Screen, ScreenCtx } from './types';

type Phase = 'idle' | 'closed' | 'pause' | 'open' | 'done' | 'failed';

const RING_R = 70;
const RING_LEN = 2 * Math.PI * RING_R;
const NS = 'http://www.w3.org/2000/svg';
/** 게이지의 가득 찬 값(jawOpen 원시값). 이 이상은 같은 끝으로 보인다 */
const GAUGE_MAX = 0.7;

export function createCalibrationScreen({ app }: ScreenCtx): Screen {
  const title = h('h2', { class: 'h2', text: '입 벌림을 맞춰 볼게요' });
  const chip1 = h('span', { class: 'cal-step', text: '1  입 다물기' });
  const chip2 = h('span', { class: 'cal-step', text: '2  입 벌리기' });
  const steps = h('div', { class: 'cal-steps' }, chip1, h('span', { class: 'cal-arrow', text: '›' }), chip2);
  const instruction = h('p', { class: 'big cal-instruction', text: '' });

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 160 160');
  svg.setAttribute('class', 'cal-ring');
  const track = document.createElementNS(NS, 'circle');
  const arc = document.createElementNS(NS, 'circle');
  for (const c of [track, arc]) {
    c.setAttribute('cx', '80');
    c.setAttribute('cy', '80');
    c.setAttribute('r', String(RING_R));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '12');
  }
  track.setAttribute('class', 'cal-ring-track');
  arc.setAttribute('class', 'cal-ring-arc');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', String(RING_LEN));
  arc.setAttribute('transform', 'rotate(-90 80 80)');
  svg.append(track, arc);
  const ringLabel = h('span', { class: 'cal-ring-label', text: '' });
  const ring = h('div', { class: 'cal-ring-wrap' });
  ring.append(svg, ringLabel);

  const zone = h('div', { class: 'cal-gauge-zone' });
  const mark = h('div', { class: 'cal-gauge-mark' });
  const gauge = h('div', { class: 'cal-gauge' }, zone, mark);
  const hint = h('p', { class: 'sub cal-hint', text: '' });
  const warn = h('p', { class: 'notice', attrs: { hidden: '' }, text: '얼굴이 보이지 않아요. 카메라 쪽을 봐 주세요.' });
  const resultBox = h('p', { class: 'sub', text: '' });
  const skip = button('건너뛰기', () => {
    stop();
    app.skipCalibration();
    app.send('skip');
  }, 'btn btn-secondary');
  const retry = button('다시 측정하기', () => start(), 'btn');
  retry.hidden = true;
  const startCam = button('카메라 켜기', async () => {
    const ok = await app.startCamera();
    if (ok) start();
  });
  startCam.hidden = true;
  const el = h('section', { class: 'screen center cal' }, title, steps, instruction, ring, gauge, hint, warn, resultBox, h('div', { class: 'row' }, startCam, retry, skip));

  let phase: Phase = 'idle';
  let timer = 0;
  let lastTick = 0;
  let held = 0; // 조건을 만족한 누적 시간(ms)
  let waited = 0; // 단계 시작 후 경과 시간(ms)
  let pauseLeft = 0;
  let closed: number[] = [];
  let open: number[] = [];
  let lastJaw = 0;
  let openGate = CALIBRATION.MIN_RANGE;
  let doneTimer = 0;

  const setRing = (ratio: number, label: string, tone: 'idle' | 'ok' | 'done' = 'idle'): void => {
    arc.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, Math.max(0, ratio)))); // CSS 규칙이 속성보다 우선하므로 style로 지정
    ringLabel.textContent = label;
    ring.dataset['tone'] = tone;
  };
  const setZone = (from: number, to: number): void => {
    zone.style.left = `${(from / GAUGE_MAX) * 100}%`;
    zone.style.width = `${((to - from) / GAUGE_MAX) * 100}%`;
  };
  const setChips = (a: 'active' | 'done' | '', b: 'active' | 'done' | ''): void => {
    chip1.className = `cal-step ${a}`;
    chip2.className = `cal-step ${b}`;
  };

  function beginClosed(): void {
    phase = 'closed';
    held = 0;
    waited = 0;
    setChips('active', '');
    instruction.textContent = '입을 다물어 주세요';
    hint.textContent = '카메라를 보면서 입을 다문 채로 있어요.';
    setZone(0, CALIBRATION.CLOSED_GATE);
    setRing(0, '준비');
  }

  function beginOpen(): void {
    phase = 'open';
    held = 0;
    waited = 0;
    setChips('done', 'active');
    instruction.textContent = '입을 크게 벌려 주세요';
    hint.textContent = '입을 크게 벌린 채로 있어요.';
    setZone(openGate, GAUGE_MAX);
    setRing(0, '준비');
  }

  function start(): void {
    stop();
    closed = [];
    open = [];
    retry.hidden = true;
    startCam.hidden = true;
    resultBox.textContent = '';
    gauge.hidden = false;
    ring.hidden = false;
    steps.hidden = false;
    hint.hidden = false;
    beginClosed();
    app.pipeline.events.onRaw = (jaw) => {
      lastJaw = jaw;
      if (phase === 'closed' && jaw < CALIBRATION.CLOSED_GATE) closed.push(jaw);
      else if (phase === 'open' && jaw > openGate) open.push(jaw);
    };
    lastTick = performance.now();
    timer = window.setInterval(tick, 50);
  }

  function stop(): void {
    window.clearInterval(timer);
    window.clearTimeout(doneTimer);
    timer = 0;
    app.pipeline.events.onRaw = undefined;
  }

  function inGate(): boolean {
    return phase === 'closed' ? lastJaw < CALIBRATION.CLOSED_GATE : lastJaw > openGate;
  }

  function tick(): void {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    const faceOk = app.pipeline.debug.face;
    warn.hidden = faceOk;
    mark.style.left = `${Math.min(1, Math.max(0, lastJaw / GAUGE_MAX)) * 100}%`;
    if (phase === 'pause') {
      pauseLeft -= dt;
      if (pauseLeft <= 0) beginOpen();
      return;
    }
    if (phase !== 'closed' && phase !== 'open') return;
    if (!faceOk) return; // 얼굴이 없으면 시간이 흐르지 않는다
    waited += dt;
    const need = phase === 'closed' ? CALIBRATION.CLOSED_MS : CALIBRATION.OPEN_MS;
    const ok = inGate();
    held = ok ? held + dt : Math.max(0, held - dt * 2);
    if (ok) {
      hint.textContent = held > 0 ? '좋아요, 그대로 있어 주세요' : hint.textContent;
      setRing(held / need, '인식 중', 'ok');
    } else {
      hint.textContent = phase === 'closed' ? '입을 다물어 주세요' : '조금 더 크게 벌려 주세요';
      setRing(held / need, held > 0 ? '다시!' : '준비');
    }
    if (held >= need || waited >= CALIBRATION.MAX_WAIT_MS) {
      if (phase === 'closed') {
        // 입 다문 기준값이 정해지면 벌림 판정 문턱도 정해진다
        openGate = (closed.length >= CALIBRATION.MIN_SAMPLES ? median(closed) : CALIBRATION.DEFAULT_CLOSED) + CALIBRATION.MIN_RANGE;
        phase = 'pause';
        pauseLeft = CALIBRATION.SETTLE_MS;
        setChips('done', '');
        setRing(1, '완료', 'done');
        hint.textContent = '좋아요!';
      } else {
        finish();
      }
    }
  }

  function finish(): void {
    window.clearInterval(timer);
    timer = 0;
    app.pipeline.events.onRaw = undefined;
    const r = app.computeAndApplyCalibration(closed, open);
    if (r.ok) {
      phase = 'done';
      setChips('done', 'done');
      instruction.textContent = '좋아요! 보정이 끝났어요';
      hint.hidden = true;
      gauge.hidden = true;
      setRing(1, '완료', 'done');
      resultBox.textContent = `다문 값 ${r.cal.closedBase.toFixed(3)} · 벌린 값 ${r.cal.openMax.toFixed(3)}`;
      doneTimer = window.setTimeout(() => app.send('calibrated'), FLOW.CALIBRATION_DONE_MS);
    } else {
      phase = 'failed';
      setChips('done', '');
      instruction.textContent =
        r.reason === 'range' ? '입을 벌린 정도가 너무 작아요. 조금 더 크게 벌려서 다시 해 볼까요?' : '측정이 부족해요. 얼굴이 잘 보이게 해서 다시 해 볼까요?';
      hint.hidden = true;
      gauge.hidden = true;
      setRing(0, '실패');
      resultBox.textContent = `다문 값 ${r.cal.closedBase.toFixed(3)} · 벌린 값 ${r.cal.openMax.toFixed(3)} (기본값을 쓰려면 건너뛰기)`;
      retry.hidden = false;
    }
  }

  return {
    id: 'CALIBRATION', el, usesCamera: true, dim: 'dim', showMouth: true,
    enter: () => {
      // 대체 입력은 보정이 필요 없다 (SPEC 5장 9항)
      if (app.store.state.inputMode === 'fallback') {
        app.skipCalibration();
        window.setTimeout(() => app.send('skip'), 0);
        return;
      }
      if (!app.camera.isActive()) {
        phase = 'idle';
        instruction.textContent = '카메라가 꺼져 있어요';
        steps.hidden = true;
        ring.hidden = true;
        gauge.hidden = true;
        hint.hidden = true;
        startCam.hidden = false;
        return;
      }
      start();
    },
    exit: stop,
  };
}
