import { describe, expect, it, vi } from 'vitest';
import { CAMERA_MESSAGES, CameraSession, classifyCameraError, type MediaDevicesLike } from '../src/vision/camera';

function fakeTrack() {
  const listeners: Record<string, Array<() => void>> = {};
  const t = {
    readyState: 'live' as 'live' | 'ended',
    stop: vi.fn(() => { t.readyState = 'ended'; }),
    addEventListener: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn); },
    getSettings: () => ({ width: 1280, height: 720 }),
    label: '가짜 카메라',
    fire: (ev: string) => listeners[ev]?.forEach((f) => f()),
  };
  return t;
}

function fakeStream(track = fakeTrack()) {
  return { stream: { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream, track };
}

describe('카메라 오류 분류', () => {
  it('브라우저 오류 이름을 사용자 안내 종류로 바꾼다', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('denied');
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('denied');
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('notfound');
    expect(classifyCameraError({ name: 'OverconstrainedError' })).toBe('notfound');
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('inuse');
    expect(classifyCameraError({ name: 'Weird' })).toBe('unknown');
    expect(classifyCameraError(null)).toBe('unknown');
  });
  it('모든 종류에 안내 문구가 있다', () => {
    for (const k of ['denied', 'notfound', 'inuse', 'insecure', 'unsupported', 'unknown'] as const) {
      expect(CAMERA_MESSAGES[k].length).toBeGreaterThan(5);
    }
  });
});

describe('CameraSession', () => {
  it('허용되면 active가 되고 audio는 요청하지 않는다', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async (_c: MediaStreamConstraints) => stream);
    const cam = new CameraSession({ mediaDevices: { getUserMedia } });
    const r = await cam.acquire();
    expect(r).toEqual({ ok: true, reused: false });
    expect(cam.status).toBe('active');
    expect(cam.isActive()).toBe(true);
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({ audio: false });
  });

  it('이미 켜져 있으면 getUserMedia를 다시 호출하지 않는다 (권한 재요청 방지)', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    const cam = new CameraSession({ mediaDevices: { getUserMedia } });
    await cam.acquire();
    const again = await cam.acquire();
    expect(again).toEqual({ ok: true, reused: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(cam.acquireCalls).toBe(1);
  });

  it('release 하면 모든 트랙을 멈추고 idle이 된다', async () => {
    const { stream, track } = fakeStream();
    const cam = new CameraSession({ mediaDevices: { getUserMedia: async () => stream } });
    await cam.acquire();
    cam.release();
    expect(track.stop).toHaveBeenCalled();
    expect(cam.status).toBe('idle');
    expect(cam.isActive()).toBe(false);
    expect(cam.stream).toBeNull();
  });

  it('해제 뒤에는 다시 getUserMedia를 호출해 재취득한다', async () => {
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const cam = new CameraSession({ mediaDevices: { getUserMedia } });
    await cam.acquire();
    cam.release();
    await cam.acquire();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('권한 거부 → denied 오류 상태', async () => {
    const getUserMedia = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); });
    const cam = new CameraSession({ mediaDevices: { getUserMedia } });
    const r = await cam.acquire();
    expect(r).toEqual({ ok: false, kind: 'denied' });
    expect(cam.status).toBe('error');
    expect(cam.error).toBe('denied');
  });

  it('카메라 없음 / 사용 중 구분', async () => {
    const make = (name: string) => new CameraSession({ mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error(), { name }); } } });
    expect((await make('NotFoundError').acquire())).toEqual({ ok: false, kind: 'notfound' });
    expect((await make('NotReadableError').acquire())).toEqual({ ok: false, kind: 'inuse' });
  });

  it('보안 연결이 아니면 insecure, mediaDevices가 없으면 unsupported', async () => {
    expect(await new CameraSession({ isSecureContext: false, mediaDevices: { getUserMedia: async () => fakeStream().stream } }).acquire()).toEqual({ ok: false, kind: 'insecure' });
    expect(await new CameraSession({ mediaDevices: undefined }).acquire()).toEqual({ ok: false, kind: 'unsupported' });
  });

  it('사용 중 다른 프로그램이 트랙을 끊으면(ended) 오류 상태가 된다', async () => {
    const { stream, track } = fakeStream();
    const cam = new CameraSession({ mediaDevices: { getUserMedia: async () => stream } as MediaDevicesLike });
    await cam.acquire();
    const changed = vi.fn();
    cam.onChange(changed);
    track.readyState = 'ended';
    track.fire('ended');
    expect(cam.status).toBe('error');
    expect(cam.error).toBe('inuse');
    expect(changed).toHaveBeenCalled();
  });

  it('권한 조회: 없으면 unknown, 실패해도 unknown', async () => {
    expect(await new CameraSession({}).queryPermission()).toBe('unknown');
    expect(await new CameraSession({ queryPermission: async () => { throw new Error('x'); } }).queryPermission()).toBe('unknown');
    expect(await new CameraSession({ queryPermission: async () => 'granted' }).queryPermission()).toBe('granted');
  });
});
