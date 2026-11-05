/** vision → game 으로만 흘러가는 입 입력. 카메라 입력과 대체 입력(마우스/키보드/터치)이 같은 형태를 만든다. */
export interface MouthInput {
  /** 입이 열린 상태(히스테리시스·최소 유지 시간 적용 후) */
  isOpen: boolean;
  /** 0(다묾)~1(최대로 벌림) 정규화된 열림 정도 */
  openness: number;
  /** 입 중심 (논리 좌표 1280×720, 좌우 반전 적용됨) */
  center: { x: number; y: number };
  radiusX: number;
  radiusY: number;
  /** 얼굴(카메라) 또는 포인터(대체 입력)가 인식되고 있는지 */
  faceDetected: boolean;
  timestamp: number;
  source: 'camera' | 'fallback';
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Calibration {
  /** 입을 다물었을 때의 jawOpen */
  closedBase: number;
  /** 입을 크게 벌렸을 때의 jawOpen */
  openMax: number;
}

/** FaceLandmarker 한 프레임의 원시 결과 */
export interface RawFace {
  found: boolean;
  /** blendshape jawOpen (0~1) */
  jawOpen: number;
  /** 정규화된(0~1) 랜드마크. found일 때만 의미가 있다. */
  landmarks: Point[];
}

/** 손 분석 한 프레임의 원시 결과(게임에 필요한 값만). 좌표는 영상 기준 정규화(0~1), 좌우 반전 전 */
export interface RawHand {
  found: boolean;
  /** 손 인식 신뢰도(0~1) */
  score: number;
  /** 손가락 끝 [x0,y0, x1,y1, ...] 엄지·검지·중지·약지·새끼 순서 */
  tips: Float32Array;
  /** 손가락별 굽힘(0 펴짐 ~ 1 굽음) */
  flex: Float32Array;
  /** 손바닥 기준점(상대 위치 계산용, 접촉점이 아님) */
  palm: { x: number; y: number };
  /** 손 크기(손목~중지 MCP, 영상 가로 대비) */
  scale: number;
  /** 개발용 디버그: 21개 랜드마크 [x,y,z]×21 (요청했을 때만) */
  full?: Float32Array | null;
}
