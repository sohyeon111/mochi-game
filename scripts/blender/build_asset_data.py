"""렌더 원시 PNG → 게임용 에셋(WebP) + 데이터(JSON) 변환. (numpy + pillow 필요: 프로젝트 의존성 아님)

입력 : RAW 폴더(render_assets.py 출력)
출력 : OUT 폴더 (기본 public/assets/render/)
  mochi/  mochi_{skin,back}_{front,top}.webp      — 떡 막/뒷벽 (같은 시점끼리 같은 자르기 영역 → 서로 정렬됨)
  fruits/ fruit_{strawberry,kiwi,orange,blueberry}_{front,top}.webp
  trash/  trash_{can,sock,fishbone,newspaper}_front.webp
  manifest.json   — 에셋 목록(이름, 시점, 용도, 크기, 용량, 원본 Blender 오브젝트)
  collision.json  — 오브젝트별 실루엣 기준 충돌 형상(여러 개의 원), 투명 여백 제거 정보
  mochi.json      — 떡 소프트바디 외곽 링, 워프 메시/가중치, 시점 보정값, 내부 과일 배치 파라미터
"""
import json
import math
import os

import numpy as np
from PIL import Image

RAW = os.environ["RAW"]
OUT = os.environ["OUT"]
Q_MOCHI, Q_SPRITE = 88, 90
PAD = 4
os.makedirs(os.path.join(OUT, "mochi"), exist_ok=True)
os.makedirs(os.path.join(OUT, "fruits"), exist_ok=True)
os.makedirs(os.path.join(OUT, "trash"), exist_ok=True)

settings = json.load(open(os.path.join(RAW, "render_settings_all.json"), encoding="utf-8"))
FRAME_W, FRAME_H = settings["resolution"]
W_M, _, H_M = settings["mochi_world_dims_xyz"]
R_M = W_M / 2
ELEV = settings["final"]["elev"]


def load(name):
    return Image.open(os.path.join(RAW, name + ".png")).convert("RGBA")


def bbox_of(im, thr=8):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def union(b1, b2):
    return min(b1[0], b2[0]), min(b1[1], b2[1]), max(b1[2], b2[2]), max(b1[3], b2[3])


def pad(b):
    return max(0, b[0] - PAD), max(0, b[1] - PAD), min(FRAME_W, b[2] + PAD), min(FRAME_H, b[3] + PAD)


def save_webp(im, path, q):
    im.save(path, "WEBP", quality=q, method=6, alpha_quality=100, exact=True)
    return os.path.getsize(path)


manifest = {"version": 1, "pxPerMeterFrame": None, "frame": [FRAME_W, FRAME_H], "assets": []}
collision = {"version": 1, "note": "충돌 형상은 스프라이트(여백 제거된 WebP) 좌표계 px. hitScale/HIT_SHRINK로 플레이 테스트 조정", "assets": {}}


def add_manifest(aid, kind, view, rel, im, nbytes, src, purpose, origin=None):
    manifest["assets"].append({"id": aid, "kind": kind, "view": view, "file": rel, "size": [im.width, im.height],
                               "bytes": nbytes, "blenderObject": src, "purpose": purpose, "cropOriginInFrame": origin})


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def mean_value_weights(x, y, poly):
    """Floater 평균값 좌표: 링(다각형) 안쪽 점이 링 점 변위를 부드럽게 보간하게 하는 가중치(합 = 1)."""
    P = np.asarray(poly, np.float64)
    n = len(P)
    v = P - np.array([x, y])
    d = np.hypot(v[:, 0], v[:, 1])
    if d.min() < 1e-6:
        w = np.zeros(n)
        w[int(d.argmin())] = 1.0
        return w
    nxt = np.roll(np.arange(n), -1)
    cross = v[:, 0] * v[nxt, 1] - v[:, 1] * v[nxt, 0]
    dot = v[:, 0] * v[nxt, 0] + v[:, 1] * v[nxt, 1]
    alpha = np.arctan2(cross, dot)
    t = np.tan(alpha / 2)
    w = (np.roll(t, 1) + t) / d
    s_ = w.sum()
    return w / s_ if abs(s_) > 1e-12 else np.ones(n) / n


def outside_weights(x, y, poly, decay_len):
    """링 밖(늘림 여유 구역) 정점: 가장 가까운 링 구간의 두 점을 따르되 거리에 따라 변위가 줄어든다."""
    P = np.asarray(poly, np.float64)
    n = len(P)
    best = (1e18, 0, 0.0)
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        ab = b - a
        t = np.clip(np.dot(np.array([x, y]) - a, ab) / (np.dot(ab, ab) + 1e-12), 0, 1)
        d = np.hypot(*(a + t * ab - np.array([x, y])))
        if d < best[0]:
            best = (d, i, t)
    d, i, t = best
    w = np.zeros(n)
    w[i] += (1 - t)
    w[(i + 1) % n] += t
    return w * math.exp(-d / decay_len)


# ============================ 떡 (막/뒷벽) ============================
mochi_meta = {"version": 1, "frame": [FRAME_W, FRAME_H], "worldDimsMeters": {"width": W_M, "height": H_M, "radius": R_M},
              "cameraElevationDeg": ELEV, "views": {}}
for view in ("front", "top"):
    skin, back = load(f"mochi_skin_{view}"), load(f"mochi_back_{view}")
    box = pad(union(bbox_of(skin), bbox_of(back)))
    cs, cb = skin.crop(box), back.crop(box)
    b1 = save_webp(cs, os.path.join(OUT, "mochi", f"mochi_skin_{view}.webp"), Q_MOCHI)
    b2 = save_webp(cb, os.path.join(OUT, "mochi", f"mochi_back_{view}.webp"), Q_MOCHI)
    add_manifest(f"mochi_skin_{view}", "mochi", view, f"mochi/mochi_skin_{view}.webp", cs, b1, "Mochi",
                 "떡 막(앞면) 레이어: 과일 레이어 위에 그림. 반투명 우윳빛 + 하이라이트", box[:2])
    add_manifest(f"mochi_back_{view}", "mochi", view, f"mochi/mochi_back_{view}.webp", cb, b2, "Mochi",
                 "떡 뒷벽 레이어: 과일 레이어 아래에 그림. 속이 찬 두께감과 깊이", box[:2])
    # 실루엣(막 알파) 분석
    a = np.asarray(cs)[..., 3].astype(np.float32) / 255.0
    sil = a > 0.05
    ys, xs = np.where(sil)
    sb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    cx, cy = float(xs.mean()), float(ys.mean())
    # 외곽 링: 중심에서 사방으로 레이를 쏴서 가장 바깥 실루엣 점 32개
    N = 32
    ring = []
    for i in range(N):
        th = 2 * math.pi * i / N - math.pi / 2          # 위쪽에서 시계 방향
        r_hi = max(cs.width, cs.height)
        found = None
        for r in np.arange(r_hi, 0, -1.0):
            x, y = cx + r * math.cos(th), cy + r * math.sin(th)
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < cs.width and 0 <= yi < cs.height and sil[yi, xi]:
                found = (x, y)
                break
        ring.append([round(found[0], 2), round(found[1], 2)] if found else [round(cx, 2), round(cy, 2)])
    # 워프 메시(격자): 실루엣 bbox보다 약간 넉넉하게. 각 정점은 가까운 링 점 4개의 역거리 가중치로 변위를 받는다.
    cols, rows = 22, 18
    mx0, my0 = sb[0] - 0.25 * (sb[2] - sb[0]), sb[1] - 0.6 * (sb[3] - sb[1])      # 늘림 여유(왼/오른/위)
    mx1, my1 = sb[2] + 0.25 * (sb[2] - sb[0]), sb[3] + 0.08 * (sb[3] - sb[1])
    verts, weights = [], []
    decay_len = 0.22 * (sb[2] - sb[0])
    for r_ in range(rows):
        for c_ in range(cols):
            x = mx0 + (mx1 - mx0) * c_ / (cols - 1)
            y = my0 + (my1 - my0) * r_ / (rows - 1)
            w = mean_value_weights(x, y, ring) if point_in_poly(x, y, ring) else outside_weights(x, y, ring, decay_len)
            keep = np.where(np.abs(w) >= 0.003)[0]
            tot = w.sum()
            wk = w[keep]
            if abs(wk.sum()) > 1e-9:
                wk = wk * (tot / wk.sum())            # 가중치 총합(안쪽 1, 바깥 감쇠값) 유지
            verts.append([round(x, 2), round(y, 2)])
            weights.append([[int(k), round(float(v), 4)] for k, v in zip(keep, wk)])
    pxm = (sb[2] - sb[0]) / (2 * R_M)
    meta = {
        "sprites": {"skin": f"mochi/mochi_skin_{view}.webp", "back": f"mochi/mochi_back_{view}.webp"},
        "size": [cs.width, cs.height], "cropOriginInFrame": list(box[:2]),
        "silhouetteBBox": list(sb), "centroid": [round(cx, 2), round(cy, 2)],
        "pxPerMeterAtBase": round(pxm, 2), "outlineRing": ring,
        "warpMesh": {"cols": cols, "rows": rows, "bounds": [round(mx0, 2), round(my0, 2), round(mx1, 2), round(my1, 2)],
                     "restVertices": verts, "ringWeights": weights, "weightType": "mean-value coordinates (inside ring) / nearest-segment with decay (outside)",
                     "note": "정점 변위 = Σ w_i · (링 점 i의 현재 위치 − 기준 위치). 막·뒷벽·과일 레이어를 같은 정점으로 그린다."},
    }
    if view == "front":
        s = math.sin(math.radians(ELEV))
        y_gc = sb[3] - R_M * s * pxm
        meta["projection"] = {"groundCenterY": round(y_gc, 2), "hkPxPerMeterVertical": round((y_gc - sb[1]) / H_M * 0.97, 2),
                              "groundBottomY": sb[3], "perspective": "scale = 1.6/(1.6 + d*cos(elev))"}
    else:
        meta["projection"] = {"centerY": round((sb[1] + sb[3]) / 2, 2)}
    mochi_meta["views"][view] = meta
manifest["pxPerMeterFrame"] = mochi_meta["views"]["front"]["pxPerMeterAtBase"]


# ============================ 과일/쓰레기 스프라이트 ============================
def chamfer_dt(mask):
    h, w = mask.shape
    INF = 1e9
    d = np.where(mask, INF, 0.0).astype(np.float64)
    for y in range(h):
        for x in range(w):
            if d[y, x] == 0:
                continue
            v = d[y, x]
            if y > 0:
                v = min(v, d[y - 1, x] + 1)
                if x > 0:
                    v = min(v, d[y - 1, x - 1] + 1.4142)
                if x < w - 1:
                    v = min(v, d[y - 1, x + 1] + 1.4142)
            if x > 0:
                v = min(v, d[y, x - 1] + 1)
            d[y, x] = v
    for y in range(h - 1, -1, -1):
        for x in range(w - 1, -1, -1):
            if d[y, x] == 0:
                continue
            v = d[y, x]
            if y < h - 1:
                v = min(v, d[y + 1, x] + 1)
                if x > 0:
                    v = min(v, d[y + 1, x - 1] + 1.4142)
                if x < w - 1:
                    v = min(v, d[y + 1, x + 1] + 1.4142)
            if x < w - 1:
                v = min(v, d[y, x + 1] + 1)
            d[y, x] = v
    return d


def disc_kernel(shape, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    yy = np.minimum(yy, h - yy)
    xx = np.minimum(xx, w - xx)
    return ((xx ** 2 + yy ** 2) <= r * r).astype(np.float32)


def fft_conv(img, kern):
    return np.real(np.fft.ifft2(np.fft.fft2(img) * np.fft.fft2(kern)))


def silhouette_circles(im, max_circles, min_inside=0.85, cover_goal=0.93, work=160):
    """실루엣(알파)을 여러 개의 원으로 채운다. 원은 면적의 min_inside 이상이 실루엣 안에 있어야 한다.
    가늘고 긴 오브젝트(생선뼈, 양말)는 min_inside를 낮춰(0.5~0.6) 끊기지 않게 덮는다. 결과의 coverage/overshoot로 품질을 기록한다."""
    a = np.asarray(im)[..., 3]
    k = work / max(im.width, im.height)
    small = Image.fromarray((a > 64).astype(np.uint8) * 255).resize((max(8, int(im.width * k)), max(8, int(im.height * k))), Image.BILINEAR)
    m = (np.asarray(small) > 127).astype(np.float32)
    h, w = m.shape
    total = m.sum()
    covered = np.zeros_like(m)
    rmax = 0.5 * max(h, w)
    radii = [r for r in np.linspace(max(3.0, 0.03 * max(h, w)), rmax, 14)]
    P = int(rmax) + 2                                   # 제로 패딩: 순환(wrap) 합성곱 오염 방지
    PH, PW = h + 2 * P, w + 2 * P
    kern = {r: disc_kernel((PH, PW), r) for r in radii}
    areas = {r: kern[r].sum() for r in radii}
    fk = {r: np.fft.fft2(kern[r]) for r in radii}

    def pad_(a):
        out = np.zeros((PH, PW), np.float32)
        out[P:P + h, P:P + w] = a
        return out

    def conv(F, r):
        return np.real(np.fft.ifft2(F * fk[r]))[P:P + h, P:P + w]

    m_f = np.fft.fft2(pad_(m))
    circles = []
    for _ in range(max_circles):
        uncovered = np.fft.fft2(pad_(m * (1 - covered)))
        best, bscore = None, 0.0
        for r in radii:
            inside = conv(m_f, r) / areas[r]
            gain = conv(uncovered, r)
            ok = (inside >= min_inside) & (m > 0)
            if not ok.any():
                continue
            score = np.where(ok, gain, 0)
            y, x = np.unravel_index(np.argmax(score), score.shape)
            if score[y, x] > bscore:
                bscore, best = score[y, x], (x, y, r)
        if best is None or bscore < 0.01 * total:
            break
        x, y, r = best
        circles.append(best)
        yy, xx = np.mgrid[0:h, 0:w]
        covered = np.maximum(covered, (((xx - x) ** 2 + (yy - y) ** 2) <= r * r).astype(np.float32))
        if (covered * m).sum() / total >= cover_goal:
            break
    yy, xx = np.mgrid[0:h, 0:w]
    union_mask = np.zeros_like(m)
    for (x, y, r) in circles:
        union_mask = np.maximum(union_mask, (((xx - x) ** 2 + (yy - y) ** 2) <= r * r).astype(np.float32))
    cov = float((union_mask * m).sum() / total)
    over = float((union_mask * (1 - m)).sum() / max(union_mask.sum(), 1))
    ys, xs = np.where(m > 0)
    inv = 1.0 / k
    return ([{"x": round(float(x * inv), 1), "y": round(float(y * inv), 1), "r": round(float(r * inv), 1)} for x, y, r in circles],
            round(cov, 3), round(over, 3), [round(float(xs.mean() * inv), 1), round(float(ys.mean() * inv), 1)], int(total * inv * inv))


MAXC = {"strawberry": 3, "kiwi": 3, "orange": 2, "blueberry": 4, "can": 3, "sock": 6, "fishbone": 8, "newspaper": 4}
MIN_INSIDE = {"fishbone": 0.5, "sock": 0.6}   # 가늘고 긴 오브젝트는 원이 실루엣 밖으로 더 나가는 것을 허용
PURPOSE = {
    "fruit": "과일: 떨어지는 오브젝트(정면)와 떡 내부 조각(정면/위)에 모두 사용",
    "trash": "쓰레기: 떨어지는 오브젝트(정면)",
}
for fn in sorted(os.listdir(RAW)):
    if not (fn.startswith("fruit_") or fn.startswith("trash_")) or not fn.endswith(".png"):
        continue
    stem = fn[:-4]
    kind, gid, view = stem.split("_")
    im = load(stem)
    box = pad(bbox_of(im))
    c = im.crop(box)
    folder = "fruits" if kind == "fruit" else "trash"
    nbytes = save_webp(c, os.path.join(OUT, folder, stem + ".webp"), Q_SPRITE)
    src = next(r["blender_object"] for r in settings["renders"] if r["tag"] == stem)
    add_manifest(f"{kind}_{gid}_{view}", kind, view, f"{folder}/{stem}.webp", c, nbytes, src, PURPOSE[kind], box[:2])
    if view == "front":
        circles, cov, over, cen, area = silhouette_circles(c, MAXC[gid], min_inside=MIN_INSIDE.get(gid, 0.85))
        collision["assets"][f"{kind}_{gid}"] = {
            "sprite": f"{folder}/{stem}.webp", "size": [c.width, c.height], "trimmedFromFrame": list(box),
            "centroid": cen, "silhouetteAreaPx": area, "circles": circles, "hitScale": 1.0, "minInside": MIN_INSIDE.get(gid, 0.85),
            "coverage": cov, "overshoot": over, "pxPerMeter": manifest["pxPerMeterFrame"],
        }

# ============================ 내부 과일 배치 파라미터 (게임 구현용) ============================
mochi_meta["fruitLayout"] = {
    "algorithm": "best-candidate blue-noise inside ellipsoid (reference: scripts/blender/verify_assets.py layout3d)",
    "ellipsoid": {"R": round(R_M, 4), "H": round(H_M, 4)},
    "candidates": 260,
    "innerMargin": {"radial": 0.78, "radialSizeFactor": 1.3, "heightBase": 0.06, "heightRange": 0.62},
    "pieceBaseRadiusMeters": 0.085,
    "pieceScale": {"base": 0.72, "perspective": "1.6/(1.6 + d*cos(elev))", "randomRange": [0.92, 1.08]},
    "shareMultiplier": {"min": 0.92, "max": 1.12, "formula": "0.9 + 0.45*share", "dominantBonus": 1.06},
    "tooManyPiecesShrink": {"whenTotalAbove": 6, "factor": 0.72},
    "blueberry": {"scale": 0.72, "extraWhenCountAtLeast5": 0.88, "reason": "모델이 3알 묶음 1개라 개수가 많으면 과밀"},
    "rotationDeg": [-35, 35], "flipProbability": 0.5,
    "depthEffects": {"blurBasePxAtFrame900": 3.0, "blurPerDepthPxAtFrame900": 1.6, "tintBase": 0.12, "tintPerDepth": 0.16,
                     "opacityBase": 0.95, "opacityLossPerDepth": 0.14, "milkFill": 0.35,
                     "note": "블러 px는 900px 폭 프레임 기준. 실제 스프라이트(프레임 %d px 폭)에서는 배율(%.1f)만큼 곱한다" % (FRAME_W, FRAME_W / 900)},
    "dominantRule": "가장 많이 획득한 과일, 동수면 먼저 획득한 과일",
    "layerOrder": ["back", "milkFill", "fruits(clipped to skin silhouette)", "skin"],
}
mochi_meta["commonWarp"] = {
    "summary": "막·뒷벽·과일 레이어를 같은 메시 정점으로 그린다. 과일 레이어는 떡의 기본 형태에서 한 번 합성해 오프스크린 캔버스에 두고, 메시로 워프한 뒤 워프된 막의 알파로 클리핑한다.",
    "perFrame": ["소프트바디 링 → 정점 변위(ringWeights)", "back/fruitLayer/skin 3장을 같은 메시로 그리기", "과일 레이어를 skin 알파로 클리핑(destination-in)"],
    "guarantee": "과일이 막 실루엣 밖으로 나가지 않음(검증 시트 참고)",
}

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(collision, open(os.path.join(OUT, "collision.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(mochi_meta, open(os.path.join(OUT, "mochi.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
tot = sum(a["bytes"] for a in manifest["assets"])
print("assets", len(manifest["assets"]), "total KB", round(tot / 1024), "collision", len(collision["assets"]))
