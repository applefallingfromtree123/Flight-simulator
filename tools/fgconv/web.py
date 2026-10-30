#!/usr/bin/env python3
"""Pack the converted FlightGear aircraft (Unreal/SkyLine/Aircraft) for the web version.

For every aircraft this writes   <out>/<id>/model.bin          shared exterior geometry
                                 <out>/<id>/t/<n>.jpg|png      shared exterior textures (<= MAX px)
                                 <out>/<id>/l/<livery>.jpg|png livery textures
                                 <out>/<id>/<livery>.gltf      tiny glTF per livery (same .bin, livery images)
                                 <out>/<id>/interior.gltf|.bin cockpit / cabin (loaded only in cockpit view)
                                 <out>/<id>/ti/<n>.jpg|png     interior textures
                                 <out>/<id>/screens.json       cockpit display faces (PFD/ND/EICAS) drawn live
and <out>/index.json describing poses (gear/flaps), spinning parts, eye point and liveries.

Usage: python3 tools/fgconv/web.py [--src Unreal/SkyLine/Aircraft] [--out web-aircraft] [--max 1024] [--liveries 16] [ids...]
Needs Pillow.
"""
import argparse, copy, io, json, os, struct, sys
from PIL import Image

SKIP = set()
# models that are their own aircraft in the web version (the Unreal catalog flies them with a sibling's flight model)
WEB_FDM = {'a320-cfm': 'a320-cfm', 'a320-iae': 'a320-iae', 'a320neo-cfm': 'a320neo-cfm', 'erj145': 'erj145'}
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    data = open(path, 'rb').read()
    jl = struct.unpack('<I', data[12:16])[0]
    j = json.loads(data[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', data[off:off + 4])[0]
    return j, data[off + 8:off + 8 + bl]


def read_accessor(j, bin_, a):
    acc = j['accessors'][a]
    v = j['bufferViews'][acc['bufferView']]
    fmt, size = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    stride = v.get('byteStride', size * n)
    base = v.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = []
    for i in range(acc['count']):
        out.append(struct.unpack_from('<' + fmt * n, bin_, base + i * stride))
    return out


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


def subset(j0, bin_, keep_root, out_dir, tdir, bin_name, max_px, quality):
    """glTF (dict) holding only the scene roots accepted by keep_root, with a compact .bin and texture files."""
    j = copy.deepcopy(j0)
    os.makedirs(os.path.join(out_dir, tdir), exist_ok=True)
    roots = [n for n in j['scenes'][0]['nodes'] if keep_root(j['nodes'][n].get('name', ''))]
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
    new_bin, views, view_map, accessors = bytearray(), [], {}, []
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

    def tex_slots(mat):
        pbr = mat.get('pbrMetallicRoughness', {})
        for holder, key in ((pbr, 'baseColorTexture'), (pbr, 'metallicRoughnessTexture'), (mat, 'emissiveTexture'), (mat, 'normalTexture'), (mat, 'occlusionTexture')):
            if key in holder:
                yield holder[key]
    tex_refs = []
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
        name = f'{tdir}/{k}.{ext}'
        open(os.path.join(out_dir, name), 'wb').write(data)
        images.append({'uri': name})

    open(os.path.join(out_dir, bin_name), 'wb').write(new_bin)
    return {
        'asset': {'version': '2.0', 'generator': 'SkyLine fgconv/web.py'},
        'scene': 0, 'scenes': j['scenes'], 'nodes': j['nodes'], 'meshes': j['meshes'],
        'materials': mats, 'textures': textures, 'images': images, 'samplers': j.get('samplers', []),
        'accessors': accessors, 'bufferViews': views,
        'buffers': [{'uri': bin_name, 'byteLength': len(new_bin)}],
    }


def plane_extents(P, tris):
    """Sorted (thickness, width, height) of a point set measured in the plane of its largest triangle."""
    sub = lambda a, b: (a[0] - b[0], a[1] - b[1], a[2] - b[2])
    cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    best, n = 0, None
    for a, b, c in tris:
        x = cross(sub(b, a), sub(c, a))
        l = dot(x, x) ** 0.5
        if l > best:
            best, n, e = l, tuple(v / l for v in x), sub(b, a)
    if n is None or best < 1e-8:
        return None
    el = dot(e, e) ** 0.5
    u = tuple(v / el for v in e)
    v = cross(n, u)
    span = lambda ax: max(dot(p, ax) for p in P) - min(dot(p, ax) for p in P)
    return sorted([span(n), span(u), span(v)])


def face_uvs(P, tris):
    sub = lambda a, b: (a[0] - b[0], a[1] - b[1], a[2] - b[2])
    cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    norm = lambda a: tuple(x / (dot(a, a) ** 0.5 or 1) for x in a)
    a, b, c = max(tris, key=lambda t: dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), cross(sub(t[1], t[0]), sub(t[2], t[0]))))
    n = norm(cross(sub(b, a), sub(c, a)))
    up = sub((0, 1, 0), tuple(x * n[1] for x in n))
    if dot(up, up) < 0.05:  # face lying flat: 'up' is forward
        up = sub((0, 0, 1), tuple(x * n[2] for x in n))
    up = norm(up)
    right = norm(cross(up, n))
    if right[0] > 0:  # pilot's right is -X
        right = tuple(-x for x in right)
    us = [dot(p, right) for p in P]
    vs = [-dot(p, up) for p in P]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    if u1 - u0 < 1e-4 or v1 - v0 < 1e-4:
        return None
    return [((u - u0) / (u1 - u0), (v - v0) / (v1 - v0)) for u, v in zip(us, vs)]


def display_pieces(j, bin_, p):
    """Connected pieces of a primitive that are shaped like a display: (vertex positions, triangles, uvs, centre)."""
    pos = read_accessor(j, bin_, p['attributes']['POSITION'])
    idx = [i[0] for i in read_accessor(j, bin_, p['indices'])]
    tris = [idx[i:i + 3] for i in range(0, len(idx) - 2, 3)]
    # connected pieces (vertices are shared within a piece; also merge coincident positions)
    parent = list(range(len(pos)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    key = {}
    for i, q in enumerate(pos):
        k = tuple(round(c, 4) for c in q)
        if k in key:
            parent[find(i)] = find(key[k])
        else:
            key[k] = i
    for a, b, c in tris:
        parent[find(b)] = find(a)
        parent[find(c)] = find(a)
    groups = {}
    for t in tris:
        groups.setdefault(find(t[0]), []).append(t)
    out = []
    for g in groups.values():
        if len(g) > 400:
            continue
        vs = sorted({v for t in g for v in t})
        P = [pos[v] for v in vs]
        T = [[pos[v] for v in t] for t in g]
        big = plane_extents(P, T)
        # a display face: thin, between 10 and 45 cm across, not a long strip
        if big is None or not (big[0] < 0.012 and 0.1 < big[2] < 0.45 and big[1] > 0.05 and big[2] / big[1] < 2.6):
            continue
        # UVs projected on the face (the models' own UVs point into texture atlases, or are missing):
        # u along the pilot's right (-X), v down (-Y), both in the face's plane
        U = face_uvs(P, T)
        if U is None:
            continue
        remap = {v: i for i, v in enumerate(vs)}
        out.append({'P': P, 'U': U, 'idx': [remap[v] for t in g for v in t], 'c': tuple(sum(q[i] for q in P) / len(P) for i in range(3))})
    return out


def screen_faces(j, bin_, man):
    """Display faces of the cockpit, drawn live by the web cockpit: pieces of the converter's screen materials,
    plus dark untextured display-shaped panels beside them (screens the converter didn't recognise)."""
    kinds = {}
    for s in man.get('screens', []):
        for mn in s['materials']:
            kinds[mn] = s['kind']
    inter = [n for n in j['nodes'] if n.get('name') == 'Interior' and 'mesh' in n]
    if not kinds or not inter:
        return []
    prims = j['meshes'][inter[0]['mesh']]['primitives']
    faces = []
    for p in prims:
        mat = j['materials'][p['material']].get('name', '') if 'material' in p else ''
        if mat in kinds and 'indices' in p:
            faces += [dict(f, kind=kinds[mat]) for f in display_pieces(j, bin_, p)]
    if not faces:
        return []
    for p in prims:
        if 'material' not in p or 'indices' not in p:
            continue
        m = j['materials'][p['material']]
        pbr = m.get('pbrMetallicRoughness', {})
        col = pbr.get('baseColorFactor', [1, 1, 1, 1])
        if m.get('name', '') in kinds or 'baseColorTexture' in pbr or 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2] > 0.12:
            continue
        for f in display_pieces(j, bin_, p):
            near_row = any(abs(f['c'][1] - g['c'][1]) < 0.12 and abs(f['c'][2] - g['c'][2]) < 0.15 for g in faces)
            overlaps = any(sum((a - b) ** 2 for a, b in zip(f['c'], g['c'])) < 0.1 ** 2 for g in faces)
            if near_row and not overlaps:
                faces.append(dict(f, kind='ND'))
    # what each display shows, by position: centre line -> engines; per side the outboard one of the main row -> PFD, next -> ND
    for f in faces:
        if abs(f['c'][0]) < 0.15 and f['kind'] in ('ND', 'MFD'):
            f['kind'] = 'EICAS'
    for side in (1, -1):
        row = [f for f in faces if f['c'][0] * side > 0.15]
        if not row:
            continue
        top = max(f['c'][1] for f in row)
        row = sorted((f for f in row if top - f['c'][1] < 0.12), key=lambda f: -abs(f['c'][0]))
        if len(row) >= 2:
            row[0]['kind'], row[1]['kind'] = 'PFD', 'ND'
    return [{'kind': f['kind'], 'pos': [round(c, 5) for q in f['P'] for c in q], 'uv': [round(c, 5) for u in f['U'] for c in u], 'idx': f['idx']} for f in faces]


def pack(src_dir, out_dir, max_px, max_liv, quality, interior_px):
    man = json.load(open(os.path.join(src_dir, 'manifest.json'), encoding='utf-8'))
    j, bin_ = read_glb(os.path.join(src_dir, man['glb']))
    os.makedirs(os.path.join(out_dir, 'l'), exist_ok=True)
    base = subset(j, bin_, lambda n: n != 'Interior', out_dir, 't', 'model.bin', max_px, quality)
    mats, textures = base['materials'], base['textures']
    # glossier paint and clear glass: the web scene lights models with the sky's reflections (PBR)
    for m in mats:
        pbr = m.setdefault('pbrMetallicRoughness', {})
        name = m.get('name', '')
        if name.startswith('LIVERY'):
            pbr['roughnessFactor'] = min(pbr.get('roughnessFactor', 1), 0.32)
            pbr['metallicFactor'] = 0.0
        elif name.startswith('GLASS'):
            pbr['roughnessFactor'] = 0.05

    has_interior = any(n.get('name') == 'Interior' and 'mesh' in n for n in j['nodes'])
    if has_interior:
        inter = subset(j, bin_, lambda n: n == 'Interior', out_dir, 'ti', 'interior.bin', interior_px, quality)
        json.dump(inter, open(os.path.join(out_dir, 'interior.gltf'), 'w'), separators=(',', ':'))
        faces = screen_faces(j, bin_, man)
        if faces:
            json.dump(faces, open(os.path.join(out_dir, 'screens.json'), 'w'), separators=(',', ':'))
    else:
        faces = []

    # liveries: slot materials get the livery's texture
    mat_names = {m.get('name'): i for i, m in enumerate(mats)}
    slot_images = {}
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
    livs = livs[:max_liv] if max_liv > 0 else livs
    safe = lambda s: ''.join(c if c.isalnum() or c in '-_' else '_' for c in s)
    out_livs = []
    for l in livs:
        g = json.loads(json.dumps(base))
        for slot, rel in l['textures'].items():
            p = os.path.join(src_dir, rel)
            if not os.path.exists(p) or not slot_images.get(slot):
                continue
            data, ext = encode(open(p, 'rb').read(), max_px, quality)
            name = f'l/{safe(l["id"])}_{slot}.{ext}'
            open(os.path.join(out_dir, name), 'wb').write(data)
            for im in slot_images[slot]:
                g['images'][im] = {'uri': name}
        file = safe(l['id']) + '.gltf'
        json.dump(g, open(os.path.join(out_dir, file), 'w'), separators=(',', ':'))
        out_livs.append({'id': l['id'], 'name': l['name'], 'file': file})
    if not out_livs:
        json.dump(base, open(os.path.join(out_dir, 'default.gltf'), 'w'), separators=(',', ':'))
        out_livs.append({'id': 'default', 'name': '기본 도색', 'file': 'default.gltf'})

    return {
        'id': man['id'], 'fdm': WEB_FDM.get(man['id'], man['fdm']), 'name': man['name'], 'source': man.get('source', ''), 'license': man.get('license', ''),
        'bounds': man['bounds'], 'groundY': man['groundY'], 'eye': man.get('eye'),
        'interior': has_interior, 'screens': len(faces),
        'poses': man.get('poses', []), 'spins': man.get('spins', []),
        'defaultLivery': out_livs[0]['id'], 'liveries': out_livs,
    }


def dedupe(out, ids):
    """Identical files across aircraft (A320 family cockpits, the Dreamlifter's 747 parts) are stored once:
    later copies are deleted and their glTFs point at the first one ('../<id>/<path>')."""
    import hashlib
    owner, saved = {}, 0
    for i in ids:
        d = os.path.join(out, i)
        if not os.path.isdir(d):
            continue
        gltfs = [f for f in os.listdir(d) if f.endswith('.gltf')]
        docs = {f: json.load(open(os.path.join(d, f))) for f in gltfs}
        local = {}
        for doc in docs.values():
            for item in doc.get('images', []) + doc.get('buffers', []):
                u = item.get('uri', '')
                if not u or u.startswith('..') or u in local:
                    continue
                p = os.path.join(d, u)
                if not os.path.exists(p):
                    continue
                h = hashlib.sha1(open(p, 'rb').read()).hexdigest()
                local[u] = owner[h] if h in owner and owner[h][0] != i else None
                owner.setdefault(h, (i, u))
        moved = {u: f'../{o[0]}/{o[1]}' for u, o in local.items() if o}
        if not moved:
            continue
        for f, doc in docs.items():
            for item in doc.get('images', []) + doc.get('buffers', []):
                if item.get('uri') in moved:
                    item['uri'] = moved[item['uri']]
            json.dump(doc, open(os.path.join(d, f), 'w'), separators=(',', ':'))
        for u in moved:
            saved += os.path.getsize(os.path.join(d, u))
            os.remove(os.path.join(d, u))
    print(f'dedupe: {saved / 1e6:.1f} MB of identical files shared')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='Unreal/SkyLine/Aircraft')
    ap.add_argument('--out', default='web-aircraft')
    ap.add_argument('--max', type=int, default=1024)
    ap.add_argument('--interior-max', type=int, default=1024)
    ap.add_argument('--liveries', type=int, default=0, help='max liveries per aircraft (0 = all)')
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('ids', nargs='*')
    a = ap.parse_args()
    ids = a.ids or sorted(d for d in os.listdir(a.src) if os.path.exists(os.path.join(a.src, d, 'manifest.json')) and d not in SKIP)
    index = []
    for i in ids:
        try:
            e = pack(os.path.join(a.src, i), os.path.join(a.out, i), a.max, a.liveries, a.quality, a.interior_max)
            index.append(e)
            size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(os.path.join(a.out, i)) for f in fs)
            print(f'{i:14s} {len(e["liveries"]):3d} liveries  interior={e["interior"]} screens={e["screens"]:2d}  {size / 1e6:6.1f} MB')
        except Exception as ex:  # keep going: one broken aircraft shouldn't stop the rest
            print(f'{i}: FAILED {ex}', file=sys.stderr)
    json.dump({'aircraft': index}, open(os.path.join(a.out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    if any(e['id'] == 'b747-400' for e in index):
        import lcf  # Dreamlifter: the 747-400 with the LCF fuselage
        lcf.build(a.out, a.src, a.max)
    dedupe(a.out, [e['id'] for e in json.load(open(os.path.join(a.out, 'index.json'), encoding='utf-8'))['aircraft']])


if __name__ == '__main__':
    main()
