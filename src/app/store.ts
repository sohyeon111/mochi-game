// 앱 전역 상태: 입력 모드, 보정값, 권한/카메라 상태, 라운드 결과(자리표시), 안내 메시지.
import type { InputMode } from '../vision/inputHub';
import type { RoundResult } from '../game/types';
import type { Calibration } from '../vision/types';

export type PermissionStatus = 'unknown' | 'granted' | 'denied';
export type ResultKind = 'success' | 'fail';

export interface AppState {
  inputMode: InputMode;
  calibration: Calibration | null;
  permission: PermissionStatus;
  /** 모델 prefetch 결과 */
  assetsLoaded: boolean;
  loadError: string | null;
  /** 카메라/얼굴 인식 시작 중 안내 */
  busyMessage: string | null;
  /** 마지막 오류 안내(권한 거부 등) */
  errorMessage: string | null;
  /** 라운드 결과 자리표시(이번 단계에서는 개발용 버튼으로만 설정) */
  lastResult: ResultKind | null;
  /** 라운드 결과(과일별 집계·대표 과일 포함). RESULT 화면과 다음 단계의 떡 내부 과일 배치가 사용 */
  roundResult: RoundResult | null;
  /** 확인창 등 UI 때문에 게임이 멈춰 있는지 */
  uiPaused: boolean;
  /** 모바일 접속 안내 표시 여부 */
  mobileNotice: boolean;
  /** 모찌 늘리기 완료 표시(자리표시, 이번 단계에서는 개발용 버튼) */
  stretchedOnce: boolean;
  faceDetected: boolean;
}

export type Listener = (s: AppState, changed: Array<keyof AppState>) => void;

export class Store {
  private s: AppState = {
    inputMode: 'camera',
    calibration: null,
    permission: 'unknown',
    assetsLoaded: false,
    loadError: null,
    busyMessage: null,
    errorMessage: null,
    lastResult: null,
    roundResult: null,
    uiPaused: false,
    mobileNotice: false,
    stretchedOnce: false,
    faceDetected: false,
  };
  private listeners: Listener[] = [];

  get state(): Readonly<AppState> {
    return this.s;
  }

  set(patch: Partial<AppState>): void {
    const changed: Array<keyof AppState> = [];
    for (const k of Object.keys(patch) as Array<keyof AppState>) {
      if (this.s[k] !== patch[k]) changed.push(k);
    }
    if (changed.length === 0) return;
    this.s = { ...this.s, ...patch };
    for (const l of [...this.listeners]) l(this.s, changed);
  }

  subscribe(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** TITLE로 돌아갈 때 라운드 상태를 초기화한다. 보정값·입력 모드·권한 상태는 유지한다(SPEC 6장). */
  resetRound(): void {
    this.set({ lastResult: null, roundResult: null, uiPaused: false, stretchedOnce: false, errorMessage: null, busyMessage: null });
  }
}
