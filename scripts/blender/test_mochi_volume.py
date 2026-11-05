"""찹쌀떡 두께감·내부 과일 스프라이트 테스트 렌더 (비주얼 디벨롭, 테스트 전용).

Blender 헤드리스로 '복사본'만 열어 렌더한다. 원본은 열지도 저장하지도 않으며 새 모델링은 하지 않는다.
(오브젝트 배율, 기존 셰이프키 값, 재질, 카메라, 조명 같은 렌더 설정만 바꾼다.)

STAGE=A : 형태(높이/셰이프키) × 재질(현재 막 vs 볼륨 막) 후보를 정면으로 렌더 + 시점 후보
STAGE=B : 선택한 설정(GEOM, MAT, ELEV, RIM)으로 막(앞면)·뒷벽(뒷면) 레이어와 과일 종류별 스프라이트 렌더
실행: OUT=<결과폴더> STAGE=A|B [GEOM=g1 MAT=m2 ELEV=21 RIM=0] Blender -b <복사본.blend> --python 이 파일
"""
import json
import math
import os
import time

import bpy
from mathutils import Vector

OUT = os.environ["OUT"]
STAGE = os.environ.get("STAGE", "A")
GEOM = os.environ.get("GEOM", "g1")
MAT = os.environ.get("MAT", "m2")
ELEV = float(os.environ.get("ELEV", "21"))
RIM = int(os.environ.get("RIM", "0"))
SAMPLES = int(os.environ.get("SAMPLES", "64"))
RES = (900, 750)
LAYERS = os.path.join(OUT, "layers")
os.makedirs(LAYERS, exist_ok=True)

assert "test_copy" in bpy.data.filepath, "복사본으로만 실행해야 한다: " + bpy.data.filepath

sc = bpy.context.scene
objs = bpy.data.objects
log = {"blender": bpy.app.version_string, "blend_file": bpy.data.filepath, "stage": STAGE, "samples": SAMPLES,
       "resolution": RES, "renders": [], "geometry": {}}

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

mochi = objs["Mochi"]
rig = objs["MochiRig"]
if rig.animation_data:
    rig.animation_data.action = None
for b in rig.pose.bones:
    b.location = (0, 0, 0)
    b.rotation_mode = "QUATERNION"
    b.rotation_quaternion = (1, 0, 0, 0)
    b.scale = (1, 1, 1)

for o in objs:
    if o.type == "MESH" and o.name != "Mochi":
        o.hide_render = True
        o.hide_viewport = True

MX, MY = rig.location.x, rig.location.y

# ---------- 형태 후보: 기존 셰이프키 값과 오브젝트 높이 배율만 사용 ----------
GEOMS = {
    "g0": {"zscale": 1.00, "stretch": 0.0, "squash": 0.0, "desc": "현재(원본 그대로)"},
    "g1": {"zscale": 1.30, "stretch": 0.0, "squash": 0.0, "desc": "높이 1.3배"},
    "g2": {"zscale": 1.55, "stretch": 0.0, "squash": 0.0, "desc": "높이 1.55배"},
    "g3": {"zscale": 1.00, "stretch": 0.45, "squash": 0.0, "desc": "Stretch 셰이프키 0.45"},
    "g4": {"zscale": 1.20, "stretch": 0.30, "squash": 0.0, "desc": "높이 1.2배 + Stretch 0.30"},
}


def apply_geom(name):
    g = GEOMS[name]
    mochi.scale = (1.0, 1.0, g["zscale"])
    for kb in mochi.data.shape_keys.key_blocks:
        if kb.name == "Stretch":
            kb.value = g["stretch"]
        elif kb.name == "Squash":
            kb.value = g["squash"]
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mochi.evaluated_get(dg)
    me = ev.to_mesh()
    xs = [(ev.matrix_world @ v.co).x for v in me.vertices]
    ys = [(ev.matrix_world @ v.co).y for v in me.vertices]
    zs = [(ev.matrix_world @ v.co).z for v in me.vertices]
    dims = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    ev.to_mesh_clear()
    log["geometry"][name] = {**g, "world_dims_xyz": [round(d, 3) for d in dims],
                             "height_over_width": round(dims[2] / dims[0], 3)}
    return dims


# ---------- 카메라 ----------
def make_cam(name, elev_deg, target_z, dist=1.61, ortho=None):
    data = bpy.data.cameras.new(name)
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = ortho
    cam = bpy.data.objects.new(name, data)
    sc.collection.objects.link(cam)
    e = math.radians(elev_deg)
    target = Vector((MX, MY, target_z))
    if ortho:
        cam.location = target + Vector((0, 0, 2.5))
        cam.rotation_euler = (0, 0, 0)
    else:
        cam.location = target + Vector((0, -dist * math.cos(e), dist * math.sin(e)))
        direction = target - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


# ---------- 재질 ----------
def clear_nodes(mat):
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat.node_tree


def fmix(nt, a, b, fac_socket=None, fac=0.5):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "FLOAT"
    if fac_socket is not None:
        nt.links.new(fac_socket, n.inputs[0])
    else:
        n.inputs[0].default_value = fac
    n.inputs[2].default_value = a
    n.inputs[3].default_value = b
    return n


def make_skin_m1(name):
    """현재 막(S2와 동일): 가장자리일수록 불투명, 뒷면은 완전 투명."""
    mat = bpy.data.materials.new("VOL_m1_" + name)
    nt = clear_nodes(mat)
    n = nt.nodes
    tint = (1.0, 0.90, 0.87)
    lw = n.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5
    mr = n.new("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.42; mr.inputs["To Max"].default_value = 0.90
    nt.links.new(lw.outputs["Fresnel"], mr.inputs["Value"])
    diff = n.new("ShaderNodeBsdfPrincipled")
    diff.inputs["Base Color"].default_value = (*tint, 1)
    diff.inputs["Roughness"].default_value = 0.8
    diff.inputs["Specular IOR Level"].default_value = 0.0
    diff.inputs["Emission Color"].default_value = (*tint, 1)
    diff.inputs["Emission Strength"].default_value = 0.35
    gloss = n.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Color"].default_value = (0.35, 0.35, 0.35, 1); gloss.inputs["Roughness"].default_value = 0.30
    tr = n.new("ShaderNodeBsdfTransparent")
    ma = n.new("ShaderNodeMixShader")
    nt.links.new(mr.outputs["Result"], ma.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], ma.inputs[1]); nt.links.new(diff.outputs["BSDF"], ma.inputs[2])
    add = n.new("ShaderNodeAddShader")
    nt.links.new(ma.outputs["Shader"], add.inputs[0]); nt.links.new(gloss.outputs["BSDF"], add.inputs[1])
    geo = n.new("ShaderNodeNewGeometry")
    tr2 = n.new("ShaderNodeBsdfTransparent")
    mb = n.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mb.inputs["Fac"])
    nt.links.new(add.outputs["Shader"], mb.inputs[1]); nt.links.new(tr2.outputs["BSDF"], mb.inputs[2])
    out = n.new("ShaderNodeOutputMaterial")
    nt.links.new(mb.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_skin_m2(name, p):
    """볼륨 막: 높이에 따라 아래쪽(두꺼운 쪽)이 더 우윳빛, 측면은 분홍빛으로 어두워짐,
    바닥 접지부는 은은히 가라앉고, 부드러운 시튼(가루 묻은 듯한 벨벳 느낌)으로 플라스틱 느낌을 줄인다."""
    mat = bpy.data.materials.new("VOL_m2_" + name)
    nt = clear_nodes(mat)
    n = nt.nodes
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    zN = sep.outputs["Z"]

    lw = n.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = p["blend"]
    fres = lw.outputs["Fresnel"]

    # 알파: 위는 투명, 아래(두꺼운 쪽)는 불투명에 가깝게 → 가장자리일수록 더 불투명
    mr_a = n.new("ShaderNodeMapRange")
    mr_a.inputs["From Min"].default_value = 0.0; mr_a.inputs["From Max"].default_value = 1.0
    mr_a.inputs["To Min"].default_value = p["a_base"]; mr_a.inputs["To Max"].default_value = p["a_top"]
    nt.links.new(zN, mr_a.inputs["Value"])
    alpha = fmix(nt, 0.0, p["a_edge"], fac_socket=fres)
    nt.links.new(mr_a.outputs["Result"], alpha.inputs[2])

    # 색: 위는 밝은 우윳빛, 측면(프레넬)은 분홍빛, 바닥 쪽은 접지 그림자 색
    top_col = n.new("ShaderNodeMix"); top_col.data_type = "RGBA"
    top_col.inputs[6].default_value = (*p["tint_top"], 1); top_col.inputs[7].default_value = (*p["tint_side"], 1)
    nt.links.new(fres, top_col.inputs[0])
    mr_s = n.new("ShaderNodeMapRange")
    mr_s.inputs["From Min"].default_value = 0.0; mr_s.inputs["From Max"].default_value = p["ao_height"]
    mr_s.inputs["To Min"].default_value = p["ao_strength"]; mr_s.inputs["To Max"].default_value = 0.0
    mr_s.clamp = True
    nt.links.new(zN, mr_s.inputs["Value"])
    ao_col = n.new("ShaderNodeMix"); ao_col.data_type = "RGBA"
    nt.links.new(mr_s.outputs["Result"], ao_col.inputs[0])
    nt.links.new(top_col.outputs[2], ao_col.inputs[6])
    ao_col.inputs[7].default_value = (*p["tint_ao"], 1)

    diff = n.new("ShaderNodeBsdfPrincipled")
    nt.links.new(ao_col.outputs[2], diff.inputs["Base Color"])
    diff.inputs["Roughness"].default_value = 0.75
    diff.inputs["Specular IOR Level"].default_value = 0.0
    nt.links.new(ao_col.outputs[2], diff.inputs["Emission Color"])
    diff.inputs["Emission Strength"].default_value = p["glow"]
    diff.inputs["Sheen Weight"].default_value = p["sheen"]
    diff.inputs["Sheen Roughness"].default_value = 0.5
    diff.inputs["Sheen Tint"].default_value = (1.0, 0.85, 0.85, 1.0)

    gloss = n.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Color"].default_value = (p["hl"],) * 3 + (1,)
    gloss.inputs["Roughness"].default_value = p["rough"]

    tr = n.new("ShaderNodeBsdfTransparent")
    ma = n.new("ShaderNodeMixShader")
    nt.links.new(alpha.outputs[0], ma.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], ma.inputs[1]); nt.links.new(diff.outputs["BSDF"], ma.inputs[2])
    add = n.new("ShaderNodeAddShader")
    nt.links.new(ma.outputs["Shader"], add.inputs[0]); nt.links.new(gloss.outputs["BSDF"], add.inputs[1])

    geo = n.new("ShaderNodeNewGeometry")
    tr2 = n.new("ShaderNodeBsdfTransparent")
    mb = n.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mb.inputs["Fac"])
    nt.links.new(add.outputs["Shader"], mb.inputs[1]); nt.links.new(tr2.outputs["BSDF"], mb.inputs[2])
    out = n.new("ShaderNodeOutputMaterial")
    nt.links.new(mb.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_back(name, p):
    """뒷벽 레이어: 앞면은 투명, 뒷면(안쪽에서 보이는 뒤쪽 벽과 바닥)만 은은한 우윳빛으로 그린다.
    과일 레이어 '아래'에 깔아 떡 속 깊이감과 두께감을 만든다."""
    mat = bpy.data.materials.new("VOL_back_" + name)
    nt = clear_nodes(mat)
    n = nt.nodes
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    mr = n.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0; mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = (p["back_tint_low"][0]); mr.inputs["To Max"].default_value = 1.0
    diff = n.new("ShaderNodeBsdfPrincipled")
    diff.inputs["Base Color"].default_value = (*p["back_tint"], 1)
    diff.inputs["Roughness"].default_value = 0.9
    diff.inputs["Specular IOR Level"].default_value = 0.0
    diff.inputs["Emission Color"].default_value = (*p["back_tint"], 1)
    diff.inputs["Emission Strength"].default_value = p["back_glow"]
    tr = n.new("ShaderNodeBsdfTransparent")
    mix_a = n.new("ShaderNodeMixShader")
    mix_a.inputs["Fac"].default_value = p["back_alpha"]
    nt.links.new(tr.outputs["BSDF"], mix_a.inputs[1]); nt.links.new(diff.outputs["BSDF"], mix_a.inputs[2])
    geo = n.new("ShaderNodeNewGeometry")
    tr2 = n.new("ShaderNodeBsdfTransparent")
    mb = n.new("ShaderNodeMixShader")  # 앞면은 투명, 뒷면은 위의 우윳빛
    nt.links.new(geo.outputs["Backfacing"], mb.inputs["Fac"])
    nt.links.new(tr2.outputs["BSDF"], mb.inputs[1]); nt.links.new(mix_a.outputs["Shader"], mb.inputs[2])
    out = n.new("ShaderNodeOutputMaterial")
    nt.links.new(mb.outputs["Shader"], out.inputs["Surface"])
    return mat


VOL = {
    "blend": 0.45, "a_base": 0.62, "a_top": 0.40, "a_edge": 0.92,
    "tint_top": (1.0, 0.94, 0.91), "tint_side": (1.0, 0.85, 0.84), "tint_ao": (0.97, 0.83, 0.82),
    "ao_height": 0.28, "ao_strength": 0.5, "glow": 0.55, "sheen": 0.45,
    "hl": 0.22, "rough": 0.42,
    "back_tint": (1.0, 0.93, 0.91), "back_tint_low": (0.85,), "back_alpha": 0.28, "back_glow": 0.60,
}
VOL.update({k[4:]: v for k, v in os.environ.items() if False})


def set_mat(mat):
    mochi.data.materials[0] = mat


def hide_all_but(*names):
    mochi.hide_render = "Mochi" not in names
    for name in FRUITS:
        FR[name].hide_render = name not in names


# ---------- 내부 과일(스프라이트용 복제, 복사본 씬에서만) ----------
FRUITS = ["strawberry", "kiwi", "tangerine", "blueberry"]
FR = {}
for name in FRUITS:
    d = objs[name].copy()
    d.name = "spr_" + name
    sc.collection.objects.link(d)
    d.hide_render = True
    d.hide_viewport = False
    FR[name] = d

# 시점별 방향: 정면은 그대로, 위 시점은 키위 단면이 위를 보도록 눕힌다(회전만, 새 모델링 아님)
FRUIT_ROT_TOP = {"strawberry": (0, 0, 0), "kiwi": (-math.pi / 2, 0, 0), "tangerine": (0, 0, 0), "blueberry": (0, 0, 0)}

# ---------- 라이트 (선택) ----------
if RIM:
    rim = bpy.data.lights.new("RimTest", "AREA")
    rim.energy = 80
    rim.size = 1.2
    rim_o = bpy.data.objects.new("RimTest", rim)
    sc.collection.objects.link(rim_o)
    rim_o.location = (MX - 0.8, MY + 1.4, 1.2)
    rim_o.rotation_euler = (math.radians(120), 0, math.radians(-30))


def render(tag, cam, kind, **kw):
    sc.camera = cam
    path = os.path.join(LAYERS, tag + ".png")
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log["renders"].append({"tag": tag, "path": os.path.relpath(path), "kind": kind,
                           "seconds": round(time.time() - t0, 1), "bytes": os.path.getsize(path), **kw})
    print("RENDERED", tag)


if STAGE == "A":
    for gname in GEOMS:
        dims = apply_geom(gname)
        cam = make_cam("CamA_" + gname, ELEV, 0.17 * GEOMS[gname]["zscale"] * 0.9 + 0.02)
        for mname in ("m1", "m2"):
            set_mat(make_skin_m1(gname) if mname == "m1" else make_skin_m2(gname, VOL))
            hide_all_but("Mochi")
            render(f"A_skin_{gname}_{mname}", cam, "skin", geom=gname, mat=mname, elev=ELEV)
        if True:
            set_mat(make_back(gname, VOL))
            hide_all_but("Mochi")
            render(f"A_back_{gname}", cam, "back", geom=gname, elev=ELEV)
    # 시점 후보 (g1 + m2)
    apply_geom("g1")
    for e in (14, 21, 30):
        cam = make_cam(f"CamE{e}", e, 0.17 * 1.3 * 0.9 + 0.02)
        set_mat(make_skin_m2("g1", VOL)); hide_all_but("Mochi")
        render(f"A_elev_{e}_skin", cam, "skin", geom="g1", mat="m2", elev=e)
        set_mat(make_back("g1", VOL)); hide_all_but("Mochi")
        render(f"A_elev_{e}_back", cam, "back", geom="g1", elev=e)
else:
    dims = apply_geom(GEOM)
    zs = GEOMS[GEOM]["zscale"]
    cam_f = make_cam("Cam_F", ELEV, 0.17 * zs * 0.9 + 0.02)
    cam_t = make_cam("Cam_T", 90, 0.0, ortho=1.15)
    set_mat(make_skin_m1(GEOM) if MAT == "m1" else make_skin_m2(GEOM, VOL))
    hide_all_but("Mochi")
    render("B_skin_front", cam_f, "skin", geom=GEOM, mat=MAT, elev=ELEV)
    render("B_skin_top", cam_t, "skin", geom=GEOM, mat=MAT)
    set_mat(make_back(GEOM, VOL))
    hide_all_but("Mochi")
    render("B_back_front", cam_f, "back")
    render("B_back_top", cam_t, "back")
    # 과일 종류별 스프라이트(정면/위): 떡 중심 위치에 두고 한 개씩 렌더
    for name in FRUITS:
        src = objs[name]
        for view, cam in (("front", cam_f), ("top", cam_t)):
            hide_all_but(name)
            d = FR[name]
            d.location = (MX, MY, 0.14)
            d.scale = (1.0, 1.0, 1.0)
            d.rotation_euler = (0, 0, 0) if view == "front" else FRUIT_ROT_TOP[name]
            render(f"B_fruit_{name}_{view}", cam, "fruit sprite", fruit=name, view=view)
    log["note"] = "과일 스프라이트는 기본 크기(배율 1.0) 기준. 배치 시 배율·회전·반전은 합성 단계에서 적용"

log["vol_params"] = {k: (list(v) if isinstance(v, tuple) else v) for k, v in VOL.items()}
log["config"] = {"GEOM": GEOM, "MAT": MAT, "ELEV": ELEV, "RIM": RIM}
with open(os.path.join(OUT, f"volume_render_log_{STAGE}.json"), "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
print("DONE", STAGE)
