"""Preserve the supplied skinned GLB and repack opaque PNG textures for the game.

The source already has a weighted 180-joint skeleton and about 101k triangles,
so geometry and skin data are copied byte for byte. Only embedded opaque images
are converted to JPEG. The source path is supplied explicitly on the command line.
"""

import io
import json
import shutil
import struct
import sys
from pathlib import Path

from PIL import Image


def chunk(data: bytes, kind: bytes) -> bytes:
    return struct.pack('<I', len(data)) + kind + data


def main(source: Path, root: Path) -> None:
    work = root / 'model-work'
    (work / 'source').mkdir(parents=True, exist_ok=True)
    (work / 'intermediary').mkdir(parents=True, exist_ok=True)
    (work / 'output').mkdir(parents=True, exist_ok=True)
    untouched = work / 'source' / 'boba_fett_orig.glb'
    shutil.copyfile(source, untouched)

    source_data = source.read_bytes()
    source_json_size = struct.unpack_from('<I', source_data, 12)[0]
    source_doc = json.loads(source_data[20:20 + source_json_size])
    candidate = work / 'intermediary' / 'boba_fett_game_lod0.glb'
    data = candidate.read_bytes() if candidate.exists() else source_data
    magic, version, total = struct.unpack_from('<4sII', data)
    assert (magic, version, total) == (b'glTF', 2, len(data))
    json_size, json_kind = struct.unpack_from('<I4s', data, 12)
    assert json_kind == b'JSON'
    doc = json.loads(data[20:20 + json_size])
    bin_at = 20 + json_size
    bin_size, bin_kind = struct.unpack_from('<I4s', data, bin_at)
    assert bin_kind == b'BIN\0'
    original_bin = data[bin_at + 8:bin_at + 8 + bin_size]
    out_bin = bytearray()
    images = []
    replacements = {}

    for index, spec in enumerate(doc['images']):
        view = doc['bufferViews'][spec['bufferView']]
        start = view.get('byteOffset', 0)
        raw = original_bin[start:start + view['byteLength']]
        picture = Image.open(io.BytesIO(raw))
        original_mode = picture.mode
        original_size = picture.size
        if max(picture.size) > 1024:
            if original_mode == 'P':
                picture = picture.convert('RGBA' if 'transparency' in picture.info else 'RGB')
            picture.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        # Keep packed masks and alpha channels lossless. Opaque base colour
        # and normal maps use high-quality JPEG at the game texture budget.
        if original_mode == 'RGB':
            encoded = io.BytesIO()
            picture.save(encoded, format='JPEG', quality=90, subsampling=0,
                         optimize=True)
            candidate = encoded.getvalue()
            mime = 'image/jpeg'
        elif picture.size != original_size:
            encoded = io.BytesIO()
            picture.save(encoded, format='PNG', optimize=True)
            candidate = encoded.getvalue()
            mime = 'image/png'
        else:
            candidate = raw
            mime = spec['mimeType']
        if len(candidate) < len(raw):
            spec['mimeType'] = mime
            replacements[spec['bufferView']] = candidate
        else:
            candidate = raw
        images.append({'index': index, 'from': len(raw), 'to': len(candidate),
                       'format': mime if candidate != raw else 'original',
                       'size': list(picture.size)})

    # The decimator adds compact vertex streams and new index accessors. Drop
    # their unused originals so the smaller GPU buffers also reduce GLB size.
    used_accessors = set()
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            used_accessors.update(primitive['attributes'].values())
            used_accessors.add(primitive['indices'])
            for target in primitive.get('targets', []):
                used_accessors.update(target.values())
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_accessors.add(skin['inverseBindMatrices'])
    for animation in doc.get('animations', []):
        for sampler in animation['samplers']:
            used_accessors.update((sampler['input'], sampler['output']))
    accessor_ids = sorted(used_accessors)
    accessor_map = {old: new for new, old in enumerate(accessor_ids)}
    doc['accessors'] = [doc['accessors'][old] for old in accessor_ids]
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            primitive['indices'] = accessor_map[primitive['indices']]
            primitive['attributes'] = {k: accessor_map[v]
                                       for k, v in primitive['attributes'].items()}
            for target in primitive.get('targets', []):
                for key, value in target.items():
                    target[key] = accessor_map[value]
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = accessor_map[skin['inverseBindMatrices']]
    for animation in doc.get('animations', []):
        for sampler in animation['samplers']:
            sampler['input'] = accessor_map[sampler['input']]
            sampler['output'] = accessor_map[sampler['output']]

    used_views = {accessor['bufferView'] for accessor in doc['accessors']}
    used_views.update(image['bufferView'] for image in doc['images'])
    view_ids = sorted(used_views)
    view_map = {old: new for new, old in enumerate(view_ids)}
    doc['bufferViews'] = [doc['bufferViews'][old] for old in view_ids]
    for accessor in doc['accessors']:
        accessor['bufferView'] = view_map[accessor['bufferView']]
    for image in doc['images']:
        image['bufferView'] = view_map[image['bufferView']]

    # Repack only live buffer views. Accessor-local byte offsets still refer
    # to the same data, and all vertex/skin values are preserved exactly.
    for index, view in enumerate(doc['bufferViews']):
        start = view.get('byteOffset', 0)
        raw = replacements.get(view_ids[index], original_bin[start:start + view['byteLength']])
        while len(out_bin) % 4:
            out_bin.append(0)
        view['byteOffset'] = len(out_bin)
        view['byteLength'] = len(raw)
        out_bin.extend(raw)
    while len(out_bin) % 4:
        out_bin.append(0)
    doc['buffers'][0]['byteLength'] = len(out_bin)
    encoded_json = json.dumps(doc, separators=(',', ':')).encode()
    encoded_json += b' ' * (-len(encoded_json) % 4)
    packed = chunk(encoded_json, b'JSON') + chunk(bytes(out_bin), b'BIN\0')
    packed = struct.pack('<4sII', b'glTF', 2, 12 + len(packed)) + packed
    output = work / 'output' / 'boba_fett.glb'
    output.write_bytes(packed)
    shutil.copyfile(output, root / 'public' / 'models' / 'boba_fett.glb')

    triangles = sum(doc['accessors'][p['indices']]['count'] // 3
                    for mesh in doc['meshes'] for p in mesh['primitives'])
    source_triangles = sum(source_doc['accessors'][p['indices']]['count'] // 3
                           for mesh in source_doc['meshes'] for p in mesh['primitives'])
    vertices = sum(doc['accessors'][p['attributes']['POSITION']]['count']
                   for mesh in doc['meshes'] for p in mesh['primitives'])
    unweighted = 0
    max_influences = 0
    min_weight_sum = float('inf')
    max_weight_sum = 0
    invalid_joints = 0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            weights = doc['accessors'][primitive['attributes']['WEIGHTS_0']]
            joints = doc['accessors'][primitive['attributes']['JOINTS_0']]
            assert weights['componentType'] == 5126 and joints['componentType'] == 5123
            w_view = doc['bufferViews'][weights['bufferView']]
            j_view = doc['bufferViews'][joints['bufferView']]
            w_start = w_view.get('byteOffset', 0) + weights.get('byteOffset', 0)
            j_start = j_view.get('byteOffset', 0) + joints.get('byteOffset', 0)
            for index in range(weights['count']):
                w = struct.unpack_from('<4f', out_bin,
                                       w_start + index * w_view.get('byteStride', 16))
                j = struct.unpack_from('<4H', out_bin,
                                       j_start + index * j_view.get('byteStride', 8))
                total = sum(w)
                unweighted += total < 1e-6
                max_influences = max(max_influences, sum(value > 1e-6 for value in w))
                min_weight_sum = min(min_weight_sum, total)
                max_weight_sum = max(max_weight_sum, total)
                invalid_joints += any(value >= len(doc['skins'][0]['joints']) for value in j)
    assert unweighted == 0 and invalid_joints == 0 and max_influences <= 4
    report = {
        'source': str(source), 'source_bytes': len(source_data),
        'uncompressed_game_bytes': len(data),
        'game_bytes': len(packed), 'vertices': vertices, 'triangles': triangles,
        'source_triangles': source_triangles, 'unweighted': unweighted,
        'max_influences': max_influences, 'min_weight_sum': min_weight_sum,
        'max_weight_sum': max_weight_sum, 'invalid_joints': invalid_joints,
        'mesh_parts': len(doc['meshes']), 'skins': len(doc['skins']),
        'joints': len(doc['skins'][0]['joints']), 'animations': len(doc.get('animations', [])),
        'images': images,
        'method': 'Retain supplied skin, geometry, and scene orientation; repack opaque textures.',
    }
    (work / 'intermediary' / 'boba_fett_report.json').write_text(
        json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
