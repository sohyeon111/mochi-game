// 웹캠 스트림 수명 관리. 허용 → 시작 → 재사용 → 해제 (SPEC 6장 "웹캠 수명").
// 브라우저 객체는 주입받아 테스트할 수 있다.

export type CameraErrorKind = 'denied' | 'notfound' | 'inuse' | 'insecure' | 'unsupported' | 'unknown';
export type CameraStatus = 'idle' | 'starting' | 'active' | 'error';
export type PermissionState3 = 'granted' | 'denied' | 'prompt' | 'unknown';

/** 오류를 사용자 안내용 종류로 분류한다. */
export function classifyCameraError(e: unknown): CameraErrorKind {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'notfound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'inuse';
    default:
      return 'unknown';
  }
}

export const CAMERA_MESSAGES: Record<CameraErrorKind, string> = {
  denied: '카메라 권한이 거부되었어요. 브라우저 주소창의 카메라 설정에서 허용하거나, 마우스·키보드로 계속할 수 있어요.',
  notfound: '사용할 수 있는 카메라를 찾지 못했어요. 마우스·키보드로 계속할 수 있어요.',
  inuse: '카메라를 다른 프로그램이 사용 중이에요. 그 프로그램을 닫고 다시 시도하거나, 마우스·키보드로 계속할 수 있어요.',
  insecure: '카메라는 보안 연결(https)에서만 사용할 수 있어요. 마우스·키보드로 계속할 수 있어요.',
  unsupported: '이 브라우저는 카메라를 지원하지 않아요. 마우스·키보드로 계속할 수 있어요.',
  unknown: '카메라를 시작하지 못했어요. 다시 시도하거나, 마우스·키보드로 계속할 수 있어요.',
};

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface CameraDeps {
  mediaDevices?: MediaDevicesLike | undefined;
  /** Permissions API (없으면 'unknown') */
  queryPermission?: (() => Promise<PermissionState3>) | undefined;
  isSecureContext?: boolean;
}

export type AcquireResult = { ok: true; reused: boolean } | { ok: false; kind: CameraErrorKind };

export interface CameraSnapshot {
  status: CameraStatus;
  error: CameraErrorKind | null;
  trackCount: number;
  label: string;
  width: number;
  height: number;
}

export class CameraSession {
  private deps: CameraDeps;
  private _status: CameraStatus = 'idle';
  private _error: CameraErrorKind | null = null;
  private _stream: MediaStream | null = null;
  private listeners: Array<() => void> = [];
  /** getUserMedia를 호출한 횟수(권한 재요청 방지 검증용) */
  acquireCalls = 0;

  constructor(deps: CameraDeps) {
    this.deps = deps;
  }

  get status(): CameraStatus {
    return this._status;
  }
  get error(): CameraErrorKind | null {
    return this._error;
  }
  get stream(): MediaStream | null {
    return this._stream;
  }

  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  private set(status: CameraStatus, error: CameraErrorKind | null = null): void {
    this._status = status;
    this._error = error;
    this.emit();
  }

  /** 스트림이 켜져 있고 트랙이 살아 있는지 */
  isActive(): boolean {
    return this._status === 'active' && !!this._stream && this._stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  async queryPermission(): Promise<PermissionState3> {
    if (!this.deps.queryPermission) return 'unknown';
    try {
      return await this.deps.queryPermission();
    } catch {
      return 'unknown';
    }
  }

  /** 카메라를 켠다. 이미 켜져 있으면 getUserMedia를 다시 호출하지 않고 재사용한다. */
  async acquire(): Promise<AcquireResult> {
    if (this.isActive()) return { ok: true, reused: true };
    if (this.deps.isSecureContext === false) {
      this.set('error', 'insecure');
      return { ok: false, kind: 'insecure' };
    }
    const md = this.deps.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') {
      this.set('error', 'unsupported');
      return { ok: false, kind: 'unsupported' };
    }
    this.set('starting');
    this.acquireCalls += 1;
    try {
      const stream = await md.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      this._stream = stream;
      // 다른 프로그램이 가져가거나 장치가 빠지면 알린다
      for (const t of stream.getVideoTracks()) {
        t.addEventListener('ended', () => {
          if (this._stream === stream) {
            this._stream = null;
            this.set('error', 'inuse');
          }
        });
      }
      this.set('active');
      return { ok: true, reused: false };
    } catch (e) {
      const kind = classifyCameraError(e);
      this._stream = null;
      this.set('error', kind);
      return { ok: false, kind };
    }
  }

  /** 모든 트랙을 멈추고 스트림을 해제한다. */
  release(): void {
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
    }
    this._stream = null;
    this.set('idle');
  }

  snapshot(): CameraSnapshot {
    const track = this._stream?.getVideoTracks()[0];
    const s = track?.getSettings?.() ?? {};
    return {
      status: this._status,
      error: this._error,
      trackCount: this._stream?.getTracks().length ?? 0,
      label: track?.label ?? '',
      width: s.width ?? 0,
      height: s.height ?? 0,
    };
  }
}

/** 실제 브라우저용 의존성 */
export function browserCameraDeps(): CameraDeps {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    mediaDevices: nav?.mediaDevices,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
    queryPermission: async () => {
      const perms = nav?.permissions;
      if (!perms?.query) return 'unknown';
      const r = await perms.query({ name: 'camera' as PermissionName });
      return r.state as PermissionState3;
    },
  };
}
