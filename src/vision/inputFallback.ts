// 대체 입력(마우스·키보드·터치). 카메라가 없을 때 같은 MouthInput을 만든다. (SPEC 5장 9항)
// - 마우스/터치 위치 = 입 중심, 버튼을 누르는 동안 또는 Space를 누르는 동안 = 입 벌림
import { layout } from '../app/layout';
import { MOUTH_AREA } from '../app/constants';
import type { InputHub } from './inputHub';
import type { MouthInput, Point } from './types';

export interface FallbackState {
  pointer: Point | null;
  pointerDown: boolean;
  spaceDown: boolean;
}

/** 순수 함수: 대체 입력 상태 → MouthInput */
export function buildFallbackInput(s: FallbackState, t: number): MouthInput {
  const isOpen = s.pointerDown || s.spaceDown;
  return {
    isOpen,
    openness: isOpen ? 1 : 0,
    center: s.pointer ?? { x: layout.w / 2, y: layout.h / 2 },
    radiusX: MOUTH_AREA.FALLBACK_RX,
    radiusY: MOUTH_AREA.FALLBACK_RY,
    faceDetected: true, // 대체 입력은 항상 "있음": 얼굴 미검출 일시정지가 적용되지 않는다
    timestamp: t,
    source: 'fallback',
  };
}

const isInteractive = (el: EventTarget | null): boolean =>
  el instanceof Element && el.closest('button, a, input, select, textarea, [data-no-fallback]') !== null;

export class FallbackInput {
  private state: FallbackState = { pointer: null, pointerDown: false, spaceDown: false };
  private enabled = false;
  private hub: InputHub;
  private target: HTMLElement;
  private toStage: (clientX: number, clientY: number) => Point;

  constructor(target: HTMLElement, hub: InputHub, toStage: (clientX: number, clientY: number) => Point) {
    this.target = target;
    this.hub = hub;
    this.toStage = toStage;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.addEventListener('pointermove', this.onMove);
    this.target.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.publish();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.state = { pointer: null, pointerDown: false, spaceDown: false };
  }

  private publish(): void {
    this.hub.publish(buildFallbackInput(this.state, performance.now()));
  }

  private onMove = (e: PointerEvent): void => {
    this.state.pointer = this.toStage(e.clientX, e.clientY);
    this.publish();
  };

  private onDown = (e: PointerEvent): void => {
    if (isInteractive(e.target)) return; // 버튼 클릭은 입 벌림으로 보지 않는다
    this.state.pointer = this.toStage(e.clientX, e.clientY);
    this.state.pointerDown = true;
    this.publish();
  };

  private onUp = (): void => {
    if (!this.state.pointerDown) return;
    this.state.pointerDown = false;
    this.publish();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' || isInteractive(e.target)) return;
    e.preventDefault();
    if (!this.state.spaceDown) {
      this.state.spaceDown = true;
      this.publish();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space') return;
    this.state.spaceDown = false;
    this.publish();
  };

  private onBlur = (): void => {
    this.state.pointerDown = false;
    this.state.spaceDown = false;
    this.publish();
  };
}
