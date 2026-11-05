import { describe, expect, it } from 'vitest';
import { GAME } from '../src/app/constants';
import { createRound, isFinished, processHits, remainingSeconds, summarize, tick, type HitToProcess, type RoundState } from '../src/game/round';

let n = 0;
const fruit = (id: string): HitToProcess => ({ seq: n++, kind: 'fruit', itemId: id });
const trash = (id = 'can'): HitToProcess => ({ seq: n++, kind: 'trash', itemId: id });

function applyAll(s: RoundState, hits: HitToProcess[]): RoundState {
  return processHits(s, hits).state;
}

describe('성공 조건', () => {
  it('과일 10개째에 즉시 성공한다', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 9 }, () => fruit('kiwi')));
    expect(s.status).toBe('running');
    const r = processHits(s, [fruit('kiwi')]);
    expect(r.state.status).toBe('success');
    expect(r.events).toEqual([{ type: 'success' }]);
  });
  it('같은 프레임에서 10번째 과일 뒤의 충돌은 처리하지 않는다(즉시 중단)', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 9 }, () => fruit('kiwi')));
    const hits = [fruit('orange'), fruit('orange'), trash()];
    const r = processHits(s, hits);
    expect(r.state.fruitCount).toBe(10);
    expect(r.state.trashCount).toBe(0);
    expect(r.processed).toEqual([hits[0]!.seq]);
  });
  it('성공 뒤에는 더 이상 충돌이 처리되지 않는다', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 10 }, () => fruit('kiwi')));
    const r = processHits(s, [fruit('kiwi'), trash()]);
    expect(r.processed).toEqual([]);
    expect(r.state.fruitCount).toBe(10);
  });
});

describe('실패 조건', () => {
  it('쓰레기 2번까지는 계속된다', () => {
    let s = createRound();
    s = applyAll(s, [trash(), trash()]);
    expect(s.status).toBe('running');
    expect(s.trashCount).toBe(2);
  });
  it('쓰레기 3번째에 즉시 실패한다', () => {
    let s = createRound();
    s = applyAll(s, [trash(), trash()]);
    const r = processHits(s, [trash('sock')]);
    expect(r.state.status).toBe('fail');
    expect(r.state.failReason).toBe('trash');
    expect(r.events).toEqual([{ type: 'fail', reason: 'trash' }]);
  });
  it('같은 프레임에서 3번째 쓰레기 뒤의 충돌은 처리하지 않는다', () => {
    let s = createRound();
    s = applyAll(s, [trash(), trash()]);
    const hits = [trash(), fruit('kiwi'), fruit('kiwi')];
    const r = processHits(s, hits);
    expect(r.processed).toEqual([hits[0]!.seq]);
    expect(r.state.fruitCount).toBe(0);
  });
  it('과일을 9개 모은 뒤 쓰레기 3개면 실패(과일 10개가 먼저가 아니면)', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 9 }, () => fruit('kiwi')));
    s = applyAll(s, [trash(), trash(), trash()]);
    expect(s.status).toBe('fail');
    expect(s.fruitCount).toBe(9);
  });
  it('쓰레기 2개 + 과일 10개째는 성공', () => {
    let s = createRound();
    s = applyAll(s, [trash(), trash()]);
    s = applyAll(s, Array.from({ length: 10 }, () => fruit('orange')));
    expect(s.status).toBe('success');
  });
  it('시간이 끝났을 때 과일 9개면 실패(timeout)', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 9 }, () => fruit('kiwi')));
    let ev: ReturnType<typeof tick>['events'] = [];
    for (let i = 0; i < 300 && !isFinished(s); i++) {
      const t = tick(s, 100);
      s = t.state;
      ev = t.events;
    }
    expect(s.status).toBe('fail');
    expect(s.failReason).toBe('timeout');
    expect(ev).toContainEqual({ type: 'fail', reason: 'timeout' });
  });
  it('시간이 끝났을 때 과일 0개여도 실패(timeout)', () => {
    let s = createRound();
    while (!isFinished(s)) s = tick(s, 100).state;
    expect(s.failReason).toBe('timeout');
  });
});

describe('시간', () => {
  it('실제 경과 시간의 합으로 20초에 끝난다(프레임 수와 무관)', () => {
    const run = (dt: number): number => {
      let s = createRound();
      let frames = 0;
      while (!isFinished(s)) {
        s = tick(s, dt).state;
        frames++;
      }
      expect(s.elapsedMs).toBe(GAME.DURATION_MS);
      return frames;
    };
    expect(run(100)).toBe(200); // 10fps
    expect(run(50)).toBe(400); // 20fps
    expect(run(16)).toBeGreaterThan(1200); // 60fps 근처 (같은 20초)
  });
  it('한 프레임의 시간은 MAX_FRAME_DT_MS로 잘린다(긴 멈춤이 시간을 한꺼번에 먹지 않는다)', () => {
    const s = tick(createRound(), 5000).state;
    expect(s.elapsedMs).toBe(GAME.MAX_FRAME_DT_MS);
  });
  it('음수 시간은 0으로 처리', () => {
    expect(tick(createRound(), -50).state.elapsedMs).toBe(0);
  });
  it('남은 시간(초)은 올림: 20초 시작, 0.5초 남으면 1', () => {
    expect(remainingSeconds(createRound())).toBe(20);
    expect(remainingSeconds({ ...createRound(), elapsedMs: 19_500 })).toBe(1);
    expect(remainingSeconds({ ...createRound(), elapsedMs: 20_000 })).toBe(0);
  });
  it('종료된 라운드는 시간이 더 흐르지 않는다', () => {
    let s = createRound();
    s = applyAll(s, Array.from({ length: 10 }, () => fruit('kiwi')));
    const t = tick(s, 100);
    expect(t.state).toBe(s);
    expect(t.events).toEqual([]);
  });
});

describe('카운트다운 5,4,3,2,1', () => {
  it('남은 시간이 5초 이하가 되면 5부터 1까지 한 번씩 알린다', () => {
    let s = createRound();
    const seen: number[] = [];
    while (!isFinished(s)) {
      const t = tick(s, 50);
      s = t.state;
      for (const e of t.events) if (e.type === 'countdown') seen.push(e.n);
    }
    expect(seen).toEqual([5, 4, 3, 2, 1]);
  });
  it('15초 전에는 알리지 않는다', () => {
    let s = createRound();
    const seen: number[] = [];
    while (s.elapsedMs < 14_900) {
      const t = tick(s, 100);
      s = t.state;
      for (const e of t.events) if (e.type === 'countdown') seen.push(e.n);
    }
    expect(seen).toEqual([]);
  });
  it('남은 시간이 5초가 되는 순간(15초)에 5를 알린다', () => {
    let s = createRound();
    let first = -1;
    while (!isFinished(s) && first < 0) {
      const t = tick(s, 100);
      s = t.state;
      if (t.events.some((e) => e.type === 'countdown' && e.n === 5)) first = s.elapsedMs;
    }
    expect(first).toBe(15_000 - 0 > 0 ? first : 0);
    expect(first).toBeLessThanOrEqual(15_100);
    expect(first).toBeGreaterThanOrEqual(15_000 - 1_000 + 1);
  });
  it('성공해서 먼저 끝나면 이후 카운트다운은 없다', () => {
    let s = createRound();
    s = tick({ ...s, elapsedMs: 16_000 }, 100).state; // 이미 5가 울린 구간
    s = applyAll(s, Array.from({ length: 10 }, () => fruit('kiwi')));
    const t = tick(s, 100);
    expect(t.events).toEqual([]);
  });
});

describe('결과 집계', () => {
  const collect = (ids: string[]): RoundState => applyAll(createRound(), ids.map((id) => fruit(id)));

  it('종류별 개수와 총합', () => {
    const r = summarize(collect(['kiwi', 'kiwi', 'orange', 'strawberry', 'kiwi']));
    expect(r.fruitCounts).toEqual({ strawberry: 1, kiwi: 3, orange: 1, blueberry: 0 });
    expect(r.fruitCount).toBe(5);
    expect(r.representative).toBe('kiwi');
  });
  it('가장 많이 수집한 과일이 대표', () => {
    const r = summarize(collect(['orange', 'kiwi', 'kiwi', 'orange', 'orange', 'blueberry']));
    expect(r.representative).toBe('orange');
  });
  it('동률이면 먼저 수집한 과일이 대표', () => {
    expect(summarize(collect(['kiwi', 'orange', 'orange', 'kiwi'])).representative).toBe('kiwi');
    expect(summarize(collect(['orange', 'kiwi', 'kiwi', 'orange'])).representative).toBe('orange');
    expect(summarize(collect(['blueberry', 'strawberry', 'kiwi', 'orange'])).representative).toBe('blueberry');
  });
  it('3개 과일이 동률일 때도 가장 먼저 수집한 과일', () => {
    expect(summarize(collect(['kiwi', 'orange', 'strawberry', 'strawberry', 'kiwi', 'orange'])).representative).toBe('kiwi');
  });
  it('수집한 다른 과일도 보존하고, 수집 순서(중복 제거)를 기록한다', () => {
    const r = summarize(collect(['orange', 'kiwi', 'orange', 'blueberry']));
    expect(r.firstOrder).toEqual(['orange', 'kiwi', 'blueberry']);
    expect(r.collected.map((c) => c.itemId)).toEqual(['orange', 'kiwi', 'orange', 'blueberry']);
    expect(r.fruitCounts.kiwi).toBe(1);
    expect(r.fruitCounts.blueberry).toBe(1);
  });
  it('성공 결과는 과일 합이 10', () => {
    const s = collect(['kiwi', 'kiwi', 'kiwi', 'orange', 'orange', 'strawberry', 'strawberry', 'blueberry', 'blueberry', 'kiwi']);
    const r = summarize(s);
    expect(r.success).toBe(true);
    expect(Object.values(r.fruitCounts).reduce((a, b) => a + b, 0)).toBe(10);
  });
  it('과일이 없으면 대표 없음', () => {
    expect(summarize(createRound()).representative).toBeNull();
  });
  it('실패 사유와 쓰레기 횟수가 결과에 담긴다', () => {
    let s = collect(['kiwi']);
    s = applyAll(s, [trash(), trash(), trash()]);
    const r = summarize(s);
    expect(r.success).toBe(false);
    expect(r.failReason).toBe('trash');
    expect(r.trashCount).toBe(3);
  });
});
