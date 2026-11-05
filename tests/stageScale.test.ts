import { describe, expect, it } from 'vitest';
import { clientToStage, computeStageTransform, isLikelyMobile, needsRotateNotice } from '../src/ui/stageScale';

describe('스테이지 스케일', () => {
  it('정확히 16:9 창이면 레터박스가 없다', () => {
    const t = computeStageTransform(1920, 1080);
    expect(t.scale).toBeCloseTo(1.5);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo(0);
  });
  it('가로로 더 넓으면 좌우 레터박스', () => {
    const t = computeStageTransform(2000, 720);
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(360);
    expect(t.offsetY).toBe(0);
  });
  it('세로로 더 길면 위아래 레터박스', () => {
    const t = computeStageTransform(1280, 1000);
    expect(t.scale).toBe(1);
    expect(t.offsetY).toBe(140);
  });
  it('화면 좌표 → 스테이지 좌표', () => {
    const t = computeStageTransform(2000, 720);
    expect(clientToStage(360, 0, t)).toEqual({ x: 0, y: 0 });
    expect(clientToStage(1000, 360, t)).toEqual({ x: 640, y: 360 });
  });
  it('세로 휴대폰 화면은 가로 회전 안내', () => {
    expect(needsRotateNotice(390, 844)).toBe(true);
    expect(needsRotateNotice(844, 390)).toBe(false);
    expect(needsRotateNotice(1000, 1400)).toBe(false); // 큰 세로 창(태블릿/데스크톱)은 안내 대신 레터박스
  });
  it('휴대폰 판별', () => {
    expect(isLikelyMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 5, true)).toBe(true);
    expect(isLikelyMobile('Mozilla/5.0 (Macintosh)', 0, false)).toBe(false);
    expect(isLikelyMobile('Mozilla/5.0 (X11; Linux)', 10, true)).toBe(true);
  });
});
