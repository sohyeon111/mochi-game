"""게임용 에셋 본 렌더 (찹쌀떡 막/뒷벽, 과일 스프라이트, 쓰레기).

Blender 헤드리스로 **복사본**만 열어 렌더한다. 원본(design/assets/mochi_assets.blend)은 열지도 저장하지도 않는다.
새 모델링은 없다. 오브젝트 높이 배율, 기존 셰이프키 값, 재질, 카메라, 조명 같은 렌더 설정만 바꾼다.

실행: RAW=<원시 PNG 폴더> MODE=probe|all /Applications/Blender.app/Contents/MacOS/Blender -b <복사본.blend> --python 이 파일
출력: RAW/*.png (투명 배경 RGBA) + RAW/render_settings.json
이후 build_asset_data.py가 여백 제거·WebP 변환·충돌/워프 데이터를 만든다.
"""
import json
import math
import os
import time

import bpy
from mathutils import Vector

RAW = os.environ["RAW"]
MODE = os.environ.get("MODE", "all")
SAMPLES = int(os.environ.get("SAMPLES", "128"))
SCALE = float(os.environ.get("SCALE", "2.0"))        # 테스트(900×750) 대비 해상도 배수
RES = (int(900 * SCALE), int(750 * SCALE))
os.makedirs(RAW, exist_ok=True)

assert "test_copy" in bpy.data.filepath or "render_copy" in bpy.data.filepath, \
    "복사본으로만 실행해야 한다: " + bpy.data.filepath

# ===== 최종 확정 설정 (선택 이유는 design/test-renders/mochi_final/RESULTS.md) =====
FINAL = {
    "zscale": float(os.environ.get("ZSCALE", "1.4")),     # 높이 배율 (높이/폭 0.668)
    "squash": float(os.environ.get("SQUASH", "0.18")),    # 기존 Squash 셰이프키 값(바닥 퍼짐, 말랑한 처짐)
    "elev": 21.0,                                          # 카메라 고도(도)
    "dist": 1.61,
}
VOL = {
    "blend": 0.45, "a_base": 0.62, "a_top": 0.40, "a_edge": 0.92,
    "tint_top": (1.0, 0.94, 0.91), "tint_side": (1.0, 0.85, 0.84), "tint_ao": (0.97, 0.83, 0.82),
    "ao_height": 0.28, "ao_strength": 0.5, "glow": 0.55, "sheen": 0.45,
    "hl": 0.22, "rough": 0.42,
    "back_tint": (1.0, 0.93, 0.91), "back_alpha": 0.28, "back_glow": 0.60,
}

sc = bpy.context.scene
objs = bpy.data.objects
log = {"blender": bpy.app.version_string, "blend_file": bpy.data.filepath, "samples": SAMPLES,
       "resolution": RES, "scale_vs_test": SCALE, "final": FINAL, "vol_params": {k: list(v) if isinstance(v, tuple) else v for k, v in VOL.items()},
       "renders": []}

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
MX, MY = rig.location.x, rig.location.y

for o in objs:
    if o.type == "MESH" and o.name != "Mochi":
        o.hide_render = True
        o.hide_viewport = True


def apply_final_geometry():
    mochi.scale = (1.0, 1.0, FINAL["zscale"])
    for kb in mochi.data.shape_keys.key_blocks:
        if kb.name == "Squash":
            kb.value = FINAL["squash"]
        elif kb.name == "Stretch":
            kb.value = 0.0
    bpy.context.view_layer.update()
    ev = mochi.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    dims = [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]
    ev.to_mesh_clear()
    log["mochi_world_dims_xyz"] = [round(d, 4) for d in dims]
    log["mochi_height_over_width"] = round(dims[2] / dims[0], 3)


def smooth_silhouette():
    """외곽이 다각형처럼 각져 보이지 않도록 복사본의 떡에 서브디비전만 추가한다(새 모델링 아님, 렌더 설정)."""
    if not any(m.type == "SUBSURF" for m in mochi.modifiers):
        m = mochi.modifiers.new("RenderSubdiv", "SUBSURF")
        m.levels = 2
        m.render_levels = 2
    log["mochi_subdivision"] = 2


def make_cam(name, elev_deg, target_z, dist=None, ortho=None):
    data = bpy.data.cameras.new(name)
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = ortho
    cam = bpy.data.objects.new(name, data)
    sc.collection.objects.link(cam)
    target = Vector((MX, MY, target_z))
    if ortho:
        cam.location = target + Vector((0, 0, 2.5))
        cam.rotation_euler = (0, 0, 0)
    else:
        e = math.radians(elev_deg)
        d = dist or FINAL["dist"]
        cam.location = target + Vector((0, -d * math.cos(e), d * math.sin(e)))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam


def clear_nodes(mat):
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat.node_tree


def fmix(nt, a, b, fac_socket):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "FLOAT"
    nt.links.new(fac_socket, n.inputs[0])
    n.inputs[2].default_value = a
    n.inputs[3].default_value = b
    return n


def make_skin(p):
    mat = bpy.data.materials.new("FINAL_skin")
    nt = clear_nodes(mat)
    n = nt.nodes
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    zN = sep.outputs["Z"]
    lw = n.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = p["blend"]
    fres = lw.outputs["Fresnel"]
    mr_a = n.new("ShaderNodeMapRange")
    mr_a.inputs["To Min"].default_value = p["a_base"]; mr_a.inputs["To Max"].default_value = p["a_top"]
    nt.links.new(zN, mr_a.inputs["Value"])
    alpha = fmix(nt, 0.0, p["a_edge"], fres)
    nt.links.new(mr_a.outputs["Result"], alpha.inputs[2])
    top_col = n.new("ShaderNodeMix"); top_col.data_type = "RGBA"
    top_col.inputs[6].default_value = (*p["tint_top"], 1); top_col.inputs[7].default_value = (*p["tint_side"], 1)
    nt.links.new(fres, top_col.inputs[0])
    mr_s = n.new("ShaderNodeMapRange")
    mr_s.inputs["From Max"].default_value = p["ao_height"]
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


def make_back(p):
    mat = bpy.data.materials.new("FINAL_back")
    nt = clear_nodes(mat)
    n = nt.nodes
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
    mb = n.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mb.inputs["Fac"])
    nt.links.new(tr2.outputs["BSDF"], mb.inputs[1]); nt.links.new(mix_a.outputs["Shader"], mb.inputs[2])
    out = n.new("ShaderNodeOutputMaterial")
    nt.links.new(mb.outputs["Shader"], out.inputs["Surface"])
    return mat


# ----- 과일/쓰레기: 원본 오브젝트를 복제해 한 개씩 렌더 (복사본 씬에서만) -----
ITEMS = {
    # 게임 ID: (Blender 오브젝트, 종류)
    "strawberry": ("strawberry", "fruit"),
    "kiwi": ("kiwi", "fruit"),
    "orange": ("tangerine", "fruit"),
    "blueberry": ("blueberry", "fruit"),
    "can": ("can", "trash"),
    "sock": ("sock", "trash"),
    "fishbone": ("fishbone", "trash"),
    "newspaper": ("newspaper", "trash"),
}
SPR = {}
for gid, (bname, _) in ITEMS.items():
    d = objs[bname].copy()
    d.name = "spr_" + gid
    sc.collection.objects.link(d)
    d.hide_render = True
    d.hide_viewport = False
    SPR[gid] = d
# 위 시점: 키위 단면이 위를 향하도록 눕힘(회전만, 새 모델링 아님)
TOP_ROT = {"kiwi": (-math.pi / 2, 0, 0)}


def show_only(*gids, mochi_on=False):
    mochi.hide_render = not mochi_on
    for g, d in SPR.items():
        d.hide_render = g not in gids


def render(tag, cam, **kw):
    sc.camera = cam
    path = os.path.join(RAW, tag + ".png")
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log["renders"].append({"tag": tag, "file": os.path.basename(path), "seconds": round(time.time() - t0, 1),
                           "bytes": os.path.getsize(path), **kw})
    print("RENDERED", tag, round(time.time() - t0, 1), "s")


apply_final_geometry()
smooth_silhouette()
zs = FINAL["zscale"]
cam_f = make_cam("Cam_F", FINAL["elev"], 0.17 * zs * 0.9 + 0.02)
cam_t = make_cam("Cam_T", 90, 0.0, ortho=1.15)

if MODE == "probe":
    mochi.data.materials[0] = make_skin(VOL)
    show_only(mochi_on=True)
    render("probe_skin_front", cam_f)
    mochi.data.materials[0] = make_back(VOL)
    render("probe_back_front", cam_f)
else:
    # 1) 떡 막 / 뒷벽 (정면, 위)
    mochi.data.materials[0] = make_skin(VOL)
    show_only(mochi_on=True)
    render("mochi_skin_front", cam_f, view="front")
    render("mochi_skin_top", cam_t, view="top")
    mochi.data.materials[0] = make_back(VOL)
    render("mochi_back_front", cam_f, view="front")
    render("mochi_back_top", cam_t, view="top")
    # 2) 과일 4종 (정면, 위) — 떡 안쪽 조각과 떨어지는 오브젝트 양쪽에 같은 스프라이트 사용
    for gid, (bname, kind) in ITEMS.items():
        d = SPR[gid]
        d.location = (MX, MY, 0.14)
        d.scale = (1, 1, 1)
        views = [("front", cam_f)] + ([("top", cam_t)] if kind == "fruit" else [])
        for view, cam in views:
            show_only(gid)
            d.rotation_euler = TOP_ROT.get(gid, (0, 0, 0)) if view == "top" else (0, 0, 0)
            render(f"{kind}_{gid}_{view}", cam, item=gid, kind=kind, view=view, blender_object=bname)

with open(os.path.join(RAW, f"render_settings_{MODE}.json"), "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
print("DONE", MODE)
