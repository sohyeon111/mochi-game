// 렌더링 품질 단계 조절: 프레임이 느리면 단계적으로 낮추고, 충분히 여유가 생기면 올린다. 시각 품질을 위해 프레임을 희생하지 않는다.
import { MOCHI } from '../app/constants';

export interface QualityTier {
  name: string;
  /** 워프 메시 정점 건너뛰기(1 = 전체 22×18, 클수록 삼각형이 적다) */
  stride: number;
  /** 텍스처(오프스크린) 해상도 배율 */
  textureScale: number;
  /** 눌림 그림자·하이라이트 등 부가 효과 */
  effects: boolean;
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: '최고', stride: 1, textureScale: 1, effects: true },
  { name: '높음', stride: 2, textureScale: 1, effects: true },
  { name: '보통', stride: 3, textureScale: 0.85, effects: true },
  { name: '낮음', stride: 4, textureScale: 0.7, effects: false },
  { name: '최저', stride: 6, textureScale: 0.55, effects: false },
];

export class QualityController {
  private _tier: number;
  private slow = 0;
  private fast = 0;
  /** 최근 프레임 시간의 지수이동평균(ms) */
  avgMs = 0;

  constructor(initialTier = 0) {
    this._tier = Math.min(QUALITY_TIERS.length - 1, Math.max(0, initialTier));
  }

  get tierIndex(): number {
    return this._tier;
  }
  get tier(): QualityTier {
    return QUALITY_TIERS[this._tier] as QualityTier;
  }

  /**
   * 한 프레임의 정보를 알려 준다. 단계가 바뀌면 true.
   * - frameMs: 프레임 간격(느려지면 프레임이 떨어진 것), workMs: 이 프레임의 처리(그리기) 시간
   * - 낮추기: 프레임 간격 또는 처리 시간이 오래 걸리는 프레임이 계속될 때
   * - 올리기: 한 단계 올렸을 때의 예상 처리 시간(삼각형 수에 비례 ≈ stride²)이 예산 이하인 프레임이 오래 이어질 때
   * 100ms 넘는 한 번짜리 멈춤은 무시한다.
   */
  update(frameMs: number, workMs: number = frameMs): boolean {
    if (frameMs > 100) return false;
    this.avgMs = this.avgMs === 0 ? frameMs : this.avgMs * 0.9 + frameMs * 0.1;
    const cur = QUALITY_TIERS[this._tier] as QualityTier;
    const up = QUALITY_TIERS[this._tier - 1];
    const predictedUp = up ? workMs * (cur.stride / up.stride) ** 2 : Infinity;
    if (frameMs > MOCHI.QUALITY_SLOW_MS || workMs > MOCHI.QUALITY_SLOW_MS) {
      this.slow++;
      this.fast = 0;
    } else if (predictedUp <= MOCHI.QUALITY_UP_BUDGET_MS) {
      this.fast++;
      this.slow = Math.max(0, this.slow - 1);
    } else {
      this.slow = Math.max(0, this.slow - 1);
      this.fast = Math.max(0, this.fast - 1);
    }
    if (this.slow >= MOCHI.QUALITY_DOWN_FRAMES && this._tier < QUALITY_TIERS.length - 1) {
      this._tier++;
      this.slow = this.fast = 0;
      return true;
    }
    if (this.fast >= MOCHI.QUALITY_UP_FRAMES && this._tier > 0) {
      this._tier--;
      this.slow = this.fast = 0;
      return true;
    }
    return false;
  }
}
