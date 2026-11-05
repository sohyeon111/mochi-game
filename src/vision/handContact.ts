// 손가락 끝 → 찹쌀떡 접촉 판정. 순수 로직(DOM·카메라 없음).
// 접촉의 필수 조건은 둘뿐이다: ① 손가락 끝이 찹쌀떡 위에 있다  ② 그 상태로 DWELL_MS 이상 머문다(스치기·오인식 방지).
// 두 조건을 만족하면 기본 눌림(CONTACT_BASE)으로 접촉이 시작되고, 굽힘(기준 대비 증가)과 이동 속도는 필수가 아니라 **강도를 더하는 보조 정보**다:
//   눌림 = BASE + (1-BASE)·max(굽힘 신호, SPEED_BOOST·속도 신호)  → 크게 굽히거나 빠르게 움직이지 않아도 얹기만 하면 작게 눌리고, 천천히 누르면 깊어진다.
// 안전장치: 주먹이면 접촉 없음, 임계값(히스테리시스) + 위치·눌림 스무딩, 인식이 끊겨도 서서히 푼다. 손바닥은 접촉점이 아니다.
// 손바닥은 접촉점으로 쓰지 않는다. 손바닥 크기 변화로 누르기를 판정하지도 않는다(주먹이면 모든 접촉을 끈다).
import { HAND } from '../app/constants';
import { insideMargin, tipsToStage } from './handMapping';
import type { RawHand, Size } from './types';

export interface FingerContact {
  /** 손가락 번호(0 엄지 ~ 4 새끼) */
  id: number;
  active: boolean;
  /** 스무딩된 손가락 끝(논리 좌표)과 속도(px/s) */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 눌림 정도(0~1, 스무딩됨). active가 아니면 0 */
  amount: number;
  /** 스무딩된 굽힘(0~1)과 기준 굽힘 */
  flex: number;
  flexBase: number;
  speed: number;
  /** 찹쌀떡 위에 있는지, 위에 머문 시간(ms) */
  over: boolean;
  overMs: number;
  /** 마지막 판정의 신호(디버그용): 굽힘 신호, 속도 신호 */
  pressSignal: number;
  kneadSignal: number;
  /** 접촉 조건을 분리해서 본 결과(진단용): 위에 있음 / 머문 시간 충족 / 굽힘 신호 있음 / 속도 신호 있음 / 주먹 차단 / 목표 눌림 */
  condOver: boolean;
  condDwell: boolean;
  condFlex: boolean;
  condSpeed: boolean;
  condFist: boolean;
  target: number;
}

export const smoothstep01 = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

interface FingerState extends FingerContact {
  hasPos: boolean;
  pressure: number;
}

const newFinger = (id: number): FingerState => ({
  id, active: false, x: 0, y: 0, vx: 0, vy: 0, amount: 0, flex: 0, flexBase: 0, speed: 0, over: false, overMs: 0, pressSignal: 0, kneadSignal: 0, condOver: false, condDwell: false, condFlex: false, condSpeed: false, condFist: false, target: 0, hasPos: false, pressure: 0,
});

export type OverTest = (x: number, y: number) => boolean;

export class HandContactEstimator {
  /** 손가락 5개의 현재 상태(배열은 재사용한다) */
  readonly fingers: FingerState[] = [0, 1, 2, 3, 4].map(newFinger);
  /** 손이 안정적으로 보이는 중인지(신뢰도 이상) */
  tracking = false;
  score = 0;
  private lastT = 0;
  /** 마지막 갱신 시각(워치독·외삽용) */
  lastUpdate = 0;
  private lostMs = 0;
  private tipsStage = new Float64Array(10);
  /** 찹쌀떡 위인지 판정하는 함수(MochiView가 지정). 없으면 어디도 위가 아니다 */
  overTest: OverTest | null = null;

  /** 모든 접촉을 즉시 푼다(화면 이동·손 사라짐 오래됨) */
  reset(): void {
    for (let i = 0; i < 5; i++) {
      const f = this.fingers[i] as FingerState;
      f.hasPos = false;
      f.active = false;
      f.amount = 0;
      f.pressure = 0;
      f.overMs = 0;
      f.over = false;
      f.condOver = f.condDwell = f.condFlex = f.condSpeed = f.condFist = false;
      f.target = 0;
      f.vx = f.vy = f.speed = 0;
    }
    this.tracking = false;
    this.lostMs = 0;
  }

  /** 새 분석 결과(없으면 null = 손 없음)로 갱신한다 */
  update(raw: RawHand | null, now: number, video: Size): void {
    const dt = this.lastT === 0 ? 16 : Math.min(100, Math.max(1, now - this.lastT));
    this.lastT = now;
    this.lastUpdate = now;
    const usable = !!raw && raw.found && raw.score >= HAND.MIN_SCORE;
    this.score = raw ? raw.score : 0;
    if (!usable || !raw) {
      this.tracking = false;
      this.lostMs += dt;
      if (this.lostMs > HAND.LOST_GRACE_MS) {
        this.reset();
        return;
      }
      // 잠깐 끊김: 위치는 유지하고 눌림만 서서히 푼다(찹쌀떡이 튀지 않는다)
      for (const f of this.fingers) this.relax(f, dt, 1);
      return;
    }
    this.tracking = true;
    const wasLost = this.lostMs > HAND.LOST_GRACE_MS;
    this.lostMs = 0;
    tipsToStage(raw.tips, video, this.tipsStage, true);
    let flexed = 0;
    for (let i = 1; i < 5; i++) if ((raw.flex[i] as number) >= HAND.FIST_FLEX) flexed++;
    const fist = flexed >= HAND.FIST_COUNT;
    for (let i = 0; i < 5; i++) {
      const f = this.fingers[i] as FingerState;
      const x = this.tipsStage[i * 2] as number;
      const y = this.tipsStage[i * 2 + 1] as number;
      const rawFlex = raw.flex[i] as number;
      if (!f.hasPos || wasLost) {
        f.x = x;
        f.y = y;
        f.vx = f.vy = f.speed = 0;
        f.flex = f.flexBase = rawFlex;
        f.overMs = 0;
        f.pressure = 0;
        f.active = false;
        f.hasPos = true;
      } else {
        const rawSpeed = Math.hypot(x - f.x, y - f.y) / dt * 1000;
        const a = HAND.SMOOTH_MIN + (HAND.SMOOTH_MAX - HAND.SMOOTH_MIN) * Math.min(1, rawSpeed / HAND.SMOOTH_SPEED_PX_S);
        const nx = f.x + a * (x - f.x);
        const ny = f.y + a * (y - f.y);
        const vx = ((nx - f.x) / dt) * 1000;
        const vy = ((ny - f.y) / dt) * 1000;
        f.vx += HAND.VEL_SMOOTH * (vx - f.vx);
        f.vy += HAND.VEL_SMOOTH * (vy - f.vy);
        const sp = Math.hypot(f.vx, f.vy);
        if (sp > HAND.VEL_MAX) {
          f.vx *= HAND.VEL_MAX / sp;
          f.vy *= HAND.VEL_MAX / sp;
        }
        f.speed = Math.min(sp, HAND.VEL_MAX);
        f.x = nx;
        f.y = ny;
        f.flex += 0.5 * (rawFlex - f.flex);
      }
      const onStage = insideMargin(f.x, f.y) >= 0;
      f.over = onStage && !!this.overTest && this.overTest(f.x, f.y);
      f.overMs = f.over ? f.overMs + dt : 0;
      // 기준 굽힘은 눌리지 않고 가만히 있을 때 천천히 현재 값을 따라간다(손 모양이 사람마다 다르다)
      // 펴지는 쪽(굽힘이 기준보다 작아짐)은 빨리, 굽는 쪽은 눌리지 않고 가만히 있을 때만 천천히 따라간다: 주먹에서 펴자마자 바로 누를 수 있다
      if (f.flex < f.flexBase) f.flexBase += HAND.FLEX_BASE_FALL * (f.flex - f.flexBase);
      else if (!f.active && f.speed < HAND.MOTION_V0) f.flexBase += HAND.FLEX_BASE_RATE * (dt / 16) * (f.flex - f.flexBase);
      f.pressSignal = smoothstep01((f.flex - f.flexBase - HAND.FLEX_DEAD) / HAND.FLEX_RANGE);
      f.kneadSignal = smoothstep01((f.speed - HAND.MOTION_V0) / (HAND.MOTION_V1 - HAND.MOTION_V0));
      // 필수 조건: 위에 있음 + 머문 시간. 굽힘·속도는 강도만 더한다.
      f.condOver = f.over;
      f.condDwell = f.overMs >= HAND.DWELL_MS;
      f.condFlex = f.pressSignal > 0.05;
      f.condSpeed = f.kneadSignal > 0.05;
      f.condFist = fist;
      const boost = Math.max(f.pressSignal, HAND.SPEED_BOOST * f.kneadSignal);
      const target = f.condOver && f.condDwell && !fist ? HAND.CONTACT_BASE + (1 - HAND.CONTACT_BASE) * boost : 0;
      f.target = target;
      this.approach(f, target, dt);
    }
  }

  private approach(f: FingerState, target: number, dt: number): void {
    const tau = target > f.pressure ? HAND.PRESS_RISE_MS : HAND.PRESS_FALL_MS;
    f.pressure += (target - f.pressure) * (1 - Math.exp(-dt / tau));
    if (!f.active && f.pressure > HAND.ON_THRESHOLD) f.active = true;
    else if (f.active && f.pressure < HAND.OFF_THRESHOLD) f.active = false;
    f.amount = f.active ? f.pressure : 0;
  }

  private relax(f: FingerState, dt: number, k: number): void {
    f.pressure += (0 - f.pressure) * (1 - Math.exp((-dt * k) / HAND.PRESS_FALL_MS));
    if (f.active && f.pressure < HAND.OFF_THRESHOLD) f.active = false;
    f.amount = f.active ? f.pressure : 0;
    f.vx *= 0.8;
    f.vy *= 0.8;
    f.speed = Math.hypot(f.vx, f.vy);
  }

  /**
   * 렌더 프레임마다 호출: 검출 주기(약 30Hz) 사이를 속도로 메워 접촉점 위치를 돌려준다(워치독: 오래 갱신이 없으면 접촉 없음).
   * out은 호출자가 재사용하는 배열(길이 5)이며 active인 손가락만 true가 된다.
   */
  sample(now: number, out: FingerContact[]): number {
    const stale = this.lastUpdate === 0 || now - this.lastUpdate > HAND.STALE_MS;
    if (stale && this.fingers.some((f) => f.active)) this.reset();
    const ext = Math.min(HAND.EXTRAPOLATE_MS, Math.max(0, now - this.lastUpdate)) / 1000;
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const f = this.fingers[i] as FingerState;
      const o = out[i] as FingerContact;
      o.id = i;
      o.active = !stale && f.active;
      o.x = f.x + f.vx * ext;
      o.y = f.y + f.vy * ext;
      o.vx = f.vx;
      o.vy = f.vy;
      o.amount = o.active ? f.amount : 0;
      o.flex = f.flex;
      o.flexBase = f.flexBase;
      o.speed = f.speed;
      o.over = f.over;
      o.overMs = f.overMs;
      o.pressSignal = f.pressSignal;
      o.kneadSignal = f.kneadSignal;
      o.condOver = f.condOver;
      o.condDwell = f.condDwell;
      o.condFlex = f.condFlex;
      o.condSpeed = f.condSpeed;
      o.condFist = f.condFist;
      o.target = f.target;
      if (o.active) n++;
    }
    return n;
  }
}

/** 재사용용 접촉 배열 만들기 */
export const makeContactBuffer = (): FingerContact[] => [0, 1, 2, 3, 4].map(newFinger);
