// 모찌 뷰: MOCHI_INTRO / STRETCH / TOUCH 세 화면의 캔버스·물리·입력을 관리한다.
//  - 실제 경과 시간으로 소프트바디를 진행하고, 프레임 시간을 재서 렌더링 품질을 단계적으로 조절한다.
//  - 늘리기(STRETCH): 잡아당김 → 30% 이상이면 "다 만졌어요" 버튼, 누르기(TOUCH): 누르고 드래그
import { frontLayout, layout, onLayoutChange } from '../app/layout';
import type { App } from '../app/app';
import { FRUIT_IDS, HAND, MOCHI } from '../app/constants';
import type { State } from '../app/stateMachine';
import { randomSeed } from '../game/rng';
import type { Stage } from '../ui/stage';
import { h } from '../ui/dom';
import { prof } from '../app/profiler';
import { HandOverlay } from './handOverlay';
import { makeContactBuffer } from '../vision/handContact';
import { isNearPolygon } from './geometry';
import { drawFrontBackground } from './background';
import { layoutFruits, type Piece3D } from './fruitLayout';
import { IntroDrop } from './introAnimation';
import { MochiRenderer } from './mochiRenderer';
import { QUALITY_TIERS, QualityController, type QualityTier } from './quality';
import { resolveMochiFruits } from './sampleResult';
import type { MochiScene } from './scene';
import { SoftBody } from './softBody';
import { StretchTracker } from './stretchProgress';

const MOCHI_STATES: readonly State[] = ['MOCHI_INTRO', 'MOCHI_STRETCH', 'MOCHI_TOUCH'];

export interface MochiMetrics {
  fps: number;
  frameMs: number;
  drawMs: number;
  tier: string;
  triangles: number;
}

export class MochiView {
  readonly canvas: HTMLCanvasElement;
  /** WebGL 메시 그리기용 캔버스(2D 캔버스 위에 겹친다) */
  private glCanvas: HTMLCanvasElement;
  private handOverlay = new HandOverlay();
  private handBuf = makeContactBuffer();
  /** 추가 터치(멀티터치) 포인터와 합쳐서 소프트바디에 넘길 접촉 목록(재사용) */
  private extra = new Map<number, { x: number; y: number; vx: number; vy: number; t: number }>();
  private merged: Array<{ id: number; active: boolean; x: number; y: number; vx: number; vy: number; amount: number }> = [];
  private handCamOn = false;
  private ctx: CanvasRenderingContext2D;
  private renderer_: MochiRenderer | null = null;
  private bg: HTMLCanvasElement | null = null;
  private body: SoftBody | null = null;
  private intro: IntroDrop | null = null;
  private introStart = 0;
  private introDone = false;
  private scene: MochiScene | null = null;
  private pieces: Piece3D[] = [];
  readonly tracker = new StretchTracker();
  readonly quality = new QualityController();
  private last = 0;
  /** 정지 상태를 이미 그렸는지와 그때의 화면·품질(같으면 다시 그리지 않는다) */
  private dents: Array<{ x: number; y: number; sigma: number; amount: number }> = [];
  private fingerPts: Array<{ x: number; y: number; amount: number }> = [];
  private idleDrawn = false;
  private lastActiveDrawMs = 0;
  private drawnKey = '';
  /** 그려진 내용이 달라져야 하는 사건(과일 배치·화면 진입 등)이 있었는지 */
  private dirty = true;
  private activePointer: number | null = null;
  private lastMove = 0;
  readonly metrics: MochiMetrics = { fps: 0, frameMs: 0, drawMs: 0, tier: '', triangles: 0 };
  private fpsCount = 0;
  private fpsStart = 0;
  /** 개발용: 품질 단계를 고정(null이면 자동) */
  forcedTier: number | null = null;
  /** 개발용: 삼각형 수에 비례하는 인위적 부하(ms, 최고 품질 기준). 품질 단계 조절을 시험할 때만 쓴다 */
  simulatedLoadMs = 0;
  /** 개발·비교용: WebGL 그리기 사용 여부(false면 Canvas 2D 경로) */
  get glEnabled(): boolean {
    return this.renderer_?.usingGL ?? false;
  }
  set glEnabled(v: boolean) {
    const r = this.renderer();
    r.glEnabled = v;
    this.glCanvas.hidden = !r.usingGL || this.canvas.hidden;
    if (!v) this.glCanvas.getContext('webgl2')?.clear(0x4000); // 켜져 있던 GL 그림을 지운다
    this.dirty = true;
  }
  /** 개발용: 적응형 메시 대신 모든 셀을 세밀하게 그린다(품질 비교) */
  get forceFullMesh(): boolean {
    return this.renderer_?.forceFullMesh ?? false;
  }
  set forceFullMesh(v: boolean) {
    this.renderer().forceFullMesh = v;
    this.dirty = true;
  }
  /** 개발용: 샘플 결과가 쓰였는지 */
  usingSample = false;

  constructor(private app: App, private stage: Stage) {
    this.canvas = h('canvas', { class: 'mochi-canvas', attrs: { width: String(layout.w), height: String(layout.h) } });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    this.ctx = ctx;
    this.canvas.hidden = true;
    stage.gameLayer.append(this.canvas);
    // 찹쌀떡 메시는 WebGL 캔버스(2D 캔버스 위)에 그린다. 못 쓰면 이 캔버스를 쓰지 않고 2D 캔버스에 기존 방식으로 그린다.
    this.glCanvas = h('canvas', { class: 'mochi-canvas mochi-gl', attrs: { width: String(layout.w), height: String(layout.h) } });
    this.glCanvas.hidden = true;
    stage.gameLayer.append(this.glCanvas);
    // 손가락 끝 표시(손 입력이 켜져 있을 때만 보인다)
    stage.gameLayer.append(this.handOverlay.canvas);
    app.machine.onTransition((from, to) => this.onTransition(from, to));
    const el = stage.stage;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    onLayoutChange(() => this.onLayout());
    this.last = performance.now();
    this.fpsStart = this.last;
    requestAnimationFrame(this.loop);
  }

  /** 가로↔세로 전환·화면 비율 변화: 캔버스 크기와 찹쌀떡 배치·배경을 새 좌표계로 다시 만든다(변형 상태는 기본 형태로 돌아간다) */
  private onLayout(): void {
    for (const c of [this.canvas, this.glCanvas, this.handOverlay.canvas]) {
      c.width = layout.w;
      c.height = layout.h;
    }
    this.handOverlay.reset();
    this.renderer_ = null;
    this.bg = null;
    this.dirty = true;
    this.idleDrawn = false;
    const st = this.app.machine.state;
    if (MOCHI_STATES.includes(st) && this.ready) {
      this.releasePointer();
      this.enter(st, st);
    }
  }

  private get ready(): boolean {
    return !!this.app.assets && !!this.app.mochiAssets;
  }

  // ------------------------------------------------------------------ 화면 이동
  private onTransition(from: State, to: State): void {
    if (to === 'PLAYING' || to === 'TITLE') {
      this.scene = null; // 새 라운드: 다음 결과로 새로 배치한다
      this.tracker.reset();
    }
    this.releasePointer();
    this.dirty = true;
    if (!MOCHI_STATES.includes(to)) {
      this.canvas.hidden = true;
      this.glCanvas.hidden = true;
      this.handOverlay.draw('off', this.handBuf);
      if (this.handCamOn) {
        this.handCamOn = false;
        this.stage.stage.classList.remove('hand-cam'); // 영상 표시 상태를 다른 화면에 남기지 않는다
      }
      this.body = null;
      return;
    }
    if (!this.ready) return;
    if (to === 'MOCHI_INTRO') this.tracker.reset();
    this.ensureScene();
    this.enter(to, from);
  }

  /** 결과(또는 DEV 샘플)로 과일 배치를 정한다. 실제 결과가 없고 개발 환경이 아니면 과일 없이 그린다. */
  private ensureScene(): void {
    if (this.scene) return;
    const fruits = resolveMochiFruits(this.app.store.state.roundResult, import.meta.env.DEV);
    this.usingSample = fruits.isSample;
    this.scene = { fruits, seed: randomSeed() };
    const a = this.app.mochiAssets;
    if (!a) return;
    this.pieces = layoutFruits(fruits.counts, fruits.firstOrder, this.scene.seed, a.data.fruitLayout).pieces;
    this.renderer_?.setPieces(this.pieces);
    this.dirty = true;
    this.app.log(`모찌 과일 배치: ${FRUIT_IDS.map((f) => `${f}${fruits.counts[f]}`).join(' ')}${fruits.isSample ? ' (DEV 샘플)' : ''}`);
  }

  private renderer(): MochiRenderer {
    if (!this.renderer_) {
      this.renderer_ = new MochiRenderer(this.app.mochiAssets!, this.app.assets!);
      this.renderer_.setPieces(this.pieces);
      // 개발 서버에서만 ?gl=0 으로 WebGL을 끄고 기존 Canvas 경로와 비교할 수 있다
      const wantGl = !(import.meta.env.DEV && new URLSearchParams(location.search).get('gl') === '0');
      if (wantGl) this.renderer_.attachGL(this.glCanvas);
    }
    if (!this.bg) this.bg = drawFrontBackground(frontLayout().horizonY);
    return this.renderer_;
  }

  private enter(to: State, from: State): void {
    this.canvas.hidden = false;
    const r = this.renderer();
    this.glCanvas.hidden = !r.usingGL;
    // STRETCH → TOUCH: 같은 떡·같은 배경을 그대로 이어서 쓴다(다시 만들거나 옮기지 않는다)
    if (to === 'MOCHI_TOUCH' && from === 'MOCHI_STRETCH' && this.body) {
      this.updateCursor();
      return;
    }
    const ring = r.restRing();
    this.body = new SoftBody(ring.x, ring.y, {
      groundY: frontLayout().groundY,
      // 바닥 고정은 INTRO(떨어지는 중)를 빼고 항상 적용해 TOUCH에서도 떡이 책상 위에 머문다
      pinBand: to === 'MOCHI_INTRO' ? 0 : MOCHI.PIN_BAND,
      // 화면 위쪽 여백 제한은 늘리기(STRETCH)에서만: 등장(INTRO)은 화면 위에서 떨어지므로 제한하면 찌그러진다
      topLimitY: to === 'MOCHI_STRETCH' ? MOCHI.TOP_MARGIN_PX : -Infinity,
    });
    if (to === 'MOCHI_INTRO') {
      const top = Math.min(...ring.y);
      this.intro = new IntroDrop(top + 40 + MOCHI.INTRO_START_ABOVE_PX * 0.2);
      this.body.placeAtRest(0, this.intro.y);
      this.introStart = performance.now();
      this.introDone = false;
    } else {
      this.intro = null;
    }
    this.updateCursor();
  }

  // ------------------------------------------------------------------ 입력 (Pointer Events: 마우스·터치 통합)
  private canInteract(): boolean {
    const s = this.app.machine.state;
    return (s === 'MOCHI_STRETCH' || s === 'MOCHI_TOUCH') && !!this.body && !this.canvas.hidden;
  }

  private point(e: PointerEvent): { x: number; y: number } {
    return this.stage.toStage(e.clientX, e.clientY); // 논리 좌표 — 화면 크기·레터박스 배율과 무관
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.canInteract()) return;
    if (e.target instanceof Element && e.target.closest('button, a, .dbg, .modal, .back-btn')) return;
    const p = this.point(e);
    const body = this.body as SoftBody;
    const state = this.app.machine.state;
    // 멀티터치(TOUCH): 첫 포인터는 마우스와 같은 눌림(setPress), 추가로 닿은 손가락(터치)은 각각 독립 접촉점으로 처리한다
    if (this.activePointer !== null) {
      if (state === 'MOCHI_TOUCH' && e.pointerType === 'touch' && this.extra.size < MOCHI.MAX_FINGERS - 1 && !this.extra.has(e.pointerId) && body.canGrab(p.x, p.y)) {
        this.extra.set(e.pointerId, { x: p.x, y: p.y, vx: 0, vy: 0, t: performance.now() });
        try {
          this.stage.stage.setPointerCapture(e.pointerId);
        } catch {
          /* 캡처 실패는 무시 */
        }
      }
      return;
    }
    const ok = state === 'MOCHI_STRETCH' ? body.beginGrab(p.x, p.y) : body.canGrab(p.x, p.y);
    if (!ok) return;
    this.activePointer = e.pointerId;
    try {
      this.stage.stage.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 실패는 무시 */
    }
    if (state === 'MOCHI_TOUCH') body.setPress(p.x, p.y);
    this.lastMove = performance.now();
    this.updateCursor();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.canInteract()) return;
    const body = this.body as SoftBody;
    const p = this.point(e);
    const ex = this.extra.get(e.pointerId);
    if (ex) {
      const t = performance.now();
      const dt = Math.max(1, t - ex.t);
      // 이동 속도(px/s)를 부드럽게 갱신: 터치 이벤트 간격이 일정하지 않아도 튀지 않게 한다
      ex.vx += 0.5 * (((p.x - ex.x) / dt) * 1000 - ex.vx);
      ex.vy += 0.5 * (((p.y - ex.y) / dt) * 1000 - ex.vy);
      ex.x = p.x;
      ex.y = p.y;
      ex.t = t;
      return;
    }
    if (this.activePointer === null) {
      this.updateCursor(body.canGrab(p.x, p.y));
      return;
    }
    if (e.pointerId !== this.activePointer) return;
    const now = performance.now();
    if (this.app.machine.state === 'MOCHI_STRETCH') body.moveGrab(p.x, p.y);
    else body.setPress(p.x, p.y, now - this.lastMove);
    this.lastMove = now;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.extra.delete(e.pointerId)) return;
    if (this.activePointer === null || e.pointerId !== this.activePointer) return;
    this.releasePointer();
  };

  private releasePointer(): void {
    if (this.activePointer !== null) {
      try {
        this.stage.stage.releasePointerCapture(this.activePointer);
      } catch {
        /* 무시 */
      }
    }
    this.activePointer = null;
    this.extra.clear();
    this.body?.releaseGrab();
    this.body?.releasePress();
    this.updateCursor();
  }

  private updateCursor(hover = false): void {
    const s = this.stage.stage.style;
    if (!this.canInteract()) s.cursor = '';
    else s.cursor = this.activePointer !== null ? 'grabbing' : hover ? 'grab' : '';
  }

  // ------------------------------------------------------------------ 프레임
  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = now - this.last;
    this.last = now;
    const state = this.app.machine.state;
    if (!MOCHI_STATES.includes(state) || !this.body || this.canvas.hidden || !this.ready) return;
    const body = this.body;
    const t0 = performance.now();

    // 등장: 강체로 떨어뜨리고, 소프트바디가 눌림·출렁임을 만든다
    let moved = false;
    if (this.intro) {
      const dy = this.intro.step(dt);
      if (dy !== 0) {
        body.translate(0, dy);
        moved = true;
      }
    }
    this.updateHands(state, body, now);
    const tS = prof.t();
    body.step(dt);
    prof.end('softBody', tS);

    if (state === 'MOCHI_STRETCH' && body.isGrabbing) {
      if (this.tracker.update(body.currentStretchRatio())) {
        this.app.store.set({ stretchedOnce: true });
        this.app.log('유효한 늘리기 달성(30% 이상)');
      }
    }
    if (state === 'MOCHI_INTRO' && this.intro && !this.introDone) {
      const el = now - this.introStart;
      if ((this.intro.settled && body.isSettled(1.2, 20) && el >= MOCHI.INTRO_MIN_MS) || el >= MOCHI.INTRO_MAX_MS) {
        this.introDone = true;
        this.app.send('done');
        return;
      }
    }

    // 정지(놓은 뒤 가라앉음, 누르지 않음, 떨어지지 않음) 상태는 한 번 그린 뒤 다시 그리지 않는다: 캔버스에 마지막 그림이 남아 있다
    const settled = !moved && body.isSettled();
    const key = `${state}|${this.forcedTier ?? this.quality.tierIndex}`;
    if (settled && this.idleDrawn && !this.dirty && key === this.drawnKey && this.simulatedLoadMs === 0) {
      this.metrics.drawMs = 0;
      this.metrics.frameMs = dt;
      this.fpsCount++;
      if (now - this.fpsStart >= 1000) {
        this.metrics.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsStart));
        this.fpsCount = 0;
        this.fpsStart = now;
      }
      // 쉬는 동안에도 마지막으로 잰 그리기 시간으로 품질 복귀를 판단한다(다음 당기기에 낮은 품질로 시작하지 않게)
      if (this.forcedTier === null && this.quality.update(dt, this.lastActiveDrawMs)) {
        this.renderer_?.invalidate();
        this.dirty = true;
      }
      return;
    }
    const tR = prof.t();
    this.render(body);
    prof.end('render', tR);
    if (prof.on && prof.syncGpu) {
      const tG = performance.now();
      if (this.renderer_?.usingGL) this.renderer_.finishGL();
      else this.ctx.getImageData(0, 0, 1, 1); // GPU 작업이 끝날 때까지 기다린다(측정 전용)
      prof.add('gpuSync', performance.now() - tG);
    }
    this.dirty = false;
    this.idleDrawn = settled;
    this.drawnKey = key;
    if (this.simulatedLoadMs > 0) {
      // 검증용 부하: 최고 품질(전체 격자)의 삼각형 수를 기준으로, 삼각형 수에 비례한다(격자 해상도를 바꿔도 같은 의미)
      const full = (this.renderer_ ? this.renderer_.warp.triangles(1).length * 3 : 0) || 1;
      const spin = this.simulatedLoadMs * (this.metrics.triangles / full);
      const end = performance.now() + spin;
      while (performance.now() < end) { /* 부하 흉내 */ }
    }
    const drawMs = performance.now() - t0;
    // 텍스처를 새로 만든 프레임처럼 유난히 긴 프레임은 평균에서 뺀다(쉬는 동안의 품질 판단이 흔들리지 않게)
    if (drawMs < MOCHI.QUALITY_SLOW_MS * 3) this.lastActiveDrawMs = this.lastActiveDrawMs === 0 ? drawMs : this.lastActiveDrawMs * 0.8 + drawMs * 0.2;
    this.metrics.drawMs = drawMs;
    this.metrics.frameMs = dt;
    this.fpsCount++;
    if (now - this.fpsStart >= 1000) {
      this.metrics.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsStart));
      this.fpsCount = 0;
      this.fpsStart = now;
    }
    // 프레임 시간이 길어지면 품질을 한 단계씩 낮춘다(화면은 품질을 낮춰도 프레임을 우선한다)
    if (this.forcedTier === null) {
      if (this.quality.update(dt, drawMs)) this.renderer_?.invalidate();
    }
  };

  /**
   * 손 입력(MOCHI_TOUCH): 손 추적이 켜져 있으면 손가락 접촉을 찹쌀떡에 전달한다. 마우스·터치 입력과 독립적으로 함께 동작한다.
   * 손 추적이 꺼져 있거나 실패한 환경에서는 아무 일도 하지 않는다(기존 입력만).
   */
  private updateHands(state: State, body: SoftBody, now: number): void {
    const est = this.app.handEstimator;
    const running = this.app.handPipeline.isRunning;
    const touch = state === 'MOCHI_TOUCH';
    // 숨겨진 <video>는 프레임이 갱신되지 않을 수 있어 손 추적 중에는 투명하게만 보이도록 한다
    if (running !== this.handCamOn) {
      this.handCamOn = running;
      this.stage.stage.classList.toggle('hand-cam', running);
    }
    // 위치(찹쌀떡 위인지) 판정은 손 추적이 도는 모든 모찌 화면에서 같은 hit 영역(렌더링과 같은 링 좌표)으로 계산한다.
    // 접촉을 찹쌀떡에 적용하는 것은 TOUCH뿐이다. (예전에는 TOUCH에서만 판정 함수를 연결해, 다른 화면에서는 손가락이 화면상 떡 위에 있어도 항상 '위치 밖'이었다)
    if (running) {
      if (!est.overTest) est.overTest = (x, y) => !!this.body && isNearPolygon(x, y, this.body.x, this.body.y, HAND.OVER_MARGIN_PX);
    } else if (est.overTest) {
      est.overTest = null;
    }
    if (!(running && touch)) {
      if (touch && this.extra.size > 0) body.setFingerContacts(this.mergeContacts(false));
      else if (body.hasFingers) body.releaseFingers();
      // 손 추적을 쓰지 못하는 이유/준비 중임을 알린다(TOUCH, 카메라 입력 모드일 때만). 아무 표시 없이 안 되는 것처럼 보이지 않게 한다
      const app = this.app;
      if (touch && app.store.state.inputMode === 'camera') {
        if (app.handNote) this.handOverlay.draw('note', this.handBuf, app.handNote);
        else if (app.handTracker.status === 'loading') this.handOverlay.draw('note', this.handBuf, '손 인식을 준비하는 중이에요…');
        else this.handOverlay.draw('off', this.handBuf);
      } else {
        this.handOverlay.draw('off', this.handBuf);
      }
      return;
    }
    est.sample(now, this.handBuf);
    body.setFingerContacts(this.mergeContacts(true));
    this.handOverlay.draw(est.tracking ? 'tracking' : 'searching', this.handBuf);
  }

  /** 손 추적 접촉(withHand)과 추가 터치 접촉을 한 목록으로 합친다. 터치는 비어 있는 접촉 번호를 쓴다(최대 MAX_FINGERS) */
  private mergeContacts(withHand: boolean): ReadonlyArray<{ id: number; active: boolean; x: number; y: number; vx: number; vy: number; amount: number }> {
    let n = 0;
    const used = [false, false, false, false, false];
    const put = (id: number, x: number, y: number, vx: number, vy: number, amount: number): void => {
      const o = this.merged[n] ?? (this.merged[n] = { id: 0, active: true, x: 0, y: 0, vx: 0, vy: 0, amount: 0 });
      o.id = id;
      o.active = true;
      o.x = x;
      o.y = y;
      o.vx = vx;
      o.vy = vy;
      o.amount = amount;
      used[id] = true;
      n++;
    };
    if (withHand) for (const f of this.handBuf) if (f.active) put(f.id, f.x, f.y, f.vx, f.vy, f.amount);
    for (const t of this.extra.values()) {
      const id = used.findIndex((u) => !u);
      if (id < 0) break;
      put(id, t.x, t.y, t.vx * (performance.now() - t.t < 120 ? 1 : 0), t.vy * (performance.now() - t.t < 120 ? 1 : 0), 0.85);
    }
    this.merged.length = n;
    return this.merged;
  }

  /**
   * (개발 진단용) 화면에 실제로 그려진 찹쌀떡의 알파(0~1): 논리 좌표 (x,y)의 WebGL 캔버스 픽셀. WebGL을 쓰지 않으면 -1.
   * 눈에 보이는 찹쌀떡 모양과 접촉 hit 영역(링)이 일치하는지 확인하는 데 쓴다.
   */
  renderedAlphaAt(x: number, y: number): number {
    if (!this.renderer_?.usingGL || this.glCanvas.hidden) return -1;
    if (x < 0 || y < 0 || x >= layout.w || y >= layout.h) return 0;
    if (!this.probe) {
      this.probe = document.createElement('canvas');
      this.probe.width = this.probe.height = 1;
    }
    const g = this.probe.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.clearRect(0, 0, 1, 1);
    g.drawImage(this.glCanvas, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
    return (g.getImageData(0, 0, 1, 1).data[3] as number) / 255;
  }
  private probe: HTMLCanvasElement | null = null;

  private render(body: SoftBody): void {
    const ctx = this.ctx;
    const r = this.renderer();
    const tier: QualityTier = this.forcedTier !== null ? (QUALITY_TIERS[Math.min(QUALITY_TIERS.length - 1, Math.max(0, this.forcedTier))] as QualityTier) : this.quality.tier;
    this.metrics.tier = tier.name;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tB = prof.t();
    ctx.drawImage(this.bg as HTMLCanvasElement, 0, 0);
    this.drawShadow(ctx, body);
    prof.end('bgShadow', tB);
    // 눌림 보조 변위·그림자: 마우스 눌림 하나 + 손가락 눌림 여러 개(재사용 배열)
    let nd = 0;
    const press = body.pressPoint;
    if (press && body.pressAmount > 0.01) {
      const d = this.dents[nd] ?? (this.dents[nd] = { x: 0, y: 0, sigma: 1, amount: 0 });
      d.x = press.x;
      d.y = press.y;
      d.sigma = body.restWidth * MOCHI.PRESS_SIGMA_RATIO;
      d.amount = 0.2 * body.pressAmount;
      nd++;
    }
    const nf = body.fingerPoints(this.fingerPts);
    for (let i = 0; i < nf && nd < 5; i++) {
      const f = this.fingerPts[i] as { x: number; y: number; amount: number };
      const d = this.dents[nd] ?? (this.dents[nd] = { x: 0, y: 0, sigma: 1, amount: 0 });
      d.x = f.x;
      d.y = f.y;
      d.sigma = body.restWidth * MOCHI.FINGER_SIGMA_RATIO;
      d.amount = 0.35 * f.amount; // 손가락 눌림은 반경이 작아 마우스(0.2)보다 변위를 키워 얹기만 해도 눈에 보이게
      nd++;
    }
    // 늘리기(STRETCH)에서만 세밀한 메시·변위 평활화를 쓴다(TOUCH는 기존 해상도 그대로)
    r.draw(ctx, body, tier, this.dents, nd, this.app.machine.state === 'MOCHI_STRETCH');
    this.metrics.triangles = r.lastTriangles;
  }

  /** 바닥 그림자(Canvas 타원): 높이 떠 있을수록 작고 옅게 */
  private drawShadow(ctx: CanvasRenderingContext2D, body: SoftBody): void {
    const f = frontLayout();
    const g = f.groundY;
    // 바닥 근처(g-48 이하) 점들의 가운데·반폭, 가장 낮은 점의 띄움 — 배열을 만들지 않고 한 번에 구한다
    let sx = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < body.n; i++) {
      const y = body.y[i] as number;
      const x = body.x[i] as number;
      if (y > maxY) maxY = y;
      if (y > g - 48) {
        sx += x;
        n++;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    const cx = n ? sx / n : f.centerX;
    const half = n ? (hi - lo) / 2 : body.restWidth * 0.3;
    const rx = half * 1.08 + 24;
    const lift = Math.max(0, g - maxY);
    const alpha = 0.4 / (1 + lift / 80);
    const ry = rx * 0.15;
    ctx.save();
    ctx.translate(cx, g - 2);
    ctx.scale(1, ry / rx);
    const grd = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
    grd.addColorStop(0, `rgba(60,30,10,${alpha})`);
    grd.addColorStop(1, 'rgba(60,30,10,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ 개발·테스트 도구
  get bodyRef(): SoftBody | null {
    return this.body;
  }
  get pieceList(): readonly Piece3D[] {
    return this.pieces;
  }
}
