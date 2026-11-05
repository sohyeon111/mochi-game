// 시간·임계값·크기 등 매직 넘버는 이 파일에 모은다. (조정은 여기서만)

/** 논리 해상도 (16:9). 입 좌표·충돌·소프트바디는 모두 이 좌표계를 쓴다. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** 입 열림/닫힘 판정 (SPEC 5장) */
export const MOUTH = {
  /** openness가 이 값을 넘으면 열림 */
  OPEN_ON: 0.6,
  /** openness가 이 값 아래로 내려가면 닫힘 (히스테리시스) */
  OPEN_OFF: 0.35,
  /** 상태가 바뀐 뒤 이 시간 동안은 다시 바뀌지 않는다 */
  MIN_HOLD_MS: 80,
  /** 지수이동평균 시간 상수 (작을수록 빠르게 반응) */
  EMA_TAU_MS: 60,
  /** 얼굴이 이 시간 이상 안 보이면 faceLost */
  FACE_LOST_MS: 500,
  /** 얼굴이 다시 이 시간 이상 안정적으로 보이면 faceBack */
  FACE_BACK_MS: 200,
} as const;

/** Canvas 텍스트용 폰트 스택(CSS의 --font-main과 같은 순서). 폰트 로드 완료 후 그린다 */
export const FONT_FAMILY = "'Jalnan2', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

/** 보정 (CALIBRATION) */
export const CALIBRATION = {
  /** 입 다물기 측정 시간 */
  CLOSED_MS: 2000,
  /** 입 벌리기 측정 시간 */
  OPEN_MS: 2000,
  /** 한 단계가 끝난 뒤 "좋아요"를 보여 주고 다음 단계 안내로 넘어가기 전의 짧은 쉼 */
  SETTLE_MS: 700,
  /** 입 다물기 단계에서 이 값 미만이어야 측정이 진행된다(jawOpen 원시값) */
  CLOSED_GATE: 0.15,
  /** 조건을 계속 못 맞출 때 이 시간이 지나면 측정을 마치고 결과(실패 포함)를 보여 준다 */
  MAX_WAIT_MS: 8000,
  /** 보정 건너뛰기/실패 시 쓰는 기본값 */
  DEFAULT_CLOSED: 0.02,
  DEFAULT_OPEN: 0.5,
  /** 이 이상 차이가 나야 유효한 보정 */
  MIN_RANGE: 0.15,
  /** 구간당 최소 표본 수 */
  MIN_SAMPLES: 10,
} as const;

/** 입 충돌 영역(타원) 계산 (SPEC 5장 6항) */
export const MOUTH_AREA = {
  /** 입꼬리 간 절반 거리에 곱하는 배율 */
  RX_SCALE: 1.15,
  /** 입술 안쪽 절반 높이에 곱하는 배율 */
  RY_SCALE: 1.3,
  /** 입이 열렸을 때 RY가 RX의 이 비율보다 작아지지 않게 */
  MIN_RY_RATIO: 0.45,
  /** 대체 입력(마우스/터치)의 영역 크기(논리 px) */
  FALLBACK_RX: 70,
  FALLBACK_RY: 50,
} as const;

/** 입술 랜드마크 인덱스 (MediaPipe FaceLandmarker 478점) */
export const LIP = {
  UPPER_INNER: 13,
  LOWER_INNER: 14,
  CORNER_LEFT: 78,
  CORNER_RIGHT: 308,
} as const;

/** FaceLandmarker 리소스 (상대경로: GitHub Pages 하위 경로에서도 동작) */
export const VISION_ASSETS = {
  WASM_DIR: 'mediapipe/wasm',
  MODEL: 'mediapipe/face_landmarker.task',
  /** 얼굴 분석 Worker(classic)와 그것이 읽는 번들 */
  WORKER: 'mediapipe/face-worker.js',
  BUNDLE: 'mediapipe/vision_bundle.js',
  /** Worker로 보내는 영상의 가로 상한(px): 모델 입력은 이보다 훨씬 작아 정확도 영향 없이 전송·업로드 비용만 줄인다 */
  WORKER_FRAME_MAX_W: 640,
  WORKER_INIT_TIMEOUT_MS: 30000,
  /** 손 분석(HandLandmarker) 모델과 Worker(classic) */
  HAND_MODEL: 'mediapipe/hand_landmarker.task',
  HAND_WORKER: 'mediapipe/hand-worker.js',
} as const;

/**
 * 손가락 입력(MOCHI_TOUCH): 정면 웹캠의 손가락 끝을 찹쌀떡 접촉점으로 쓴다. 손바닥은 접촉점으로 쓰지 않는다(기준 위치 계산에만 사용).
 * 단안 카메라는 깊이를 알 수 없으므로 "찹쌀떡 위에 있음 + 손가락 굽힘 + 움직임 + 머문 시간"을 조합해 누르기를 추정한다.
 */
export const HAND = {
  /** 손 인식 신뢰도 하한(handedness 점수). 미만이면 손이 없는 것으로 본다 */
  MIN_SCORE: 0.5,
  /** 인식이 끊겨도 이 시간(ms)까지는 마지막 위치를 유지하며 눌림을 서서히 푼다(찹쌀떡이 튀지 않게) */
  LOST_GRACE_MS: 180,
  /** 이 시간 넘게 새 결과가 없으면 모든 접촉을 해제한다(워치독) */
  STALE_MS: 300,
  /** 위치 스무딩(지수 평균): 느릴 때 강하게(떨림 제거), 빠를 때 약하게(지연 감소) */
  SMOOTH_MIN: 0.32,
  SMOOTH_MAX: 0.85,
  SMOOTH_SPEED_PX_S: 1800,
  /** 속도 스무딩과 상한(px/s) */
  VEL_SMOOTH: 0.35,
  VEL_MAX: 1600,
  /** 손가락 끝이 찹쌀떡 외곽에서 이 거리(px) 안이면 "위에 있음" */
  OVER_MARGIN_PX: 14,
  /** 위에 머문 시간(ms)이 이 값을 넘어야 접촉이 시작된다(스치기·오인식 방지). 접촉의 필수 조건은 이것(위에 있음 + 머묾)뿐이다 */
  DWELL_MS: 140,
  /** 접촉이 시작될 때의 기본 눌림 정도(0~1): 손가락을 얹고 머물기만 해도 작은 눌림이 생긴다. 굽힘·속도는 여기에 더해지는 강도 보조 */
  CONTACT_BASE: 0.38,
  /** 이동 속도가 강도에 더하는 비중(이 속도 범위는 MOTION_V0~V1)과 굽힘이 더하는 비중 */
  SPEED_BOOST: 0.35,
  /** 굽힘 기반 누르기: 기준 굽힘(기본 펴진 상태, 천천히 적응) 대비 증가분 */
  FLEX_DEAD: 0.08,
  FLEX_RANGE: 0.35,
  FLEX_BASE_RATE: 0.02,
  /** 굽힘이 기준보다 줄어들 때(펴질 때) 기준이 따라가는 비율(프레임당) */
  FLEX_BASE_FALL: 0.3,
  /** 이동 속도(px/s) 범위: V0 이하는 가만히, V1 이상은 최대 주무르기 강도 */
  MOTION_V0: 90,
  MOTION_V1: 520,
  /** 눌림 정도의 오르내림 시간 상수(ms)와 접촉 켜짐/꺼짐 임계(히스테리시스) */
  PRESS_RISE_MS: 90,
  PRESS_FALL_MS: 150,
  ON_THRESHOLD: 0.12,
  OFF_THRESHOLD: 0.06,
  /** 이만큼 많은 손가락이 거의 다 굽으면(주먹) 접촉 없음: 손바닥·주먹이 눌림으로 오인되는 것을 막는다 */
  FIST_FLEX: 0.75,
  FIST_COUNT: 4,
  /** 접촉점 위치를 속도로 앞당겨 쓰는 최대 시간(ms): 검출 주기(약 30Hz) 사이를 메운다 */
  EXTRAPOLATE_MS: 50,
} as const;

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
/** MediaPipe 손 랜드마크 인덱스: [끝, DIP/IP, PIP/MCP-쪽 관절, MCP] (엄지는 IP·MCP·CMC) */
export const HAND_LM = {
  WRIST: 0,
  TIPS: [4, 8, 12, 16, 20],
  /** 굽힘 각도 계산에 쓰는 [근위 관절, 중간 관절, 끝] 인덱스 */
  JOINTS: [[2, 3, 4], [5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]],
  PALM: [0, 5, 9, 13, 17],
} as const;

/** 화면 흐름 보조 시간 */
export const FLOW = {
  MOCHI_INTRO_MS: 2500,
  CALIBRATION_DONE_MS: 900,
} as const;

/** 게임 규칙 (SPEC 7.2) — 규칙 값은 변경 금지, 아래 "밸런스" 값은 플레이 테스트로 조정 */
export const GAME = {
  // ----- 규칙 (변경 금지) -----
  DURATION_MS: 20_000,
  TARGET_FRUITS: 10,
  /** 쓰레기 이 횟수째 획득 시 즉시 실패 (허용은 2개) */
  TRASH_FAIL_COUNT: 3,
  /** 남은 시간이 이 초 이하가 되면 5,4,3,2,1 카운트다운 */
  COUNTDOWN_FROM: 5,

  // ----- 밸런스 (조정 가능) -----
  /** 한 프레임에서 시간으로 인정하는 최대 길이. 탭 전환·긴 멈춤으로 시간이 한꺼번에 사라지는 것을 막는다 */
  MAX_FRAME_DT_MS: 100,
  /** 생성 간격(ms) 범위 */
  SPAWN_INTERVAL_MS: [420, 760] as readonly [number, number],
  /** 재료:쓰레기 출현 비율 (약 7:3) */
  FRUIT_RATIO: 0.7,
  /** 20초 동안 최소 이만큼의 과일이 나오도록 보장 (SPEC: 예 15개 이상) */
  MIN_GUARANTEED_FRUITS: 15,
  /** 위 보장 개수를 이 시간 비율까지 채운다 */
  GUARANTEE_BY: 0.85,
  /** 낙하 속도 범위(px/s) */
  FALL_SPEED: [190, 340] as readonly [number, number],
  /** 크기 배율 범위(에셋 기본 크기 기준) */
  SIZE_FACTOR: [0.8, 1.25] as readonly [number, number],
  /** 스테이지 1m당 px — Blender 실제 치수 비율을 그대로 반영해 에셋 기본 크기를 정한다 */
  STAGE_PX_PER_METER: 520,
  /** 좌우 흔들림 */
  SWAY_AMPLITUDE_PX: [18, 55] as readonly [number, number],
  SWAY_FREQ_HZ: [0.5, 1.3] as readonly [number, number],
  /** 흔들림에 따른 기울기(rad) 최대 */
  TILT_RAD: 0.22,
  /** 생성 x의 좌우 여백(흔들림이 화면 밖으로 나가지 않게) */
  SPAWN_MARGIN_X: 110,
  /** 화면 아래로 이만큼 벗어나면 제거 */
  OFFSCREEN_MARGIN: 140,

  // ----- 충돌 -----
  /** 전역 충돌 축소 배율(1.0 = 실루엣 그대로). 에셋별 hitScale과 곱해진다 */
  HIT_SHRINK: 1.0,
  /** 입 영역이 너무 작아 플레이가 불가능해지지 않도록 하는 충돌용 최소 반경 */
  MIN_MOUTH_RX: 34,
  MIN_MOUTH_RY: 24,

  // ----- 표시 -----
  START_BANNER_MS: 900,
  END_BANNER_MS: 1000,
  POP_MS: 650,
  FLASH_MS: 280,
} as const;

/** 게임 오브젝트 종류 (게임 ID) */
export const FRUIT_IDS = ['strawberry', 'kiwi', 'orange', 'blueberry'] as const;
export const TRASH_IDS = ['can', 'sock', 'fishbone', 'newspaper'] as const;
export type FruitId = (typeof FRUIT_IDS)[number];
export type TrashId = (typeof TRASH_IDS)[number];
export type ItemId = FruitId | TrashId;

export const ITEM_LABELS: Record<ItemId, string> = {
  strawberry: '딸기',
  kiwi: '키위',
  orange: '오렌지',
  blueberry: '블루베리',
  can: '캔',
  sock: '양말',
  fishbone: '생선뼈',
  newspaper: '신문지',
};

export const RENDER_ASSET_DIR = 'assets/render';

/** 찹쌀떡 인터랙션 (SPEC 7.4, 7.5). 좌표는 모두 논리 좌표(1280×720) px */
export const MOCHI = {
  // ----- 손가락 접촉(손 입력): 마우스 누르기보다 작고 여러 개 -----
  FINGER_SIGMA_RATIO: 0.085,
  FINGER_DEPTH_RATIO: 0.075,
  FINGER_STIFFNESS: 0.3,
  /** 손가락이 표면 안쪽으로 파고든 깊이(px)가 눌림에 더하는 비율(0이면 침투 효과 없음) */
  FINGER_PEN_GAIN: 0.55,
  /** 손가락 이동을 윤곽에 전달하는 반경(기본 폭 대비: 눌림 반경보다 넓다 — 안쪽을 주물러도 몸이 따라 밀린다), 전달 비율, 속도 상한(px/s) */
  FINGER_DRAG_SIGMA_RATIO: 0.25,
  FINGER_DRAG_TRANSFER: 0.55,
  FINGER_MAX_SPEED: 1400,
  /** 한 번에 처리하는 접촉점 수 상한 */
  MAX_FINGERS: 5,
  // ----- 외곽 링/메시 해상도 (mochi.json 32점 링에서 런타임에 파생. 에셋은 수정하지 않는다) -----
  RING_POINTS: 48,
  /** mochi.json 원본 링 점 수(곡률 완화 횟수 등 점 간격에 의존하는 값의 기준) */
  RING_REF_POINTS: 32,
  /** 워프 메시 격자 배수(1 = mochi.json의 22×18) */
  MESH_SCALE: 32 / 21, // 22×18 → 33×27 정점(32×26칸, 짝수 칸이라 적응형 2×2 합치기가 가능)
  /** 링 밖 메시 정점의 변위 감쇠 길이(실루엣 폭 대비). 0.22(mochi.json)는 최대 당김에서 끝 쪽 셀이 겹쳤다. 0.4 이상이면 겹침 없음 */
  MESH_DECAY_RATIO: 0.6,
  /** STRETCH에서 세밀한 메시로 바꾸는 변형량(px, 최대 변위)과 되돌리는 변형량(이력). 작은 변형에서는 기본 메시와 차이가 몇 px 이하 */
  MESH_FINE_ENTER_PX: 14,
  MESH_FINE_LEAVE_PX: 8,
  /** 적응형 메시에서 기준 윤곽으로부터 이 칸 수(세밀한 셀 기준) 이내만 세밀하게 그린다 */
  MESH_BAND_CELLS: 2,
  /** 그리는 영역(링 외곽 상자)에 더하는 여유(px) */
  DIRTY_MARGIN_PX: 56,
  // ----- 소프트바디 물리 (고정 시간 간격 서브스텝) -----
  SUBSTEP_MS: 1000 / 120,
  MAX_SUBSTEPS_PER_FRAME: 10,
  /** 서브스텝마다 속도에 곱하는 감쇠(1에 가까울수록 오래 출렁임) */
  DAMPING: 0.992,
  /** 기준 형태로 돌아가려는 힘(서브스텝당 비율) — 클수록 단단하고 빠르게 복귀 */
  K_REST: 0.004,
  /** 기준 형태로 돌아가는 스프링의 ω²(1/s²). 복원은 실제 가속도로 적용해 출렁임(진동)이 살아 있다 */
  SPRING_OMEGA2: 210,
  /** 이웃 점/반대편 점 간격 유지 */
  K_EDGE: 0.4,
  K_OPPOSITE: 0.1,
  /** 면적(부피) 보존 */
  K_AREA: 0.6,
  /** 이웃 점 간격이 기준의 이 배수를 넘지 못한다(찢어짐 방지) */
  MAX_EDGE_RATIO: 1.9,
  /** 서브스텝당 점의 최대 이동(px) — 폭주 방지 */
  MAX_STEP_PX: 40,
  /** 안전 최대 늘림 길이 = (당기는 방향으로의 기본 길이) × 이 값. 방향에 상관없이 같은 비율로 판정한다 */
  MAX_EXTENT_FACTOR: 1.45,
  /** 링 점 사이 최대 거리의 안전 상한(기본 장축 대비) — 어떤 경우에도 찢어지지 않게 하는 최후 방어선 */
  MAX_MAJOR_FAILSAFE: 2.2,
  /** 이 비율(30%) 이상 늘린 적이 있으면 "유효한 늘리기" (SPEC 7.4) */
  STRETCH_COMPLETE_RATIO: 0.3,
  /** 모찌를 잡을 수 있는 영역: 실루엣 바깥으로 이만큼(논리 좌표 px) — 화면 크기·레터박스와 무관 */
  GRAB_MARGIN_PX: 24,
  /** 당김 필드(STRETCH): 반대편 0 ~ 앞쪽 끝 1 위치의 거듭제곱. 클수록 끝에 변형이 몰리고(뾰족해짐) 작을수록 몸 전체로 고르게 늘어난다 */
  GRAB_RAMP_POWER: 1.0,
  /** 잡은 쪽 옆으로 가중치가 퍼지는 폭(기본 폭 대비)과 최소값(0이면 잡은 곳만 튀어나온다) */
  GRAB_LATERAL_SIGMA_RATIO: 1.0,
  GRAB_LATERAL_FLOOR: 0.72,
  /** 늘어난 만큼 옆 폭을 줄이는 정도(1이면 부피 보존에 가까운 완전 수축, 작으면 덜 가늘어짐) */
  GRAB_NECK: 1.0,
  /** 당기는 동안 윤곽 곡률을 완화하는 정도(0이면 없음). 클수록 끝이 둥글어지지만 늘어나는 맛이 줄어든다 */
  GRAB_SMOOTH: 0.3,
  /** STRETCH 렌더링에서 메시 정점 변위를 이웃끼리 평균내는 횟수(0이면 없음). 늘어난 셀 사이의 꺾임을 줄인다 */
  STRETCH_MESH_SMOOTH_PASSES: 2,
  GRAB_STIFFNESS: 0.5,
  /** 놓은 뒤 당김이 풀리는 감쇠 스프링: 각진동수(rad/s)와 감쇠비. ζ≈0.45면 한 번 지나쳤다가(약 20%) 돌아온다 */
  GRAB_RELEASE_OMEGA: 14,
  GRAB_RELEASE_ZETA: 0.45,
  /** 당기는 거리 상한 = (안전 최대 − 기본 길이) × 이 값. 1이면 끝이 안전 최대 길이를 넘지 않는다 */
  GRAB_REACH_FACTOR: 1.15,
  /** STRETCH에서 바닥(아래쪽 이 비율)을 책상에 붙여 둔다 */
  PIN_BAND: 0.16,
  PIN_MULTIPLIER: 45,
  // ----- 누르기(TOUCH) -----
  PRESS_SIGMA_RATIO: 0.3,
  /** 눌림 깊이(기본 폭 대비)와 올라가는/내려가는 속도(1/초) */
  PRESS_DEPTH_RATIO: 0.1,
  PRESS_RISE_PER_S: 9,
  PRESS_STIFFNESS: 0.3,
  /** 누르는 동안 포인터를 따라 움직이는 속도 전달 비율 */
  PRESS_DRAG_TRANSFER: 0.35,
  // ----- 등장(INTRO) -----
  GRAVITY_PX_S2: 3400,
  INTRO_RESTITUTION: 0.42,
  INTRO_START_ABOVE_PX: 380,
  INTRO_MIN_MS: 1800,
  INTRO_MAX_MS: 3500,
  /** 바닥 접촉 반발(각 점) */
  GROUND_RESTITUTION: 0.25,
  // ----- 배치(논리 좌표) -----
  FRONT_SCALE: 0.44,
  FRONT_CENTER_X: 640,
  FRONT_GROUND_Y: 590,
  /** 화면 위쪽 여백(늘릴 때 화면 밖으로 나가지 않게) */
  TOP_MARGIN_PX: 24,
  // ----- 렌더링 품질(프레임 저하 시 단계적으로 낮춘다) -----
  /** 목표 프레임 시간(ms). 이보다 오래 걸리면 품질을 낮춘다 */
  QUALITY_SLOW_MS: 20,
  /** 한 단계 올렸을 때의 예상 작업 시간(ms)이 이 값 이하이면 품질을 올릴 수 있다. 프레임 간격(vsync 16.7ms)은 여유의 기준이 될 수 없어 작업 시간으로 판단한다 */
  QUALITY_UP_BUDGET_MS: 7,
  QUALITY_DOWN_FRAMES: 24,
  QUALITY_UP_FRAMES: 180,
} as const;
