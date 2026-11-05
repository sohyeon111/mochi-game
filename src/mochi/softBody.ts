// 찹쌀떡 소프트바디: 외곽 링의 질량점들을 Verlet + 위치 기반 제약(PBD)으로 움직인다. DOM에 의존하지 않는 순수 로직 (SPEC 7.5).
//  - 이웃/반대편 점 간격 유지(스프링 역할), 이웃 간격 상한(찢어짐 방지)
//  - 기준 형태로 돌아가는 복원, 면적(부피) 보존, 속도 감쇠
//  - 고정 시간 간격(1/120초) 서브스텝, 바닥 접촉, 폭주 방지(이동량 상한)
import { MOCHI } from '../app/constants';
import { centroidOf, isNearPolygon, signedArea } from './geometry';
import { extentAlong, majorAxis, maxExtentLength, stretchRatio } from './stretchProgress';

export interface BodyOptions {
  /** 바닥 y(이보다 아래로 내려가지 않음). null이면 바닥 없음(위 시점) */
  groundY: number | null;
  /** 아래쪽을 책상에 붙여 두는 비율(0이면 없음). STRETCH에서 사용 */
  pinBand: number;
  /** 위쪽 화면 여백: 점이 이보다 위로 올라가지 못한다 */
  topLimitY: number;
}

export const DEFAULT_BODY_OPTIONS: BodyOptions = { groundY: null, pinBand: 0, topLimitY: -Infinity };

export class SoftBody {
  readonly n: number;
  /** 현재 위치 / 이전 위치(Verlet) */
  readonly x: number[];
  readonly y: number[];
  private px: number[];
  private py: number[];
  /** 기준 형태(논리 좌표) */
  readonly rx: number[];
  readonly ry: number[];
  /** 복원 힘 배율(바닥 고정 점은 크게) */
  private pinMul: number[];
  private edgeLen: number[];
  private oppLen: number[];
  private area0: number;
  readonly restMajor: number;
  /** 링 점 사이 거리의 최후 방어선(찢어짐 방지) */
  readonly failsafeMajor: number;
  /** 마지막으로 잡아당긴 방향(단위 벡터). 늘림 비율은 이 방향 기준 */
  private axis: { x: number; y: number } = { x: 0, y: -1 };
  private axisValid = false;
  readonly restWidth: number;
  readonly centroid0: { x: number; y: number };
  /** 복원 기준점의 평행 이동(등장 애니메이션에서 떡 전체가 떨어질 때 사용) */
  anchorX = 0;
  anchorY = 0;
  /** 제약 계산용 임시 배열(프레임마다 새로 만들지 않는다) */
  private scratchA: number[] = [];
  private scratchB: number[] = [];
  private accumulator = 0;
  private opts: BodyOptions;

  // 잡기(STRETCH)
  private grabW: number[] | null = null;
  private grabDx = 0;
  private grabDy = 0;
  private grabOrigin: { x: number; y: number } | null = null;
  /** 당김 필드: 모든 점에 "당기는 방향 기준 위치(0 반대편 ~ 1 앞쪽 끝)에 따른 가중치"를 둔다 */
  private grabU = { x: 0, y: -1 };
  private grabV = { x: 1, y: 0 };
  private grabH = 1;
  /** 점별 가중치와 몸 중심선으로부터 옆 방향 거리(당기는 방향에 수직) */
  private grabField: number[] = [];
  private grabPerp: number[] = [];
  /** 놓은 뒤 당김이 부드럽게 풀리는 동안의 남은 당김 거리(0이면 없음). 놓는 순간 구속이 사라져 끝이 접히는 것을 막는다 */
  private fadeD = 0;
  private fadeV = 0;

  // 누르기(TOUCH)
  private pressAt: { x: number; y: number } | null = null;
  private pressTarget = 0;
  /** 현재 눌림 정도(0~1) */
  pressAmount = 0;
  private pressVel = { x: 0, y: 0 };

  // 손가락 접촉(손 입력): 손가락 끝마다 독립적인 접촉점(최대 5). 마우스 누르기(setPress)와 별개로 동시에 동작한다
  private fx: number[] = [0, 0, 0, 0, 0];
  private fy: number[] = [0, 0, 0, 0, 0];
  private fvx: number[] = [0, 0, 0, 0, 0];
  private fvy: number[] = [0, 0, 0, 0, 0];
  /** 현재 눌림 정도(부드럽게 오르내림)와 목표 */
  private fAmt: number[] = [0, 0, 0, 0, 0];
  private fTarget: number[] = [0, 0, 0, 0, 0];

  /** 중력(px/s²) — 등장 애니메이션에서만 0이 아니다 */
  gravity = 0;

  constructor(restX: readonly number[], restY: readonly number[], opts: Partial<BodyOptions> = {}) {
    this.n = restX.length;
    this.opts = { ...DEFAULT_BODY_OPTIONS, ...opts };
    this.rx = [...restX];
    this.ry = [...restY];
    this.x = [...restX];
    this.y = [...restY];
    this.px = [...restX];
    this.py = [...restY];
    const n = this.n;
    this.scratchA = new Array<number>(n).fill(0);
    this.scratchB = new Array<number>(n).fill(0);
    this.edgeLen = Array.from({ length: n }, (_, i) => Math.hypot(restX[(i + 1) % n]! - restX[i]!, restY[(i + 1) % n]! - restY[i]!));
    const half = Math.floor(n / 2);
    this.oppLen = Array.from({ length: n }, (_, i) => Math.hypot(restX[(i + half) % n]! - restX[i]!, restY[(i + half) % n]! - restY[i]!));
    this.area0 = signedArea(restX, restY);
    this.restMajor = majorAxis(restX, restY);
    this.failsafeMajor = this.restMajor * MOCHI.MAX_MAJOR_FAILSAFE;
    this.restWidth = Math.max(...restX) - Math.min(...restX);
    this.centroid0 = centroidOf(restX, restY);
    const minY = Math.min(...restY);
    const maxY = Math.max(...restY);
    this.pinMul = restY.map((yy) => (this.opts.pinBand > 0 && yy >= maxY - (maxY - minY) * this.opts.pinBand ? MOCHI.PIN_MULTIPLIER : 1));
  }

  // ------------------------------------------------------------------ 상태
  reset(): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.px[i] = this.rx[i] as number;
      this.y[i] = this.py[i] = this.ry[i] as number;
    }
    this.anchorX = this.anchorY = 0;
    this.releaseGrab();
    this.fadeD = this.fadeV = 0;
    this.axisValid = false;
    this.pressAt = null;
    this.pressTarget = this.pressAmount = 0;
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) this.fAmt[i] = this.fTarget[i] = this.fvx[i] = this.fvy[i] = 0;
    this.accumulator = 0;
    this.gravity = 0;
  }

  /** 모든 점을 기준 위치 + (dx,dy)에 두고 속도를 0으로 한다 */
  placeAtRest(dx = 0, dy = 0): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.px[i] = (this.rx[i] as number) + dx;
      this.y[i] = this.py[i] = (this.ry[i] as number) + dy;
    }
    this.anchorX = dx;
    this.anchorY = dy;
  }

  /** 모든 점(과 이전 위치)을 평행 이동한다. 변형은 그대로 두고 떡 전체를 옮길 때 쓴다(등장 애니메이션) */
  translate(dx: number, dy: number): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = (this.x[i] as number) + dx;
      this.y[i] = (this.y[i] as number) + dy;
      this.px[i] = (this.px[i] as number) + dx;
      this.py[i] = (this.py[i] as number) + dy;
    }
    this.anchorX += dx;
    this.anchorY += dy;
  }

  currentMajor(): number {
    return majorAxis(this.x, this.y);
  }
  /** 기본 형태에서 (ux,uy) 방향으로의 길이 */
  restExtentAlong(ux: number, uy: number): number {
    return extentAlong(this.rx, this.ry, ux, uy);
  }
  /** 마지막으로 잡아당긴 방향 기준의 늘림 비율(0~). 한 번도 잡아당기지 않았으면 0 */
  currentStretchRatio(): number {
    if (!this.axisValid) return 0;
    const rest = this.restExtentAlong(this.axis.x, this.axis.y);
    return stretchRatio(extentAlong(this.x, this.y, this.axis.x, this.axis.y), rest);
  }
  area(): number {
    return signedArea(this.x, this.y);
  }
  /** 기준 면적 대비 현재 면적 비율 */
  areaRatio(): number {
    return this.area() / this.area0;
  }
  centroid(): { x: number; y: number } {
    return centroidOf(this.x, this.y);
  }
  /** 가장 큰 변위(기준 위치+앵커 대비), 속도의 최대 — 안정(settled) 판정용 */
  maxDisplacement(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.hypot((this.x[i] as number) - (this.rx[i] as number) - this.anchorX, (this.y[i] as number) - (this.ry[i] as number) - this.anchorY));
    return m;
  }
  maxSpeed(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.hypot((this.x[i] as number) - (this.px[i] as number), (this.y[i] as number) - (this.py[i] as number)));
    return m * (1000 / MOCHI.SUBSTEP_MS);
  }
  isSettled(dispEps = 0.8, speedEps = 12): boolean {
    return !this.grabW && this.fadeD === 0 && this.pressAmount < 0.01 && !this.hasFingers && this.maxDisplacement() < dispEps && this.maxSpeed() < speedEps;
  }

  // ------------------------------------------------------------------ 잡기 (STRETCH)
  /** 점(px,py)이 모찌를 잡을 수 있는 영역(실루엣 + 바깥 GRAB_MARGIN_PX, 논리 좌표)인지 */
  canGrab(px: number, py: number): boolean {
    return isNearPolygon(px, py, this.x, this.y, MOCHI.GRAB_MARGIN_PX);
  }

  beginGrab(px: number, py: number): boolean {
    if (!this.canGrab(px, py)) return false;
    this.axisValid = false;
    this.grabW = new Array<number>(this.n).fill(0); // 잡힘 표시(실제 가중치는 방향이 정해지면 updateGrabField가 채운다)
    this.grabOrigin = { x: px, y: py };
    this.fadeD = 0;
    this.fadeV = 0;
    this.grabDx = this.grabDy = 0;
    this.grabField = new Array<number>(this.n).fill(0);
    this.grabPerp = new Array<number>(this.n).fill(0);
    return true;
  }

  /**
   * 당기는 방향(ux,uy)이 정해지면 점마다 당김 가중치를 만든다.
   * 이전 방식(잡은 점 주변의 가우스 종 모양)은 변위가 몇 개의 점에 몰려 끝이 뾰족한 삼각형이 됐다.
   * 지금은 반대편(0)에서 앞쪽 끝(1)까지 **몸 전체에 매끄럽게 이어지는 변위 필드**를 쓴다:
   *  - 축 방향 가중치 t^p: 앞쪽일수록 많이 움직이고 반대편은 거의 안 움직여, 반죽이 몸 전체로 늘어난다.
   *  - 옆 방향 가중치: 잡은 쪽 옆이 조금 더 따라오되 완전히 0으로 떨어지지 않는다(바닥값 있음).
   *  - 폭 수축은 moveGrab/solveGrab에서 같은 가중치로 옆 방향을 줄여 목이 자연스럽게 가늘어진다.
   */
  private updateGrabField(ux: number, uy: number): void {
    if (!this.grabOrigin) return;
    const vx = -uy;
    const vy = ux;
    this.grabU = { x: ux, y: uy };
    this.grabV = { x: vx, y: vy };
    const n = this.n;
    const proj: number[] = new Array(n);
    const perp: number[] = new Array(n);
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const X = (this.rx[i] as number) + this.anchorX;
      const Y = (this.ry[i] as number) + this.anchorY;
      proj[i] = X * ux + Y * uy;
      perp[i] = X * vx + Y * vy;
      tMin = Math.min(tMin, proj[i] as number);
      tMax = Math.max(tMax, proj[i] as number);
    }
    const H = Math.max(1e-6, tMax - tMin);
    this.grabH = H;
    const cx = this.centroid0.x + this.anchorX;
    const cy = this.centroid0.y + this.anchorY;
    const perpC = cx * vx + cy * vy;
    const pinY = this.pinThresholdY();
    const perpG = this.grabOrigin.x * vx + this.grabOrigin.y * vy;
    const sigma = this.restWidth * MOCHI.GRAB_LATERAL_SIGMA_RATIO;
    const floor = MOCHI.GRAB_LATERAL_FLOOR;
    for (let i = 0; i < n; i++) {
      const t = ((proj[i] as number) - tMin) / H;
      const lat = Math.exp(-(((perp[i] as number) - perpG) ** 2) / (2 * sigma * sigma));
      (this.grabField as number[])[i] = t ** MOCHI.GRAB_RAMP_POWER * (floor + (1 - floor) * lat);
      (this.grabPerp as number[])[i] = this.neckReference(i, vx, vy, perp[i] as number, perpC, pinY);
    }
  }

  /** 책상에 붙여 두는 구역의 y 하한(기준 형태, 앵커 포함). 없으면 Infinity */
  private pinThresholdY(): number {
    if (this.opts.pinBand <= 0) return Infinity;
    const minY = Math.min(...this.ry);
    const maxY = Math.max(...this.ry);
    return maxY - (maxY - minY) * this.opts.pinBand + this.anchorY;
  }

  /**
   * 폭 수축의 기준선까지의 거리(점의 옆 방향 좌표 − 기준선 좌표).
   * 점을 지나 옆 방향으로 그은 선이 기준 윤곽과 만나는 반대쪽 끝(단면의 다른 끝)을 찾아,
   *  - 반대쪽 끝이 책상에 붙어 있으면(옆으로 당길 때의 윗면) 그 끝을 기준으로 줄여 책상에 붙은 채 납작하게 늘어나게 하고,
   *  - 아니면 단면의 가운데를 기준으로 가늘어지게 한다(위로 당길 때).
   * 책상에 붙은 점 자신은 줄이지 않는다. 몸 중심 기준이면 바닥이 고정된 옆 당김에서 윗면만 내려와 쐐기(삼각형)가 됐다.
   */
  private neckReference(i: number, vx: number, vy: number, perpI: number, perpC: number, pinY: number): number {
    const n = this.n;
    const X = (this.rx[i] as number) + this.anchorX;
    const Y = (this.ry[i] as number) + this.anchorY;
    if (Y >= pinY) return 0;
    let bestS = 0;
    let ox = X;
    let oy = Y;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      if (k === i || j === i) continue;
      const ax = (this.rx[k] as number) + this.anchorX;
      const ay = (this.ry[k] as number) + this.anchorY;
      const ex = (this.rx[j] as number) + this.anchorX - ax;
      const ey = (this.ry[j] as number) + this.anchorY - ay;
      // 점 + s·v = a + t·e 의 해(0≤t≤1)
      const det = vx * -ey - vy * -ex;
      if (Math.abs(det) < 1e-9) continue;
      const rxp = ax - X;
      const ryp = ay - Y;
      const sRay = (rxp * -ey - ryp * -ex) / det;
      const t = (vx * ryp - vy * rxp) / det;
      if (t < 0 || t > 1) continue;
      if (Math.abs(sRay) > Math.abs(bestS)) {
        bestS = sRay;
        ox = X + vx * sRay;
        oy = Y + vy * sRay;
      }
    }
    if (bestS === 0) return perpI - perpC;
    const perpO = ox * vx + oy * vy;
    if (oy < pinY) return perpI - (perpI + perpO) / 2;
    // 수평에 가까운 당김일수록 책상 쪽 끝을 기준으로(대각선에서 전부 책상 쪽으로 줄이면 어깨가 움푹 들어간다)
    const wp = Math.abs(this.grabU.x) ** 4;
    const ref = (perpI + perpO) / 2 + wp * (perpO - (perpI + perpO) / 2);
    return perpI - ref;
  }

  /** 포인터를 옮긴다. 안전 최대 길이를 넘지 않도록 끌어당기는 거리를 제한한다 */
  moveGrab(px: number, py: number): void {
    if (!this.grabOrigin) return;
    let dx = px - this.grabOrigin.x;
    let dy = py - this.grabOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const ux = dx / len;
      const uy = dy / len;
      // 안전 최대 늘림 길이(그 방향 기본 길이 × 배율)를 넘지 않도록 당기는 거리를 제한한다
      const rest = this.restExtentAlong(ux, uy);
      const dMax = Math.max(0, maxExtentLength(rest) - rest) * MOCHI.GRAB_REACH_FACTOR;
      if (len > dMax) {
        dx = ux * dMax;
        dy = uy * dMax;
      }
      this.axis = { x: ux, y: uy };
      this.axisValid = true;
      this.updateGrabField(ux, uy);
    }
    this.grabDx = dx;
    this.grabDy = dy;
  }

  releaseGrab(): void {
    if (this.grabW) {
      const d = Math.hypot(this.grabDx, this.grabDy);
      this.fadeD = d > 1 ? d : 0;
      this.fadeV = 0;
    }
    this.grabW = null;
    this.grabOrigin = null;
    this.grabDx = this.grabDy = 0;
  }
  get isGrabbing(): boolean {
    return this.grabW !== null;
  }
  /** 잡고 있거나 놓은 뒤 당김이 풀리는 중(이때만 책상에 붙은 점이 옆으로 미끄러진다) */
  private get isGripping(): boolean {
    return this.grabW !== null || this.fadeD !== 0;
  }

  // ------------------------------------------------------------------ 누르기 (TOUCH)
  /** (px,py)를 누른다. 이미 누르는 중이면 위치만 따라 움직이고 속도를 전달한다 */
  setPress(px: number, py: number, dtMs = 16): void {
    if (this.pressAt) {
      this.pressVel = { x: ((px - this.pressAt.x) / Math.max(1, dtMs)) * 1000, y: ((py - this.pressAt.y) / Math.max(1, dtMs)) * 1000 };
    } else {
      this.pressVel = { x: 0, y: 0 };
    }
    this.pressAt = { x: px, y: py };
    this.pressTarget = 1;
  }
  releasePress(): void {
    this.pressTarget = 0;
    this.pressVel = { x: 0, y: 0 };
  }
  get pressPoint(): { x: number; y: number } | null {
    return this.pressAt;
  }

  // ------------------------------------------------------------------ 손가락 접촉 (손 입력)
  /**
   * 손가락 접촉점을 갱신한다(렌더 프레임마다 호출). 목록에 없거나 active가 아닌 손가락은 눌림이 서서히 풀린다(위치는 유지).
   * 위치·속도는 손 추적에서 이미 스무딩되어 들어오며, 여기서는 눌림 정도를 한 번 더 부드럽게 올리고 내려 갑작스러운 변형을 막는다.
   */
  setFingerContacts(list: ReadonlyArray<{ id: number; active: boolean; x: number; y: number; vx: number; vy: number; amount: number }>): void {
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) this.fTarget[i] = 0;
    for (const c of list) {
      const i = c.id;
      if (i < 0 || i >= MOCHI.MAX_FINGERS) continue;
      this.fx[i] = c.x;
      this.fy[i] = c.y;
      if (c.active) {
        this.fvx[i] = c.vx;
        this.fvy[i] = c.vy;
        this.fTarget[i] = Math.min(1, Math.max(0, c.amount));
      }
    }
  }

  /** 손가락 접촉을 모두 푼다(화면 이동 등) */
  releaseFingers(): void {
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) this.fTarget[i] = 0;
  }

  get hasFingers(): boolean {
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) if ((this.fAmt[i] as number) > 0.0005 || (this.fTarget[i] as number) > 0) return true;
    return false;
  }

  /** 눌림이 남아 있는 손가락의 (위치, 눌림 정도)를 out에 채우고 개수를 돌려준다(렌더의 눌림 효과용, 배열 재사용) */
  fingerPoints(out: Array<{ x: number; y: number; amount: number }>): number {
    let n = 0;
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) {
      const a = this.fAmt[i] as number;
      if (a <= 0.01) continue;
      const o = out[n] ?? (out[n] = { x: 0, y: 0, amount: 0 });
      o.x = this.fx[i] as number;
      o.y = this.fy[i] as number;
      o.amount = a;
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ 시간 진행
  /** 실제 경과 시간(ms)만큼 진행한다. 고정 시간 간격으로 나눠 프레임 속도와 무관하게 같은 움직임을 낸다. */
  step(dtMs: number): number {
    this.accumulator += Math.min(dtMs, MOCHI.SUBSTEP_MS * MOCHI.MAX_SUBSTEPS_PER_FRAME);
    let steps = 0;
    while (this.accumulator >= MOCHI.SUBSTEP_MS && steps < MOCHI.MAX_SUBSTEPS_PER_FRAME) {
      this.substep(MOCHI.SUBSTEP_MS / 1000);
      this.accumulator -= MOCHI.SUBSTEP_MS;
      steps++;
    }
    if (steps === MOCHI.MAX_SUBSTEPS_PER_FRAME) this.accumulator = 0;
    return steps;
  }

  private substep(dt: number): void {
    if (!this.grabW && this.fadeD !== 0) {
      // 당김 거리를 감쇠 스프링으로 0까지 되돌린다: 구속이 갑자기 사라지는 것을 막고, 살짝 지나쳤다 돌아오는(출렁임) 움직임을 만든다
      const w = MOCHI.GRAB_RELEASE_OMEGA;
      this.fadeV += (-w * w * this.fadeD - 2 * MOCHI.GRAB_RELEASE_ZETA * w * this.fadeV) * dt;
      this.fadeD += this.fadeV * dt;
      if (Math.abs(this.fadeD) < 0.5 && Math.abs(this.fadeV) < 6) this.fadeD = this.fadeV = 0;
    }
    const n = this.n;
    // 눌림 정도를 목표로 부드럽게 올리고 내린다
    const rise = MOCHI.PRESS_RISE_PER_S * dt;
    if (this.pressAmount < this.pressTarget) this.pressAmount = Math.min(this.pressTarget, this.pressAmount + rise);
    else if (this.pressAmount > this.pressTarget) this.pressAmount = Math.max(this.pressTarget, this.pressAmount - rise * 0.7);
    if (this.pressAmount <= 0.0005 && this.pressTarget === 0) this.pressAt = this.pressAmount > 0 ? this.pressAt : null;
    // 손가락 눌림 정도도 같은 방식으로 부드럽게
    for (let i = 0; i < MOCHI.MAX_FINGERS; i++) {
      const a = this.fAmt[i] as number;
      const t = this.fTarget[i] as number;
      if (a < t) this.fAmt[i] = Math.min(t, a + rise);
      else if (a > t) this.fAmt[i] = Math.max(t, a - rise * 0.7);
      if ((this.fAmt[i] as number) <= 0.0005 && t === 0) {
        this.fAmt[i] = 0;
        this.fvx[i] = this.fvy[i] = 0;
      }
    }

    // 1) Verlet 적분
    for (let i = 0; i < n; i++) {
      let vx = ((this.x[i] as number) - (this.px[i] as number)) * MOCHI.DAMPING;
      let vy = ((this.y[i] as number) - (this.py[i] as number)) * MOCHI.DAMPING;
      const sp = Math.hypot(vx, vy);
      if (sp > MOCHI.MAX_STEP_PX) {
        vx *= MOCHI.MAX_STEP_PX / sp;
        vy *= MOCHI.MAX_STEP_PX / sp;
      }
      // 기준 형태로 돌아가려는 스프링(가속도): 놓았을 때 출렁이며 돌아오게 한다
      const ax = MOCHI.SPRING_OMEGA2 * ((this.rx[i] as number) + this.anchorX - (this.x[i] as number));
      const ay = MOCHI.SPRING_OMEGA2 * ((this.ry[i] as number) + this.anchorY - (this.y[i] as number));
      this.px[i] = this.x[i] as number;
      this.py[i] = this.y[i] as number;
      this.x[i] = (this.x[i] as number) + vx + ax * dt * dt;
      this.y[i] = (this.y[i] as number) + vy + (ay + this.gravity) * dt * dt;
    }
    // 누르는 동안 포인터의 움직임을 가까운 점에 전달(드래그를 따라 끌려오는 느낌)
    if (this.pressAt && this.pressAmount > 0 && (this.pressVel.x !== 0 || this.pressVel.y !== 0)) {
      const sigma = this.restWidth * MOCHI.PRESS_SIGMA_RATIO;
      for (let i = 0; i < n; i++) {
        const w = Math.exp(-(((this.x[i] as number) - this.pressAt.x) ** 2 + ((this.y[i] as number) - this.pressAt.y) ** 2) / (2 * sigma * sigma));
        this.x[i] = (this.x[i] as number) + this.pressVel.x * dt * w * MOCHI.PRESS_DRAG_TRANSFER;
        this.y[i] = (this.y[i] as number) + this.pressVel.y * dt * w * MOCHI.PRESS_DRAG_TRANSFER;
      }
    }

    // 손가락 이동을 가까운 점에 방향성 있는 힘으로 전달(속도 상한으로 빠른 움직임에도 표면이 불안정해지지 않게)
    this.transferFingerDrag(dt);

    // 2) 제약 반복
    for (let iter = 0; iter < 3; iter++) {
      this.solveEdges();
      this.solveGrab();
      if (this.grabW || this.fadeD !== 0) this.solveSmooth();
      this.solvePress();
      this.solveFingers();
      this.solveRestore();
      this.solvePinned();
      this.solveArea();
      this.solveMaxMajor();
      this.solveBounds();
    }
    // 당기는 동안에만: 당김 필드가 끝 쪽 이웃 간격을 늘릴 수 있어 최대 간격(찢어짐 방지)을 마지막에 한 번 더 강제한다
    if (this.grabW || this.fadeD !== 0) for (let k = 0; k < 3; k++) this.clampEdgeRatio();
    else if (this.hasFingers) this.clampEdgeRatio(); // 손가락으로 빠르게 주물러도 이웃 간격이 한계를 넘지 않는다
  }

  /**
   * 윤곽 곡률 완화(당기는 동안만): 각 점을 양옆 이웃의 중점 쪽으로 조금 당겨 한 점에서 윤곽이 꺾이는 것(뾰족한 끝)을 막는다.
   * 기준 형태 자체의 곡률은 건드리지 않도록 "기준 형태의 중점 대비 어긋남"만 줄인다.
   */
  private solveSmooth(): void {
    // 점이 촘촘할수록 한 번의 이웃 평균이 닿는 길이가 짧아지므로, 점 간격의 제곱에 비례해 횟수를 늘려 완화 길이를 같게 맞춘다
    const passes = Math.max(1, Math.round((this.n / MOCHI.RING_REF_POINTS) ** 2));
    for (let p = 0; p < passes; p++) this.smoothOnce();
  }

  private smoothOnce(): void {
    const n = this.n;
    const k = MOCHI.GRAB_SMOOTH;
    const dx = this.scratchA;
    const dy = this.scratchB;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      const mx = ((this.x[p] as number) + (this.x[q] as number)) / 2 - (this.x[i] as number);
      const my = ((this.y[p] as number) + (this.y[q] as number)) / 2 - (this.y[i] as number);
      const rmx = ((this.rx[p] as number) + (this.rx[q] as number)) / 2 - (this.rx[i] as number);
      const rmy = ((this.ry[p] as number) + (this.ry[q] as number)) / 2 - (this.ry[i] as number);
      dx[i] = (mx - rmx) * k;
      dy[i] = (my - rmy) * k;
    }
    for (let i = 0; i < n; i++) {
      if ((this.pinMul[i] as number) > 1) continue; // 바닥에 붙은 점은 그대로
      this.x[i] = (this.x[i] as number) + (dx[i] as number);
      this.y[i] = (this.y[i] as number) + (dy[i] as number);
    }
  }

  private clampEdgeRatio(): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const rest = this.edgeLen[i] as number;
      const dx = (this.x[j] as number) - (this.x[i] as number);
      const dy = (this.y[j] as number) - (this.y[i] as number);
      const len = Math.hypot(dx, dy) || 1e-9;
      const max = rest * MOCHI.MAX_EDGE_RATIO;
      if (len <= max) continue;
      const corr = ((len - max) / len) * 0.5;
      this.x[i] = (this.x[i] as number) + dx * corr;
      this.y[i] = (this.y[i] as number) + dy * corr;
      this.x[j] = (this.x[j] as number) - dx * corr;
      this.y[j] = (this.y[j] as number) - dy * corr;
    }
  }

  // ------------------------------------------------------------------ 제약
  private solveEdges(): void {
    const n = this.n;
    const half = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.distance(i, j, this.edgeLen[i] as number, MOCHI.K_EDGE, MOCHI.MAX_EDGE_RATIO);
    }
    for (let i = 0; i < half; i++) this.distance(i, (i + half) % n, this.oppLen[i] as number, MOCHI.K_OPPOSITE, Infinity);
  }

  private distance(i: number, j: number, rest: number, k: number, maxRatio: number): void {
    let dx = (this.x[j] as number) - (this.x[i] as number);
    let dy = (this.y[j] as number) - (this.y[i] as number);
    const len = Math.hypot(dx, dy) || 1e-9;
    let stiff = k;
    // 최대 길이를 넘으면 강제로 되돌린다(찢어짐 방지)
    if (len > rest * maxRatio) stiff = 1;
    const target = len > rest * maxRatio ? rest * maxRatio : rest;
    const corr = ((len - target) / len) * 0.5 * stiff;
    dx *= corr;
    dy *= corr;
    this.x[i] = (this.x[i] as number) + dx;
    this.y[i] = (this.y[i] as number) + dy;
    this.x[j] = (this.x[j] as number) - dx;
    this.y[j] = (this.y[j] as number) - dy;
  }

  /** 면적(부피) 보존: 면적 제약 C = A − A0 의 기울기 방향으로 모든 점을 보정 */
  private solveArea(): void {
    const n = this.n;
    const a = signedArea(this.x, this.y);
    const c = a - this.area0;
    if (Math.abs(c) < 1e-9) return;
    const gx = this.scratchA;
    const gy = this.scratchB;
    let denom = 0;
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;
      gx[i] = 0.5 * ((this.y[next] as number) - (this.y[prev] as number));
      gy[i] = 0.5 * ((this.x[prev] as number) - (this.x[next] as number));
      denom += (gx[i] as number) ** 2 + (gy[i] as number) ** 2;
    }
    if (denom < 1e-12) return;
    const lambda = (-c / denom) * MOCHI.K_AREA;
    for (let i = 0; i < n; i++) {
      this.x[i] = (this.x[i] as number) + lambda * (gx[i] as number);
      this.y[i] = (this.y[i] as number) + lambda * (gy[i] as number);
    }
  }

  private solveRestore(): void {
    const k = MOCHI.K_REST;
    const sliding = this.isGripping;
    for (let i = 0; i < this.n; i++) {
      const kk = Math.min(0.6, k * (this.pinMul[i] as number));
      // 당기는 동안 책상에 붙은 점은 옆으로 미끄러질 수 있다(x 복원은 일반 점과 같게)
      const kx = sliding ? k : kk;
      this.x[i] = (this.x[i] as number) + kx * ((this.rx[i] as number) + this.anchorX - (this.x[i] as number));
      this.y[i] = (this.y[i] as number) + kk * ((this.ry[i] as number) + this.anchorY - (this.y[i] as number));
    }
  }

  private solveGrab(): void {
    if (!this.grabW && this.fadeD === 0) return;
    const d = this.grabW ? Math.hypot(this.grabDx, this.grabDy) : this.fadeD;
    if (Math.abs(d) < 1e-6) return;
    const { x: ux, y: uy } = this.grabU;
    const { x: vx, y: vy } = this.grabV;
    for (let i = 0; i < this.n; i++) {
      const w = this.grabField[i] as number;
      // 앞쪽으로 w·d 만큼 이동 + 같은 비율로 옆 폭 수축(부피 보존의 근사, 나머지는 면적 제약이 맞춘다)
      const stretch = (d * w) / this.grabH;
      const shrink = (1 / (1 + stretch) - 1) * MOCHI.GRAB_NECK;
      const perp = this.grabPerp[i] as number;
      const tx = (this.rx[i] as number) + this.anchorX + ux * d * w + vx * perp * shrink;
      let ty = (this.ry[i] as number) + this.anchorY + uy * d * w + vy * perp * shrink;
      if ((this.pinMul[i] as number) > 1) ty = (this.ry[i] as number) + this.anchorY; // 책상에 붙은 점은 옆으로만 미끄러진다
      ty = Math.max(this.opts.topLimitY, ty);
      const k = MOCHI.GRAB_STIFFNESS;
      this.x[i] = (this.x[i] as number) + k * (tx - (this.x[i] as number));
      this.y[i] = (this.y[i] as number) + k * (ty - (this.y[i] as number));
    }
  }

  /**
   * 눌림: 누른 점 근처의 외곽은 중심 쪽(안쪽)으로 들어가고, 중앙을 누르면 전체가 살짝 퍼진다.
   * 나머지는 면적 보존 제약이 맞춰 준다.
   */
  private solvePress(): void {
    if (!this.pressAt || this.pressAmount <= 0) return;
    const sigma = this.restWidth * MOCHI.PRESS_SIGMA_RATIO;
    const depth = this.restWidth * MOCHI.PRESS_DEPTH_RATIO * this.pressAmount;
    const c = { x: this.centroid0.x + this.anchorX, y: this.centroid0.y + this.anchorY };
    const toPressX = this.pressAt.x - c.x;
    const toPressY = this.pressAt.y - c.y;
    const pressR = Math.hypot(toPressX, toPressY);
    const edgeNess = Math.min(1, pressR / (this.restWidth * 0.5)); // 1: 가장자리, 0: 중앙
    for (let i = 0; i < this.n; i++) {
      const rxp = (this.rx[i] as number) + this.anchorX;
      const ryp = (this.ry[i] as number) + this.anchorY;
      const w = Math.exp(-((rxp - this.pressAt.x) ** 2 + (ryp - this.pressAt.y) ** 2) / (2 * sigma * sigma));
      const cx = c.x - rxp;
      const cy = c.y - ryp;
      const cl = Math.hypot(cx, cy) || 1;
      // 안쪽으로 밀기(가장자리를 누를수록 크게) + 중앙을 누를 때 바깥으로 퍼짐
      const inward = depth * w * edgeNess;
      const spread = depth * 0.45 * (1 - edgeNess);
      const tx = rxp + (cx / cl) * inward - (cx / cl) * spread;
      const ty = ryp + (cy / cl) * inward - (cy / cl) * spread;
      const k = MOCHI.PRESS_STIFFNESS * Math.min(1, w + (1 - edgeNess) * 0.35);
      this.x[i] = (this.x[i] as number) + k * (tx - (this.x[i] as number));
      this.y[i] = (this.y[i] as number) + k * (ty - (this.y[i] as number));
    }
  }

  /** (px,py)에서 기준 윤곽(앵커 포함)까지의 최단 거리 */
  private distanceToRestOutline(px: number, py: number): number {
    let best = Infinity;
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      const ax = (this.rx[i] as number) + this.anchorX;
      const ay = (this.ry[i] as number) + this.anchorY;
      const dx = (this.rx[j] as number) + this.anchorX - ax;
      const dy = (this.ry[j] as number) + this.anchorY - ay;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-9)));
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d < best) best = d;
    }
    return best;
  }

  private transferFingerDrag(dt: number): void {
    const sigma = this.restWidth * MOCHI.FINGER_DRAG_SIGMA_RATIO;
    for (let f = 0; f < MOCHI.MAX_FINGERS; f++) {
      const amt = this.fAmt[f] as number;
      if (amt <= 0.0005) continue;
      let vx = this.fvx[f] as number;
      let vy = this.fvy[f] as number;
      const sp = Math.hypot(vx, vy);
      if (sp < 1e-6) continue;
      if (sp > MOCHI.FINGER_MAX_SPEED) {
        vx *= MOCHI.FINGER_MAX_SPEED / sp;
        vy *= MOCHI.FINGER_MAX_SPEED / sp;
      }
      const px = this.fx[f] as number;
      const py = this.fy[f] as number;
      for (let i = 0; i < this.n; i++) {
        const dx = (this.x[i] as number) - px;
        const dy = (this.y[i] as number) - py;
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        if (w < 0.01) continue;
        const k = dt * w * MOCHI.FINGER_DRAG_TRANSFER * amt;
        this.x[i] = (this.x[i] as number) + vx * k;
        this.y[i] = (this.y[i] as number) + vy * k;
      }
    }
  }

  /**
   * 손가락 눌림: 손가락 끝 가까이의 외곽이 안쪽으로 들어간다(작은 반경). 가운데를 누르면 외곽이 아주 조금 퍼진다.
   * 손가락마다 독립이며 여러 개가 동시에 적용된다. 나머지는 면적 보존·복원 제약이 맞춘다.
   */
  private solveFingers(): void {
    const sigma = this.restWidth * MOCHI.FINGER_SIGMA_RATIO;
    const c = { x: this.centroid0.x + this.anchorX, y: this.centroid0.y + this.anchorY };
    for (let f = 0; f < MOCHI.MAX_FINGERS; f++) {
      const amt = this.fAmt[f] as number;
      if (amt <= 0.0005) continue;
      const px = this.fx[f] as number;
      const py = this.fy[f] as number;
      // 눌림 깊이 = 눌림 정도에 비례한 기본 깊이 + 손가락이 표면 안쪽으로 파고든 깊이(침투). 천천히 안쪽으로 밀수록 표면이 따라 들어간다.
      // 침투 효과는 표면에서 멀어질수록(안쪽 깊이 d) 처음엔 커지다가 윤곽이 멀어지면 줄어든다(가운데를 눌러도 윤곽이 크게 변하지 않는다)
      const d = this.distanceToRestOutline(px, py);
      const pen = MOCHI.FINGER_PEN_GAIN * d * Math.exp(-((d / (1.6 * sigma)) ** 2));
      const depth = this.restWidth * MOCHI.FINGER_DEPTH_RATIO * amt + pen * Math.min(1, amt / 0.38);
      const toX = px - c.x;
      const toY = py - c.y;
      const edgeNess = Math.min(1, Math.hypot(toX, toY) / (this.restWidth * 0.5));
      for (let i = 0; i < this.n; i++) {
        const rxp = (this.rx[i] as number) + this.anchorX;
        const ryp = (this.ry[i] as number) + this.anchorY;
        const w = Math.exp(-((rxp - px) ** 2 + (ryp - py) ** 2) / (2 * sigma * sigma));
        const cx = c.x - rxp;
        const cy = c.y - ryp;
        const cl = Math.hypot(cx, cy) || 1;
        const inward = depth * w * edgeNess;
        const spread = depth * 0.25 * (1 - edgeNess);
        const tx = rxp + (cx / cl) * inward - (cx / cl) * spread;
        const ty = ryp + (cy / cl) * inward - (cy / cl) * spread;
        const k = MOCHI.FINGER_STIFFNESS * Math.min(1, w + (1 - edgeNess) * 0.12);
        this.x[i] = (this.x[i] as number) + k * (tx - (this.x[i] as number));
        this.y[i] = (this.y[i] as number) + k * (ty - (this.y[i] as number));
      }
    }
  }

  /** 바닥 고정 점은 책상에서 떠오르지 않도록 기준 위치 쪽으로 강하게 되돌린다 */
  private solvePinned(): void {
    const sliding = this.isGripping;
    for (let i = 0; i < this.n; i++) {
      if ((this.pinMul[i] as number) <= 1) continue;
      if (!sliding) this.x[i] = (this.x[i] as number) + 0.75 * ((this.rx[i] as number) + this.anchorX - (this.x[i] as number));
      this.y[i] = (this.y[i] as number) + 0.75 * ((this.ry[i] as number) + this.anchorY - (this.y[i] as number));
    }
  }

  /** 가장 멀리 떨어진 두 점의 거리가 안전 최대 길이를 넘지 않게 한다 */
  private solveMaxMajor(): void {
    // 가장 먼 두 점의 거리는 외곽 상자의 대각선 이하이므로, 대각선이 한계 안이면 O(N²) 탐색을 건너뛴다(결과는 같다)
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i] as number;
      const y = this.y[i] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (Math.hypot(x1 - x0, y1 - y0) <= this.failsafeMajor) return;
    let bi = 0;
    let bj = 1;
    let best = 0;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const d = Math.hypot((this.x[i] as number) - (this.x[j] as number), (this.y[i] as number) - (this.y[j] as number));
        if (d > best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (best > this.failsafeMajor) {
      const dx = (this.x[bj] as number) - (this.x[bi] as number);
      const dy = (this.y[bj] as number) - (this.y[bi] as number);
      const corr = ((best - this.failsafeMajor) / best) * 0.5;
      this.x[bi] = (this.x[bi] as number) + dx * corr;
      this.y[bi] = (this.y[bi] as number) + dy * corr;
      this.x[bj] = (this.x[bj] as number) - dx * corr;
      this.y[bj] = (this.y[bj] as number) - dy * corr;
    }
  }

  private solveBounds(): void {
    const g = this.opts.groundY;
    for (let i = 0; i < this.n; i++) {
      if (g !== null && (this.y[i] as number) > g) {
        const vy = (this.y[i] as number) - (this.py[i] as number);
        this.y[i] = g;
        this.py[i] = g + vy * MOCHI.GROUND_RESTITUTION; // 바닥에서 약간 튕김
      }
      if ((this.y[i] as number) < this.opts.topLimitY) this.y[i] = this.opts.topLimitY;
    }
  }
}
