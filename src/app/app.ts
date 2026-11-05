// 앱 조립: 상태 머신, 스토어, 카메라, 얼굴 인식 파이프라인, 입력 허브를 만들고 화면 이동에 따른 부수 효과(웹캠 수명)를 연결한다.
import type { MochiView } from '../mochi/mochiView';
import { assetUrl } from './assetUrl';
import { device } from './layout';
import { CALIBRATION, FLOW, VISION_ASSETS } from './constants';
import { StateMachine, type Event, type State } from './stateMachine';
import { Store } from './store';
import { CAMERA_MESSAGES, CameraSession, browserCameraDeps, type CameraErrorKind } from '../vision/camera';
import { FaceTracker, prefetchVisionAssets } from '../vision/faceTracker';
import { HandContactEstimator } from '../vision/handContact';
import { HandPipeline } from '../vision/handPipeline';
import { HandTracker } from '../vision/handTracker';
import { GAME_ASSET_COUNT, loadGameAssets, type GameAssets } from '../game/assets';
import { MOCHI_ASSET_COUNT, loadMochiAssets, type MochiAssets } from '../mochi/assets';
import { InputHub } from '../vision/inputHub';
import { MouthDetector, DEFAULT_CALIBRATION, computeCalibration } from '../vision/mouthDetector';
import { VisionPipeline } from '../vision/visionPipeline';
import type { Calibration } from '../vision/types';

export type LogFn = (msg: string) => void;

export class App {
  readonly log: LogFn;
  readonly logs: string[] = [];
  readonly machine: StateMachine;
  readonly store = new Store();
  readonly camera = new CameraSession(browserCameraDeps());
  // 손 입력(MOCHI_TOUCH): 얼굴 인식과 독립적인 추적기·Worker·파이프라인. 실패해도 마우스·터치는 그대로 동작한다.
  readonly handTracker = new HandTracker();
  readonly handEstimator = new HandContactEstimator();
  readonly handPipeline = new HandPipeline(this.handTracker, this.handEstimator);
  /**
   * 손 입력 상태 안내(TOUCH 화면에 작게 표시): ''이면 안내 없음. 손 추적을 쓰지 못하는 이유를 숨기지 않는다.
   * (예전에는 실패하면 아무 표시 없이 웹캠만 꺼져서 "손 인식이 전혀 안 된다"로만 보였다)
   */
  handNote = '';
  private handModelPrefetched = false;
  readonly tracker = new FaceTracker();
  readonly detector = new MouthDetector(DEFAULT_CALIBRATION);
  readonly hub = new InputHub();
  readonly pipeline: VisionPipeline;
  /** 화면 전체 배경으로 쓰는 웹캠 영상 요소(스트림이 있을 때만 재생) */
  readonly video: HTMLVideoElement;
  /** 게임 에셋(스프라이트, 충돌 형상). LOADING에서 불러온다 */
  assets: GameAssets | null = null;
  /** 모찌 에셋(막·뒷벽, 워프 메시, 과일 위 시점) */
  mochiAssets: MochiAssets | null = null;
  /** 모찌 뷰(main에서 연결). 화면 UI가 상태를 읽는 데 쓴다 */
  mochiView: MochiView | null = null;
  private loadingProgress: (done: number, total: number) => void = () => {};

  constructor() {
    this.log = (m) => {
      this.logs.push(`${new Date().toLocaleTimeString()} ${m}`);
      if (this.logs.length > 200) this.logs.shift();
      console.debug('[mochi]', m);
    };
    this.machine = new StateMachine('LOADING', undefined, this.log);
    this.video = document.createElement('video');
    this.video.className = 'cam-video';
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.pipeline = new VisionPipeline(this.tracker, this.detector, this.hub);

    // 얼굴 미검출: PLAYING 중일 때만 PAUSED로, 돌아오면 PLAYING으로 (SPEC 5장 8항)
    this.pipeline.events.onFaceLost = () => {
      this.store.set({ faceDetected: false });
      if (this.machine.state === 'PLAYING' && this.store.state.inputMode === 'camera') this.machine.send('faceLost');
    };
    this.pipeline.events.onFaceBack = () => {
      this.store.set({ faceDetected: true });
      if (this.machine.state === 'PAUSED') this.machine.send('faceBack');
    };

    this.machine.onTransition((from, to, ev) => this.onTransition(from, to, ev));
  }

  setLoadingProgress(cb: (done: number, total: number) => void): void {
    this.loadingProgress = cb;
  }

  // ------------------------------------------------------------------ LOADING
  /**
   * 앱 시작: 게임 에셋(필수)과 얼굴 인식 리소스(wasm·모델)를 미리 받아 둔다.
   * - 게임 에셋 실패: 재시도만 가능 (게임을 할 수 없다)
   * - 얼굴 인식 리소스 실패: 대체 입력으로 계속 가능
   */
  async boot(): Promise<void> {
    this.store.set({ loadError: null });
    // 폰트: Canvas 텍스트는 로드가 끝난 뒤에 그려야 하므로 먼저 불러온다. 실패·지연(3초)이어도 진행하며 시스템 폰트로 대체된다.
    await Promise.race([
      document.fonts.load("24px 'Jalnan2'").catch(() => []),
      new Promise((r) => window.setTimeout(r, 3000)),
    ]);
    const total = 3 + GAME_ASSET_COUNT + MOCHI_ASSET_COUNT;
    let g = 0;
    let v = 0;
    let m = 0;
    const report = (): void => this.loadingProgress(g + v + m, total);
    if (!this.assets) {
      try {
        this.assets = await loadGameAssets((d) => {
          g = d;
          report();
        });
        this.store.set({ assetsLoaded: true });
        this.log('게임 에셋 로드 완료');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`게임 에셋 로드 실패: ${msg}`);
        this.store.set({ loadError: `게임 에셋: ${msg}`, assetsLoaded: false });
        return;
      }
    } else {
      g = GAME_ASSET_COUNT;
    }
    if (!this.mochiAssets) {
      try {
        this.mochiAssets = await loadMochiAssets((d) => {
          m = d;
          report();
        });
        this.log('모찌 에셋 로드 완료');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`모찌 에셋 로드 실패: ${msg}`);
        this.store.set({ loadError: `모찌 에셋: ${msg}`, assetsLoaded: false });
        return;
      }
    } else {
      m = MOCHI_ASSET_COUNT;
    }
    try {
      await prefetchVisionAssets((d) => {
        v = d;
        report();
      });
      this.log('얼굴 인식 리소스 로드 완료');
      this.machine.send('loaded');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`리소스 로드 실패: ${msg}`);
      // 같은 LOADING에 머물며 오류 안내 → 사용자가 "대체 입력으로 시작"을 누르면 useFallback
      this.store.set({ loadError: msg });
    }
  }

  // ------------------------------------------------------------------ 카메라 흐름
  /** 카메라 켜기 → 얼굴 인식 초기화 → 파이프라인 시작. 성공하면 true. */
  async startCamera(): Promise<boolean> {
    this.store.set({ busyMessage: '카메라를 켜는 중이에요…', errorMessage: null });
    const res = await this.camera.acquire();
    if (!res.ok) {
      this.store.set({ busyMessage: null, errorMessage: CAMERA_MESSAGES[res.kind], permission: res.kind === 'denied' ? 'denied' : this.store.state.permission });
      this.log(`카메라 실패: ${res.kind}`);
      return false;
    }
    this.store.set({ permission: 'granted' });
    this.attachVideo();
    if (!this.tracker.isReady()) {
      this.store.set({ busyMessage: '얼굴 인식을 준비하는 중이에요…' });
      try {
        await this.tracker.init();
      } catch (e) {
        this.log(`얼굴 인식 초기화 실패: ${e instanceof Error ? e.message : String(e)}`);
        this.camera.release();
        this.store.set({ busyMessage: null, errorMessage: '얼굴 인식을 시작하지 못했어요. 마우스·키보드로 계속할 수 있어요.' });
        return false;
      }
    }
    this.hub.setMode('camera');
    this.store.set({ inputMode: 'camera', busyMessage: null });
    await this.playVideo();
    this.detector.setCalibration(this.store.state.calibration ?? DEFAULT_CALIBRATION);
    if (!this.pipeline.isRunning) this.pipeline.start(this.video);
    this.log(`카메라·얼굴 인식 시작 (${this.tracker.delegate})`);
    return true;
  }

  private attachVideo(): void {
    const stream = this.camera.stream;
    if (stream && this.video.srcObject !== stream) this.video.srcObject = stream;
  }

  private async playVideo(): Promise<void> {
    try {
      await this.video.play();
    } catch (e) {
      this.log(`영상 재생 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * MOCHI_INTRO 진입: 얼굴 분석은 끄고(게임 플레이가 끝났다), 카메라가 켜져 있고 손 입력을 쓸 수 있으면 스트림을 유지하며 손 추적기를 미리 준비한다.
   * 쓸 수 없으면 기존처럼 웹캠을 해제한다. 손 추적기 초기화가 실패하면 웹캠도 해제한다(마우스·터치만 사용).
   */
  private enterMochiCamera(): void {
    // 모바일(터치 기기)은 손 인식을 쓰지 않는다(휴대폰을 들고 웹캠으로 손가락을 누르기 어렵다): 손 Worker·모델을 실행/선로딩하지 않고 기존처럼 웹캠을 해제한다.
    // 코드·파일은 그대로 두고 여기서만 비활성화한다(PC는 변경 없음).
    const keep = !device.mobile && this.store.state.inputMode === 'camera' && this.camera.isActive() && HandTracker.supported();
    if (!keep) {
      if (this.camera.status !== 'idle' || this.pipeline.isRunning || this.tracker.isReady()) this.releaseCamera();
      return;
    }
    this.pipeline.stop();
    this.tracker.close();
    this.store.set({ faceDetected: false });
    this.log('얼굴 분석 해제, 웹캠 유지(손 입력)');
    void this.prepareHands();
  }

  private async prepareHands(): Promise<void> {
    try {
      await this.handTracker.init();
      this.log('손 인식 준비 완료');
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log(`손 인식 사용 불가: ${reason} — 마우스·터치로 진행`);
      this.releaseCamera(); // 손 입력을 못 쓰면 웹캠을 켜 둘 이유가 없다
      this.handNote = `손 인식을 사용할 수 없어요 (${reason}) — 마우스·터치로 만져 주세요`;
      return;
    }
    const st = this.machine.state;
    if (st === 'MOCHI_TOUCH') this.startHands();
    else if (st !== 'MOCHI_INTRO' && st !== 'MOCHI_STRETCH') this.handTracker.close(); // 그 사이 다른 화면으로 나갔다
  }

  /**
   * 개발 전용: 지금 화면과 무관하게 웹캠을 켜고 손 추적을 시작한다(DEV 패널에서 MOCHI_TOUCH로 바로 이동해 카메라가 꺼져 있을 때 확인용).
   * 정상 흐름(결과 → INTRO → STRETCH → TOUCH)에서는 쓰지 않는다.
   */
  async devStartHands(): Promise<void> {
    this.log('[개발] 손 추적 강제 시작');
    const res = await this.camera.acquire();
    if (!res.ok) {
      this.log(`[개발] 웹캠 실패: ${res.kind}`);
      return;
    }
    this.store.set({ permission: 'granted', inputMode: 'camera' });
    this.attachVideo();
    await this.playVideo();
    try {
      await this.handTracker.init();
    } catch (e) {
      this.log(`[개발] 손 인식 초기화 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.handNote = '';
    this.handPipeline.stop();
    this.handPipeline.start(this.video);
  }

  private startHands(): void {
    if (device.mobile) return; // 모바일은 손 인식을 쓰지 않는다(안내 문구도 띄우지 않는다)
    // 시작하지 못하는 이유를 숨기지 않는다: "손이 안 보임"과 "손 추적이 시작되지 않음"을 구분할 수 있어야 한다
    const why = !this.handTracker.isReady() ? `손 추적기 ${this.handTracker.status}${this.handTracker.error ? ` (${this.handTracker.error})` : ''}` : !this.camera.isActive() ? `웹캠 ${this.camera.status}` : this.store.state.inputMode !== 'camera' ? `입력 모드 ${this.store.state.inputMode}` : '';
    if (why) {
      this.log(`손 추적 시작 안 함: ${why}`);
      // 준비 중(loading)이면 곧 시작되므로 안내하지 않는다. 그 밖의 이유는 화면에 알린다(대체 입력 모드면 손 입력을 쓰지 않으므로 안내 없음)
      if (this.store.state.inputMode === 'camera' && this.handTracker.status !== 'loading' && !this.handNote) this.handNote = `손 추적을 시작하지 못했어요 (${why}) — 마우스·터치로 만져 주세요`;
      return;
    }
    this.handNote = '';
    if (this.video.srcObject !== this.camera.stream) this.video.srcObject = this.camera.stream;
    void this.video.play().catch(() => undefined);
    this.handPipeline.start(this.video);
    this.log('손 추적 시작');
  }

  /** 카메라와 얼굴 인식을 모두 끈다 (SPEC: MediaStreamTrack.stop + FaceLandmarker.close) */
  releaseCamera(): void {
    this.handPipeline.stop();
    this.handTracker.close();
    this.pipeline.stop();
    this.tracker.close();
    this.camera.release();
    this.video.srcObject = null;
    this.store.set({ faceDetected: false });
    this.log('카메라 해제');
  }

  /** 대체 입력(마우스·키보드·터치) 모드로 전환 */
  useFallbackMode(): void {
    this.releaseCamera();
    this.hub.setMode('fallback');
    this.store.set({ inputMode: 'fallback', busyMessage: null });
    this.log('대체 입력 모드');
  }

  /** MOCHI_TOUCH의 "다시 하기": 권한 프롬프트 없이 재취득을 시도한다. 성공하면 true. */
  async reacquireSilently(): Promise<boolean> {
    if (this.store.state.inputMode === 'fallback') return true; // 대체 입력은 스트림이 필요 없다
    const perm = await this.camera.queryPermission();
    if (perm === 'denied') return false;
    if (perm === 'prompt') return false; // 프롬프트가 뜰 상황 → PERMISSION 화면을 거친다
    // 'granted'이거나 알 수 없는 경우(Safari 등): 이전에 허용한 기록이 있을 때만 조용히 시도
    if (perm === 'unknown' && this.store.state.permission !== 'granted') return false;
    return this.startCamera();
  }

  // ------------------------------------------------------------------ 이동에 따른 부수 효과
  private onTransition(from: State, to: State, _ev: Event | 'dev'): void {
    // 웹캠: TITLE 이동 때 해제. 모찌 단계(MOCHI_INTRO)에서는 얼굴 분석만 해제하고, 손 입력을 쓸 수 있으면 웹캠 스트림은 TOUCH 종료까지 유지한다.
    if (to === 'TITLE') {
      if (this.camera.status !== 'idle' || this.pipeline.isRunning || this.tracker.isReady() || this.handTracker.isReady()) this.releaseCamera();
    } else if (to === 'MOCHI_INTRO') {
      this.enterMochiCamera();
    }
    if (to === 'PLAYING' && !device.mobile && this.store.state.inputMode === 'camera' && !this.handModelPrefetched) {
      // 손 모델(약 7.8MB)을 플레이 중에 미리 받아 두어 MOCHI_INTRO의 준비 시간을 줄인다(브라우저 캐시에만 올린다)
      this.handModelPrefetched = true;
      void fetch(assetUrl(VISION_ASSETS.HAND_MODEL), { cache: 'force-cache' }).then((r) => r.arrayBuffer()).catch(() => undefined);
    }
    if (to === 'PLAYING' || to === 'TITLE') this.handNote = ''; // 새 라운드/처음으로: 이전 실패 안내를 지운다(모찌 화면 사이에서는 유지)
    if (from === 'MOCHI_TOUCH' && to !== 'MOCHI_TOUCH') {
      // TOUCH를 떠나면(다시 하기 등) 손 추적을 끈다. 웹캠은 다음 화면이 필요하면 재사용한다(startCamera는 켜진 스트림을 재사용)
      this.handPipeline.stop();
      this.handTracker.close();
    }
    if (to === 'MOCHI_TOUCH') this.startHands();
    if (to === 'TITLE') {
      this.store.resetRound();
    }
    if (from === 'RESULT' && to === 'PLAYING') {
      this.store.set({ lastResult: null }); // 다시하기: 스트림·보정값은 그대로 재사용
    }
    if (to === 'PLAYING' && from !== 'PAUSED') {
      this.store.set({ lastResult: null, roundResult: null, stretchedOnce: false });
    }
    // 얼굴이 이미 사라진 채로 PLAYING에 들어오면 곧바로 일시정지한다.
    // (faceLost 이벤트는 사라지는 순간 한 번만 발생하므로, 진입 시점의 상태를 직접 확인해야 한다)
    if (to === 'PLAYING' && from !== 'PAUSED' && this.store.state.inputMode === 'camera' && this.pipeline.faceIsLost) {
      queueMicrotask(() => {
        if (this.machine.state === 'PLAYING') this.machine.send('faceLost');
      });
    }
  }

  // ------------------------------------------------------------------ 보정
  /** 보정 결과를 저장하고 파이프라인에 적용한다 */
  applyCalibration(cal: Calibration): void {
    this.store.set({ calibration: cal });
    this.detector.setCalibration(cal);
    this.log(`보정 적용: closed=${cal.closedBase.toFixed(3)} open=${cal.openMax.toFixed(3)}`);
  }

  computeAndApplyCalibration(closed: number[], open: number[]): ReturnType<typeof computeCalibration> {
    const r = computeCalibration(closed, open);
    if (r.ok) this.applyCalibration(r.cal);
    return r;
  }

  /** 보정 건너뛰기: 기본값 사용 */
  skipCalibration(): void {
    this.applyCalibration(DEFAULT_CALIBRATION);
  }

  // ------------------------------------------------------------------ 편의
  send(ev: Event): boolean {
    return this.machine.send(ev);
  }
}

export { CALIBRATION, FLOW };
export type { CameraErrorKind };
