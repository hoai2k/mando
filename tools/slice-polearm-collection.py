"""Clean and split Tripo's seven-weapon sheet into independent static GLBs.

Blender: blender -b --python tools/slice-polearm-collection.py -- SOURCE OUTDIR
The source is never modified. Connected shells determine the seven main
weapons; small detached details follow the nearest shell on the row axis.
"""
import bpy
import bmesh
import json
import os
import sys
from mathutils import Vector

source_path, output_dir = sys.argv[sys.argv.index('--') + 1:]
source_path = os.path.abspath(source_path)
output_dir = os.path.abspath(output_dir)
os.makedirs(output_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source_path)
source = next(o for o in bpy.context.scene.objects if o.type == 'MESH')

# Tripo duplicates many vertices at coincident positions. Weld conservatively:
# the UV coordinates live on face corners, so the texture seams remain intact.
bm = bmesh.new()
bm.from_mesh(source.data)
before_verts = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
bm.to_mesh(source.data)
bm.free()
source.data.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output_dir, 'polearm_collection_cleaned.blend'))

bm = bmesh.new()
bm.from_mesh(source.data)
bm.verts.ensure_lookup_table()
bm.verts.index_update()
seen = set()
components = []
for start in bm.verts:
    if start in seen:
        continue
    stack = [start]
    seen.add(start)
    component = []
    while stack:
        v = stack.pop()
        component.append(v)
        for edge in v.link_edges:
            neighbor = edge.other_vert(v)
            if neighbor not in seen:
                seen.add(neighbor)
                stack.append(neighbor)
    components.append(component)

main = sorted((c for c in components if len(c) >= 250), key=len, reverse=True)
if len(main) != 7:
    raise RuntimeError(f'Expected seven principal weapon shells, found {len(main)}')
main.sort(key=lambda c: sum(v.co.z for v in c) / len(c), reverse=True)
labels = ['gaffi_collection', 'rey_staff', 'electrostaff', 'beskar_spear',
          'force_pike', 'poleaxe', 'nightsister_polearm']
centers = [sum(v.co.z for v in c) / len(c) for c in main]
assigned = {label: set() for label in labels}
for component in components:
    if component in main:
        idx = main.index(component)
    else:
        center = sum(v.co.z for v in component) / len(component)
        idx = min(range(7), key=lambda i: abs(center - centers[i]))
    assigned[labels[idx]].update(v.index for v in component)
bm.free()

# A full 2K PBR atlas per slice would duplicate 4 MB seven times. These props
# read at hand scale, so a 1K atlas retains their visible detail.
for image in bpy.data.images:
    if image.size[0] > 1024 or image.size[1] > 1024:
        image.scale(1024, 1024)

report = {
    'source': source_path,
    'source_vertices': before_verts,
    'cleaned_vertices': len(source.data.vertices),
    'components': len(components),
    'principal_centers_z': dict(zip(labels, centers)),
    'texture_size': 1024,
    'slices': [],
}
for label in labels:
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.scene.collection.objects.link(obj)
    obj.name = label
    obj.data.name = label + '_mesh'
    body = bmesh.new()
    body.from_mesh(obj.data)
    body.verts.ensure_lookup_table()
    body.verts.index_update()
    remove = [face for face in body.faces if face.verts[0].index not in assigned[label]]
    bmesh.ops.delete(body, geom=remove, context='FACES')
    bmesh.ops.delete(body, geom=[v for v in body.verts if not v.link_faces], context='VERTS')
    body.to_mesh(obj.data)
    body.free()
    if not obj.data.polygons:
        raise RuntimeError(f'Empty weapon: {label}')

    # Each weapon's own midpoint is its grip-space origin, while the shaft's
    # long axis is retained for the game's existing weapon mount rotation.
    mins = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maxs = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    center = (mins + maxs) / 2
    for vertex in obj.data.vertices:
        vertex.co -= center
    obj.data.update()
    obj.data.calc_loop_triangles()
    before = len(obj.data.loop_triangles)
    target = 4000 if label == 'poleaxe' else 3200
    if before > target:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Static game LOD', 'DECIMATE')
        modifier.ratio = target / before
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()

    path = os.path.join(output_dir, label + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True)
    report['slices'].append({
        'name': label, 'file': path, 'bytes': os.path.getsize(path),
        'vertices': len(obj.data.vertices),
        'triangles_before_lod': before,
        'triangles': len(obj.data.loop_triangles),
        'dimensions': list(maxs - mins),
        'uv_layers': len(obj.data.uv_layers),
        'materials': len(obj.material_slots),
    })
    bpy.data.objects.remove(obj, do_unlink=True)

with open(os.path.join(output_dir, 'polearm_slices_report.json'), 'w') as handle:
    json.dump(report, handle, indent=2)
print('POLEARM_SPLIT', json.dumps(report), flush=True)
