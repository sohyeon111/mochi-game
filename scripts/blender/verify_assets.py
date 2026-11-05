"""본 렌더 에셋 검증 시트 생성 (numpy + pillow). public/assets/render/ 의 **결과물과 JSON만** 사용한다.

생성: design/test-renders/mochi_final/sheets/*.png , verify_metrics.json
  F1 에셋 개요 / F2 시점별(정면·위) 레이어와 합성 / F3 내부 과일 배치 / F4 공통 워프 변형 / F5 충돌 형상 / F6 두께감 비교
환경변수: ASSETS(기본 public/assets/render), OUT(기본 design/test-renders/mochi_final), FONT_DIR(라벨용, 테스트 이미지에만 사용)
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = os.environ.get("ASSETS", "public/assets/render")
OUT = os.environ.get("OUT", "design/test-renders/mochi_final")
FONT_DIR = os.environ.get("FONT_DIR", "")
SHEETS = os.path.join(OUT, "sheets")
os.makedirs(SHEETS, exist_ok=True)
BG = {"cream": (255, 246, 234), "wood": (158, 104, 60)}
TINT = np.array([255, 236, 228], dtype=np.float32)

manifest = json.load(open(f"{ASSETS}/manifest.json", encoding="utf-8"))
collision = json.load(open(f"{ASSETS}/collision.json", encoding="utf-8"))
mm = json.load(open(f"{ASSETS}/mochi.json", encoding="utf-8"))
FRAME_W = mm["frame"][0]
RES_SCALE = FRAME_W / 900.0
R_M, H_M = mm["worldDimsMeters"]["radius"], mm["worldDimsMeters"]["height"]
ELEV = math.radians(mm["cameraElevationDeg"])
LP = mm["fruitLayout"]
TYPES = ["strawberry", "kiwi", "orange", "blueberry"]
metrics = {}

# ---------- 라벨 ----------
_fk = _fl = None
_ck = _cl = set()
if FONT_DIR:
    from fontTools.ttLib import TTFont
    _fk, _fl = os.path.join(FONT_DIR, "jua-korean.ttf"), os.path.join(FONT_DIR, "jua-latin.ttf")
    _ck, _cl = set(TTFont(_fk).getBestCmap()), set(TTFont(_fl).getBestCmap())


def label(im, text, size=20, xy=(10, 8), color=(60, 40, 30)):
    im = im.convert("RGBA")
    dr = ImageDraw.Draw(im)
    x, y = xy
    fk = ImageFont.truetype(_fk, size) if _fk else ImageFont.load_default()
    fl = ImageFont.truetype(_fl, size) if _fl else fk
    for ch in text:
        f = fk if ord(ch) in _ck else (fl if ord(ch) in _cl else fk)
        dr.text((x + 1, y + 1), ch, font=f, fill=(255, 255, 255, 210))
        dr.text((x, y), ch, font=f, fill=color + (255,))
        x += dr.textlength(ch, font=f)
    return im


def sheet(tiles, cols, name, tile_w=640, labels=None, bgc=(36, 30, 30)):
    ims = []
    for i, im in enumerate(tiles):
        k = tile_w / im.width
        t = im.resize((tile_w, int(im.height * k)), Image.LANCZOS)
        if labels:
            t = label(t, labels[i], size=18, xy=(8, 6))
        ims.append(t.convert("RGB"))
    h = max(i.height for i in ims)
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", (tile_w * cols, h * rows), bgc)
    for k, im in enumerate(ims):
        sh.paste(im, ((k % cols) * tile_w, (k // cols) * h))
    sh.save(os.path.join(SHEETS, name + ".png"))
    return sh


# ---------- 합성 도구 ----------
def A(rel):
    return Image.open(f"{ASSETS}/{rel}").convert("RGBA")


def arr(im):
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a[..., :3] * 255.0, a[..., 3]


def over(dr, da, sr, sa):
    oa = sa + da * (1 - sa)
    safe = np.where(oa > 1e-6, oa, 1.0)[..., None]
    return (sr * sa[..., None] + dr * da[..., None] * (1 - sa[..., None])) / safe, oa


def to_img(rgb, a):
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8), "RGBA")


def blur_rgba(im, r):
    return im if r <= 0 else im.convert("RGBa").filter(ImageFilter.GaussianBlur(r)).convert("RGBA")


def mochi_stack(back, skin, fruit=None, mfill=None):
    mfill = LP["depthEffects"]["milkFill"] if mfill is None else mfill
    w, h = skin.size
    rgb, a = np.zeros((h, w, 3), np.float32), np.zeros((h, w), np.float32)
    s_rgb, s_a = arr(skin)
    sil = np.clip(s_a * 1.6, 0, 1)
    b_rgb, b_a = arr(back)
    rgb, a = over(rgb, a, b_rgb, b_a)
    fill = np.empty_like(rgb)
    fill[:] = TINT
    rgb, a = over(rgb, a, fill, sil * mfill)
    if fruit is not None:
        f_rgb, f_a = arr(fruit)
        rgb, a = over(rgb, a, f_rgb, np.clip(f_a * sil, 0, 1))
    rgb, a = over(rgb, a, s_rgb, s_a)
    return to_img(rgb, a)


def on_bg(rgba, bg="cream"):
    b = Image.new("RGBA", rgba.size, BG[bg] + (255,))
    b.alpha_composite(rgba)
    return b


# ---------- 내부 과일 배치 (mochi.json 파라미터 사용) ----------
def layout3d(counts, first_order, seed):
    rng = random.Random(seed)
    total = sum(counts.values())
    dom = max(counts, key=lambda k: (counts[k], -first_order.index(k)))
    sm = LP["shareMultiplier"]
    pieces = []
    for t, c in counts.items():
        share = c / total
        mult = min(sm["max"], max(sm["min"], 0.9 + 0.45 * share))
        if t == dom:
            mult *= sm["dominantBonus"]
        if t == "blueberry":
            mult *= LP["blueberry"]["scale"]
            if c >= 5:
                mult *= LP["blueberry"]["extraWhenCountAtLeast5"]
        for _ in range(c):
            pieces.append({"type": t, "mult": mult * rng.uniform(*LP["pieceScale"]["randomRange"])})
    pieces.sort(key=lambda p: -p["mult"])
    placed = []
    shrink = 1.0 if total <= LP["tooManyPiecesShrink"]["whenTotalAbove"] else LP["tooManyPiecesShrink"]["factor"]
    im = LP["innerMargin"]
    for p in pieces:
        r = LP["pieceBaseRadiusMeters"] * p["mult"] * shrink
        rho_max = im["radial"] - im["radialSizeFactor"] * r / R_M
        best, best_score = None, -1e9
        for _ in range(LP["candidates"]):
            while True:
                x, d, h = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 1)
                if x * x + d * d + h * h <= 1:
                    break
            X, D, Hh = x * R_M * rho_max, d * R_M * rho_max, h * H_M * im["heightRange"] + im["heightBase"]
            if (X / R_M) ** 2 + (D / R_M) ** 2 + (Hh / H_M) ** 2 > (rho_max * 0.92) ** 2:
                continue
            sc = min([math.dist((X, D, Hh), (q["x"], q["d"], q["h"])) - 0.78 * (r + q["r"]) for q in placed] or [1.0])
            if sc > best_score:
                best, best_score = (X, D, Hh), sc
        X, D, Hh = best
        placed.append({"type": p["type"], "x": X, "d": D, "h": Hh, "r": r, "mult": p["mult"],
                       "rot": rng.uniform(*LP["rotationDeg"]), "flip": rng.random() < LP["flipProbability"]})
    return placed, dom


def sil_box(view):
    return mm["views"][view]["silhouetteBBox"]


def fruit_layer(pieces, view, size):
    de = LP["depthEffects"]
    meta = mm["views"][view]
    x0, y0, x1, y1 = meta["silhouetteBBox"]
    cx, k = (x0 + x1) / 2, meta["pxPerMeterAtBase"]
    W, H = size
    lrgb, la = np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)
    if view == "front":
        y_gc, hk = meta["projection"]["groundCenterY"], meta["projection"]["hkPxPerMeterVertical"]
        order = sorted(pieces, key=lambda p: -p["d"])
    else:
        cy = meta["projection"]["centerY"]
        order = sorted(pieces, key=lambda p: p["h"])
    for p in order:
        spr = A(f"fruits/fruit_{p['type']}_{view}.webp")
        if view == "front":
            surf = -R_M * math.sqrt(max(0.0, 1 - (p["x"] / R_M) ** 2 - (p["h"] / H_M) ** 2))
            inside = min(1.0, max(0.0, (p["d"] - surf) / (2 * R_M)))
            sx, sy = cx + p["x"] * k, y_gc - p["d"] * math.sin(ELEV) * k - p["h"] * hk
            persp = 1.6 / (1.6 + p["d"] * math.cos(ELEV))
        else:
            hs = H_M * math.sqrt(max(0.0, 1 - (p["x"] / R_M) ** 2 - (p["d"] / R_M) ** 2))
            inside = min(1.0, max(0.0, (hs - p["h"]) / H_M))
            sx, sy, persp = cx + p["x"] * k, cy - p["d"] * k, 1.0
        s = p["mult"] * LP["pieceScale"]["base"] * persp
        im = spr.resize((max(2, int(spr.width * s)), max(2, int(spr.height * s))), Image.LANCZOS)
        if p["flip"]:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = im.rotate(p["rot"], expand=True, resample=Image.BICUBIC)
        bb = (de["blurBasePxAtFrame900"] + de["blurPerDepthPxAtFrame900"] * inside) * RES_SCALE
        pad = int(bb * 3) + 2
        padded = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        padded.paste(im, (pad, pad))
        padded = blur_rgba(padded, bb)
        srgb, sa = arr(padded)
        tint = de["tintBase"] + de["tintPerDepth"] * inside
        srgb = srgb * (1 - tint) + TINT * tint
        sa = sa * (de["opacityBase"] - de["opacityLossPerDepth"] * inside)
        xs, ys = int(sx - padded.width / 2), int(sy - padded.height / 2)
        xa, ya, xb, yb = max(0, xs), max(0, ys), min(W, xs + padded.width), min(H, ys + padded.height)
        if xb > xa and yb > ya:
            r_, a_ = over(lrgb[ya:yb, xa:xb], la[ya:yb, xa:xb], srgb[ya - ys:yb - ys, xa - xs:xb - xs], sa[ya - ys:yb - ys, xa - xs:xb - xs])
            lrgb[ya:yb, xa:xb], la[ya:yb, xa:xb] = r_, a_
    return to_img(lrgb, la)


# ---------- 링 기반 공통 워프 (mochi.json의 링/메시 가중치 사용) ----------
def mesh_arrays(view):
    wm = mm["views"][view]["warpMesh"]
    cols, rows = wm["cols"], wm["rows"]
    V = np.array(wm["restVertices"], np.float32).reshape(rows, cols, 2)
    return cols, rows, V, wm["ringWeights"], wm["bounds"]


def ring_forward(view, kind, amount):
    """링 점의 '현재 위치'를 만든다(실제 게임에서는 소프트바디가 이 역할)."""
    meta = mm["views"][view]
    ring = np.array(meta["outlineRing"], np.float32)
    x0, y0, x1, y1 = meta["silhouetteBBox"]
    cx, Wm, Hm = (x0 + x1) / 2, x1 - x0, y1 - y0
    yb = y1 - Hm * 0.17
    new = ring.copy()
    for i, (x, y) in enumerate(ring):
        if kind == "stretch_up":
            Sy = 1 + 0.85 * amount
            u = np.clip((yb - y) / Hm, 0, 1)
            ny = yb - (yb - y) * Sy
            nx = cx + (x - cx) / (1 + 0.55 * amount * np.clip(u * Sy, 0, 1) ** 1.4)
            new[i] = (nx, ny)
        elif kind == "stretch_left":
            Sx = 1 + 0.75 * amount
            xr = x1 - Wm * 0.18
            t = np.clip((xr - x) / Wm, 0, 1)
            new[i] = (xr - (xr - x) * Sx, yb - (yb - y) / (1 + 0.28 * amount * t))
        elif kind in ("press_top", "press_left"):
            px, py = (cx, y0 + Hm * 0.22) if kind == "press_top" else (x0 + Wm * 0.28, y0 + Hm * 0.42)
            sg = Wm * 0.26
            g = math.exp(-((x - px) ** 2 + (y - py) ** 2) / sg ** 2)
            g2 = math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2.2 * sg ** 2))
            new[i] = (x + 0.30 * amount * (x - px) * g2, y + Hm * 0.20 * amount * g)
        elif kind == "squash":
            Sy, Sx = 1 - 0.30 * amount, 1 + 0.20 * amount
            new[i] = (cx + (x - cx) * Sx, yb - (yb - y) * Sy)
        elif kind == "drag_right":
            u = np.clip((yb - y) / Hm, 0, 1.2)
            new[i] = (x + 0.30 * amount * (yb - y) * 0.9 * u ** 1.2, y)
    return ring, new


def warp_maps_from_ring(view, ring0, ring1, size):
    """링 변위 → 메시 정점 변위(ringWeights) → 화면 변위장(쌍선형) → 역방향 맵(고정점 반복)."""
    cols, rows, V, RW, bounds = mesh_arrays(view)
    disp = ring1 - ring0
    dv = np.zeros((rows * cols, 2), np.float32)
    for vi, ws in enumerate(RW):
        for idx, w in ws:
            dv[vi] += w * disp[idx]
    dv = dv.reshape(rows, cols, 2)
    W, H = size
    bx0, by0, bx1, by1 = bounds
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    def sample(px, py):
        u = np.clip((px - bx0) / (bx1 - bx0) * (cols - 1), 0, cols - 1.001)
        v = np.clip((py - by0) / (by1 - by0) * (rows - 1), 0, rows - 1.001)
        ui, vi_ = u.astype(int), v.astype(int)
        fu, fv = (u - ui)[..., None], (v - vi_)[..., None]
        d = (dv[vi_, ui] * (1 - fu) * (1 - fv) + dv[vi_, ui + 1] * fu * (1 - fv)
             + dv[vi_ + 1, ui] * (1 - fu) * fv + dv[vi_ + 1, ui + 1] * fu * fv)
        inside = ((px >= bx0) & (px <= bx1) & (py >= by0) & (py <= by1))[..., None]
        return d * inside

    sx, sy = xx.copy(), yy.copy()
    for _ in range(4):
        d = sample(sx, sy)
        sx, sy = xx - d[..., 0], yy - d[..., 1]
    return sx, sy


def remap(im, mx, my):
    a = np.asarray(im.convert("RGBa"), dtype=np.float32)
    H, W = a.shape[:2]
    x, y = np.clip(mx, 0, W - 1.001), np.clip(my, 0, H - 1.001)
    xi, yi = x.astype(int), y.astype(int)
    fx, fy = (x - xi)[..., None], (y - yi)[..., None]
    out = (a[yi, xi] * (1 - fx) * (1 - fy) + a[yi, xi + 1] * fx * (1 - fy) + a[yi + 1, xi] * (1 - fx) * fy + a[yi + 1, xi + 1] * fx * fy)
    ok = ((mx >= 0) & (mx <= W - 1) & (my >= 0) & (my <= H - 1))[..., None]
    return Image.fromarray((out * ok).astype(np.uint8), "RGBa").convert("RGBA")


CASES = [
    ("C1", {"strawberry": 4, "kiwi": 3, "orange": 2, "blueberry": 1}, ["strawberry", "kiwi", "orange", "blueberry"], "딸기4 키위3 오렌지2 블루베리1"),
    ("C2", {"kiwi": 10}, ["kiwi"], "키위 10(한 종류)"),
    ("C3", {"blueberry": 7, "strawberry": 3}, ["blueberry", "strawberry"], "블루베리7 딸기3"),
    ("C4", {"orange": 3, "kiwi": 3, "strawberry": 2, "blueberry": 2}, ["orange", "kiwi", "strawberry", "blueberry"], "동점: 오렌지3 키위3 (먼저 획득=오렌지)"),
    ("C5", {"strawberry": 1, "kiwi": 1, "orange": 1, "blueberry": 7}, ["blueberry", "strawberry", "kiwi", "orange"], "블루베리7 + 나머지 1씩"),
    ("C6", {"blueberry": 10}, ["blueberry"], "블루베리 10(한 종류)"),
]

skin_f, back_f = A("mochi/mochi_skin_front.webp"), A("mochi/mochi_back_front.webp")
skin_t, back_t = A("mochi/mochi_skin_top.webp"), A("mochi/mochi_back_top.webp")


def outside_pct(fruit_im, skin_im):
    fa = np.asarray(fruit_im)[..., 3] / 255.0
    sa = np.asarray(skin_im)[..., 3] / 255.0
    return round(100 * float((fa * (sa <= 0.05)).sum() / max(fa.sum(), 1e-6)), 2)


# ===================== F1 에셋 개요 =====================
tiles, labs = [], []
for a in manifest["assets"]:
    im = A(a["file"])
    canvas = Image.new("RGBA", (max(im.width, 400), max(im.height, 300)), BG["cream"] + (255,))
    canvas.alpha_composite(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    tiles.append(canvas)
    labs.append(f"{a['id']} {a['size'][0]}x{a['size'][1]} {a['bytes'] // 1024}KB")
sheet(tiles, 4, "F1_asset_overview", tile_w=480, labels=labs)

# ===================== F2 시점별 비교 (정면 / 위) =====================
pieces, dom = layout3d(CASES[0][1], CASES[0][2], seed=11)
fl_f, fl_t = fruit_layer(pieces, "front", skin_f.size), fruit_layer(pieces, "top", skin_t.size)
rowsF = [on_bg(back_f, "cream"), on_bg(fl_f, "cream"), on_bg(skin_f, "cream"), on_bg(mochi_stack(back_f, skin_f, fl_f), "cream")]
rowsT = [on_bg(back_t, "cream"), on_bg(fl_t, "cream"), on_bg(skin_t, "cream"), on_bg(mochi_stack(back_t, skin_t, fl_t), "wood")]
sheet(rowsF + rowsT, 4, "F2_views_front_top", tile_w=480,
      labels=["정면 뒷벽", "정면 과일 레이어", "정면 막", "정면 합성(대표=딸기)", "위 뒷벽", "위 과일 레이어", "위 막", "위 합성(같은 3D 배치)"])

# ===================== F3 내부 과일 배치 =====================
tiles, labs = [], []
for name, counts, order, desc in CASES:
    p, d = layout3d(counts, order, seed=abs(hash(name)) % 1000 + 7)
    fl = fruit_layer(p, "front", skin_f.size)
    tiles.append(on_bg(mochi_stack(back_f, skin_f, fl), "cream"))
    labs.append(f"{name} {desc} / 대표={d}")
    metrics.setdefault("layout_outside_pct", {})[name] = outside_pct(fl, skin_f)
sheet(tiles, 3, "F3_fruit_layouts", tile_w=640, labels=labs)
tiles, labs = [], []
for sd in (3, 11, 29):
    p, d = layout3d(CASES[0][1], CASES[0][2], seed=sd)
    tiles.append(on_bg(mochi_stack(back_f, skin_f, fruit_layer(p, "front", skin_f.size)), "cream"))
    labs.append(f"C1 같은 입력, 시드 {sd}")
sheet(tiles, 3, "F3b_same_input_different_seeds", tile_w=640, labels=labs)

# ===================== F4 공통 워프 =====================
KINDS = [("stretch_up", 0.7, "위로 늘림"), ("stretch_left", 0.6, "왼쪽으로 늘림"), ("press_top", 1.0, "윗면 누름"),
         ("press_left", 1.0, "왼쪽 어깨 누름"), ("squash", 1.0, "납작하게 누름"), ("drag_right", 1.0, "옆으로 끌기")]
metrics["warp_outside_pct"] = {}
for cname in ("C1", "C3", "C6"):
    case = next(c for c in CASES if c[0] == cname)
    p, d = layout3d(case[1], case[2], seed=abs(hash(cname)) % 1000 + 7)
    fl = fruit_layer(p, "front", skin_f.size)
    tiles, labs = [], []
    metrics["warp_outside_pct"][cname] = {}
    for kind, amt, nm in KINDS:
        r0, r1 = ring_forward("front", kind, amt)
        mx, my = warp_maps_from_ring("front", r0, r1, skin_f.size)
        b_w, s_w, f_w = remap(back_f, mx, my), remap(skin_f, mx, my), remap(fl, mx, my)
        joint = on_bg(mochi_stack(b_w, s_w, f_w), "cream")
        sep = on_bg(mochi_stack(b_w, s_w, fl), "cream")
        tiles += [sep, joint]
        labs += [f"{nm}: 막만 변형(비교)", f"{nm}: 막+과일 함께"]
        metrics["warp_outside_pct"][cname][kind] = {"joint": outside_pct(f_w, s_w), "separate": outside_pct(fl, s_w)}
    sheet(tiles, 2, f"F4_warp_{cname}", tile_w=560, labels=labs)
p, d = layout3d(CASES[0][1], CASES[0][2], seed=11)
fl = fruit_layer(p, "front", skin_f.size)
tiles, labs = [], []
for amt in (0.0, 0.3, 0.5, 0.7):
    if amt == 0:
        im = on_bg(mochi_stack(back_f, skin_f, fl), "cream")
    else:
        r0, r1 = ring_forward("front", "stretch_up", amt)
        mx, my = warp_maps_from_ring("front", r0, r1, skin_f.size)
        im = on_bg(mochi_stack(remap(back_f, mx, my), remap(skin_f, mx, my), remap(fl, mx, my)), "cream")
    tiles.append(im)
    labs.append(f"위로 늘림 {amt}")
sheet(tiles, 4, "F4b_stretch_progression", tile_w=480, labels=labs)

# ===================== F5 충돌 형상 =====================
tiles, labs = [], []
metrics["collision"] = {}
for aid, c in collision["assets"].items():
    im = A(c["sprite"])
    can = Image.new("RGBA", (im.width, im.height), BG["cream"] + (255,))
    can.alpha_composite(im)
    ov = Image.new("RGBA", can.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    for ci in c["circles"]:
        dr.ellipse((ci["x"] - ci["r"], ci["y"] - ci["r"], ci["x"] + ci["r"], ci["y"] + ci["r"]), outline=(220, 40, 70, 255), width=3)
    cx, cy = c["centroid"]
    dr.line((cx - 14, cy, cx + 14, cy), fill=(30, 90, 220, 255), width=4)
    dr.line((cx, cy - 14, cx, cy + 14), fill=(30, 90, 220, 255), width=4)
    can.alpha_composite(ov)
    tiles.append(can)
    labs.append(f"{aid} 원 {len(c['circles'])}개 / 커버 {int(c['coverage'] * 100)}% / 실루엣 밖 {int(c['overshoot'] * 100)}%")
    metrics["collision"][aid] = {"circles": len(c["circles"]), "coverage": c["coverage"], "overshoot": c["overshoot"], "size": c["size"]}
sheet(tiles, 4, "F5_collision_shapes", tile_w=420, labels=labs)

# ===================== F6 두께감 비교 (이전 테스트 vs 본 렌더) =====================
prev3 = "design/test-renders/mochi_volume/composites/B_layout_C1_front.png"
prev2 = "design/test-renders/mochi_translucent/composites/final_S2_front_cream.png"
tiles, labs = [], []
if os.path.exists(prev2):
    tiles.append(Image.open(prev2).convert("RGBA")); labs.append("2차 테스트(납작한 막, 고정 조합)")
if os.path.exists(prev3):
    tiles.append(Image.open(prev3).convert("RGBA")); labs.append("3차 테스트(높이 1.3, C1)")
pp, dd = layout3d(CASES[0][1], CASES[0][2], seed=abs(hash("C1")) % 1000 + 7)
fin = mochi_stack(back_f, skin_f, fruit_layer(pp, "front", skin_f.size))
tiles.append(on_bg(fin, "cream")); labs.append("본 렌더(높이 1.4 + Squash 0.18, C1)")
tiles.append(on_bg(fin, "wood")); labs.append("본 렌더(어두운 배경)")
sheet(tiles, 2, "F6_thickness_progression", tile_w=720, labels=labs)

metrics["mochi"] = {"height_over_width": round(H_M / (2 * R_M), 3), "worldDims": mm["worldDimsMeters"]}
json.dump(metrics, open(os.path.join(OUT, "verify_metrics.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("DONE verify")
