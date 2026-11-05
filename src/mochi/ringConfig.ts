// 링·메시 해상도 설정. 기본값은 constants.ts(MOCHI). 개발 모드(DEV)에서만 주소의 ?ring=32|48|64, ?mesh=1|1.5|2 로 덮어써 비교할 수 있다.
import { MOCHI } from '../app/constants';
import type { RingOptions } from './ringResample';

export function resolveRingOptions(search: string = typeof location !== 'undefined' ? location.search : ''): RingOptions {
  let points: number = MOCHI.RING_POINTS;
  let meshScale: number = MOCHI.MESH_SCALE;
  // import.meta.env.DEV는 배포 빌드에서 상수 false로 치환되어 이 블록이 제거된다
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(search);
    const r = Number(q.get('ring'));
    const m = Number(q.get('mesh'));
    if (Number.isInteger(r) && r >= 16 && r <= 128) points = r;
    if (m >= 1 && m <= 3) meshScale = m;
  }
  return { points, meshScale, decayRatio: MOCHI.MESH_DECAY_RATIO };
}
