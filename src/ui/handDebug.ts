// 손 인식 디버그(개발 서버 전용, 처음에는 접혀 있음): 21개 랜드마크, 손가락 끝, 굽힘, 신뢰도, 접촉 상태, 손가락별 속도, 찹쌀떡에 전달되는 압력 위치·방향.
// 배포 번들에는 만들어지지 않는다(main.ts에서 import.meta.env.DEV일 때만 생성).
import { layout, onLayoutChange } from '../app/layout';
import type { App } from '../app/app';
import { FINGER_NAMES, HAND } from '../app/constants';
import { distanceToPolygonEdges, pointInPolygon } from '../mochi/geometry';
import { makeContactBuffer } from '../vision/handContact';
import { coverMap, normalizedToStage } from '../vision/mouthPosition';
import { h } from './dom';
import type { Stage } from './stage';

const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
];

export class HandDebugPanel {
  private body: HTMLElement;
  private info: HTMLPreElement;
  private toggle: HTMLButtonElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf = makeContactBuffer();
  private open = false;

  private stageRef: Stage;

  constructor(private app: App, stage: Stage) {
    this.stageRef = stage;
    this.info = h('pre', { class: 'dbg-info' });
    const force = h('button', { class: 'dbg-btn', text: '웹캠+손 추적 강제 시작(개발용)', attrs: { type: 'button' }, on: { click: () => void this.app.devStartHands() } });
    this.body = h('div', { class: 'dbg-body hand-dbg-body' }, h('div', { class: 'dbg-title', text: '손 인식(개발용)' }), this.info, force);
    this.body.hidden = true;
    this.toggle = h('button', { class: 'dbg-toggle', text: 'HAND', attrs: { type: 'button' }, on: { click: () => this.setOpen(!this.open) } });
    const panel = h('div', { class: 'dbg hand-dbg' }, this.toggle, this.body);
    panel.style.left = 'auto';
    panel.style.right = '12px';
    panel.style.bottom = '12px';
    stage.overlayLayer.append(panel);
    this.canvas = h('canvas', { class: 'hand-dbg-canvas', attrs: { width: String(layout.w), height: String(layout.h) } });
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:25';
    // 개발 환경에서는 패널을 접어 둬도 21개 랜드마크 뼈대를 화면에 그린다(손이 인식되는지 바로 보이게). 패널(수치)은 접혀 있다
    app.handPipeline.wantFull = true;
    stage.overlayLayer.append(this.canvas);
    const c = this.canvas.getContext('2d');
    if (!c) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    this.ctx = c;
    onLayoutChange(() => {
      this.canvas.width = layout.w;
      this.canvas.height = layout.h;
    });
    (window as unknown as { __handAudit?: () => unknown }).__handAudit = () => this.audit();
    window.setInterval(() => this.refresh(), 100);
  }

  /**
   * 좌표계 전수 조사: 같은 프레임에서 손가락별로 모든 단계의 좌표를 모은다.
   *  norm   MediaPipe 정규화 좌표(0~1, 영상 기준, 좌우 반전 전)
   *  videoPx 영상 intrinsic 픽셀(videoW×videoH)
   *  stageRaw 거울 반전 + object-fit: cover 적용 후 논리 좌표(1280×720) — 같은 변환 함수(normalizedToStage)로 독립 계산
   *  contact handContact가 쓰는(스무딩된) 논리 좌표 / overlay 점을 그리는 논리 좌표(외삽 포함)
   *  hit    접촉 판정이 쓰는 링(렌더링과 같은 body.x/y, 논리 좌표)까지의 거리·내부 여부 / rendered 실제로 그려진 찹쌀떡 픽셀 알파
   * 모든 캔버스(2D·WebGL·overlay·디버그)는 1280×720 backing store이며 CSS로 스테이지 배율만큼 늘어나므로 논리 좌표가 곧 캔버스 픽셀 좌표다(DPR 무관).
   */
  audit(): unknown {
    const a = this.app;
    const d = a.handPipeline.debug;
    const v = a.video;
    const video = { w: d.videoW || v.videoWidth, h: d.videoH || v.videoHeight };
    const cm = video.w > 0 ? coverMap(video) : { scale: 0, offsetX: 0, offsetY: 0 };
    const body = a.mochiView?.bodyRef ?? null;
    const buf = makeContactBuffer();
    a.handEstimator.sample(performance.now(), buf);
    const fingers = buf.map((f) => {
      const nx = d.lastTips[f.id * 2] as number;
      const ny = d.lastTips[f.id * 2 + 1] as number;
      const raw = normalizedToStage({ x: nx, y: ny }, video, true);
      let dist = NaN;
      let inside = false;
      if (body) {
        dist = distanceToPolygonEdges(f.x, f.y, body.x, body.y);
        inside = pointInPolygon(f.x, f.y, body.x, body.y);
      }
      return {
        id: f.id, name: FINGER_NAMES[f.id], norm: [nx, ny], videoPx: [nx * video.w, ny * video.h], stageRaw: [raw.x, raw.y], contact: [f.x, f.y], overlay: [f.x, f.y],
        hit: { inside, distToOutline: dist, margin: HAND.OVER_MARGIN_PX, over: f.condOver, expectedOver: body ? inside || dist <= HAND.OVER_MARGIN_PX : false },
        renderedAlpha: a.mochiView?.renderedAlphaAt(f.x, f.y) ?? -1,
      };
    });
    return {
      state: a.machine.state,
      video, cover: cm, mirror: true, canvasBacking: [layout.w, layout.h], dpr: window.devicePixelRatio, stageCssScale: this.stageRef.transform.scale,
      bodyBBox: body ? { x0: Math.min(...body.x), x1: Math.max(...body.x), y0: Math.min(...body.y), y1: Math.max(...body.y) } : null,
      fingers,
    };
  }

  private setOpen(v: boolean): void {
    this.open = v;
    this.body.hidden = !v;
  }

  private refresh(): void {
    // 접혀 있어도 토글 버튼의 상태 표시는 갱신한다(가벼운 계산만)
    if (!this.open) {
      const d0 = this.app.handPipeline.debug;
      this.toggle.textContent = !d0.running ? 'HAND ○ 꺼짐' : d0.results === 0 ? 'HAND ⚠ 추론 없음' : d0.found ? 'HAND ● 손 감지' : 'HAND ◌ 손 없음';
      this.drawSkeleton();
      return;
    }
    const a = this.app;
    const d = a.handPipeline.debug;
    const est = a.handEstimator;
    est.sample(performance.now(), this.buf);
    const cam = a.camera.snapshot();
    const v = a.video;
    const now = performance.now();
    const diag = !d.running
      ? '진단: 손 추적 파이프라인이 꺼져 있음(MOCHI_TOUCH에서만 실행되며 웹캠·손 추적기가 준비돼야 시작) — 아래 "강제 시작" 버튼으로 확인 가능'
      : d.sent === 0
        ? '진단: 프레임이 한 번도 전송되지 않음(영상 준비 안 됨? video readyState/재생 확인)'
        : d.results === 0
          ? '진단: ⚠ 프레임은 보냈지만 추론 결과가 한 번도 오지 않음 → Worker/모델 문제(추론이 실행되지 않음)'
          : d.handsFound === 0
            ? '진단: 추론은 정상 실행 중이며 손이 감지되지 않음(카메라에 손이 안 보이거나 신뢰도 낮음)'
            : d.found
              ? '진단: 정상 — 손 감지 중'
              : '진단: 정상 — 지금은 손이 안 보임(이전에는 감지됨)';
    const st = a.machine.state;
    const stateLine = st === 'MOCHI_TOUCH'
      ? `현재 화면: ${st} — 접촉이 찹쌀떡에 적용됨`
      : `현재 화면: ${st} — ⚠ 접촉은 MOCHI_TOUCH에서만 적용됨(여기서는 위치 판정만 표시)`;
    const lines = [
      stateLine,
      diag,
      `[1 카메라] 상태 ${cam.status}${cam.error ? ` (${cam.error})` : ''} 트랙 ${cam.trackCount}개 ${cam.width}x${cam.height} / 입력모드 ${a.store.state.inputMode}`,
      `[2 video] readyState ${v.readyState} 크기 ${v.videoWidth}x${v.videoHeight} 재생 ${v.paused ? '멈춤' : '중'} t=${v.currentTime.toFixed(1)} srcObject ${v.srcObject ? '있음' : '없음'}`,
      `[3-6 모델/Worker] 추적기 ${a.handTracker.status}${a.handTracker.error ? ` 오류: ${a.handTracker.error}` : ''} 초기화 ${a.handTracker.initMs.toFixed(0)}ms delegate ${a.handTracker.delegate || '-'}`,
      `[7-10 추론] 파이프라인 ${d.running ? '실행 중' : '정지'} | 전송 ${d.sent}회 / 추론결과 ${d.results}회 / 손 감지 ${d.handsFound}회 | 마지막 추론 ${d.lastResultAt ? `${(now - d.lastResultAt).toFixed(0)}ms 전` : '없음'} (${d.ms.toFixed(1)}ms, ${d.fps}fps)`,
      `[오류] 연속 ${d.errors} 누적 ${d.totalErrors} 시간초과 ${d.timeouts} 마지막: ${d.lastError || '없음'}`,
      `[11 결과] 손 ${d.found ? '1개 감지' : '0개'} 신뢰도 ${d.score.toFixed(2)} 랜드마크 ${d.full ? `${d.lmCount}개 수신` : d.found ? '5점만(패널을 열면 21점)' : '없음'} 추적 ${est.tracking ? '안정' : '아님'}`,
      `[12 화면 좌표] 접촉 중 ${this.buf.filter((f) => f.active).length}개`,
    ];
    const yn = (v: boolean): string => (v ? 'O' : 'x');
    // 좌표계 감사(같은 프레임): 영상 정규화 → 영상 px → 논리 좌표 → hit 거리 → 실제로 그려진 알파
    const au = this.audit() as { video: { w: number; h: number }; cover: { scale: number; offsetX: number; offsetY: number }; dpr: number; stageCssScale: number; fingers: Array<{ name: string; norm: number[]; videoPx: number[]; stageRaw: number[]; contact: number[]; hit: { inside: boolean; distToOutline: number; over: boolean; expectedOver: boolean }; renderedAlpha: number }> };
    lines.push(`[좌표계] video ${au.video.w}x${au.video.h}px → cover 배율 ${au.cover.scale.toFixed(3)} 오프셋(${au.cover.offsetX.toFixed(0)},${au.cover.offsetY.toFixed(0)}) 좌우반전 → 논리 1280x720 | 캔버스 backing 1280x720 | DPR ${au.dpr} 스테이지 CSS 배율 ${au.stageCssScale.toFixed(3)}`);
    for (const f of au.fingers) {
      lines.push(`  ${f.name!.padEnd(6)} 정규화(${f.norm[0]!.toFixed(3)},${f.norm[1]!.toFixed(3)}) → 영상px(${f.videoPx[0]!.toFixed(0)},${f.videoPx[1]!.toFixed(0)}) → 논리(${f.stageRaw[0]!.toFixed(0)},${f.stageRaw[1]!.toFixed(0)}) 접촉좌표(${f.contact[0]!.toFixed(0)},${f.contact[1]!.toFixed(0)}) | hit ${f.hit.inside ? '안' : '밖'} 윤곽거리 ${Number.isFinite(f.hit.distToOutline) ? f.hit.distToOutline.toFixed(0) : '-'}px → 판정 ${f.hit.over ? '위치 안' : '위치 밖'}${f.hit.over === f.hit.expectedOver ? '' : ' ⚠ 불일치'} | 그려진 떡 알파 ${f.renderedAlpha < 0 ? '-' : f.renderedAlpha.toFixed(2)}`);
    }
    lines.push('조건(필수=위에 있음 AND 머문 시간 / 보조=굽힘·속도 → 강도): 위 140ms 굽힘 속도 주먹차단 | 목표→눌림 | 판정');
    for (const f of this.buf) {
      lines.push(`${FINGER_NAMES[f.id]!.padEnd(6)} (${f.x.toFixed(0)},${f.y.toFixed(0)}) 위${yn(f.condOver)} 머문${yn(f.condDwell)}(${Math.min(f.overMs, 999).toFixed(0)}ms) 굽힘${yn(f.condFlex)}(${f.flex.toFixed(2)}/기준${f.flexBase.toFixed(2)}) 속도${yn(f.condSpeed)}(${f.speed.toFixed(0)}px/s) 주먹${yn(f.condFist)} | 목표 ${f.target.toFixed(2)}→눌림 ${f.amount.toFixed(2)} | ${f.active ? '접촉' : !f.condOver ? '없음(찹쌀떡 밖)' : !f.condDwell ? '없음(머문 시간 부족)' : f.condFist ? '없음(주먹)' : '없음(눌림 상승 중)'}`);
    }
    // 토글 버튼에 상태를 한눈에(패널을 접어 둬도 보인다)
    this.toggle.textContent = !d.running ? 'HAND ○ 꺼짐' : d.results === 0 ? 'HAND ⚠ 추론 없음' : d.found ? 'HAND ● 손 감지' : 'HAND ◌ 손 없음';
    this.info.textContent = lines.join('\n');
    this.drawSkeleton();
  }

  private drawHit(c: CanvasRenderingContext2D): void {
    // 접촉 판정에 쓰는 실제 hit 영역(렌더링과 같은 링 좌표): 빨간 윤곽선 + 판정 여유(OVER_MARGIN) 띠
    const body = this.app.mochiView?.bodyRef;
    if (body && body.n > 2) {
      c.save();
      c.beginPath();
      for (let i = 0; i < body.n; i++) (i ? c.lineTo(body.x[i] as number, body.y[i] as number) : c.moveTo(body.x[i] as number, body.y[i] as number));
      c.closePath();
      c.lineJoin = 'round';
      c.lineWidth = HAND.OVER_MARGIN_PX * 2;
      c.strokeStyle = 'rgba(255, 40, 40, 0.16)';
      c.stroke();
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255, 40, 40, 0.95)';
      c.stroke();
      c.restore();
    }
  }

  private drawSkeleton(): void {
    const d = this.app.handPipeline.debug;
    const est = this.app.handEstimator;
    if (!d.running) {
      this.ctx.clearRect(0, 0, layout.w, layout.h);
      this.drawHit(this.ctx); // 손 추적이 꺼져 있어도 hit 영역은 보인다(렌더링과의 일치 확인용)
      return;
    }
    est.sample(performance.now(), this.buf);
    // 21개 랜드마크 + 압력 위치·방향
    const c = this.ctx;
    c.clearRect(0, 0, layout.w, layout.h);
    const full = d.full;
    if (full && d.videoW > 0) {
      const video = { w: d.videoW, h: d.videoH };
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 21; i++) pts.push(normalizedToStage({ x: full[i * 3] as number, y: full[i * 3 + 1] as number }, video, true));
      c.strokeStyle = 'rgba(60,220,120,0.9)';
      c.lineWidth = 2;
      c.beginPath();
      for (const [p, q] of BONES) {
        c.moveTo((pts[p] as { x: number }).x, (pts[p] as { y: number }).y);
        c.lineTo((pts[q] as { x: number }).x, (pts[q] as { y: number }).y);
      }
      c.stroke();
      c.fillStyle = 'rgba(60,220,120,0.95)';
      for (const p of pts) {
        c.beginPath();
        c.arc(p.x, p.y, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    this.drawHit(c);
    for (const f of this.buf) {
      c.beginPath();
      c.arc(f.x, f.y, 6, 0, Math.PI * 2);
      if (f.over) {
        c.fillStyle = 'rgba(60, 220, 120, 0.9)';
        c.fill();
      }
      c.strokeStyle = f.active ? '#ff4060' : f.over ? '#20a050' : '#ffffff';
      c.lineWidth = 2;
      c.stroke();
      if (f.active) {
        // 압력 위치와 방향(이동 속도 방향)
        c.beginPath();
        c.moveTo(f.x, f.y);
        c.lineTo(f.x + f.vx * 0.12, f.y + f.vy * 0.12);
        c.strokeStyle = '#ffd040';
        c.lineWidth = 3;
        c.stroke();
      }
    }
  }
}
