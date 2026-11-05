// 모찌 씬 데이터: 이번 라운드 결과로 정해진 과일(종류·개수·수집 순서)과 배치 시드. INTRO에서 만들고 STRETCH·TOUCH가 같은 배치를 쓴다.
import type { FruitCounts } from './fruitLayout';
import type { FruitId } from '../app/constants';

export interface FruitInput {
  counts: FruitCounts;
  firstOrder: FruitId[];
  isSample: boolean;
}

export interface MochiScene {
  fruits: FruitInput;
  seed: number;
}
