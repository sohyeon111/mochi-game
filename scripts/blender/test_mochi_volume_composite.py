"""찹쌀떡 두께감·동적 과일 배치·공통 변형 테스트 합성 (테스트 전용, numpy + pillow).

MODE=A : 형태×재질 후보 비교 시트
MODE=B : 선택 설정으로 과일 개수별 동적 배치 + 변형(워프) 테스트 + 현재/개선 비교 시트
Canvas 2D에서 할 수 있는 연산만 사용한다(레이어 합성, 가우시안 흐림, 클리핑, 메시/맵 워프).
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.environ["OUT"]
MODE = os.environ.get("MODE", "A")
LAYERS = os.path.join(OUT, "layers")
COMP = os.path.join(OUT, "composites")
SHEETS = os.path.join(OUT, "sheets")
for d in (COMP, SHEETS):
    os.makedirs(d, exist_ok=True)

FONT_DIR = os.environ.get("FONT_DIR", "")
BG = {"cream": (255, 246, 234), "wood": (158, 104, 60)}
TINT = np.array([255, 236, 228], dtype=np.float32)
records = []

# ---------- 라벨용 폰트 (테스트 이미지에만 사용) ----------
_fk = _fl = None
_ck = _cl = set()
if FONT_DIR:
    from fontTools.ttLib import TTFont
    _fk = os.path.join(FONT_DIR, "jua-korean.ttf")
    _fl = os.path.join(FONT_DIR, "jua-latin.ttf")
    _ck = set(TTFont(_fk).getBestCmap().keys())
    _cl = set(TTFont(_fl).getBestCmap().keys())


def label(im, text, size=22, xy=(12, 8), color=(60, 40, 30)):
    im = im.convert("RGBA")
    dr = ImageDraw.Draw(im)
    x, y = xy
    fk = ImageFont.truetype(_fk, size) if _fk else ImageFont.load_default()
    fl = ImageFont.truetype(_fl, size) if _fl else fk
    for ch in text:
        f = fk if (ord(ch) in _ck) else (fl if ord(ch) in _cl else fk)
        dr.text((x + 1, y + 1), ch, font=f, fill=(255, 255, 255, 200))
        dr.text((x, y), ch, font=f, fill=color + (255,))
        x += dr.textlength(ch, font=f)
    return im


def load(name):
    return Image.open(os.path.join(LAYERS, name + ".png")).convert("RGBA")


def arr(im):
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a[..., :3] * 255.0, a[..., 3]


def over(dst_rgb, dst_a, src_rgb, src_a):
    out_a = src_a + dst_a * (1 - src_a)
    safe = np.where(out_a > 1e-6, out_a, 1.0)[..., None]
    out = (src_rgb * src_a[..., None] + dst_rgb * dst_a[..., None] * (1 - src_a[..., None])) / safe
    return out, out_a


def blur_rgba(im, r):
    if r <= 0:
        return im
    return im.convert("RGBa").filter(ImageFilter.GaussianBlur(r)).convert("RGBA")


def to_img(rgb, a):
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8), "RGBA")


def mochi_stack(back, skin, fruit_layer=None, mfill=0.35, back_strength=1.0):
    """투명 배경 위에 [뒷벽 → 우윳빛 채움 → 과일 → 막]을 쌓은 떡 RGBA를 돌려준다. (배경 없음)"""
    w, h = skin.size
    rgb = np.zeros((h, w, 3), np.float32)
    a = np.zeros((h, w), np.float32)
    s_rgb, s_a = arr(skin)
    sil = np.clip(np.maximum(s_a, 0) * 1.6, 0, 1)
    if back is not None:
        b_rgb, b_a = arr(back)
        rgb, a = over(rgb, a, b_rgb, b_a * back_strength)
    fill = np.empty_like(rgb)
    fill[:] = TINT
    rgb, a = over(rgb, a, fill, sil * mfill)
    if fruit_layer is not None:
        f_rgb, f_a = arr(fruit_layer)
        rgb, a = over(rgb, a, f_rgb, np.clip(f_a * sil, 0, 1))
    rgb, a = over(rgb, a, s_rgb, s_a)
    return to_img(rgb, a)


def on_bg(rgba, bg="cream"):
    base = Image.new("RGBA", rgba.size, BG[bg] + (255,))
    base.alpha_composite(rgba)
    return base


def sheet(tiles, cols, name, scale=0.5, labels=None):
    ims = []
    for i, im in enumerate(tiles):
        t = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        if labels:
            t = label(t, labels[i], size=18, xy=(8, 6))
        ims.append(t.convert("RGB"))
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", (w * cols, h * rows), (35, 30, 30))
    for k, im in enumerate(ims):
        sh.paste(im, ((k % cols) * w, (k // cols) * h))
    sh.save(os.path.join(SHEETS, name + ".png"))
    return sh


def save(tag, im, **info):
    p = os.path.join(COMP, tag + ".png")
    im.convert("RGB").save(p)
    records.append({"tag": tag, "path": os.path.relpath(p), **info})


# =====================================================================================
if MODE == "A":
    GEOMS = ["g0", "g1", "g2", "g3", "g4"]
    NAMES = {"g0": "현재 형태(높이 1.0)", "g1": "높이 1.3배", "g2": "높이 1.55배",
             "g3": "Stretch 0.45", "g4": "높이 1.2 + Stretch 0.3"}
    for bg in ("cream", "wood"):
        tiles, labs = [], []
        for g in GEOMS:
            m1 = on_bg(mochi_stack(None, load(f"A_skin_{g}_m1")), bg)
            m2 = on_bg(mochi_stack(load(f"A_back_{g}"), load(f"A_skin_{g}_m2")), bg)
            tiles += [m1, m2]
            labs += [f"{NAMES[g]} / 현재 막", f"{NAMES[g]} / 볼륨 막+뒷벽"]
        sheet(tiles, 2, f"A1_geometry_material_{bg}", scale=0.5, labels=labs)
    tiles, labs = [], []
    for e in (14, 21, 30):
        tiles.append(on_bg(mochi_stack(load(f"A_elev_{e}_back"), load(f"A_elev_{e}_skin")), "cream"))
        labs.append(f"시점 고도 {e}°")
    sheet(tiles, 3, "A2_view_elevation", scale=0.5, labels=labs)
    print("DONE A")


# =====================================================================================
# MODE B : 동적 과일 배치 + 공통 변형 테스트
# =====================================================================================
def crop_sprite(name):
    im = load(name)
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 8)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def sil_bbox(skin):
    a = np.asarray(skin)[..., 3]
    ys, xs = np.where(a > 20)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


TYPES = ["strawberry", "kiwi", "tangerine", "blueberry"]
R_M, H_M = 0.35, 0.434          # 떡 바닥 반지름(m), 높이(m) — g1(높이 1.3배)
ELEV = math.radians(21)


def layout3d(counts, first_order, seed):
    """획득한 과일의 종류·개수에서 떡 속 3D 배치를 만든다. (x, d, h)는 m 단위, d는 카메라에서 멀어지는 방향.
    - 개수만큼 조각을 만들고, 가장 많이 획득한 과일(동수면 먼저 획득한 과일)은 약간 크게
    - 타원체(떡 내부) 안에서 '가장 덜 겹치는 후보'를 고르는 방식(블루 노이즈)으로 자연스럽게 흩뿌리되 일부 겹침 허용
    """
    rng = random.Random(seed)
    total = sum(counts.values())
    dom = max(counts, key=lambda k: (counts[k], -first_order.index(k)))
    pieces = []
    for t, c in counts.items():
        share = c / total
        mult = min(1.12, max(0.92, 0.9 + 0.45 * share))
        if t == dom:
            mult *= 1.06
        for _ in range(c):
            pieces.append({"type": t, "mult": mult * rng.uniform(0.92, 1.08)})
    pieces.sort(key=lambda p: -p["mult"])
    placed = []
    base_r = 0.085  # 조각 기본 반지름(m), 실제 크기는 스프라이트 크기에 곱함
    for p in pieces:
        r = base_r * p["mult"] * (1.0 if total <= 6 else 0.72)
        best, best_score = None, -1e9
        for _ in range(260):
            # 타원체 안쪽(여유 0.74)에서 균일 샘플
            while True:
                x, d, h = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 1)
                if x * x + d * d + h * h <= 1:
                    break
            X, D, Hh = x * R_M * 0.68, d * R_M * 0.68, h * H_M * 0.62 + 0.06
            if (X / R_M) ** 2 + (D / R_M) ** 2 + (Hh / H_M) ** 2 > 0.46:
                continue
            score = min([math.dist((X, D, Hh), (q["x"], q["d"], q["h"])) - 0.78 * (r + q["r"]) for q in placed] or [1.0])
            if score > best_score:
                best, best_score = (X, D, Hh), score
        X, D, Hh = best
        placed.append({"type": p["type"], "x": X, "d": D, "h": Hh, "r": r, "mult": p["mult"],
                       "rot": rng.uniform(-35, 35), "flip": rng.random() < 0.5})
    return placed, dom


def paste_over(lrgb, la, srgb, sa, x0, y0):
    H, W = la.shape
    h, w = sa.shape
    xa, ya = max(0, x0), max(0, y0)
    xb, yb = min(W, x0 + w), min(H, y0 + h)
    if xb <= xa or yb <= ya:
        return
    sx, sy = xa - x0, ya - y0
    reg_rgb, reg_a = over(lrgb[ya:yb, xa:xb], la[ya:yb, xa:xb], srgb[sy:sy + yb - ya, sx:sx + xb - xa],
                          sa[sy:sy + yb - ya, sx:sx + xb - xa])
    lrgb[ya:yb, xa:xb] = reg_rgb
    la[ya:yb, xa:xb] = reg_a


def fruit_layer(pieces, view, skin, sprites, base_blur=3.0, depth_blur=1.6, base_tint=0.12, depth_tint=0.16,
                base_op=0.95, depth_op=0.14):
    """3D 배치 → 화면 투영 + 깊이별 흐림/색 섞임/투명도로 내부 과일 레이어를 만든다."""
    W, H = skin.size
    x0, y0, x1, y1 = sil_bbox(skin)
    cx = (x0 + x1) / 2
    k = (x1 - x0) / (2 * R_M)
    layer_rgb = np.zeros((H, W, 3), np.float32)
    layer_a = np.zeros((H, W), np.float32)
    if view == "front":
        y_gc = y1 - R_M * math.sin(ELEV) * k
        hk = (y_gc - y0) / H_M * 0.97
        order = sorted(pieces, key=lambda p: -p["d"])
    else:
        cy = (y0 + y1) / 2
        order = sorted(pieces, key=lambda p: p["h"])
    for p in order:
        spr = sprites[(p["type"], view)]
        # 앞쪽 표면에서 얼마나 안쪽(뒤)에 있는지 0~1
        if view == "front":
            surf = -R_M * math.sqrt(max(0.0, 1 - (p["x"] / R_M) ** 2 - (p["h"] / H_M) ** 2))
            inside = min(1.0, max(0.0, (p["d"] - surf) / (2 * R_M)))
            sx = cx + p["x"] * k
            sy = y_gc - p["d"] * math.sin(ELEV) * k - p["h"] * hk
            persp = 1.6 / (1.6 + p["d"] * math.cos(ELEV))
        else:
            hs = H_M * math.sqrt(max(0.0, 1 - (p["x"] / R_M) ** 2 - (p["d"] / R_M) ** 2))
            inside = min(1.0, max(0.0, (hs - p["h"]) / H_M))
            sx = cx + p["x"] * k
            sy = cy - p["d"] * k
            persp = 1.0
        s = p["mult"] * 0.72 * persp
        im = spr
        im = im.resize((max(2, int(im.width * s)), max(2, int(im.height * s))), Image.LANCZOS)
        if p["flip"]:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = im.rotate(p["rot"], expand=True, resample=Image.BICUBIC)
        pad = int(base_blur * 3 + depth_blur * 3) + 2
        padded = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        padded.paste(im, (pad, pad))
        padded = blur_rgba(padded, base_blur + depth_blur * inside)
        srgb, sa = arr(padded)
        tint = base_tint + depth_tint * inside
        srgb = srgb * (1 - tint) + TINT * tint
        sa = sa * (base_op - depth_op * inside)
        paste_over(layer_rgb, layer_a, srgb, sa, int(sx - padded.width / 2), int(sy - padded.height / 2))
    return to_img(layer_rgb, layer_a)


def remap(im, map_x, map_y):
    """target→source 좌표맵으로 RGBA 워프(알파 곱한 값에서 쌍선형 샘플링)."""
    a = np.asarray(im.convert("RGBa"), dtype=np.float32)
    H, W = a.shape[:2]
    x = np.clip(map_x, 0, W - 1.001)
    y = np.clip(map_y, 0, H - 1.001)
    xi, yi = x.astype(int), y.astype(int)
    fx, fy = (x - xi)[..., None], (y - yi)[..., None]
    out = (a[yi, xi] * (1 - fx) * (1 - fy) + a[yi, xi + 1] * fx * (1 - fy)
           + a[yi + 1, xi] * (1 - fx) * fy + a[yi + 1, xi + 1] * fx * fy)
    inside = ((map_x >= 0) & (map_x <= W - 1) & (map_y >= 0) & (map_y <= H - 1))[..., None]
    out = out * inside
    return Image.fromarray(out.astype(np.uint8), "RGBa").convert("RGBA")


def warp_maps(kind, bbox, W, H, amount=1.0):
    x0, y0, x1, y1 = bbox
    cx, yb, Wm, Hm = (x0 + x1) / 2, y1 - 0.12 * (y1 - y0) * 0.0 - (y1 - y0) * 0.17, x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if kind == "stretch_up":
        Sy = 1 + 0.85 * amount
        u = np.clip((yb - yy) / (Hm * Sy), 0, 1.2)
        src_y = yb - (yb - yy) / Sy
        src_x = cx + (xx - cx) * (1 + 0.55 * amount * np.clip(u, 0, 1) ** 1.4)
        return src_x, src_y
    if kind == "stretch_left":
        Sx = 1 + 0.75 * amount
        xr = x1 - Wm * 0.18
        t = np.clip((xr - xx) / (Wm * Sx), 0, 1.3)
        src_x = xr - (xr - xx) / Sx
        src_y = yb - (yb - yy) * (1 + 0.28 * amount * np.clip(t, 0, 1))
        return src_x, src_y
    if kind in ("press_top", "press_left"):
        px = cx if kind == "press_top" else x0 + Wm * 0.28
        py = (y0 + Hm * 0.22) if kind == "press_top" else (y0 + Hm * 0.42)
        sg = Wm * 0.26
        r2 = ((xx - px) ** 2 + (yy - py) ** 2) / sg ** 2
        g = np.exp(-r2)
        g2 = np.exp(-r2 / 2.2)
        D = Hm * 0.20 * amount
        src_y = yy - D * g
        src_x = xx - 0.30 * amount * (xx - px) * g2
        return src_x, src_y
    if kind == "squash":
        Sy, Sx = 1 - 0.30 * amount, 1 + 0.20 * amount
        return cx + (xx - cx) / Sx, yb - (yb - yy) / Sy
    if kind == "drag_right":
        sh = 0.30 * amount
        u = np.clip((yb - yy) / Hm, 0, 1.2)
        return xx - sh * (yb - yy) * 0.9 * (u ** 1.2) * 1.0, yy
    raise ValueError(kind)


if MODE == "B":
    sprites = {(t, v): crop_sprite(f"B_fruit_{t}_{v}") for t in TYPES for v in ("front", "top")}
    back_f, skin_f = load("B_back_front"), load("B_skin_front")
    back_t, skin_t = load("B_back_top"), load("B_skin_top")
    CASES = [
        ("C1", {"strawberry": 4, "kiwi": 3, "tangerine": 2, "blueberry": 1}, ["strawberry", "kiwi", "tangerine", "blueberry"], "딸기4 키위3 오렌지2 블루베리1"),
        ("C2", {"kiwi": 10}, ["kiwi"], "키위 10 (한 종류)"),
        ("C3", {"blueberry": 7, "strawberry": 3}, ["blueberry", "strawberry"], "블루베리7 딸기3"),
        ("C4", {"tangerine": 3, "kiwi": 3, "strawberry": 2, "blueberry": 2}, ["tangerine", "kiwi", "strawberry", "blueberry"], "동점: 오렌지3 키위3(먼저 획득=오렌지)"),
        ("C5", {"strawberry": 1, "kiwi": 1, "tangerine": 1, "blueberry": 7}, ["blueberry", "strawberry", "kiwi", "tangerine"], "블루베리7 + 나머지 1씩"),
    ]
    # 1) 현재(2차) vs 개선 : 정지 상태
    base_dir = os.path.join(os.path.dirname(OUT), "mochi_translucent", "composites")
    cur_img = Image.open(os.path.join(base_dir, "final_S2_front_cream.png")).convert("RGBA")
    tiles, labs = [cur_img], ["현재(2차 결과): 과일 4종 고정 조합"]
    results = {}
    for name, counts, order, desc in CASES:
        pieces, dom = layout3d(counts, order, seed=hash(name) % 1000 + 7)
        fl = fruit_layer(pieces, "front", skin_f, sprites)
        img = on_bg(mochi_stack(back_f, skin_f, fl), "cream")
        save(f"B_layout_{name}_front", img, counts=counts, dominant=dom, desc=desc)
        tiles.append(img)
        labs.append(f"개선 {name}: {desc} (대표={dom})")
        results[name] = (pieces, fl)
    sheet(tiles, 3, "B1_current_vs_improved_layouts", scale=0.5, labels=labs)

    # 2) 같은 입력(C1)에 시드만 다르게: 같은 개수여도 매번 다른 배치
    tiles, labs = [], []
    for sd in (3, 11, 29):
        pieces, dom = layout3d(CASES[0][1], CASES[0][2], seed=sd)
        fl = fruit_layer(pieces, "front", skin_f, sprites)
        tiles.append(on_bg(mochi_stack(back_f, skin_f, fl), "cream"))
        labs.append(f"C1 같은 입력, 시드 {sd}")
    sheet(tiles, 3, "B2_same_input_different_seeds", scale=0.5, labels=labs)

    # 3) 정면/위 시점 일관성(같은 3D 배치)
    tiles, labs = [], []
    for name, counts, order, desc in CASES[:3]:
        pieces, dom = results[name][0], None
        flf = results[name][1]
        flt = fruit_layer(pieces, "top", skin_t, sprites)
        tiles.append(on_bg(mochi_stack(back_f, skin_f, flf), "cream"))
        tiles.append(on_bg(mochi_stack(back_t, skin_t, flt), "wood"))
        labs += [f"{name} 정면", f"{name} 위(같은 배치)"]
    sheet(tiles, 2, "B3_front_top_consistency", scale=0.5, labels=labs)

    # 4) 변형: 떡 막·뒷벽·과일 레이어에 같은 워프를 적용 vs 막만 워프(분리 변형)
    pieces, fl = results["C1"]
    bbox = sil_bbox(skin_f)
    W, H = skin_f.size
    tiles, labs = [], []
    for kind, amt, nm in [("stretch_up", 0.7, "위로 늘림"), ("stretch_left", 0.6, "왼쪽으로 늘림"),
                          ("press_top", 1.0, "윗면 누름"), ("press_left", 1.0, "왼쪽 어깨 누름"),
                          ("squash", 1.0, "납작하게 누름"), ("drag_right", 1.0, "옆으로 끌기")]:
        mx, my = warp_maps(kind, bbox, W, H, amt)
        b_w, s_w, f_w = remap(back_f, mx, my), remap(skin_f, mx, my), remap(fl, mx, my)
        joint = on_bg(mochi_stack(b_w, s_w, f_w), "cream")
        sep = on_bg(mochi_stack(b_w, s_w, fl), "cream")   # 과일은 안 움직이고 막만 움직임(분리 변형, 나쁜 예)
        save(f"B_deform_{kind}_joint", joint, kind=kind)
        save(f"B_deform_{kind}_separate", sep, kind=kind)
        tiles += [sep, joint]
        labs += [f"{nm}: 막만 변형(분리)", f"{nm}: 막+과일 함께(개선)"]
    sheet(tiles, 2, "B4_deformation_joint_vs_separate", scale=0.5, labels=labs)

    # 5) 변형 강도 단계(위로 늘림 0.4/0.7/1.0)
    tiles, labs = [], []
    for amt in (0.0, 0.3, 0.5, 0.7):
        mx, my = warp_maps("stretch_up", bbox, W, H, amt) if amt > 0 else (np.mgrid[0:H, 0:W][1].astype(np.float32), np.mgrid[0:H, 0:W][0].astype(np.float32))
        im = on_bg(mochi_stack(remap(back_f, mx, my), remap(skin_f, mx, my), remap(fl, mx, my)), "cream")
        tiles.append(im)
        labs.append(f"위로 늘림 강도 {amt}")
    sheet(tiles, 4, "B5_stretch_progression", scale=0.5, labels=labs)

    # 6) 표면 재질: 현재 vs 개선 (같은 C1)
    wood_cur = Image.open(os.path.join(base_dir, "final_S2_front_wood.png")).convert("RGBA")
    pieces, fl = results["C1"]
    new_cream = on_bg(mochi_stack(back_f, skin_f, fl), "cream")
    new_wood = on_bg(mochi_stack(back_f, skin_f, fl), "wood")
    sheet([cur_img, new_cream, wood_cur, new_wood], 2, "B6_surface_current_vs_improved", scale=0.5,
          labels=["현재(밝은 배경)", "개선(밝은 배경)", "현재(어두운 배경)", "개선(어두운 배경)"])
    json.dump(records, open(os.path.join(OUT, "volume_composite_log_B.json"), "w"), indent=2, ensure_ascii=False)
    print("DONE B")
