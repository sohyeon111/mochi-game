import { describe, expect, it } from 'vitest';
import { MOUTH_AREA } from '../src/app/constants';
import { InputHub, emptyInput } from '../src/vision/inputHub';
import { buildFallbackInput } from '../src/vision/inputFallback';

describe('대체 입력', () => {
  it('마우스를 누르거나 Space를 누르는 동안 입이 열린다', () => {
    expect(buildFallbackInput({ pointer: { x: 100, y: 200 }, pointerDown: false, spaceDown: false }, 0).isOpen).toBe(false);
    expect(buildFallbackInput({ pointer: { x: 100, y: 200 }, pointerDown: true, spaceDown: false }, 0).isOpen).toBe(true);
    expect(buildFallbackInput({ pointer: null, pointerDown: false, spaceDown: true }, 0).isOpen).toBe(true);
  });
  it('위치와 반경, source가 채워진다', () => {
    const i = buildFallbackInput({ pointer: { x: 100, y: 200 }, pointerDown: true, spaceDown: false }, 5);
    expect(i.center).toEqual({ x: 100, y: 200 });
    expect(i.radiusX).toBe(MOUTH_AREA.FALLBACK_RX);
    expect(i.radiusY).toBe(MOUTH_AREA.FALLBACK_RY);
    expect(i.source).toBe('fallback');
    expect(i.faceDetected).toBe(true);
    expect(i.openness).toBe(1);
  });
  it('포인터가 없으면 화면 중앙', () => {
    expect(buildFallbackInput({ pointer: null, pointerDown: false, spaceDown: false }, 0).center).toEqual({ x: 640, y: 360 });
  });
});

describe('InputHub', () => {
  it('현재 모드와 다른 원천의 입력은 버린다', () => {
    const hub = new InputHub();
    hub.setMode('fallback');
    hub.publish(emptyInput('camera', 1));
    expect(hub.current().source).toBe('fallback');
    const seen: string[] = [];
    hub.subscribe((i) => seen.push(i.source));
    hub.publish({ ...emptyInput('fallback', 2), isOpen: true });
    hub.publish(emptyInput('camera', 3));
    expect(seen).toEqual(['fallback']);
    expect(hub.current().isOpen).toBe(true);
  });
  it('모드를 바꾸면 최신 입력이 초기화된다', () => {
    const hub = new InputHub();
    hub.publish({ ...emptyInput('camera', 1), isOpen: true });
    hub.setMode('fallback');
    expect(hub.current().isOpen).toBe(false);
    expect(hub.getMode()).toBe('fallback');
  });
});
