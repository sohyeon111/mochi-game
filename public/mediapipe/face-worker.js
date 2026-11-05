// FaceLandmarker 전용 Web Worker(classic). 영상 분석이 메인 스레드를 막아 게임 프레임이 끊기는 것을 막는다.
// 메시지:
//   → {type:'init', wasmBase, modelUrl}            ← {type:'ready', delegate} | {type:'initError', message}
//   → {type:'frame', id, bitmap, ts, lips:[4]}     ← {type:'result', id, found, jaw, pts:Float32Array(8), ms} | {type:'frameError', id, message}
//   → {type:'close'}
// 입 판정에 필요한 랜드마크(윗·아랫 안쪽 입술, 입꼬리 2개)와 jawOpen만 돌려준다(478점 전체를 복사하지 않는다).
importScripts('./vision_bundle.js'); // 같은 폴더(public/mediapipe)의 IIFE 번들: 전역 Vision

let landmarker = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const fileset = await Vision.FilesetResolver.forVisionTasks(m.wasmBase);
      const make = (delegate) =>
        Vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: m.modelUrl, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
      let delegate = 'GPU';
      try {
        landmarker = await make('GPU');
      } catch (gpuErr) {
        delegate = 'CPU';
        landmarker = await make('CPU');
      }
      self.postMessage({ type: 'ready', delegate });
    } else if (m.type === 'frame') {
      const t0 = performance.now();
      let r;
      try {
        r = landmarker.detectForVideo(m.bitmap, m.ts);
      } finally {
        m.bitmap.close();
      }
      const lm = r.faceLandmarks && r.faceLandmarks[0];
      const pts = new Float32Array(8);
      let found = false;
      let jaw = 0;
      if (lm && lm.length > 0) {
        found = true;
        for (let i = 0; i < 4; i++) {
          const p = lm[m.lips[i]];
          pts[i * 2] = p ? p.x : 0;
          pts[i * 2 + 1] = p ? p.y : 0;
        }
        const cats = (r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories) || [];
        for (let i = 0; i < cats.length; i++) if (cats[i].categoryName === 'jawOpen') jaw = cats[i].score;
      }
      self.postMessage({ type: 'result', id: m.id, found, jaw, pts, ms: performance.now() - t0 }, [pts.buffer]);
    } else if (m.type === 'close') {
      if (landmarker) landmarker.close();
      landmarker = null;
      self.close();
    }
  } catch (err) {
    self.postMessage({ type: m.type === 'init' ? 'initError' : 'frameError', id: m.id, message: String((err && err.message) || err) });
  }
};
