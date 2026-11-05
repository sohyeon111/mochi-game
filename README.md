# Mochi Game

웹캠과 얼굴 인식(MediaPipe)으로 입을 벌려 과일 재료를 모으고, 완성된 찹쌀떡을 늘리고 만지는 웹 미니게임.

- 기획/규칙: [SPEC.md](./SPEC.md)
- 개발 가이드: [CLAUDE.md](./CLAUDE.md)
- 디자인 가이드: [design/DESIGN_GUIDE.md](./design/DESIGN_GUIDE.md)

## 개발
```
npm install
npm run dev      # 개발 서버 (http://localhost:5173). 실행 전에 MediaPipe wasm을 public/mediapipe/wasm 으로 복사한다
npm test         # 단위 테스트
npm run build    # 프로덕션 빌드(타입 검사 포함)
```
`main`에 푸시하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 수행한다.

## 현재 단계: 찹쌀떡 체험 정면 통일·보정 UX·폰트(Jalnan 2)·TITLE 표지 적용 (효과음은 아직 없음)
- 입을 벌려 떨어지는 과일(딸기·키위·오렌지·블루베리)을 먹고, 쓰레기(캔·양말·생선뼈·신문지)를 피하는 20초 게임. 과일 10개 성공, 쓰레기 3번째 즉시 실패.
- 개발 패널의 `충돌 형상 표시(C)`로 충돌 원을 볼 수 있고, `강제 성공/실패`로 결과 화면을 바로 확인할 수 있다.
- 브라우저에서 직접 확인하기: `npm run dev` 후 접속 → **카메라 허용하기**. 화면 왼쪽 아래 **DEV 패널**(F2로 접기/펼치기)에 카메라 상태, FPS, jawOpen, 입 위치·열림이 실시간으로 표시되고, 화면 이동 버튼으로 모든 화면을 직접 이동해 볼 수 있다.
- 카메라가 없거나 거부해도 **마우스(누르는 동안 입 열림)·Space·터치**로 진행할 수 있다.
- 카메라 영상과 얼굴 데이터는 브라우저 안에서만 처리되며 저장·전송하지 않는다.

## 얼굴 인식 리소스
- 모델 `public/mediapipe/face_landmarker.task` (Google MediaPipe Face Landmarker, float16, Apache-2.0, 약 3.7MB)
  - 출처: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- wasm `public/mediapipe/wasm/` 는 `@mediapipe/tasks-vision` 패키지에서 복사한다(`npm run copy:mediapipe`, dev/build 전에 자동). 용량이 커서 Git에는 올리지 않는다.
- 런타임에 외부 CDN을 사용하지 않는다.
