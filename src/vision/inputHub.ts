// 입력 허브: 카메라 입력과 대체 입력 중 현재 모드의 것만 게임에 전달한다.
// 게임 로직은 입력 원천을 구분하지 않고 MouthInput만 받는다.
import { layout } from '../app/layout';
import type { MouthInput } from './types';

export type InputMode = 'camera' | 'fallback';

export function emptyInput(source: MouthInput['source'], t = 0): MouthInput {
  return {
    isOpen: false,
    openness: 0,
    center: { x: layout.w / 2, y: layout.h / 2 },
    radiusX: 0,
    radiusY: 0,
    faceDetected: false,
    timestamp: t,
    source,
  };
}

export class InputHub {
  private mode: InputMode = 'camera';
  private latest: MouthInput = emptyInput('camera');
  private listeners: Array<(i: MouthInput) => void> = [];

  getMode(): InputMode {
    return this.mode;
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    this.latest = emptyInput(mode);
  }

  /** 입력 원천이 호출한다. 현재 모드와 다른 원천의 입력은 버린다. */
  publish(input: MouthInput): void {
    if (input.source !== this.mode) return;
    this.latest = input;
    for (const l of [...this.listeners]) l(input);
  }

  current(): MouthInput {
    return this.latest;
  }

  subscribe(cb: (i: MouthInput) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}
