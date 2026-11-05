// WebGL 메시 그리기: 워프 메시를 Canvas 2D의 "삼각형마다 clip + drawImage"(프레임당 약 1400번) 대신 정점/인덱스 버퍼로 한 번에 그린다.
// GPU가 삼각형마다 클립 마스크를 만들던 비용이 사라지고, 삼각형이 정점을 공유해 이음새(틈)도 생기지 않는다. 결과 화면은 Canvas 경로와 같게 유지한다:
//  - 텍스처는 같은 캔버스(막·뒷벽+과일)를 premultiplied 알파로 올리고 LINEAR 필터(Canvas drawImage의 쌍선형과 같다)
//  - 합성은 뒷벽 → 막 순서의 source-over, 눌림 그림자는 막 알파를 3번 곱한(a³) 방사형 그라데이션
// WebGL2를 못 쓰거나 컨텍스트를 잃으면 호출하는 쪽(MochiRenderer)이 기존 Canvas 경로로 대체한다.
import type { Tri } from './meshWarp';

export interface GlDent {
  x: number;
  y: number;
  /** 그라데이션 반지름(px) */
  radius: number;
  /** 가장 진한 곳의 알파(Canvas 경로의 a) */
  alpha: number;
}

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_res;
out vec2 v_uv;
out vec2 v_px;
void main() {
  v_uv = a_uv;
  v_px = a_pos;
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_tex;
uniform float u_mode;      // 0: 텍스처 그대로, 1: 눌림 그림자(막 알파로 가림)
uniform vec4 u_dents[5];   // x, y, 반지름, 알파
uniform int u_dentN;
out vec4 outColor;
void main() {
  vec4 t = texture(u_tex, v_uv);            // premultiplied
  if (u_mode < 0.5) { outColor = t; return; }
  float mask = t.a * t.a * t.a;              // Canvas 경로: destination-in으로 막 알파를 3번 곱한다(a³)
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 5; k++) {
    if (k >= u_dentN) break;
    vec4 dn = u_dents[k];
    float d = length(v_px - dn.xy) / dn.z;
    // Canvas 그라데이션(Skia는 premultiplied 보간): 0.1R에서 (150,92,84,a), 0.6R에서 (190,130,120,0.45a), R에서 알파 0
    vec4 p0 = vec4(vec3(150.0, 92.0, 84.0) / 255.0 * dn.w, dn.w);
    vec4 p1 = vec4(vec3(190.0, 130.0, 120.0) / 255.0 * (dn.w * 0.45), dn.w * 0.45);
    vec4 c;
    if (d <= 0.1) c = p0;
    else if (d <= 0.6) c = mix(p0, p1, (d - 0.1) / 0.5);
    else if (d <= 1.0) c = mix(p1, vec4(0.0), (d - 0.6) / 0.4);
    else c = vec4(0.0);
    sum = sum + c * (1.0 - sum.a); // 여러 눌림은 source-over로 겹친다
  }
  outColor = sum * mask;
}`;

interface GpuMesh {
  pos: WebGLBuffer;
  uv: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  posData: Float32Array;
  indexCache: Map<string, { buf: WebGLBuffer; count: number }>;
}

export class MeshGL {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private meshes = new Map<object, GpuMesh>();
  private texBack: WebGLTexture | null = null;
  private texSkin: WebGLTexture | null = null;
  private lost = false;

  /** WebGL2 컨텍스트를 만들지 못하면 null */
  static create(canvas: HTMLCanvasElement): MeshGL | null {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'default' });
    if (!gl) return null;
    try {
      return new MeshGL(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(private canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? '셰이더 컴파일 실패');
      return s;
    };
    const prog = gl.createProgram() as WebGLProgram;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_uv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? '링크 실패');
    this.prog = prog;
    for (const n of ['u_res', 'u_tex', 'u_mode', 'u_dents', 'u_dentN']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied source-over
    gl.disable(gl.DEPTH_TEST);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  /** 컨텍스트를 잃었는지(그러면 Canvas 경로로 대체해야 한다) */
  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /** 막·뒷벽(+과일) 텍스처를 올린다(레이어를 새로 만들 때마다). 이전 텍스처는 지운다 */
  setTextures(back: HTMLCanvasElement, skin: HTMLCanvasElement): void {
    const gl = this.gl;
    const up = (c: HTMLCanvasElement, old: WebGLTexture | null): WebGLTexture => {
      if (old) gl.deleteTexture(old);
      const t = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.texBack = up(back, this.texBack);
    this.texSkin = up(skin, this.texSkin);
    // UV는 텍스처 크기에 의존하므로 메시 버퍼를 모두 지우고 다음 그리기에서 다시 만든다
    this.disposeMeshes();
    this.uvSize = { w: back.width, h: back.height };
  }

  private disposeMeshes(): void {
    const gl = this.gl;
    for (const m of this.meshes.values()) {
      gl.deleteBuffer(m.pos);
      gl.deleteBuffer(m.uv);
      gl.deleteVertexArray(m.vao);
      for (const e of m.indexCache.values()) gl.deleteBuffer(e.buf);
    }
    this.meshes.clear();
  }

  private uvSize = { w: 1, h: 1 };

  private meshFor(key: object, restSprite: Float64Array, texScale: number): GpuMesh {
    let m = this.meshes.get(key);
    if (m) return m;
    const gl = this.gl;
    const n = restSprite.length / 2;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = ((restSprite[i * 2] as number) * texScale) / this.uvSize.w;
      uv[i * 2 + 1] = ((restSprite[i * 2 + 1] as number) * texScale) / this.uvSize.h;
    }
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, n * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    m = { pos, uv: uvBuf, vao, posData: new Float32Array(n * 2), indexCache: new Map() };
    this.meshes.set(key, m);
    return m;
  }

  private indicesFor(m: GpuMesh, id: string, tris: ReadonlyArray<Tri>): { buf: WebGLBuffer; count: number } {
    let e = m.indexCache.get(id);
    if (e) return e;
    const gl = this.gl;
    const idx = new Uint16Array(tris.length * 3);
    tris.forEach((t, i) => {
      idx[i * 3] = t[0];
      idx[i * 3 + 1] = t[1];
      idx[i * 3 + 2] = t[2];
    });
    const buf = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    e = { buf, count: idx.length };
    m.indexCache.set(id, e);
    return e;
  }

  /**
   * 한 프레임: 뒷벽(+과일) → 막 → (눌림 그림자). 정점 위치만 매 프레임 올리고 삼각형 목록(인덱스)은 id별로 캐시한다.
   * meshKey: 메시 객체(MeshWarp), restSprite: 기준 정점(스프라이트 좌표), deformed: 현재 정점(논리 좌표)
   */
  draw(meshKey: object, restSprite: Float64Array, deformed: Float64Array, texScale: number, trisId: string, tris: ReadonlyArray<Tri>, dents: ReadonlyArray<GlDent>, dentCount: number): void {
    const gl = this.gl;
    if (this.isLost || !this.texBack || !this.texSkin) return;
    const m = this.meshFor(meshKey, restSprite, texScale);
    const idx = this.indicesFor(m, trisId, tris);
    for (let i = 0; i < deformed.length; i++) m.posData[i] = deformed[i] as number;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.u_res as WebGLUniformLocation, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.u.u_tex as WebGLUniformLocation, 0);
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.posData);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx.buf);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.u.u_mode as WebGLUniformLocation, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBack);
    gl.drawElements(gl.TRIANGLES, idx.count, gl.UNSIGNED_SHORT, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texSkin);
    gl.drawElements(gl.TRIANGLES, idx.count, gl.UNSIGNED_SHORT, 0);
    if (dentCount > 0) {
      const n = Math.min(5, dentCount);
      for (let i = 0; i < n; i++) {
        const d = dents[i] as GlDent;
        this.dentBuf[i * 4] = d.x;
        this.dentBuf[i * 4 + 1] = d.y;
        this.dentBuf[i * 4 + 2] = d.radius;
        this.dentBuf[i * 4 + 3] = d.alpha;
      }
      gl.uniform1f(this.u.u_mode as WebGLUniformLocation, 1);
      gl.uniform4fv(this.u.u_dents as WebGLUniformLocation, this.dentBuf);
      gl.uniform1i(this.u.u_dentN as WebGLUniformLocation, n);
      gl.drawElements(gl.TRIANGLES, idx.count, gl.UNSIGNED_SHORT, 0); // 같은 텍스처(막)의 알파로 가린다
    }
  }

  private dentBuf = new Float32Array(20);

  /** 개발용: GPU 완료까지 기다린다(측정 전용) */
  finish(): void {
    this.gl.finish();
  }
}
