// 모찌 화면에 쓸 과일 결과를 정한다. 실제 라운드 결과가 있으면 그것만 쓴다.
// 결과가 없을 때의 샘플은 **개발 환경(DEV)에서만** 쓰고, 배포 버전에서는 임의의 과일을 만들어 보여주지 않는다(과일 없음).
import { FRUIT_IDS, type FruitId } from '../app/constants';
import type { RoundResult } from '../game/types';
import type { FruitCounts } from './fruitLayout';

/** 개발용 샘플: 키위4·오렌지3·딸기2·블루베리1 (SPEC 협의) */
export const DEV_SAMPLE: { counts: FruitCounts; firstOrder: FruitId[] } = {
  counts: { strawberry: 2, kiwi: 4, orange: 3, blueberry: 1 },
  firstOrder: ['kiwi', 'orange', 'strawberry', 'blueberry'],
};

export const emptyCounts = (): FruitCounts => Object.fromEntries(FRUIT_IDS.map((f) => [f, 0])) as FruitCounts;

export interface MochiFruitInput {
  counts: FruitCounts;
  firstOrder: FruitId[];
  /** 개발용 샘플이 쓰였는지(화면에 표시해 혼동을 막는다) */
  isSample: boolean;
}

export function resolveMochiFruits(result: RoundResult | null, isDev: boolean): MochiFruitInput {
  if (result) return { counts: { ...result.fruitCounts }, firstOrder: [...result.firstOrder], isSample: false };
  // import.meta.env.DEV가 상수로 치환되어 배포 번들에서는 이 분기와 DEV_SAMPLE이 통째로 제거된다
  if (isDev && import.meta.env.DEV) return { counts: { ...DEV_SAMPLE.counts }, firstOrder: [...DEV_SAMPLE.firstOrder], isSample: true };
  return { counts: emptyCounts(), firstOrder: [], isSample: false };
}
