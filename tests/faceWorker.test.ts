// 얼굴 분석 Worker 보조 로직: 결과 변환과 전송 프레임 크기
import { describe, expect, it } from 'vitest';
import { LIP, VISION_ASSETS } from '../src/app/constants';
import { mouthAreaFromLandmarks } from '../src/vision/mouthPosition';
import { rawFaceFromWorker, workerFrameSize } from '../src/vision/faceTracker';

describe('rawFaceFromWorker', () => {
  it('얼굴이 없으면 found=false, 랜드마크 없음', () => {
    expect(rawFaceFromWorker(false, 0.7, [0, 0, 0, 0, 0, 0, 0, 0])).toEqual({ found: false, jawOpen: 0, landmarks: [] });
  });

  it('입 판정에 쓰는 4점을 LIP 인덱스에 채워, 전체 랜드마크로 만든 것과 같은 입 영역을 낸다', () => {
    const pts = [0.5, 0.55, 0.5, 0.65, 0.42, 0.6, 0.58, 0.6]; // 윗입술, 아랫입술, 왼쪽 입꼬리, 오른쪽 입꼬리
    const raw = rawFaceFromWorker(true, 0.6, pts);
    expect(raw.found).toBe(true);
    expect(raw.jawOpen).toBe(0.6);
    expect(raw.landmarks[LIP.UPPER_INNER]).toEqual({ x: 0.5, y: 0.55 });
    expect(raw.landmarks[LIP.CORNER_RIGHT]).toEqual({ x: 0.58, y: 0.6 });
    // 478점 전체 배열로 만든 경우와 같은 결과
    const full = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    full[LIP.UPPER_INNER] = { x: 0.5, y: 0.55 };
    full[LIP.LOWER_INNER] = { x: 0.5, y: 0.65 };
    full[LIP.CORNER_LEFT] = { x: 0.42, y: 0.6 };
    full[LIP.CORNER_RIGHT] = { x: 0.58, y: 0.6 };
    const a = mouthAreaFromLandmarks(raw.landmarks, { w: 1280, h: 720 }, 0.8);
    const b = mouthAreaFromLandmarks(full, { w: 1280, h: 720 }, 0.8);
    expect(a).toEqual(b);
  });
});

describe('workerFrameSize', () => {
  it('가로 상한 이하면 그대로, 넘으면 비율을 유지해 줄인다', () => {
    expect(workerFrameSize(640, 480, 640)).toEqual({ w: 640, h: 480 });
    expect(workerFrameSize(1280, 720, 640)).toEqual({ w: 640, h: 360 });
    expect(workerFrameSize(1920, 1080, VISION_ASSETS.WORKER_FRAME_MAX_W)).toEqual({ w: 640, h: 360 });
    expect(workerFrameSize(300, 200, 640)).toEqual({ w: 300, h: 200 });
  });
});
