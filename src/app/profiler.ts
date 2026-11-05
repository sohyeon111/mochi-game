// 구간별 소요 시간 측정(개발·검증용). 꺼져 있으면(기본) 호출 비용은 불리언 검사 하나뿐이다.
// 켜는 법: 콘솔에서 __mochi.prof.on = true. 결과: __mochi.prof.report() — 구간별 평균/p95/최대(ms)와 횟수.
export interface ProfStat {
  avg: number;
  p95: number;
  max: number;
  n: number;
}

export class Profiler {
  on = false;
  /** true면 그리기 직후 1픽셀을 읽어 GPU 작업 완료까지 기다린 시간(gpuSync)도 잰다 — 켜면 프레임 시간이 늘어난다(측정 전용) */
  syncGpu = false;
  private data = new Map<string, number[]>();

  /** 구간 시작 시각(꺼져 있으면 0) */
  t(): number {
    return this.on ? performance.now() : 0;
  }

  /** t()로 받은 시작 시각부터의 경과를 기록한다 */
  end(name: string, start: number): void {
    if (!this.on) return;
    this.add(name, performance.now() - start);
  }

  add(name: string, ms: number): void {
    let a = this.data.get(name);
    if (!a) {
      a = [];
      this.data.set(name, a);
    }
    if (a.length < 20000) a.push(ms);
  }

  reset(): void {
    this.data.clear();
  }

  report(): Record<string, ProfStat> {
    const out: Record<string, ProfStat> = {};
    for (const [k, a] of this.data) {
      const s = [...a].sort((x, y) => x - y);
      out[k] = { avg: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.floor(s.length * 0.95)] as number, max: s[s.length - 1] as number, n: s.length };
    }
    return out;
  }
}

export const prof = new Profiler();
