// 떨어지는 오브젝트 생성·이동. 순수 로직 (난수는 주입).
import { gameTuning, layout } from '../app/layout';
import { FRUIT_IDS, GAME, TRASH_IDS, type ItemId } from '../app/constants';
import { range, type Rng } from './rng';
import type { FallingObject, ObjectKind } from './types';

export interface SpriteDims {
  /** 에셋 키(fruit_strawberry …) → 기본 표시 배율(스프라이트 px → 스테이지 px) */
  baseScale: Record<string, number>;
  /** 에셋 키 → 스프라이트 크기 */
  size: Record<string, { w: number; h: number }>;
}

export const assetKeyOf = (kind: ObjectKind, id: ItemId): string => `${kind === 'fruit' ? 'fruit' : 'trash'}_${id}`;

/** Blender 실제 치수 비율을 유지하는 기본 배율: 스테이지 px/m ÷ 스프라이트 px/m */
export const baseScaleFromPxPerMeter = (spritePxPerMeter: number): number => GAME.STAGE_PX_PER_METER / spritePxPerMeter;

/** 흔들림이 적용된 x 위치 */
export const swayX = (o: Pick<FallingObject, 'baseX' | 'swayAmp' | 'swayFreq' | 'swayPhase'>, ageMs: number): number =>
  o.baseX + o.swayAmp * Math.sin(2 * Math.PI * o.swayFreq * (ageMs / 1000) + o.swayPhase);

/** 흔들림 속도에 비례하는 기울기(rad) */
export const swayTilt = (o: Pick<FallingObject, 'swayAmp' | 'swayFreq' | 'swayPhase'>, ageMs: number): number =>
  GAME.TILT_RAD * Math.cos(2 * Math.PI * o.swayFreq * (ageMs / 1000) + o.swayPhase);

/** 이동 한 걸음(ms). 처리된 오브젝트도 이동은 계속해 자연스럽게 사라지게 둘 수 있다. */
export function stepObject(o: FallingObject, dtMs: number): void {
  o.age += dtMs;
  o.y += (o.vy * dtMs) / 1000;
  o.x = swayX(o, o.age);
  o.rot = swayTilt(o, o.age);
}

export function isOffscreen(o: FallingObject, dims: SpriteDims): boolean {
  const s = dims.size[o.assetKey];
  const half = s ? (Math.max(s.w, s.h) * o.scale) / 2 : 100;
  return o.y - half > layout.h + GAME.OFFSCREEN_MARGIN;
}

export class Spawner {
  private seq = 0;
  private nextIn: number;
  private elapsed = 0;
  fruitsSpawned = 0;
  trashSpawned = 0;

  constructor(private rng: Rng, private dims: SpriteDims) {
    this.nextIn = 120; // 시작하자마자 곧 첫 오브젝트
  }

  /** 다음에 만들 종류. 과일 최소 보장 속도를 못 따라가면 과일을 강제한다 */
  private pickKind(): ObjectKind {
    const guaranteeWindow = GAME.DURATION_MS * GAME.GUARANTEE_BY;
    const need = GAME.MIN_GUARANTEED_FRUITS * Math.min(1, (this.elapsed + 600) / guaranteeWindow);
    if (this.fruitsSpawned < need) return 'fruit';
    return this.rng() < GAME.FRUIT_RATIO ? 'fruit' : 'trash';
  }

  private create(kind: ObjectKind): FallingObject {
    const ids = kind === 'fruit' ? FRUIT_IDS : TRASH_IDS;
    const itemId = ids[Math.floor(this.rng() * ids.length)] as ItemId;
    const assetKey = assetKeyOf(kind, itemId);
    const base = this.dims.baseScale[assetKey] ?? 0.3;
    const tune = gameTuning(); // 세로 화면은 좁고 길어서 크기·낙하 속도를 조정한다
    const scale = base * range(this.rng, GAME.SIZE_FACTOR) * tune.sizeScale;
    const sz = this.dims.size[assetKey] ?? { w: 300, h: 300 };
    const half = (Math.max(sz.w, sz.h) * scale) / 2;
    const swayAmp = range(this.rng, GAME.SWAY_AMPLITUDE_PX);
    const margin = Math.max(tune.spawnMarginX, swayAmp + half * 0.5);
    const baseX = margin + this.rng() * (layout.w - 2 * margin);
    const swayFreq = range(this.rng, GAME.SWAY_FREQ_HZ);
    const swayPhase = this.rng() * Math.PI * 2;
    const o: FallingObject = {
      seq: this.seq++, itemId, kind, assetKey, x: baseX, y: -half, baseX, vy: range(this.rng, GAME.FALL_SPEED) * tune.speedScale, scale,
      rot: 0, swayAmp, swayFreq, swayPhase, age: 0, handled: false,
    };
    o.x = swayX(o, 0);
    o.rot = swayTilt(o, 0);
    if (kind === 'fruit') this.fruitsSpawned += 1;
    else this.trashSpawned += 1;
    return o;
  }

  /** 시간을 dtMs만큼 진행하고 새로 생긴 오브젝트를 돌려준다 */
  update(dtMs: number): FallingObject[] {
    this.elapsed += dtMs;
    const out: FallingObject[] = [];
    this.nextIn -= dtMs;
    while (this.nextIn <= 0) {
      out.push(this.create(this.pickKind()));
      this.nextIn += range(this.rng, GAME.SPAWN_INTERVAL_MS);
    }
    return out;
  }
}
