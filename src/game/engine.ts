// 게임 엔진: 생성 → 이동 → 입 충돌 → 규칙 적용을 한 프레임 단위로 진행한다. DOM·캔버스에 의존하지 않는 순수 로직.
import { GAME, type FruitId, type ItemId } from '../app/constants';
import type { MouthInput } from '../vision/types';
import { findHits } from './collision';
import { createRound, isFinished, processHits, summarize, tick, clampDt, type RoundState } from './round';
import { mulberry32, type Rng } from './rng';
import { Spawner, assetKeyOf, isOffscreen, stepObject, swayTilt, swayX, type SpriteDims } from './spawner';
import type { FallingObject, ObjectKind, RoundResult, ShapeTable } from './types';
import { FRUIT_IDS } from '../app/constants';

export type EngineEvent =
  | { type: 'collect'; object: FallingObject; kind: ObjectKind; itemId: ItemId; fruitCount: number; trashCount: number }
  | { type: 'countdown'; n: number }
  | { type: 'end'; result: RoundResult };

export interface EngineDeps {
  shapes: ShapeTable;
  dims: SpriteDims;
}

export class GameEngine {
  round: RoundState = createRound();
  objects: FallingObject[] = [];
  private spawner: Spawner;
  private ended = false;
  /** 테스트·개발용: false면 새 오브젝트를 만들지 않는다 */
  spawningEnabled = true;
  private rng: Rng;

  constructor(private deps: EngineDeps, seed = 1) {
    this.rng = mulberry32(seed);
    this.spawner = new Spawner(this.rng, deps.dims);
  }

  /** 새 라운드 시작: 점수·타이머·오브젝트를 모두 초기화한다 */
  reset(seed: number): void {
    this.rng = mulberry32(seed);
    this.spawner = new Spawner(this.rng, this.deps.dims);
    this.round = createRound();
    this.objects = [];
    this.ended = false;
  }

  get finished(): boolean {
    return isFinished(this.round);
  }

  get spawnStats(): { fruits: number; trash: number } {
    return { fruits: this.spawner.fruitsSpawned, trash: this.spawner.trashSpawned };
  }

  /**
   * 한 프레임 진행. 순서:
   * 1) 시간 진행(시간 종료면 그 프레임에서 확정, 충돌은 처리하지 않음)
   * 2) 생성·이동·화면 밖 제거
   * 3) 입 충돌(입이 열려 있을 때만) → 거리순 처리, 성공/실패 시 즉시 중단
   */
  update(dtMs: number, mouth: MouthInput): EngineEvent[] {
    if (this.finished) return [];
    const events: EngineEvent[] = [];
    const dt = clampDt(dtMs);

    const t = tick(this.round, dt);
    this.round = t.state;
    for (const e of t.events) if (e.type === 'countdown') events.push({ type: 'countdown', n: e.n });
    if (this.finished) {
      this.pushEnd(events);
      return events;
    }

    if (this.spawningEnabled) this.objects.push(...this.spawner.update(dt));
    for (const o of this.objects) stepObject(o, dt);
    this.objects = this.objects.filter((o) => !o.handled && !isOffscreen(o, this.deps.dims));

    const hits = findHits(this.objects, mouth, this.deps.shapes);
    if (hits.length > 0) {
      const before = this.round;
      const r = processHits(before, hits.map((h) => ({ seq: h.object.seq, kind: h.object.kind, itemId: h.object.itemId })));
      this.round = r.state;
      const bySeq = new Map(hits.map((h) => [h.object.seq, h.object]));
      let fruits = before.fruitCount;
      let trash = before.trashCount;
      for (const seq of r.processed) {
        const o = bySeq.get(seq);
        if (!o) continue;
        o.handled = true; // 이후 충돌하지 않는다
        if (o.kind === 'fruit') fruits += 1;
        else trash += 1;
        events.push({ type: 'collect', object: { ...o }, kind: o.kind, itemId: o.itemId, fruitCount: fruits, trashCount: trash });
      }
      this.objects = this.objects.filter((o) => !o.handled);
      if (this.finished) this.pushEnd(events);
    }
    return events;
  }

  private pushEnd(events: EngineEvent[]): void {
    if (this.ended) return;
    this.ended = true;
    events.push({ type: 'end', result: summarize(this.round) });
  }

  // ------------------------------------------------------------------ 개발·테스트 도구
  /** 지정한 위치에 정지한 오브젝트를 만든다(충돌 테스트용). vy 기본 0, 흔들림 없음. */
  debugSpawn(itemId: ItemId, x: number, y: number, vy = 0): FallingObject {
    const kind: ObjectKind = (FRUIT_IDS as readonly string[]).includes(itemId) ? 'fruit' : 'trash';
    const assetKey = assetKeyOf(kind, itemId);
    const o: FallingObject = {
      seq: 100000 + this.objects.length + this.round.collected.length * 7 + Math.floor(this.rng() * 1000), itemId, kind, assetKey, x, y, baseX: x, vy,
      scale: this.deps.dims.baseScale[assetKey] ?? 0.3, rot: 0, swayAmp: 0, swayFreq: 1, swayPhase: 0, age: 0, handled: false,
    };
    o.x = swayX(o, 0);
    o.rot = swayTilt(o, 0);
    this.objects.push(o);
    return o;
  }

  /** 개발용: 결과를 강제로 확정한다 */
  forceEnd(success: boolean): EngineEvent[] {
    if (this.finished) return [];
    if (success) {
      const fruits = [...FRUIT_IDS] as FruitId[];
      for (let i = this.round.fruitCount; i < GAME.TARGET_FRUITS; i++) {
        this.round.collected.push({ itemId: fruits[i % fruits.length] as FruitId, seq: -1 - i, at: this.round.elapsedMs });
        this.round.fruitCount += 1;
      }
      this.round.status = 'success';
    } else {
      this.round.trashCount = GAME.TRASH_FAIL_COUNT;
      this.round.status = 'fail';
      this.round.failReason = 'trash';
    }
    const events: EngineEvent[] = [];
    this.pushEnd(events);
    return events;
  }
}
