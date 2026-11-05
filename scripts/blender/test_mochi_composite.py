"""반투명 찹쌀떡 테스트 합성 (7.5단계, 테스트 전용).

Blender로 렌더한 레이어(PNG, 투명 배경)를 Canvas 2D에서 할 합성과 같은 순서로 합친다.
  배경 → (그림자) → 떡 속 우윳빛 채움 → 내부 과일(흐림·투명도·색 섞임) → 떡 막(skin)
필요: numpy, pillow (프로젝트 의존성이 아니라 임시 가상환경에서만 사용)

실행: OUT=<결과폴더> STAGE=1|2 SKIN=S2 python test_mochi_composite.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageFilter

OUT = os.environ["OUT"]
STAGE = int(os.environ.get("STAGE", "1"))
SKIN = os.environ.get("SKIN", "S2")
LAYERS = os.path.join(OUT, "layers")
COMP = os.path.join(OUT, "composites")
SHEETS = os.path.join(OUT, "sheets")
os.makedirs(COMP, exist_ok=True)
os.makedirs(SHEETS, exist_ok=True)

BG = {
    "cream": (255, 246, 234),   # 크림(밝은 배경)
    "wood": (158, 104, 60),     # 따뜻한 갈색(도마 느낌의 어두운 배경)
}
TINT = np.array([255, 236, 228], dtype=np.float32)  # 떡 속 우윳빛 색(연분홍 크림)


def load(name):
    return Image.open(os.path.join(LAYERS, name + ".png")).convert("RGBA")


def to_arr(im):
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a[..., :3] * 255.0, a[..., 3]


def over(dst_rgb, dst_a, src_rgb, src_a):
    out_a = src_a + dst_a * (1 - src_a)
    safe = np.where(out_a > 1e-6, out_a, 1.0)[..., None]
    out_rgb = (src_rgb * src_a[..., None] + dst_rgb * dst_a[..., None] * (1 - src_a[..., None])) / safe
    return out_rgb, out_a


def blur_rgba(im, radius):
    if radius <= 0:
        return im
    # RGBa(알파 곱해진 형식)에서 흐려야 가장자리가 번지지 않는다
    return im.convert("RGBa").filter(ImageFilter.GaussianBlur(radius)).convert("RGBA")


def composite(skin_name, fruit_name, bg="cream", mfill=0.35, f_opacity=0.95, f_blur=3.0,
              f_tint=0.12, shadow_name=None, shadow_strength=0.35):
    skin = load(skin_name)
    w, h = skin.size
    bg_rgb = np.empty((h, w, 3), dtype=np.float32)
    bg_rgb[:] = np.array(BG[bg], dtype=np.float32)
    rgb, a = bg_rgb, np.ones((h, w), dtype=np.float32)

    s_rgb, s_a = to_arr(skin)

    if shadow_name:
        sh = load(shadow_name)
        _, sh_a = to_arr(sh)
        dark = np.zeros_like(rgb)
        rgb, a = over(rgb, a, dark, np.clip(sh_a * shadow_strength, 0, 1))

    # 실루엣(떡 모양)을 약간 부드럽게
    sil = np.clip(s_a * 1.6, 0, 1)
    # 1) 우윳빛 채움(떡 반죽 자체가 비치지 않는 정도)
    fill_rgb = np.empty_like(rgb)
    fill_rgb[:] = TINT
    rgb, a = over(rgb, a, fill_rgb, sil * mfill)

    # 2) 내부 과일 (흐림 + 색 섞임 + 투명도, 실루엣 안쪽만)
    if fruit_name:
        fr = blur_rgba(load(fruit_name), f_blur)
        f_rgb, f_a = to_arr(fr)
        f_rgb = f_rgb * (1 - f_tint) + TINT * f_tint
        rgb, a = over(rgb, a, f_rgb, np.clip(f_a * sil * f_opacity, 0, 1))

    # 3) 떡 막(skin)
    rgb, a = over(rgb, a, s_rgb, s_a)
    out = np.dstack([np.clip(rgb, 0, 255), np.ones((h, w)) * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def metrics(comp_im, skin_name, fruit_name):
    """수치 보조 지표: 과일 가시성(대비)과 채도 유지율, 외곽 헤일로 점검."""
    c = np.asarray(comp_im.convert("RGB"), dtype=np.float32)
    _, s_a = to_arr(load(skin_name))
    res = {}
    sil = s_a > 0.15
    if fruit_name:
        _, f_a = to_arr(load(fruit_name))
        fm = (f_a > 0.5) & sil
        rest = sil & ~(f_a > 0.05)
        if fm.sum() > 50 and rest.sum() > 50:
            def sat(x):
                mx, mn = x.max(-1), x.min(-1)
                return float(np.mean((mx - mn) / np.maximum(mx, 1)))
            raw = np.asarray(load(fruit_name).convert("RGB"), dtype=np.float32)
            res["fruit_saturation_kept"] = round(sat(c[fm]) / max(sat(raw[fm]), 1e-6), 3)
            res["fruit_contrast_vs_dough"] = round(float(np.linalg.norm(c[fm].mean(0) - c[rest].mean(0))), 1)
    # 외곽 헤일로: 반투명 가장자리 픽셀의 평균 밝기가 내부 대비 극단적인지
    skin_rgb = np.asarray(load(skin_name), dtype=np.float32)[..., :3]
    edge = (s_a > 0.03) & (s_a < 0.5)
    inner = s_a > 0.85
    if edge.sum() > 50 and inner.sum() > 50:
        le = float(skin_rgb[edge].mean())
        li = float(skin_rgb[inner].mean())
        res["edge_vs_inner_brightness"] = round(le / max(li, 1e-6), 3)
    res["silhouette_coverage_pct"] = round(100.0 * float((s_a > 0.5).mean()), 2)
    return res


def sheet(items, name, cols=3, scale=0.5):
    ims = [i.resize((int(i.width * scale), int(i.height * scale)), Image.LANCZOS) for _, i in items]
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", (w * cols, h * rows), (30, 30, 30))
    for k, im in enumerate(ims):
        sh.paste(im.convert("RGB"), ((k % cols) * w, (k // cols) * h))
    sh.save(os.path.join(SHEETS, name + ".png"))


records = []


def save(tag, im, **info):
    path = os.path.join(COMP, tag + ".png")
    im.convert("RGB").save(path)
    webp = os.path.join(COMP, tag + ".webp")
    im.save(webp, "WEBP", quality=85, method=6)
    rec = {"tag": tag, "path": os.path.relpath(path), "webp_bytes": os.path.getsize(webp),
           "png_bytes": os.path.getsize(path), **info}
    records.append(rec)
    return im


if STAGE == 1:
    items = []
    for k in ["S1", "S2", "S3", "S4", "S5", "S6"]:
        im = composite(f"skin_{k}_front", "fruits_all_front", "cream")
        m = metrics(im, f"skin_{k}_front", "fruits_all_front")
        save(f"comp_{k}_cream", im, skin=k, bg="cream", params="mfill=0.35 f_opacity=0.95 blur=3 tint=0.12", metrics=m)
        items.append((k, im))
    sheet(items, "sheet1_skin_variants_cream")
    # 어두운 배경에서도
    items = []
    for k in ["S1", "S2", "S3", "S4", "S5", "S6"]:
        im = composite(f"skin_{k}_front", "fruits_all_front", "wood")
        save(f"comp_{k}_wood", im, skin=k, bg="wood", params="same", metrics=metrics(im, f"skin_{k}_front", "fruits_all_front"))
        items.append((k, im))
    sheet(items, "sheet1b_skin_variants_wood")
    # 합성 파라미터 스윕 (S2 기준)
    items = []
    for fo in (0.7, 0.9, 1.0):
        for bl in (0.0, 4.0):
            im = composite("skin_S2_front", "fruits_all_front", "cream", f_opacity=fo, f_blur=bl)
            tag = f"sweep_S2_op{int(fo*100)}_blur{int(bl)}"
            save(tag, im, skin="S2", f_opacity=fo, blur=bl,
                 metrics=metrics(im, "skin_S2_front", "fruits_all_front"))
            items.append((tag, im))
    sheet(items, "sheet2_composite_sweep_S2", cols=3)
    # T-A 비교
    items = []
    for k in ("TA1", "TA2"):
        im = Image.open(os.path.join(LAYERS, f"ta_{k}_front.png")).convert("RGBA")
        bgim = Image.new("RGBA", im.size, BG["cream"] + (255,))
        bgim.alpha_composite(im)
        save(f"ta_{k}_cream", bgim, variant=k, note="T-A 완성형(비교용)")
        items.append((k, bgim))
    ref = composite("skin_S2_front", "fruits_all_front", "cream")
    items.append(("TB_S2", ref))
    sheet(items, "sheet3_TA_vs_TB", cols=3)
else:
    sk = f"skin_{SKIN}"
    items = []
    # 시점
    for cam in ("front", "top"):
        fr = f"fruits_all_{cam}"
        for bg in ("cream", "wood"):
            im = composite(f"{sk}_{cam}", fr, bg, shadow_name=f"shadow_{cam}")
            save(f"final_{SKIN}_{cam}_{bg}", im, view=cam, bg=bg, metrics=metrics(im, f"{sk}_{cam}", fr))
            items.append((f"{cam}_{bg}", im))
    sheet(items, "sheet4_views", cols=2)
    # 과일 조합 (같은 스킨 재사용)
    items = []
    for combo, fr in [("4종", "fruits_all_front"), ("딸기+키위", "fruits_strawberry_kiwi_front"),
                      ("오렌지+키위+블루베리", "fruits_orange_kiwi_blueberry_front"), ("블루베리 1종", "fruits_blueberry_front")]:
        im = composite(f"{sk}_front", fr, "cream", shadow_name="shadow_front")
        save(f"combo_{fr.replace('fruits_','').replace('_front','')}", im, combo=combo, skin=SKIN,
             metrics=metrics(im, f"{sk}_front", fr))
        items.append((combo, im))
    sheet(items, "sheet5_fruit_combos", cols=2)
    # 변형 포즈
    items = []
    for pose in ("squash", "stretch"):
        im = composite(f"{sk}_{pose}_front", "fruits_all_front", "cream", shadow_name="shadow_front")
        save(f"deform_{pose}", im, pose=pose, note="과일 레이어는 기본 포즈 그대로(실제 게임에서는 소프트바디 워프로 함께 변형)")
        items.append((pose, im))
    sheet(items, "sheet6_deformed", cols=2)
    # T-A 위 시점 비교
    ta = Image.open(os.path.join(LAYERS, "ta_TA2_top.png")).convert("RGBA")
    bgim = Image.new("RGBA", ta.size, BG["cream"] + (255,))
    bgim.alpha_composite(ta)
    save("ta_TA2_top_cream", bgim, note="T-A 위 시점(비교용)")

with open(os.path.join(OUT, f"composite_log_stage{STAGE}.json"), "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False, indent=2)
print("DONE composite stage", STAGE, len(records))
