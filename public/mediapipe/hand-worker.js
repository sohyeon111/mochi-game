// HandLandmarker 전용 Web Worker(classic). 얼굴 분석 Worker(face-worker.js)와 독립적으로 동작한다.
// 메시지:
//   → {type:'init', wasmBase, modelUrl, joints:[[a,b,c]x5], tips:[5], palm:[5]}   ← {type:'ready'} | {type:'initError', message}
//   → {type:'frame', id, bitmap, ts, full}   ← {type:'result', id, found, score, data:Float32Array(18), lm?:Float32Array(63), ms} | {type:'frameError', id, message}
//   → {type:'close'}
// data = [손가락 끝 x,y ×5 (정규화 0~1)] + [굽힘 ×5 (0 펴짐 ~ 1 완전히 굽음)] + [손바닥 기준점 x,y] + [손 크기]
// 21개 랜드마크 전체(lm)는 개발용 디버그(full=true)일 때만 보낸다. 손바닥 기준점은 상대 위치 계산용이며 접촉점이 아니다.
importScripts('./vision_bundle.js');

let landmarker = null;
let cfg = null;
let fileset = null;
let makeLandmarker = null;
let delegateUsed = '';

// 세 관절(a,b,c)에서 b의 굽힘: 일직선이면 0, 많이 접히면 1. 영상 비율을 반영한 3D 각도(z는 x와 같은 스케일)
function bend(lm, j, w, h) {
  const a = lm[j[0]], b = lm[j[1]], c = lm[j[2]];
  const ux = (a.x - b.x) * w, uy = (a.y - b.y) * h, uz = (a.z - b.z) * w;
  const vx = (c.x - b.x) * w, vy = (c.y - b.y) * h, vz = (c.z - b.z) * w;
  const du = Math.hypot(ux, uy, uz), dv = Math.hypot(vx, vy, vz);
  if (du < 1e-6 || dv < 1e-6) return 0;
  let cos = (ux * vx + uy * vy + uz * vz) / (du * dv);
  cos = Math.max(-1, Math.min(1, cos));
  const angle = Math.acos(cos); // π = 일직선
  return Math.max(0, Math.min(1, (Math.PI - angle) / (0.55 * Math.PI)));
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      cfg = { joints: m.joints, tips: m.tips, palm: m.palm };
      fileset = await Vision.FilesetResolver.forVisionTasks(m.wasmBase);
      const make = (delegate) =>
        Vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: m.modelUrl, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      makeLandmarker = make;
      // 기본: GPU 먼저, 실패하면 CPU. m.delegate가 'CPU'이면 처음부터 CPU(개발용 비교)
      if (m.delegate === 'CPU') {
        landmarker = await make('CPU');
        delegateUsed = 'CPU';
      } else {
        try {
          landmarker = await make('GPU');
          delegateUsed = 'GPU';
        } catch (gpuErr) {
          landmarker = await make('CPU');
          delegateUsed = 'CPU';
        }
      }
      self.postMessage({ type: 'ready', delegate: delegateUsed });
    } else if (m.type === 'frame') {
      const t0 = performance.now();
      let r;
      try {
        r = landmarker.detectForVideo(m.bitmap, m.ts);
      } finally {
        var w = m.bitmap.width, h = m.bitmap.height;
        m.bitmap.close();
      }
      const lm = r.landmarks && r.landmarks[0];
      const data = new Float32Array(18);
      let found = false, score = 0, full = null;
      if (lm && lm.length >= 21) {
        found = true;
        const cat = r.handedness && r.handedness[0] && r.handedness[0][0];
        score = cat ? cat.score : 0;
        for (let i = 0; i < 5; i++) {
          const t = lm[cfg.tips[i]];
          data[i * 2] = t.x; data[i * 2 + 1] = t.y;
          data[10 + i] = bend(lm, cfg.joints[i], w, h);
        }
        let px = 0, py = 0;
        for (let i = 0; i < 5; i++) { px += lm[cfg.palm[i]].x; py += lm[cfg.palm[i]].y; }
        data[15] = px / 5; data[16] = py / 5;
        data[17] = Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h) / w; // 손목~중지 MCP 길이(영상 가로 대비)
        if (m.full) {
          full = new Float32Array(63);
          for (let i = 0; i < 21; i++) { full[i * 3] = lm[i].x; full[i * 3 + 1] = lm[i].y; full[i * 3 + 2] = lm[i].z; }
        }
      }
      const transfer = [data.buffer];
      if (full) transfer.push(full.buffer);
      self.postMessage({ type: 'result', id: m.id, found, score, data, lm: full, ms: performance.now() - t0 }, transfer);
    } else if (m.type === 'close') {
      if (landmarker) landmarker.close();
      landmarker = null;
      self.close();
    }
  } catch (err) {
    // GPU 추론이 오류를 내면 CPU로 바꿔 다음 프레임부터 다시 시도한다(GPU 드라이버 문제로 손이 전혀 안 잡히는 것을 막는다)
    if (m.type === 'frame' && delegateUsed === 'GPU' && makeLandmarker) {
      try {
        if (landmarker) landmarker.close();
        landmarker = await makeLandmarker('CPU');
        delegateUsed = 'CPU';
        self.postMessage({ type: 'delegate', delegate: 'CPU' });
      } catch (e2) { /* CPU도 실패하면 아래 오류만 보고 */ }
    }
    self.postMessage({ type: m.type === 'init' ? 'initError' : 'frameError', id: m.id, message: String((err && err.message) || err) });
  }
};
