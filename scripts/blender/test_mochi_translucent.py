"""반투명 찹쌀떡 테스트 렌더 (7.5단계, 테스트 전용).

Blender 헤드리스로 '복사본'을 열어 재질/렌더 설정만 바꿔 렌더한다.
원본(design/assets/mochi_assets.blend)은 열지도 저장하지도 않는다. 이 스크립트는 save를 호출하지 않는다.

실행 예:
  OUT=design/test-renders/mochi_translucent STAGE=1 \
  /Applications/Blender.app/Contents/MacOS/Blender -b <복사본.blend> --python scripts/blender/test_mochi_translucent.py

STAGE=1 : 전체 스킨 후보 + T-A 비교 렌더(정면)
STAGE=2 : 선택한 스킨(SKIN=이름)으로 위 시점/변형 포즈/과일 조합/그림자 레이어 렌더
렌더는 레이어(PNG, 투명 배경)만 만들고, 합성은 test_mochi_composite.py가 한다.
"""
import json
import math
import os
import time

import bpy

OUT = os.environ["OUT"]
STAGE = int(os.environ.get("STAGE", "1"))
SKIN_NAME = os.environ.get("SKIN", "S2")
SAMPLES = int(os.environ.get("SAMPLES", "64"))
RES = (900, 750)

LAYERS = os.path.join(OUT, "layers")
os.makedirs(LAYERS, exist_ok=True)

assert "mochi_assets.blend" not in bpy.data.filepath or "test_copy" in bpy.data.filepath, \
    "원본 파일을 직접 열었다. 복사본으로 실행해야 한다: " + bpy.data.filepath

sc = bpy.context.scene
objs = bpy.data.objects
log = {"blender": bpy.app.version_string, "blend_file": bpy.data.filepath, "stage": STAGE,
       "samples": SAMPLES, "resolution": RES, "renders": [], "notes": []}
log["view_transform"] = sc.view_settings.view_transform
log["look"] = sc.view_settings.look

# ---------- 공통 렌더 설정 ----------
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.image_settings.color_depth = "8"

# ---------- 기본 포즈로 초기화 (저장된 Idle_Breathe 포즈 제거) ----------
mochi = objs["Mochi"]
rig = objs["MochiRig"]
if rig.animation_data:
    rig.animation_data.action = None
for b in rig.pose.bones:
    b.location = (0, 0, 0)
    b.rotation_mode = "QUATERNION"
    b.rotation_quaternion = (1, 0, 0, 0)
    b.scale = (1, 1, 1)
for kb in mochi.data.shape_keys.key_blocks:
    if kb.name != "Basis":
        kb.value = 0.0

# 메시가 닫혀 있는지 확인 (투과 렌더 품질에 영향)
import bmesh
bm = bmesh.new()
bm.from_mesh(mochi.data)
boundary = sum(1 for e in bm.edges if e.is_boundary)
log["mochi_boundary_edges"] = boundary
bm.free()

# ---------- 씬 정리: 테스트에 필요한 오브젝트만 보이게 ----------
FRUIT_SRC = ["strawberry", "kiwi", "tangerine", "blueberry"]
for o in objs:
    if o.type == "MESH" and o.name not in ("Mochi", "Floor"):
        o.hide_render = True
        o.hide_viewport = True

# 떡 월드 위치(원본: MochiRig가 (-3,0,0))
MX, MY = rig.location.x, rig.location.y

# 내부 과일: 원본 과일 오브젝트를 복제해 떡 안쪽에 배치 (새 모델링 없음, 복사본 씬에서만)
FRUIT_LAYOUT = {
    # 이름: (dx, dy, dz, 배율, z회전)
    "strawberry": (-0.17, -0.04, 0.13, 0.95, 0.2),
    "kiwi":       (0.20, -0.08, 0.12, 1.00, 0.0),
    "tangerine":  (0.00, -0.02, 0.11, 0.95, 0.0),
    "blueberry":  (0.05, 0.12, 0.15, 0.90, 0.3),
}
inner = {}
for name in FRUIT_SRC:
    src = objs[name]
    d = src.copy()
    d.name = "in_" + name
    sc.collection.objects.link(d)
    dx, dy, dz, k, rz = FRUIT_LAYOUT[name]
    d.location = (MX + dx, MY + dy, dz)
    d.scale = (k, k, k)
    d.rotation_euler = (0, 0, rz)
    d.hide_render = True
    d.hide_viewport = False
    inner[name] = d

floor = objs["Floor"]
floor.hide_render = True

# ---------- 카메라 ----------
cam_front = objs["Cam_Mochi"]
cam_top_data = bpy.data.cameras.new("Cam_Top_Test")
cam_top_data.type = "ORTHO"
cam_top_data.ortho_scale = 1.15
cam_top = bpy.data.objects.new("Cam_Top_Test", cam_top_data)
sc.collection.objects.link(cam_top)
cam_top.location = (MX, MY, 2.5)
cam_top.rotation_euler = (0, 0, 0)
CAMS = {"front": cam_front, "top": cam_top}


# ---------- 재질 ----------
def clear_nodes(mat):
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat.node_tree


def make_skin(name, a_center, a_edge, rough, highlight, glow=0.35, blend=0.5, tint=(1.0, 0.90, 0.87)):
    """T-B 막(skin) 재질: 가장자리일수록 불투명한 반투명 막 + 글로시 하이라이트 + 뒷면 제거."""
    mat = bpy.data.materials.new("TEST_skin_" + name)
    nt = clear_nodes(mat)
    n = nt.nodes
    lw = n.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = blend
    mr = n.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = a_center
    mr.inputs["To Max"].default_value = a_edge
    nt.links.new(lw.outputs["Fresnel"], mr.inputs["Value"])

    diff = n.new("ShaderNodeBsdfPrincipled")
    diff.inputs["Base Color"].default_value = (*tint, 1.0)
    diff.inputs["Roughness"].default_value = 0.8
    diff.inputs["Specular IOR Level"].default_value = 0.0
    diff.inputs["Emission Color"].default_value = (*tint, 1.0)   # 떡이 칙칙해지지 않도록 은은한 자체 밝기
    diff.inputs["Emission Strength"].default_value = glow

    gloss = n.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Color"].default_value = (highlight, highlight, highlight, 1.0)
    gloss.inputs["Roughness"].default_value = rough

    transp = n.new("ShaderNodeBsdfTransparent")
    mix_alpha = n.new("ShaderNodeMixShader")  # fac = 알파: 0 → 투명, 1 → 확산
    nt.links.new(mr.outputs["Result"], mix_alpha.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], mix_alpha.inputs[1])
    nt.links.new(diff.outputs["BSDF"], mix_alpha.inputs[2])

    add = n.new("ShaderNodeAddShader")  # 하이라이트는 알파와 무관하게 더한다
    nt.links.new(mix_alpha.outputs["Shader"], add.inputs[0])
    nt.links.new(gloss.outputs["BSDF"], add.inputs[1])

    geo = n.new("ShaderNodeNewGeometry")
    transp2 = n.new("ShaderNodeBsdfTransparent")
    mix_back = n.new("ShaderNodeMixShader")  # 뒷면은 완전 투명
    nt.links.new(geo.outputs["Backfacing"], mix_back.inputs["Fac"])
    nt.links.new(add.outputs["Shader"], mix_back.inputs[1])
    nt.links.new(transp2.outputs["BSDF"], mix_back.inputs[2])

    out = n.new("ShaderNodeOutputMaterial")
    nt.links.new(mix_back.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_ta(name, transmission, sss, rough=0.35, ior=1.35, tint=(1.0, 0.88, 0.85)):
    """T-A 완성형(비교용): 투과 + 서브서피스."""
    mat = bpy.data.materials.new("TEST_ta_" + name)
    nt = clear_nodes(mat)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*tint, 1.0)
    p.inputs["Roughness"].default_value = rough
    p.inputs["IOR"].default_value = ior
    p.inputs["Transmission Weight"].default_value = transmission
    p.inputs["Subsurface Weight"].default_value = sss
    p.inputs["Subsurface Radius"].default_value = (0.6, 0.25, 0.2)
    p.inputs["Subsurface Scale"].default_value = 0.08
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(p.outputs["BSDF"], out.inputs["Surface"])
    return mat


SKINS = {
    # 이름: (중앙 알파, 가장자리 알파, 광택 거칠기, 하이라이트 세기, 자체 밝기(glow), 설명)
    "S1": (0.30, 0.80, 0.30, 0.35, 0.35, "중앙 매우 투명"),
    "S2": (0.42, 0.90, 0.30, 0.35, 0.35, "중간(기준)"),
    "S3": (0.55, 0.95, 0.30, 0.35, 0.35, "덜 투명"),
    "S4": (0.42, 0.90, 0.45, 0.20, 0.35, "무광(퍼진 하이라이트)"),
    "S5": (0.42, 0.90, 0.20, 0.55, 0.35, "유광(선명한 하이라이트)"),
    "S6": (0.42, 0.70, 0.30, 0.35, 0.35, "가장자리도 투명(부드러운 외곽)"),
}
TA = {
    "TA1": (0.35, 0.40),
    "TA2": (0.65, 0.40),
}


def set_mochi_material(mat):
    mochi.data.materials[0] = mat


def set_visibility(show_mochi, show_fruits, shadow_only=False, show_floor=False):
    mochi.hide_render = not show_mochi
    for name, d in inner.items():
        d.hide_render = not (show_fruits and name in show_fruits)
    floor.hide_render = not show_floor
    floor.is_shadow_catcher = bool(show_floor)
    mochi.visible_camera = not shadow_only


def render(tag, cam, kind, params):
    sc.camera = CAMS[cam]
    path = os.path.join(LAYERS, tag + ".png")
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = round(time.time() - t0, 1)
    rec = {"tag": tag, "path": os.path.relpath(path), "camera": cam, "kind": kind,
           "seconds": dt, "bytes": os.path.getsize(path), **params}
    log["renders"].append(rec)
    print("RENDERED", tag, dt, "s")


ALL = list(FRUIT_SRC)

if STAGE == 1:
    # 스킨 후보 6종 (떡 본체만, 정면)
    for key, (ac, ae, r, hl, gl, desc) in SKINS.items():
        set_mochi_material(make_skin(key, ac, ae, r, hl, gl))
        set_visibility(True, [])
        render(f"skin_{key}_front", "front", "T-B skin",
               {"variant": key, "alpha_center": ac, "alpha_edge": ae, "roughness": r, "highlight": hl, "glow": gl, "desc": desc})
    # 내부 과일 4종 레이어 (정면)
    set_visibility(False, ALL)
    render("fruits_all_front", "front", "T-B fruit layer", {"fruits": ALL})
    # T-A 비교용 (과일을 3D 안에 넣고 투과 렌더)
    for key, (tr, sss) in TA.items():
        set_mochi_material(make_ta(key, tr, sss))
        set_visibility(True, ALL)
        render(f"ta_{key}_front", "front", "T-A reference",
               {"variant": key, "transmission": tr, "subsurface": sss, "fruits": ALL})
else:
    a = SKINS[SKIN_NAME]
    skin = make_skin(SKIN_NAME, a[0], a[1], a[2], a[3], a[4])
    # 위 시점: 스킨 + 과일 레이어
    set_mochi_material(skin)
    set_visibility(True, [])
    render(f"skin_{SKIN_NAME}_top", "top", "T-B skin", {"variant": SKIN_NAME})
    set_visibility(False, ALL)
    render("fruits_all_top", "top", "T-B fruit layer", {"fruits": ALL})
    # 과일 조합 레이어(정면): 스킨은 재사용
    for combo_name, combo in {"strawberry_kiwi": ["strawberry", "kiwi"], "blueberry": ["blueberry"],
                              "orange_kiwi_blueberry": ["tangerine", "kiwi", "blueberry"]}.items():
        set_visibility(False, combo)
        render(f"fruits_{combo_name}_front", "front", "T-B fruit layer", {"fruits": combo})
    # 변형 포즈에서의 스킨 (Squash, Stretch)
    set_mochi_material(skin)
    set_visibility(True, [])
    for key in ("Squash", "Stretch"):
        mochi.data.shape_keys.key_blocks[key].value = 1.0
        render(f"skin_{SKIN_NAME}_{key.lower()}_front", "front", "T-B skin deformed", {"variant": SKIN_NAME, "shape_key": key})
        mochi.data.shape_keys.key_blocks[key].value = 0.0
    # 그림자 레이어 (떡은 카메라에 안 보이게, 바닥 그림자 캐처만)
    set_visibility(True, [], shadow_only=True, show_floor=True)
    render("shadow_front", "front", "shadow catcher", {})
    render("shadow_top", "top", "shadow catcher", {})
    # T-A 비교(위 시점)
    set_mochi_material(make_ta("TA2", 0.65, 0.40))
    set_visibility(True, ALL)
    render("ta_TA2_top", "top", "T-A reference", {"variant": "TA2", "fruits": ALL})

log["fruit_layout"] = FRUIT_LAYOUT
with open(os.path.join(OUT, f"render_log_stage{STAGE}.json"), "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
print("DONE stage", STAGE)
