// 게임 뷰: 엔진을 실제 시간(performance.now)으로 구동하고 캔버스/HUD를 갱신하며, 규칙에 따라 RESULT로 넘긴다.
import { layout, onLayoutChange } from '../app/layout';
import { prof } from '../app/profiler';
import type { App } from '../app/app';
import { GAME, ITEM_LABELS } from '../app/constants';
import type { State } from '../app/stateMachine';
import type { Stage } from '../ui/stage';
import { h } from '../ui/dom';
import type { GameAssets } from './assets';
import { GameEngine, type EngineEvent } from './engine';
import { Hud } from './hud';
import { drawCollisionDebug, drawFx, drawObjects, type Fx } from './renderer';
import { randomSeed } from './rng';
import { remainingSeconds } from './round';

export class GameView {
  readonly canvas: HTMLCanvasElement;
  readonly hud = new Hud();
  engine: GameEngine | null = null;
  debugCollision = false;
  private ctx: CanvasRenderingContext2D;
  private fx: Fx = { pops: [], flashAt: -Infinity };
  private last = 0;
  private roundStartedAt = 0;
  private countdownShown: number | null = null;
  private countdownAt = 0;
  private endTimer = 0;
  private ending = false;
  private endBanner: { text: string; kind: 'success' | 'fail' } | null = null;

  constructor(private app: App, stage: Stage) {
    this.canvas = h('canvas', { class: 'game-canvas', attrs: { width: String(layout.w), height: String(layout.h) } });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    this.ctx = ctx;
    stage.gameLayer.append(this.canvas);
    onLayoutChange(() => {
      this.canvas.width = layout.w;
      this.canvas.height = layout.h;
      // 세로↔가로 전환: 플레이 중이면 남은 오브젝트는 새 좌표계 안으로 들여 놓는다(화면 밖에 갇히지 않게)
      for (const o of this.engine?.objects ?? []) o.baseX = Math.min(Math.max(o.baseX, 60), layout.w - 60);
    });
    app.machine.onTransition((from, to) => this.onTransition(from, to));
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) this.debugCollision = !this.debugCollision;
    });
    this.last = performance.now();
    this.loop(this.last);
  }

  private get assets(): GameAssets | null {
    return this.app.assets;
  }

  private isGameState(s: State): boolean {
    return s === 'PLAYING' || s === 'PAUSED';
  }

  private onTransition(from: State, to: State): void {
    if (to === 'PLAYING' && from !== 'PAUSED') this.newRound();
    if (!this.isGameState(to)) {
      window.clearTimeout(this.endTimer);
      this.ending = false;
    }
  }

  /** 새 라운드: 점수·타이머·오브젝트·효과를 모두 초기화 */
  newRound(): void {
    const a = this.assets;
    if (!a) return;
    window.clearTimeout(this.endTimer);
    this.ending = false;
    this.endBanner = null;
    this.engine = new GameEngine({ shapes: a.shapes, dims: a.dims }, randomSeed());
    this.fx = { pops: [], flashAt: -Infinity };
    this.countdownShown = null;
    this.roundStartedAt = performance.now();
    this.app.store.set({ roundResult: null, lastResult: null });
    this.app.log('새 라운드 시작');
  }

  /** 개발용: 결과를 강제로 확정 */
  forceEnd(success: boolean): void {
    if (!this.engine) this.newRound();
    if (!this.engine) return;
    this.handleEvents(this.engine.forceEnd(success), performance.now());
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = now - this.last;
    this.last = now;
    const state = this.app.machine.state;
    const visible = this.isGameState(state);
    this.canvas.hidden = !visible;
    if (!visible || !this.engine) return;

    const tU = prof.t();
    const paused = state !== 'PLAYING' || this.app.store.state.uiPaused;
    if (!paused && !this.engine.finished) {
      const events = this.engine.update(dt, this.app.hub.current());
      this.handleEvents(events, now);
    } else if (paused) {
      // 일시정지 중에는 효과의 시계도 멈추도록 출생 시각을 밀어 준다
      for (const p of this.fx.pops) p.born += dt;
      this.roundStartedAt += dt;
      if (this.countdownShown !== null) this.countdownAt += dt;
    }
    prof.end('gameUpdate', tU);
    const tG = prof.t();
    this.render(now);
    prof.end('gameRender', tG);
    if (prof.on && prof.syncGpu) {
      const t2 = performance.now();
      this.ctx.getImageData(0, 0, 1, 1);
      prof.add('gameGpuSync', performance.now() - t2);
    }
  };

  private handleEvents(events: EngineEvent[], now: number): void {
    for (const e of events) {
      if (e.type === 'collect') {
        if (e.kind === 'fruit') {
          this.fx.pops.push({ x: e.object.x, y: e.object.y, text: '+1', color: '#ffd9dd', born: now });
        } else {
          this.fx.pops.push({ x: e.object.x, y: e.object.y, text: '으악!', color: '#ff8a98', born: now });
          this.fx.flashAt = now;
        }
        this.app.log(`수집: ${ITEM_LABELS[e.itemId]} (${e.kind}) 과일 ${e.fruitCount} 쓰레기 ${e.trashCount}`);
      } else if (e.type === 'countdown') {
        this.countdownShown = e.n;
        this.countdownAt = now;
      } else if (e.type === 'end') {
        this.countdownShown = null;
        this.app.store.set({ roundResult: e.result, lastResult: e.result.success ? 'success' : 'fail' });
        this.endBanner = { text: e.result.success ? '성공!' : '실패!', kind: e.result.success ? 'success' : 'fail' };
        this.ending = true;
        this.app.log(`라운드 종료: ${e.result.success ? '성공' : `실패(${e.result.failReason})`} 과일 ${e.result.fruitCount} 쓰레기 ${e.result.trashCount}`);
        window.clearTimeout(this.endTimer);
        // 종료 직후 잠시 결과를 보여 준 뒤 RESULT로 (이 사이에는 오브젝트 생성·충돌이 없다)
        const goResult = (): void => {
          const st = this.app.machine.state;
          if (st === 'PLAYING' && !this.app.store.state.uiPaused) this.app.machine.devSendResult(e.result.success);
          else if (st === 'PLAYING' || st === 'PAUSED') this.endTimer = window.setTimeout(goResult, 250); // 일시정지가 풀리면 넘어간다
        };
        this.endTimer = window.setTimeout(goResult, GAME.END_BANNER_MS);
      }
    }
  }

  private render(now: number): void {
    const eng = this.engine;
    const a = this.assets;
    if (!eng || !a) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, layout.w, layout.h);
    drawObjects(ctx, eng.objects, a);
    drawFx(ctx, this.fx, now);
    if (this.debugCollision) drawCollisionDebug(ctx, eng.objects, a.shapes, this.app.hub.current());

    // HUD
    const r = eng.round;
    let banner: string | null = null;
    let bannerKind: 'start' | 'success' | 'fail' = 'start';
    if (this.endBanner) {
      banner = this.endBanner.text;
      bannerKind = this.endBanner.kind;
    } else if (now - this.roundStartedAt < GAME.START_BANNER_MS) {
      banner = '시작!';
    }
    const cd = this.countdownShown !== null && now - this.countdownAt < 1000 ? this.countdownShown : null;
    this.hud.update({
      remainingSec: eng.finished && r.status === 'fail' && r.failReason === 'timeout' ? 0 : remainingSeconds(r),
      fruitCount: r.fruitCount,
      trashCount: r.trashCount,
      countdown: this.ending ? null : cd,
      banner,
      bannerKind,
    });
  }
}
