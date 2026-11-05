// 화면 레이아웃 정책(방향·논리 크기·세로 배치): 순수 로직
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAGE_H, STAGE_W } from '../src/app/constants';
import { PORTRAIT_H_MAX, PORTRAIT_H_MIN, PORTRAIT_W, applyLayout, decideLayoutMode, frontLayout, gameTuning, layout, layoutSizeFor, onLayoutChange, resetLayout } from '../src/app/layout';
import { clientToStage, computeStageTransform } from '../src/ui/stageScale';

afterEach(() => resetLayout());

describe('방향 정책', () => {
  it('창이 세로형이면 기기와 상관없이 세로 모드(PC에서 창을 좁혀도 반응형)', () => {
    expect(decideLayoutMode(500, 900, false)).toBe('portrait');
    expect(decideLayoutMode(390, 844, true)).toBe('portrait');
    expect(decideLayoutMode(720, 1280, false)).toBe('portrait');
  });
  it('가로형 창은 PC·모바일 모두 기존 가로 레이아웃', () => {
    expect(decideLayoutMode(1280, 720, false)).toBe('landscape');
    expect(decideLayoutMode(844, 390, true)).toBe('landscape');
  });
  it('정사각형에 가까운 창은 가로(경계에서 깜빡이지 않도록 세로가 1.1배 넘을 때만 세로)', () => {
    expect(decideLayoutMode(800, 800, false)).toBe('landscape');
    expect(decideLayoutMode(800, 870, false)).toBe('landscape');
    expect(decideLayoutMode(800, 890, false)).toBe('portrait');
  });
});

describe('논리 크기', () => {
  it('가로 모드는 항상 1280×720', () => {
    expect(layoutSizeFor('landscape', 390, 844)).toEqual({ w: STAGE_W, h: STAGE_H });
    expect(layoutSizeFor('landscape', 1920, 1080)).toEqual({ w: 1280, h: 720 });
  });
  it('세로 모드는 가로 720, 세로는 화면 비율에 맞추되 1100~1600으로 제한', () => {
    expect(layoutSizeFor('portrait', 390, 844)).toEqual({ w: PORTRAIT_W, h: 1558 }); // 19.5:9 폰
    expect(layoutSizeFor('portrait', 360, 640).h).toBe(1280); // 16:9 폰
    expect(layoutSizeFor('portrait', 375, 667).h).toBe(1280);
    expect(layoutSizeFor('portrait', 412, 915).h).toBe(1599); // 매우 긴 화면은 1600 이하
    expect(layoutSizeFor('portrait', 360, 900).h).toBe(PORTRAIT_H_MAX); // 상한
    expect(layoutSizeFor('portrait', 768, 1024).h).toBe(PORTRAIT_H_MIN); // 태블릿은 하한(좌우 여백)
  });
  it('세로 모드의 스테이지 변환은 전체 화면을 레터박스 없이 채운다', () => {
    for (const [w, h] of [[390, 844], [375, 667], [360, 780]] as const) {
      const size = layoutSizeFor('portrait', w, h);
      const t = computeStageTransform(w, h, size.w, size.h);
      expect(t.offsetX).toBeCloseTo(0, 0);
      expect(t.offsetY).toBeCloseTo(0, 0);
      expect(size.w * t.scale).toBeCloseTo(w, 3);
      expect(size.h * t.scale).toBeLessThanOrEqual(h + 1);
    }
  });
  it('터치 좌표 → 논리 좌표 변환이 세로 모드에서도 왕복 일치', () => {
    const size = layoutSizeFor('portrait', 390, 844);
    const t = computeStageTransform(390, 844, size.w, size.h);
    const p = clientToStage(195, 422, t);
    expect(p.x).toBeCloseTo(size.w / 2, 3);
    expect(p.y).toBeCloseTo(size.h / 2, 3);
  });
});

describe('applyLayout 구독', () => {
  it('모드가 바뀌면 구독자에게 알리고 version이 오른다', () => {
    const cb = vi.fn();
    onLayoutChange(cb);
    expect(applyLayout('portrait', 720, 1280)).toBe(true);
    expect(layout.mode).toBe('portrait');
    expect(layout.version).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(applyLayout('portrait', 720, 1280)).toBe(false); // 같은 값은 무시
  });
  it('세로 높이가 조금만 달라지면(주소창 등) 재배치하지 않고, 크게 달라지면 알린다', () => {
    applyLayout('portrait', 720, 1280);
    expect(applyLayout('portrait', 720, 1300)).toBe(false);
    expect(applyLayout('portrait', 720, 1400)).toBe(true);
  });
});

describe('세로 모드 배치·조정값', () => {
  it('가로는 기존 상수와 같다', () => {
    expect(frontLayout()).toEqual({ scale: 0.44, centerX: 640, groundY: 590, horizonY: 330 });
    expect(gameTuning()).toEqual({ speedScale: 1, sizeScale: 1, spawnMarginX: 110 });
  });
  it('세로: 찹쌀떡이 화면 폭에 충분히 크고(폭의 70~85%) 가운데, 책상 위에 놓이며 화면 안에 들어온다', () => {
    applyLayout('portrait', 720, 1558);
    const f = frontLayout();
    const widthPx = 1126 * f.scale; // 찹쌀떡 스프라이트 실루엣 가로(약 1126px)
    expect(widthPx / layout.w).toBeGreaterThan(0.7);
    expect(widthPx / layout.w).toBeLessThan(0.85);
    expect(f.centerX).toBe(360);
    expect(f.groundY).toBeGreaterThan(layout.h * 0.5);
    expect(f.groundY).toBeLessThan(layout.h);
    expect(f.horizonY).toBeLessThan(f.groundY);
    // 위로 최대(안전 길이 1.45배)로 늘려도 화면 위에 남는다
    const heightPx = 859 * f.scale;
    expect(f.groundY - heightPx * 1.45).toBeGreaterThan(80);
    const g = gameTuning();
    expect(g.speedScale).toBeGreaterThan(1);
    expect(g.sizeScale).toBeLessThan(1);
  });
});
