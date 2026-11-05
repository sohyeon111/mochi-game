import { describe, expect, it } from 'vitest';
import { BACK_BEHAVIOR, STATES, StateMachine, TRANSITIONS, type Event, type State } from '../src/app/stateMachine';

function run(m: StateMachine, events: Event[]): State[] {
  const visited: State[] = [];
  for (const e of events) {
    m.send(e);
    visited.push(m.state);
  }
  return visited;
}

describe('화면 FSM', () => {
  it('성공 경로: 로딩 → 타이틀 → … → 모찌 만지기', () => {
    const m = new StateMachine();
    const path = run(m, ['loaded', 'start', 'granted', 'calibrated', 'ready', 'success', 'next', 'done', 'next']);
    expect(path).toEqual(['TITLE', 'PERMISSION', 'CALIBRATION', 'TUTORIAL', 'PLAYING', 'RESULT', 'MOCHI_INTRO', 'MOCHI_STRETCH', 'MOCHI_TOUCH']);
  });

  it('실패 경로: 다시하기는 PLAYING으로, 처음으로는 TITLE로', () => {
    const m = new StateMachine('RESULT');
    expect(m.send('retry')).toBe(true);
    expect(m.state).toBe('PLAYING');
    m.send('fail');
    expect(m.state).toBe('RESULT');
    m.send('home');
    expect(m.state).toBe('TITLE');
  });

  it('권한 거부/대체 입력은 CALIBRATION을 건너뛰고 TUTORIAL로', () => {
    const a = new StateMachine('PERMISSION');
    a.send('denied');
    expect(a.state).toBe('TUTORIAL');
    const b = new StateMachine('PERMISSION');
    b.send('useFallback');
    expect(b.state).toBe('TUTORIAL');
  });

  it('보정 건너뛰기는 TUTORIAL로', () => {
    const m = new StateMachine('CALIBRATION');
    m.send('skip');
    expect(m.state).toBe('TUTORIAL');
  });

  it('얼굴 미검출은 PLAYING에서만 PAUSED로, 돌아오면 PLAYING', () => {
    const m = new StateMachine('PLAYING');
    m.send('faceLost');
    expect(m.state).toBe('PAUSED');
    m.send('faceBack');
    expect(m.state).toBe('PLAYING');
    const t = new StateMachine('TITLE');
    expect(t.send('faceLost')).toBe(false);
    expect(t.state).toBe('TITLE');
  });

  it('정의되지 않은 전이는 무시하고 로그를 남긴다', () => {
    const logs: string[] = [];
    const m = new StateMachine('TITLE', TRANSITIONS, (s) => logs.push(s));
    expect(m.send('success')).toBe(false);
    expect(m.state).toBe('TITLE');
    expect(logs.some((l) => l.includes('무시'))).toBe(true);
  });

  it('MOCHI_TOUCH: 다시 하기 → PLAYING, 권한 필요 → PERMISSION, 처음으로 → TITLE', () => {
    expect(new StateMachine('MOCHI_TOUCH').send('again')).toBe(true);
    const m = new StateMachine('MOCHI_TOUCH');
    m.send('needPermission');
    expect(m.state).toBe('PERMISSION');
    const h = new StateMachine('MOCHI_TOUCH');
    h.send('home');
    expect(h.state).toBe('TITLE');
  });

  it('로딩 실패 후 대체 입력으로 TITLE 진입 가능', () => {
    const m = new StateMachine('LOADING');
    expect(m.send('useFallback')).toBe(true);
    expect(m.state).toBe('TITLE');
  });

  it('전이 리스너가 from/to/event를 받는다', () => {
    const m = new StateMachine('TITLE');
    const seen: string[] = [];
    m.onTransition((f, t, e) => seen.push(`${f}>${t}:${e}`));
    m.send('start');
    m.devJump('RESULT');
    expect(seen).toEqual(['TITLE>PERMISSION:start', 'PERMISSION>RESULT:dev']);
  });

  it('모든 상태에 전이 표와 뒤로가기 규칙이 있다', () => {
    for (const s of STATES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(BACK_BEHAVIOR[s]).toBeDefined();
    }
  });

  it('뒤로가기 규칙: TITLE 없음, PLAYING은 확인창, 나머지는 TITLE', () => {
    expect(BACK_BEHAVIOR.TITLE).toBe('none');
    expect(BACK_BEHAVIOR.PLAYING).toBe('confirm');
    for (const s of ['PERMISSION', 'TUTORIAL', 'RESULT', 'MOCHI_INTRO', 'MOCHI_STRETCH', 'MOCHI_TOUCH'] as State[]) {
      expect(BACK_BEHAVIOR[s]).toBe('home');
      expect(TRANSITIONS[s].home).toBe('TITLE');
    }
    expect(TRANSITIONS.PLAYING.home).toBe('TITLE');
  });
});
