#!/usr/bin/env python3
"""Pack the converted FlightGear aircraft (Unreal/SkyLine/Aircraft) for the web version.

For every aircraft this writes   <out>/<id>/model.bin          shared geometry (exterior only)
                                 <out>/<id>/t/<n>.jpg|png      shared textures (<= MAX px)
                                 <out>/<id>/l/<livery>.jpg|png livery textures
                                 <out>/<id>/<livery>.gltf      tiny glTF per livery (same .bin, livery images)
and <out>/index.json describing poses (gear/flaps), spinning parts and liveries.

Usage: python3 tools/fgconv/web.py [--src Unreal/SkyLine/Aircraft] [--out web-aircraft] [--max 1024] [--liveries 16] [ids...]
Needs Pillow.
"""
import argparse, io, json, os, struct, sys
from PIL import Image

# one FlightGear model per web aircraft (several A320 variants share one flight model)
SKIP = {'a320-cfm', 'a320-iae', 'a320neo-cfm'}


def read_glb(path):
    data = open(path, 'rb').read()
    jl = struct.unpack('<I', data[12:16])[0]
    j = json.loads(data[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', data[off:off + 4])[0]
    return j, data[off + 8:off + 8 + bl]


def encode(img_bytes, max_px, quality):
    im = Image.open(io.BytesIO(img_bytes))
    im.load()
    alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 250
    im = im.convert('RGBA' if alpha else 'RGB')
    if max(im.size) > max_px:
        s = max_px / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = io.BytesIO()
    if alpha:
        im.save(out, 'PNG', optimize=True)
        return out.getvalue(), 'png'
    im.save(out, 'JPEG', quality=quality, optimize=True, progressive=False)
    return out.getvalue(), 'jpg'


def pack(src_dir, out_dir, max_px, max_liv, quality):
    man = json.load(open(os.path.join(src_dir, 'manifest.json'), encoding='utf-8'))
    j, bin_ = read_glb(os.path.join(src_dir, man['glb']))
    os.makedirs(os.path.join(out_dir, 't'), exist_ok=True)
    os.makedirs(os.path.join(out_dir, 'l'), exist_ok=True)

    # exterior only: drop the interior from the scene, then keep what the scene still references
    roots = [n for n in j['scenes'][0]['nodes'] if j['nodes'][n].get('name') != 'Interior']
    keep_nodes, stack = set(), list(roots)
    while stack:
        n = stack.pop()
        keep_nodes.add(n)
        stack += j['nodes'][n].get('children', [])
    for i, n in enumerate(j['nodes']):
        if i not in keep_nodes:
            n.pop('mesh', None)
            n['children'] = []
    j['scenes'][0]['nodes'] = roots
    used_mesh = sorted({j['nodes'][n]['mesh'] for n in keep_nodes if 'mesh' in j['nodes'][n]})
    mesh_map = {m: i for i, m in enumerate(used_mesh)}
    j['meshes'] = [j['meshes'][m] for m in used_mesh]
    for n in j['nodes']:
        if 'mesh' in n:
            n['mesh'] = mesh_map[n['mesh']]
        if not n.get('children'):
            n.pop('children', None)

    # accessors / bufferViews (geometry only) -> new compact bin
    used_acc, used_mat = [], []
    for m in j['meshes']:
        for p in m['primitives']:
            for a in list(p['attributes'].values()) + ([p['indices']] if 'indices' in p else []):
                if a not in used_acc:
                    used_acc.append(a)
            if 'material' in p and p['material'] not in used_mat:
                used_mat.append(p['material'])
    acc_map = {a: i for i, a in enumerate(used_acc)}
    new_bin, views, view_map = bytearray(), [], {}
    accessors = []
    for a in used_acc:
        acc = dict(j['accessors'][a])
        bv = acc['bufferView']
        if bv not in view_map:
            v = j['bufferViews'][bv]
            while len(new_bin) % 4:
                new_bin.append(0)
            nv = {k: x for k, x in v.items() if k not in ('byteOffset', 'buffer')}
            nv.update(buffer=0, byteOffset=len(new_bin))
            o = v.get('byteOffset', 0)
            new_bin += bin_[o:o + v['byteLength']]
            view_map[bv] = len(views)
            views.append(nv)
        acc['bufferView'] = view_map[bv]
        accessors.append(acc)
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]

    # materials -> textures -> images (written as files)
    mat_map = {m: i for i, m in enumerate(used_mat)}
    mats = [j['materials'][m] for m in used_mat]
    for m in j['meshes']:
        for p in m['primitives']:
            if 'material' in p:
                p['material'] = mat_map[p['material']]
    tex_refs = []
    def tex_slots(mat):
        pbr = mat.get('pbrMetallicRoughness', {})
        for holder, key in ((pbr, 'baseColorTexture'), (pbr, 'metallicRoughnessTexture'), (mat, 'emissiveTexture'), (mat, 'normalTexture'), (mat, 'occlusionTexture')):
            if key in holder:
                yield holder[key]
    for mat in mats:
        for t in tex_slots(mat):
            if t['index'] not in tex_refs:
                tex_refs.append(t['index'])
    tex_map = {t: i for i, t in enumerate(tex_refs)}
    for mat in mats:
        for t in tex_slots(mat):
            t['index'] = tex_map[t['index']]
    textures = [dict(j['textures'][t]) for t in tex_refs]
    img_refs = []
    for t in textures:
        if t['source'] not in img_refs:
            img_refs.append(t['source'])
        t['source'] = img_refs.index(t['source'])
    images = []
    for k, im in enumerate(img_refs):
        v = j['bufferViews'][j['images'][im]['bufferView']]
        o = v.get('byteOffset', 0)
        data, ext = encode(bin_[o:o + v['byteLength']], max_px, quality)
        name = f't/{k}.{ext}'
        open(os.path.join(out_dir, name), 'wb').write(data)
        images.append({'uri': name})

    open(os.path.join(out_dir, 'model.bin'), 'wb').write(new_bin)
    base = {
        'asset': {'version': '2.0', 'generator': 'SkyLine fgconv/web.py'},
        'scene': 0, 'scenes': j['scenes'], 'nodes': j['nodes'], 'meshes': j['meshes'],
        'materials': mats, 'textures': textures, 'images': images, 'samplers': j.get('samplers', []),
        'accessors': accessors, 'bufferViews': views,
        'buffers': [{'uri': 'model.bin', 'byteLength': len(new_bin)}],
    }

    # liveries: slot materials get the livery's texture
    mat_names = {m.get('name'): i for i, m in enumerate(mats)}
    slot_images = {}  # slot index -> image indices to replace
    for s in man.get('slots', []):
        idx = set()
        for mn in s['materials']:
            mi = mat_names.get(mn)
            if mi is None:
                continue
            bct = mats[mi].get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if bct is not None:
                idx.add(textures[bct['index']]['source'])
        slot_images[str(s['index'])] = sorted(idx)
    livs = man.get('liveries', [])
    default = man.get('defaultLivery') or (livs[0]['id'] if livs else '')
    livs.sort(key=lambda l: (l['id'] != default, l['name'].lower()))
    livs = livs[:max_liv]
    out_livs = []
    for l in livs:
        g = json.loads(json.dumps(base))
        for slot, rel in l['textures'].items():
            p = os.path.join(src_dir, rel)
            if not os.path.exists(p) or not slot_images.get(slot):
                continue
            data, ext = encode(open(p, 'rb').read(), max_px, quality)
            safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in l['id'])
            name = f'l/{safe}_{slot}.{ext}'
            open(os.path.join(out_dir, name), 'wb').write(data)
            for im in slot_images[slot]:
                g['images'][im] = {'uri': name}
        file = ''.join(c if c.isalnum() or c in '-_' else '_' for c in l['id']) + '.gltf'
        json.dump(g, open(os.path.join(out_dir, file), 'w'), separators=(',', ':'))
        out_livs.append({'id': l['id'], 'name': l['name'], 'file': file})
    if not out_livs:
        json.dump(base, open(os.path.join(out_dir, 'default.gltf'), 'w'), separators=(',', ':'))
        out_livs.append({'id': 'default', 'name': '기본 도색', 'file': 'default.gltf'})

    return {
        'id': man['id'], 'fdm': man['fdm'], 'name': man['name'], 'source': man.get('source', ''), 'license': man.get('license', ''),
        'bounds': man['bounds'], 'groundY': man['groundY'], 'eye': man.get('eye'),
        'poses': man.get('poses', []), 'spins': man.get('spins', []),
        'defaultLivery': out_livs[0]['id'], 'liveries': out_livs,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='Unreal/SkyLine/Aircraft')
    ap.add_argument('--out', default='web-aircraft')
    ap.add_argument('--max', type=int, default=1024)
    ap.add_argument('--liveries', type=int, default=16)
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('ids', nargs='*')
    a = ap.parse_args()
    ids = a.ids or sorted(d for d in os.listdir(a.src) if os.path.exists(os.path.join(a.src, d, 'manifest.json')) and d not in SKIP)
    index = []
    for i in ids:
        try:
            e = pack(os.path.join(a.src, i), os.path.join(a.out, i), a.max, a.liveries, a.quality)
            index.append(e)
            size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(os.path.join(a.out, i)) for f in fs)
            print(f'{i:14s} {len(e["liveries"]):3d} liveries  {size / 1e6:6.1f} MB')
        except Exception as ex:  # keep going: one broken aircraft shouldn't stop the rest
            print(f'{i}: FAILED {ex}', file=sys.stderr)
    json.dump({'aircraft': index}, open(os.path.join(a.out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
