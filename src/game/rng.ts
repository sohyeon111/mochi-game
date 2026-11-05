// 시드를 줄 수 있는 난수 (테스트에서 재현 가능). 실제 게임은 Math.random 기반 시드를 쓴다.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = (): number => (Math.random() * 0xffffffff) >>> 0;

export const range = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * rng();
