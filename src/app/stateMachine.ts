// 화면 흐름 FSM (SPEC 6장). 전이는 이 표에서만 정의한다. 정의되지 않은 전이는 무시한다.

export const STATES = [
  'LOADING',
  'TITLE',
  'PERMISSION',
  'CALIBRATION',
  'TUTORIAL',
  'PLAYING',
  'PAUSED',
  'RESULT',
  'MOCHI_INTRO',
  'MOCHI_STRETCH',
  'MOCHI_TOUCH',
] as const;
export type State = (typeof STATES)[number];

export type Event =
  | 'loaded'
  | 'loadFailed'
  | 'useFallback'
  | 'start'
  | 'granted'
  | 'denied'
  | 'calibrated'
  | 'skip'
  | 'ready'
  | 'success'
  | 'fail'
  | 'faceLost'
  | 'faceBack'
  | 'resume'
  | 'next'
  | 'retry'
  | 'done'
  | 'again'
  | 'needPermission'
  | 'home';

export type TransitionTable = Record<State, Partial<Record<Event, State>>>;

export const TRANSITIONS: TransitionTable = {
  // loadFailed: 같은 LOADING에 머물며 오류 안내를 보인다(대체 입력으로 계속 가능). useFallback으로 TITLE 이동.
  LOADING: { loaded: 'TITLE', useFallback: 'TITLE' },
  TITLE: { start: 'PERMISSION' },
  PERMISSION: { granted: 'CALIBRATION', denied: 'TUTORIAL', useFallback: 'TUTORIAL', home: 'TITLE' },
  CALIBRATION: { calibrated: 'TUTORIAL', skip: 'TUTORIAL', home: 'TITLE' },
  TUTORIAL: { ready: 'PLAYING', home: 'TITLE' },
  PLAYING: { success: 'RESULT', fail: 'RESULT', faceLost: 'PAUSED', home: 'TITLE' },
  PAUSED: { faceBack: 'PLAYING', resume: 'PLAYING', home: 'TITLE' },
  RESULT: { next: 'MOCHI_INTRO', retry: 'PLAYING', home: 'TITLE' },
  MOCHI_INTRO: { done: 'MOCHI_STRETCH', home: 'TITLE' },
  MOCHI_STRETCH: { next: 'MOCHI_TOUCH', home: 'TITLE' },
  MOCHI_TOUCH: { again: 'PLAYING', needPermission: 'PERMISSION', home: 'TITLE' },
};

/** 뒤로가기 버튼 규칙 (SPEC 6장). null이면 뒤로가기 없음. 'confirm'이면 확인창을 거친 뒤 TITLE. */
export const BACK_BEHAVIOR: Record<State, 'none' | 'home' | 'confirm'> = {
  LOADING: 'none',
  TITLE: 'none',
  PERMISSION: 'home',
  CALIBRATION: 'home', // 사용자 지정 없음 → PERMISSION/TUTORIAL과 동일(제안, 승인 필요)
  TUTORIAL: 'home',
  PLAYING: 'confirm',
  PAUSED: 'confirm',
  RESULT: 'home',
  MOCHI_INTRO: 'home',
  MOCHI_STRETCH: 'home',
  MOCHI_TOUCH: 'home',
};

export type TransitionListener = (from: State, to: State, event: Event | 'dev') => void;

export class StateMachine {
  private current: State;
  private listeners: TransitionListener[] = [];
  private logger: (msg: string) => void;

  constructor(initial: State = 'LOADING', table: TransitionTable = TRANSITIONS, logger: (msg: string) => void = () => {}) {
    this.current = initial;
    this.table = table;
    this.logger = logger;
  }

  private table: TransitionTable;

  get state(): State {
    return this.current;
  }

  onTransition(cb: TransitionListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** 정의된 전이만 수행한다. 수행했으면 true. */
  send(event: Event): boolean {
    const next = this.table[this.current][event];
    if (!next) {
      this.logger(`무시된 전이: ${this.current} --${event}-->`);
      return false;
    }
    this.move(next, event);
    return true;
  }

  /** 개발·테스트 전용: 표에 없는 이동도 허용한다. */
  devJump(to: State): void {
    this.move(to, 'dev');
  }

  private move(to: State, event: Event | 'dev'): void {
    const from = this.current;
    this.current = to;
    this.logger(`전이: ${from} --${event}--> ${to}`);
    for (const l of [...this.listeners]) l(from, to, event);
  }

  /** 라운드 종료 결과를 FSM에 전달하는 편의 함수 */
  devSendResult(success: boolean): boolean {
    return this.send(success ? 'success' : 'fail');
  }

  can(event: Event): boolean {
    return this.table[this.current][event] !== undefined;
  }
}
