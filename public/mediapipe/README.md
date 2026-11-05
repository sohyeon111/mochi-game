# public/mediapipe — MediaPipe 리소스(자체 호스팅)

| 파일 | 설명 | 출처 |
|---|---|---|
| `face_landmarker.task` | 얼굴 랜드마크 + blendshape 모델 | MediaPipe 공식 모델 |
| `hand_landmarker.task` | 손 랜드마크 모델(손 검출 + 21점), 약 7.8MB, sha256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` (2026-11-05 다운로드) |
| `face-worker.js`, `hand-worker.js` | 분석 전용 Web Worker(classic) | 이 프로젝트 |
| `vision_bundle.js`, `wasm/` | `@mediapipe/tasks-vision`에서 `npm run copy:mediapipe`가 복사(Git 제외) | npm 패키지 |

모델 파일의 라이선스·이용 조건은 MediaPipe 모델 카드를 확인해야 하며, 확인된 것으로 기록하지 않는다.
