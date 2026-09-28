"""Fit Boba Fett's delivered model to the rest of the cast.

Every other hero arrived with the same kind of texture: shading and grime
baked into a dark, saturated colour map (mean brightness 0.14-0.24, saturation
0.4-0.8). Boba came from a Source-engine port whose colour maps are flat
albedo, about twice as bright and nearly grey (brightness 0.34-0.41,
saturation 0.14). Under the game's lighting, and the hero ambient that lifts
each fighter by their own colour map, that reads as a pale, chalky figure
next to Din or Paz. So this grades his colour maps toward the cast and tidies
what the port left behind:

- colour maps: darker, warmer and more saturated (GRADE below)
- two belt triangles folded by the decimator into one mirror-bright shard on
  the back of the belt are dropped
- the cloak's alpha blend becomes an alpha cutout, so it depth-sorts like
  every other surface
- the visor gets a little roughness instead of a perfect mirror
- the KHR_materials_specular maps hold a near-constant strength in alpha;
  each becomes its average as a plain factor, and the lossless packed maps
  are re-encoded as JPEG, which cuts the file by more than half

Geometry, skin and scene layout are otherwise copied unchanged. Reads the
delivered model from public/models/sources/boba_fett.glb and writes
public/models/boba_fett.glb.

Usage: python3 tools/grade-boba-fett.py
"""

import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public' / 'models' / 'sources' / 'boba_fett.glb'
OUTPUT = ROOT / 'public' / 'models' / 'boba_fett.glb'

# sRGB-space grade for the colour maps: value scale, saturation scale, then a
# warm tint (per-channel multipliers) and a gentle contrast curve
GRADE = {'value': 0.9, 'saturation': 1.5, 'tint': (1.04, 1.0, 0.93), 'gamma': 1.0}
# (mesh name, triangle index) pairs folded into a shard by the decimator
SHARD_TRIANGLES = {'BobaFett_Belt.smd_M_Boba_Fett_Armor_0': [737, 738]}
VISOR_ROUGHNESS = 0.3
MAX_TEXTURE = 1024


def chunk(data: bytes, kind: bytes) -> bytes:
    return struct.pack('<I', len(data)) + kind + data


def grade(picture: Image.Image) -> Image.Image:
    alpha = picture.getchannel('A') if picture.mode == 'RGBA' else None
    hsv = np.asarray(picture.convert('RGB').convert('HSV')).astype(np.float32) / 255
    hsv[..., 1] = np.clip(hsv[..., 1] * GRADE['saturation'], 0, 1)
    hsv[..., 2] = np.clip(hsv[..., 2] * GRADE['value'], 0, 1) ** GRADE['gamma']
    rgb = np.asarray(Image.fromarray((hsv * 255).round().astype(np.uint8), 'HSV')
                     .convert('RGB')).astype(np.float32)
    rgb = np.clip(rgb * np.array(GRADE['tint'], dtype=np.float32), 0, 255)
    out = Image.fromarray(rgb.round().astype(np.uint8), 'RGB')
    if alpha is not None:
        out.putalpha(alpha)
    return out


def main() -> None:
    data = SOURCE.read_bytes()
    magic, version, total = struct.unpack_from('<4sII', data)
    assert (magic, version, total) == (b'glTF', 2, len(data))
    json_size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_size])
    bin_at = 20 + json_size
    bin_size = struct.unpack_from('<I', data, bin_at)[0]
    source_bin = data[bin_at + 8:bin_at + 8 + bin_size]

    def view_bytes(index: int) -> bytes:
        view = doc['bufferViews'][index]
        start = view.get('byteOffset', 0)
        return source_bin[start:start + view['byteLength']]

    replacements: dict[int, bytes] = {}
    materials = doc['materials']
    by_name = {m['name']: m for m in materials}

    # ---- which images are colour maps (graded) and which specular maps go ----
    color_images: set[int] = set()
    spec_textures: set[int] = set()
    for m in materials:
        base = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if base is not None:
            color_images.add(doc['textures'][base['index']]['source'])
        spec = m.get('extensions', {}).get('KHR_materials_specular')
        if spec and 'specularTexture' in spec:
            spec_textures.add(spec['specularTexture']['index'])

    # a specular texture keeps its strength in alpha; fold it into the factor
    for m in materials:
        spec = m.get('extensions', {}).get('KHR_materials_specular')
        if not spec or 'specularTexture' not in spec:
            continue
        image = doc['textures'][spec.pop('specularTexture')['index']]['source']
        picture = Image.open(io.BytesIO(view_bytes(doc['images'][image]['bufferView'])))
        strength = float(np.asarray(picture.convert('LA').getchannel('A')).mean() / 255)
        spec['specularFactor'] = round(spec.get('specularFactor', 1) * strength, 3)

    # ---- material fixes ----
    cloak = by_name['M_Boba_Fett_Cloak']
    cloak['alphaMode'] = 'MASK'
    cloak['alphaCutoff'] = 0.5
    by_name['M_Boba_Fett_Helmet_Visor']['pbrMetallicRoughness']['roughnessFactor'] = VISOR_ROUGHNESS

    # ---- images: grade colour maps, shrink and re-encode the rest ----
    report = []
    for index, spec in enumerate(doc['images']):
        raw = view_bytes(spec['bufferView'])
        picture = Image.open(io.BytesIO(raw))
        picture.load()
        has_alpha = picture.mode in ('RGBA', 'LA') or 'transparency' in picture.info
        if spec['mimeType'] == 'image/jpeg' and index not in color_images and max(picture.size) <= MAX_TEXTURE:
            report.append((index, len(raw), len(raw), 'kept'))
            continue  # already a JPEG at budget: re-encoding would only lose detail
        if picture.mode == 'P':
            picture = picture.convert('RGBA' if has_alpha else 'RGB')
        if max(picture.size) > MAX_TEXTURE:
            picture.thumbnail((MAX_TEXTURE, MAX_TEXTURE), Image.Resampling.LANCZOS)
        if index in color_images:
            picture = grade(picture)
        encoded = io.BytesIO()
        if has_alpha and picture.mode in ('RGBA', 'LA'):
            picture.save(encoded, format='PNG', optimize=True)
            spec['mimeType'] = 'image/png'
        else:
            picture.convert('RGB').save(encoded, format='JPEG', quality=90, subsampling=0, optimize=True)
            spec['mimeType'] = 'image/jpeg'
        replacements[spec['bufferView']] = encoded.getvalue()
        report.append((index, len(raw), len(encoded.getvalue()), 'graded' if index in color_images else ''))

    # ---- drop the folded belt triangles ----
    for mesh in doc['meshes']:
        drop = SHARD_TRIANGLES.get(mesh.get('name'))
        if not drop:
            continue
        primitive = mesh['primitives'][0]
        accessor = doc['accessors'][primitive['indices']]
        assert accessor['componentType'] in (5123, 5125)
        fmt = 'H' if accessor['componentType'] == 5123 else 'I'
        view = doc['bufferViews'][accessor['bufferView']]
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        indices = list(struct.unpack_from(f'<{accessor["count"]}{fmt}', source_bin, start))
        kept = [v for t in range(len(indices) // 3) if t not in drop for v in indices[t * 3:t * 3 + 3]]
        doc['bufferViews'].append({'buffer': 0, 'byteLength': 0, 'target': 34963})
        new_view = len(doc['bufferViews']) - 1
        replacements[new_view] = struct.pack(f'<{len(kept)}{fmt}', *kept)
        accessor.update({'bufferView': new_view, 'byteOffset': 0, 'count': len(kept)})

    # ---- textures no longer referenced, then repack live views only ----
    used_textures = set()

    def walk(value):
        if isinstance(value, dict):
            if 'index' in value and len(value) <= 4 and isinstance(value['index'], int):
                used_textures.add(value['index'])
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(materials)
    texture_ids = sorted(used_textures)
    texture_map = {old: new for new, old in enumerate(texture_ids)}

    def remap(value):
        if isinstance(value, dict):
            if 'index' in value and len(value) <= 4 and isinstance(value['index'], int):
                value['index'] = texture_map[value['index']]
            for v in value.values():
                remap(v)
        elif isinstance(value, list):
            for v in value:
                remap(v)
    remap(materials)
    doc['textures'] = [doc['textures'][old] for old in texture_ids]
    image_ids = sorted({t['source'] for t in doc['textures']})
    image_map = {old: new for new, old in enumerate(image_ids)}
    doc['images'] = [doc['images'][old] for old in image_ids]
    for texture in doc['textures']:
        texture['source'] = image_map[texture['source']]

    used_views = {a['bufferView'] for a in doc['accessors'] if 'bufferView' in a}
    used_views.update(image['bufferView'] for image in doc['images'])
    view_ids = sorted(used_views)
    view_map = {old: new for new, old in enumerate(view_ids)}
    out_bin = bytearray()
    views = []
    for old in view_ids:
        view = dict(doc['bufferViews'][old])
        raw = replacements[old] if old in replacements else view_bytes(old)
        while len(out_bin) % 4:
            out_bin.append(0)
        view['byteOffset'] = len(out_bin)
        view['byteLength'] = len(raw)
        out_bin.extend(raw)
        views.append(view)
    while len(out_bin) % 4:
        out_bin.append(0)
    doc['bufferViews'] = views
    for accessor in doc['accessors']:
        if 'bufferView' in accessor:
            accessor['bufferView'] = view_map[accessor['bufferView']]
    for image in doc['images']:
        image['bufferView'] = view_map[image['bufferView']]
    doc['buffers'] = [{'byteLength': len(out_bin)}]
    doc['asset'].setdefault('extras', {})['graded'] = {'from': 'sources/boba_fett.glb', **GRADE}

    encoded_json = json.dumps(doc, separators=(',', ':')).encode()
    encoded_json += b' ' * (-len(encoded_json) % 4)
    packed = chunk(encoded_json, b'JSON') + chunk(bytes(out_bin), b'BIN\0')
    OUTPUT.write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(packed)) + packed)
    for index, before, after, note in report:
        print(f'image {index:2d}: {before:8d} -> {after:8d} bytes {note}')
    print(f'{SOURCE.name}: {len(data)} -> {OUTPUT.stat().st_size} bytes, {len(doc["images"])} images')


if __name__ == '__main__':
    main()
