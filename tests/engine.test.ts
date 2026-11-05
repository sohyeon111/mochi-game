import { describe, expect, it } from 'vitest';
import { FRUIT_IDS, GAME, TRASH_IDS, type ItemId } from '../src/app/constants';
import { worldCentroid } from '../src/game/collision';
import { GameEngine, type EngineEvent } from '../src/game/engine';
import { baseScaleFromPxPerMeter, type SpriteDims } from '../src/game/spawner';
import type { ShapeTable } from '../src/game/types';
import type { MouthInput } from '../src/vision/types';
import collisionJson from '../public/assets/render/collision.json';

const raw = collisionJson as unknown as { assets: Record<string, { size: [number, number]; centroid: [number, number]; circles: Array<{ x: number; y: number; r: number }>; hitScale: number }> };
const shapes: ShapeTable = Object.fromEntries(Object.entries(raw.assets).map(([k, v]) => [k, { w: v.size[0], h: v.size[1], centroid: v.centroid, circles: v.circles, hitScale: v.hitScale }]));
const dims: SpriteDims = {
  baseScale: Object.fromEntries(Object.keys(shapes).map((k) => [k, baseScaleFromPxPerMeter(1547.34)])),
  size: Object.fromEntries(Object.entries(shapes).map(([k, s]) => [k, { w: s.w, h: s.h }])),
};

const mouth = (open: boolean, x = 640, y = 500, rx = 70, ry = 50): MouthInput => ({
  isOpen: open, openness: open ? 1 : 0, center: { x, y }, radiusX: rx, radiusY: ry, faceDetected: true, timestamp: 0, source: 'fallback',
});

const engine = (seed = 1): GameEngine => {
  const e = new GameEngine({ shapes, dims }, seed);
  e.spawningEnabled = false; // 테스트에서는 직접 배치한 오브젝트만 쓴다
  return e;
};

/** 입 중심에 실루엣 무게중심이 정확히 오도록 오브젝트를 둔다 */
function place(e: GameEngine, id: ItemId, dx = 0, dy = 0, mx = 640, my = 500): void {
  const o = e.debugSpawn(id, 0, 0);
  const c = worldCentroid(o, shapes[o.assetKey]!);
  o.x = mx + dx - c.x;
  o.baseX = o.x; // 흔들림 없음(swayAmp 0)이므로 baseX가 곧 x
  o.y = my + dy - c.y;
}
const collects = (ev: EngineEvent[]) => ev.filter((e) => e.type === 'collect');
const ends = (ev: EngineEvent[]) => ev.filter((e) => e.type === 'end');

describe('입 상태와 수집', () => {
  it('입이 닫혀 있으면 과일이 수집되지 않는다', () => {
    const e = engine();
    place(e, 'kiwi');
    const ev = e.update(16, mouth(false));
    expect(collects(ev)).toHaveLength(0);
    expect(e.round.fruitCount).toBe(0);
    expect(e.objects).toHaveLength(1);
  });

  it('입이 닫혀 있으면 쓰레기도 맞지 않는다(물체는 그대로 지나간다)', () => {
    const e = engine();
    place(e, 'can');
    expect(collects(e.update(16, mouth(false)))).toHaveLength(0);
    expect(e.round.trashCount).toBe(0);
  });

  it('입이 열려 있으면 과일이 수집되고 오브젝트가 사라진다', () => {
    const e = engine();
    place(e, 'kiwi');
    const ev = e.update(16, mouth(true));
    expect(collects(ev)).toHaveLength(1);
    expect(e.round.fruitCount).toBe(1);
    expect(e.objects).toHaveLength(0);
  });

  it('닫혀 있다가 열면 그때 수집된다', () => {
    const e = engine();
    place(e, 'orange');
    e.update(16, mouth(false));
    expect(e.round.fruitCount).toBe(0);
    e.update(16, mouth(true));
    expect(e.round.fruitCount).toBe(1);
  });

  it('한 번 수집된 오브젝트는 다음 프레임에 다시 충돌하지 않는다', () => {
    const e = engine();
    place(e, 'orange');
    e.update(16, mouth(true));
    for (let i = 0; i < 10; i++) e.update(16, mouth(true));
    expect(e.round.fruitCount).toBe(1);
  });

  it('입에서 먼 오브젝트는 수집되지 않는다', () => {
    const e = engine();
    place(e, 'orange', 400, 0);
    e.update(16, mouth(true));
    expect(e.round.fruitCount).toBe(0);
  });

  it('쓰레기를 입으로 먹으면 쓰레기 횟수가 늘고 과일 수는 그대로', () => {
    const e = engine();
    place(e, 'sock');
    const ev = e.update(16, mouth(true));
    expect(collects(ev)).toHaveLength(1);
    expect(e.round.trashCount).toBe(1);
    expect(e.round.fruitCount).toBe(0);
  });
});

describe('성공/실패 규칙', () => {
  it('과일 10개째에 즉시 성공하고 end 이벤트가 한 번만 나온다', () => {
    const e = engine();
    let all: EngineEvent[] = [];
    for (let i = 0; i < 10; i++) {
      place(e, FRUIT_IDS[i % 4] as ItemId);
      all = all.concat(e.update(16, mouth(true)));
    }
    expect(e.round.status).toBe('success');
    expect(ends(all)).toHaveLength(1);
    const end = ends(all)[0] as Extract<EngineEvent, { type: 'end' }>;
    expect(end.result.success).toBe(true);
    expect(end.result.fruitCount).toBe(10);
  });

  it('성공 직후에는 추가 충돌·시간·생성이 없다', () => {
    const e = engine();
    e.spawningEnabled = true;
    for (let i = 0; i < 10; i++) {
      place(e, 'kiwi');
      e.update(16, mouth(true));
    }
    expect(e.finished).toBe(true);
    const before = JSON.stringify({ r: e.round, n: e.objects.length });
    place(e, 'can');
    place(e, 'orange');
    for (let i = 0; i < 20; i++) expect(e.update(100, mouth(true))).toEqual([]);
    expect(e.round.trashCount).toBe(0);
    expect(e.round.fruitCount).toBe(10);
    expect(JSON.stringify({ r: e.round, n: e.objects.length - 2 })).toBe(before);
  });

  it('쓰레기 2번까지는 계속, 3번째에 즉시 실패', () => {
    const e = engine();
    for (let i = 0; i < 2; i++) {
      place(e, TRASH_IDS[i] as ItemId);
      e.update(16, mouth(true));
    }
    expect(e.round.status).toBe('running');
    place(e, 'fishbone');
    const ev = e.update(16, mouth(true));
    expect(e.round.status).toBe('fail');
    expect(e.round.failReason).toBe('trash');
    const end = ends(ev)[0] as Extract<EngineEvent, { type: 'end' }>;
    expect(end.result.failReason).toBe('trash');
    expect(end.result.trashCount).toBe(3);
  });

  it('실패 직후 추가 충돌이 일어나지 않는다', () => {
    const e = engine();
    for (let i = 0; i < 3; i++) {
      place(e, 'can');
      e.update(16, mouth(true));
    }
    place(e, 'kiwi');
    expect(e.update(16, mouth(true))).toEqual([]);
    expect(e.round.fruitCount).toBe(0);
    expect(e.round.trashCount).toBe(3);
  });

  it('20초가 끝났을 때 과일이 9개면 실패(timeout)', () => {
    const e = engine();
    for (let i = 0; i < 9; i++) {
      place(e, 'kiwi');
      e.update(16, mouth(true));
    }
    let end: EngineEvent | undefined;
    for (let t = 0; t < 25_000 && !e.finished; t += 100) end = e.update(100, mouth(false)).find((x) => x.type === 'end');
    expect(e.round.status).toBe('fail');
    expect(e.round.failReason).toBe('timeout');
    expect((end as Extract<EngineEvent, { type: 'end' }>).result.fruitCount).toBe(9);
  });

  it('시간 종료 프레임에서는 충돌을 처리하지 않는다(종료 시각 이후 수집 불인정)', () => {
    const e = engine();
    for (let i = 0; i < 9; i++) {
      place(e, 'kiwi');
      e.update(16, mouth(true));
    }
    // 19.9초까지 진행
    while (e.round.elapsedMs < GAME.DURATION_MS - 50) e.update(50, mouth(false));
    place(e, 'kiwi'); // 이 과일이 10번째가 될 수 있다
    // 이번 프레임이 20초를 넘기는 프레임: 시간 종료가 먼저 확정되어 수집은 인정되지 않는다
    const ev = e.update(100, mouth(true));
    expect(e.round.fruitCount).toBe(9);
    expect(e.round.failReason).toBe('timeout');
    expect(ends(ev)).toHaveLength(1);
  });

  it('남은 시간이 5초 이하가 되면 5,4,3,2,1 카운트다운 이벤트', () => {
    const e = engine();
    const seen: number[] = [];
    for (let t = 0; t < 21_000 && !e.finished; t += 50) for (const ev of e.update(50, mouth(false))) if (ev.type === 'countdown') seen.push(ev.n);
    expect(seen).toEqual([5, 4, 3, 2, 1]);
  });

  it('시간은 프레임 수가 아니라 실제 경과 시간: 10fps와 60fps 모두 20초에 끝난다', () => {
    for (const dt of [100, 16, 33]) {
      const e = engine();
      let elapsed = 0;
      while (!e.finished) {
        e.update(dt, mouth(false));
        elapsed += dt;
      }
      expect(e.round.elapsedMs).toBe(GAME.DURATION_MS);
      expect(elapsed).toBeGreaterThanOrEqual(GAME.DURATION_MS);
      expect(elapsed).toBeLessThan(GAME.DURATION_MS + 100);
    }
  });
});

describe('같은 프레임의 여러 충돌', () => {
  it('입 중심에 가까운 순서로 처리된다', () => {
    const e = engine();
    place(e, 'kiwi', 60, 0); // 멀다
    place(e, 'orange', 5, 0); // 가장 가깝다
    place(e, 'strawberry', 30, 0);
    const ev = collects(e.update(16, mouth(true, 640, 500, 120, 80))) as Extract<EngineEvent, { type: 'collect' }>[];
    expect(ev.map((x) => x.itemId)).toEqual(['orange', 'strawberry', 'kiwi']);
  });

  it('9번째 과일 뒤 같은 프레임에 과일 2개 + 쓰레기 1개 → 10번째에서 성공하고 나머지는 처리하지 않는다', () => {
    const e = engine();
    for (let i = 0; i < 8; i++) {
      place(e, 'kiwi');
      e.update(16, mouth(true));
    }
    place(e, 'orange', 0, 0); // 가장 가깝다 → 9번째
    place(e, 'strawberry', 20, 0); // 10번째 → 성공
    place(e, 'can', 40, 0); // 처리되지 않아야 한다
    const ev = e.update(16, mouth(true, 640, 500, 140, 90));
    expect(collects(ev)).toHaveLength(2);
    expect(e.round.status).toBe('success');
    expect(e.round.trashCount).toBe(0);
    expect(e.objects.some((o) => o.itemId === 'can' && !o.handled)).toBe(true); // 쓰레기는 처리되지 않고 남아 있다
  });

  it('쓰레기 2번 뒤 같은 프레임에 쓰레기(가까움) → 과일(멀음): 3번째 쓰레기에서 실패, 과일은 처리하지 않는다', () => {
    const e = engine();
    for (let i = 0; i < 2; i++) {
      place(e, 'can');
      e.update(16, mouth(true));
    }
    place(e, 'sock', 0, 0);
    place(e, 'kiwi', 30, 0);
    const ev = e.update(16, mouth(true, 640, 500, 140, 90));
    expect(e.round.status).toBe('fail');
    expect(collects(ev)).toHaveLength(1);
    expect(e.round.fruitCount).toBe(0);
  });

  it('반대로 과일이 더 가까우면 과일이 먼저 처리되어 성공할 수 있다', () => {
    const e = engine();
    for (let i = 0; i < 9; i++) {
      place(e, 'kiwi');
      e.update(16, mouth(true));
    }
    for (let i = 0; i < 2; i++) {
      place(e, 'can');
      e.update(16, mouth(false));
      e.objects = [];
    }
    e.round.trashCount = 2;
    place(e, 'orange', 0, 0); // 가까움 → 10번째 과일 → 성공
    place(e, 'can', 30, 0); // 3번째 쓰레기가 될 뻔했지만 처리되지 않는다
    e.update(16, mouth(true, 640, 500, 140, 90));
    expect(e.round.status).toBe('success');
    expect(e.round.trashCount).toBe(2);
  });
});

describe('라운드 초기화(다시 하기)', () => {
  it('reset 하면 점수·타이머·오브젝트가 모두 초기화된다', () => {
    const e = engine(3);
    e.spawningEnabled = true;
    for (let t = 0; t < 3000; t += 16) e.update(16, mouth(false));
    place(e, 'kiwi');
    e.update(16, mouth(true));
    expect(e.round.fruitCount).toBe(1);
    expect(e.round.elapsedMs).toBeGreaterThan(2000);
    e.reset(9);
    expect(e.round.fruitCount).toBe(0);
    expect(e.round.trashCount).toBe(0);
    expect(e.round.elapsedMs).toBe(0);
    expect(e.round.collected).toEqual([]);
    expect(e.objects).toEqual([]);
    expect(e.finished).toBe(false);
  });

  it('종료된 뒤 reset 하면 다시 진행된다', () => {
    const e = engine();
    e.forceEnd(false);
    expect(e.finished).toBe(true);
    e.reset(2);
    e.spawningEnabled = false;
    place(e, 'kiwi');
    e.update(16, mouth(true));
    expect(e.round.fruitCount).toBe(1);
  });
});

describe('생성·제거 통합', () => {
  it('자동 생성 오브젝트가 아래로 떨어지다가 화면 밖에서 제거된다', () => {
    const e = new GameEngine({ shapes, dims }, 4);
    let max = 0;
    for (let t = 0; t < 12_000; t += 16) {
      e.update(16, mouth(false));
      max = Math.max(max, e.objects.length);
    }
    expect(e.spawnStats.fruits + e.spawnStats.trash).toBeGreaterThan(10);
    expect(max).toBeLessThan(20); // 화면 밖 오브젝트가 계속 쌓이지 않는다
    expect(e.objects.every((o) => o.y < 720 + GAME.OFFSCREEN_MARGIN + 400)).toBe(true);
  });

  it('입을 계속 닫고 있으면 아무것도 수집되지 않고 20초 뒤 실패한다', () => {
    const e = new GameEngine({ shapes, dims }, 5);
    while (!e.finished) e.update(16, mouth(false));
    expect(e.round.fruitCount).toBe(0);
    expect(e.round.trashCount).toBe(0);
    expect(e.round.failReason).toBe('timeout');
  });

  it('입을 계속 열고 입을 화면 전체에 둔 극단 상황에서도 성공/실패 중 하나로 끝나고 규칙을 어기지 않는다', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const e = new GameEngine({ shapes, dims }, seed);
      const big = mouth(true, 640, 360, 700, 400);
      while (!e.finished) e.update(16, big);
      expect(['success', 'fail']).toContain(e.round.status);
      expect(e.round.fruitCount).toBeLessThanOrEqual(GAME.TARGET_FRUITS);
      expect(e.round.trashCount).toBeLessThanOrEqual(GAME.TRASH_FAIL_COUNT);
      if (e.round.status === 'success') expect(e.round.fruitCount).toBe(GAME.TARGET_FRUITS);
      if (e.round.failReason === 'trash') expect(e.round.trashCount).toBe(GAME.TRASH_FAIL_COUNT);
    }
  });
});
