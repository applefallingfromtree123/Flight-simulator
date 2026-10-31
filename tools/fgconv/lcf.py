#!/usr/bin/env python3
"""Boeing 747-400LCF Dreamlifter for the web version, built from the packed FlightGear 747-400.

FlightGear has no Dreamlifter, so this takes the 747-400 (wings, engines, gear, tail, cockpit) and adds
  - the enlarged cargo fuselage ("bulge") as a new mesh, painted white with the DREAM)LIFTER title, and
  - a Dreamlifter repaint of the 747-400's livery texture (white fuselage, blue fin, no cabin windows).
Run after web.py (it calls this when the 747-400 was packed):  python3 tools/fgconv/lcf.py --out web-aircraft
Needs Pillow.
"""
import argparse, json, math, os, shutil, struct
from PIL import Image, ImageDraw, ImageFont

SRC_ID, ID = 'b747-400', 'b747-lcf'
NAVY, BLUE, WHITE = (28, 44, 110), (36, 86, 190), (246, 247, 249)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

# Cross-section control points along the fuselage (glTF frame: +Z nose, +Y up, m).
# The lower lobe hugs the 747's own fuselage; the upper lobe is the Dreamlifter's cargo bulge.
#   z      lower-lobe bottom, half width     bulge top, upper half width at the centre, extra width of the bulge
PROFILE = [
    (21.6, -2.62, 2.85, 4.80, 2.00, 0.00),
    (19.5, -2.76, 3.07, 5.35, 2.90, 0.10),
    (17.0, -2.90, 3.24, 5.95, 3.24, 0.35),
    (14.0, -2.95, 3.30, 6.70, 3.30, 0.65),
    (10.0, -2.95, 3.33, 7.35, 3.33, 0.90),
    (5.0, -2.95, 3.35, 7.75, 3.35, 1.00),
    (-14.0, -2.95, 3.33, 7.75, 3.33, 1.00),
    (-17.5, -2.50, 3.20, 7.55, 3.20, 0.95),
    (-21.0, -1.70, 3.02, 7.20, 3.02, 0.85),
    (-24.0, -0.95, 2.82, 6.70, 2.82, 0.70),
    (-27.0, -0.10, 2.45, 6.05, 2.45, 0.50),
    (-30.0, 1.15, 1.85, 5.35, 1.85, 0.30),
    (-32.5, 2.30, 1.35, 4.80, 1.35, 0.12),
    (-34.3, 3.00, 0.95, 4.45, 0.95, 0.00),
]
RING = 72
MARGIN = 0.05


def lerp_profile(z):
    p = PROFILE
    if z >= p[0][0]:
        return p[0][1:]
    for a, b in zip(p, p[1:]):
        if b[0] <= z <= a[0]:
            t = (a[0] - z) / (a[0] - b[0])
            t = t * t * (3 - 2 * t)  # smoothstep between control points
            return tuple(x + (y - x) * t for x, y in zip(a[1:], b[1:]))
    return p[-1][1:]


def section(z, phi):
    """Point on the hull at station z, angle phi (0 = top, pi/2 = left (+X), pi = bottom)."""
    ybot, wbot, ytop, wup, bulge = lerp_profile(z)
    ybot -= MARGIN
    wbot += MARGIN
    y0 = ybot + wbot  # centre of the (round) lower lobe
    s, c = math.sin(phi), math.cos(phi)
    side = 1 if s >= 0 else -1
    if c >= 0:  # upper half: bulge, widest above the centre
        x = wup * abs(s) + bulge * math.sin(2 * min(phi, 2 * math.pi - phi))
        y = y0 + (ytop - y0) * c
    else:
        x = wbot * abs(s)
        y = y0 + (y0 - ybot) * c
    return (side * x, y, z)


def build_hull():
    z_front, z_back = PROFILE[0][0], PROFILE[-1][0]
    n_st = int((z_front - z_back) / 0.5) + 1
    zs = [z_front - i * (z_front - z_back) / (n_st - 1) for i in range(n_st)]
    pos, uv = [], []
    for i, z in enumerate(zs):
        for k in range(RING + 1):  # last column repeats the first with u/v seam
            phi = 2 * math.pi * k / RING
            pos.append(section(z, phi))
            uv.append((i / (n_st - 1), k / RING))
    idx = []
    W = RING + 1
    for i in range(n_st - 1):
        for k in range(RING):
            a, b, c, d = i * W + k, i * W + k + 1, (i + 1) * W + k + 1, (i + 1) * W + k
            idx += [a, d, c, a, c, b]
    # end caps (fan to the ring centre)
    for i, flip in ((0, False), (n_st - 1, True)):
        ring = [pos[i * W + k] for k in range(RING)]
        cx = sum(p[0] for p in ring) / RING
        cy = sum(p[1] for p in ring) / RING
        ci = len(pos)
        pos.append((cx, cy, zs[i]))
        uv.append((0.999 if flip else 0.001, 0.5))
        for k in range(RING):
            a, b = i * W + k, i * W + k + 1
            idx += [ci, b, a] if not flip else [ci, a, b]
    # smooth normals
    nrm = [[0.0, 0.0, 0.0] for _ in pos]
    for t in range(0, len(idx), 3):
        a, b, c = (pos[idx[t + j]] for j in range(3))
        u = [b[j] - a[j] for j in range(3)]
        v = [c[j] - a[j] for j in range(3)]
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        for j in range(3):
            for q in range(3):
                nrm[idx[t + j]][q] += n[q]
    # the duplicated seam column shares its normal with the first column
    for i in range(n_st):
        a, b = i * W, i * W + RING
        s = [nrm[a][q] + nrm[b][q] for q in range(3)]
        nrm[a] = nrm[b] = s
    nrm = [tuple(x / (math.sqrt(sum(y * y for y in n)) or 1) for x in n) for n in nrm]
    # make sure faces wind outward (normal away from the axis at the widest section)
    mid = (n_st // 2) * W + RING // 4
    out = section(zs[n_st // 2], math.pi / 2)
    if nrm[mid][0] * out[0] < 0:
        idx = [v for t in range(0, len(idx), 3) for v in (idx[t], idx[t + 2], idx[t + 1])]
        nrm = [tuple(-x for x in n) for n in nrm]
    return pos, nrm, uv, idx, zs


def arc_len(z, phi0, phi1, n=40):
    s, p = 0.0, section(z, phi0)
    for i in range(1, n + 1):
        q = section(z, phi0 + (phi1 - phi0) * i / n)
        s += math.dist(p, q)
        p = q
    return s


def hull_texture(path, zs):
    """White hull with the DREAM)LIFTER title on both sides (u: nose -> tail, v: top -> left -> bottom -> right)."""
    W, H = 2048, 1024
    img = Image.new('RGB', (W, H), WHITE)
    length = zs[0] - zs[-1]
    z_title = -3.0
    circ = arc_len(z_title, 0, 2 * math.pi, 200)
    title_len, title_h = 21.0, 1.9          # metres on the aircraft
    phi_c = math.radians(78)                # title centre: just above the widest part of the bulge
    tw = int(title_len / length * W)
    th = int(title_h / circ * H)
    # render the title flat, then squeeze it into the texture's (non-square) metres-per-pixel
    big = Image.new('RGBA', (3000, 300), (0, 0, 0, 0))
    g = ImageDraw.Draw(big)
    f = ImageFont.truetype(FONT, 220)
    x = 0
    for word in ('DREAM', None, 'LIFTER'):
        if word is None:  # the crescent between the words
            g.arc((x - 60, -10, x + 130, 290), start=-60, end=60, fill=NAVY + (255,), width=30)
            x += 190
            continue
        for ch in word:
            g.text((x, 20), ch, font=f, fill=NAVY + (255,))
            x += int(g.textlength(ch, font=f)) + 34  # wide letter spacing like the real title
        x += 40
    big = big.crop((0, 0, x, 300)).resize((tw, th), Image.LANCZOS)
    u_c = (zs[0] - z_title) / length
    v_left = arc_len(z_title, 0, phi_c) / circ
    img.paste(big, (int(u_c * W - tw / 2), int(v_left * H - th / 2)), big)
    # right side: reads tail -> nose and 'up' is towards smaller... larger v: rotate 180 degrees
    v_right = 1 - v_left
    img.paste(big.rotate(180), (int(u_c * W - tw / 2), int(v_right * H - th / 2)), big.rotate(180))
    # small registration near the tail on both sides
    reg = Image.new('RGBA', (900, 160), (0, 0, 0, 0))
    ImageDraw.Draw(reg).text((0, 0), 'N747BC', font=ImageFont.truetype(FONT, 140), fill=NAVY + (255,))
    reg = reg.resize((int(2.6 / length * W), int(0.45 / circ * H)), Image.LANCZOS)
    u_r = (zs[0] + 27.0) / length
    v_r = arc_len(-27.0, 0, math.radians(60)) / arc_len(-27.0, 0, 2 * math.pi, 200)
    img.paste(reg, (int(u_r * W), int(v_r * H)), reg)
    img.paste(reg.rotate(180), (int(u_r * W), int((1 - v_r) * H - reg.height)), reg.rotate(180))
    img.save(path, 'JPEG', quality=88)


def repaint(src_png, out_jpg, max_px):
    """Dreamlifter colours on the 747-400 livery template: white fuselage without cabin windows, blue fin."""
    im = Image.open(src_png).convert('RGB')
    W, H = im.size
    px = im.load()
    bg = px[W - 2, H - 2]
    near = lambda c, d, tol=40: abs(c[0] - d[0]) + abs(c[1] - d[1]) + abs(c[2] - d[2]) < tol
    for y in range(H):
        fy = y / H
        for x in range(W):
            c = px[x, y]
            if near(c, bg, 24):
                continue
            fx = x / W
            if fx < 0.585 and fy < 0.555:            # fuselage, both sides
                px[x, y] = WHITE
            elif 0.585 <= fx < 0.75 and fy < 0.24:   # engines: red stripe -> white
                if c[0] > 150 and c[1] < 90:
                    px[x, y] = WHITE
            elif fx < 0.3 and fy > 0.62:             # vertical stabiliser, both sides
                px[x, y] = BLUE
    if max(W, H) > max_px:
        s = max_px / max(W, H)
        im = im.resize((int(W * s), int(H * s)), Image.LANCZOS)
    im.save(out_jpg, 'JPEG', quality=86)


def build(out, src_root='Unreal/SkyLine/Aircraft', max_px=1024):
    src = os.path.join(out, SRC_ID)
    dst = os.path.join(out, ID)
    if not os.path.exists(os.path.join(src, 'BOE.gltf')):
        print('lcf: packed 747-400 (BOE livery) not found, skipped')
        return None
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns('l', '*.gltf'))
    shutil.copy(os.path.join(src, 'interior.gltf'), dst) if os.path.exists(os.path.join(src, 'interior.gltf')) else None
    os.makedirs(os.path.join(dst, 'l'), exist_ok=True)
    repaint(os.path.join(src_root, SRC_ID, 'Liveries', 'BOE_S0.png'), os.path.join(dst, 'l', 'DLF_0.jpg'), max(max_px, 2048))

    g = json.load(open(os.path.join(src, 'BOE.gltf')))
    g['images'] = [{'uri': 'l/DLF_0.jpg'} if im.get('uri', '').startswith('l/BOE_0.') else im for im in g['images']]

    pos, nrm, uv, idx, zs = build_hull()
    hull_texture(os.path.join(dst, 'l', 'hull.jpg'), zs)
    bin_ = bytearray()
    views = []
    def add_view(data, target):
        while len(bin_) % 4:
            bin_.append(0)
        views.append({'buffer': len(g['buffers']), 'byteOffset': len(bin_), 'byteLength': len(data), 'target': target})
        bin_.extend(data)
        return len(g['bufferViews']) + len(views) - 1
    vp = add_view(struct.pack(f'<{len(pos) * 3}f', *[c for p in pos for c in p]), 34962)
    vn = add_view(struct.pack(f'<{len(nrm) * 3}f', *[c for n in nrm for c in n]), 34962)
    vt = add_view(struct.pack(f'<{len(uv) * 2}f', *[c for t in uv for c in t]), 34962)
    vi = add_view(struct.pack(f'<{len(idx)}I', *idx), 34963)
    a0 = len(g['accessors'])
    g['accessors'] += [
        {'bufferView': vp, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
         'min': [min(p[i] for p in pos) for i in range(3)], 'max': [max(p[i] for p in pos) for i in range(3)]},
        {'bufferView': vn, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'},
        {'bufferView': vt, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
        {'bufferView': vi, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
    ]
    g['bufferViews'] += views
    g['buffers'].append({'uri': 'lcf.bin', 'byteLength': len(bin_)})
    open(os.path.join(dst, 'lcf.bin'), 'wb').write(bin_)
    g['images'].append({'uri': 'l/hull.jpg'})
    g['textures'].append({'source': len(g['images']) - 1, 'sampler': 0})
    g['materials'].append({'name': 'LCF_hull', 'pbrMetallicRoughness': {'baseColorTexture': {'index': len(g['textures']) - 1},
                           'metallicFactor': 0.0, 'roughnessFactor': 0.32},
                           'extensions': {'KHR_materials_clearcoat': {'clearcoatFactor': 0.6, 'clearcoatRoughnessFactor': 0.08}}})
    if 'KHR_materials_clearcoat' not in g.setdefault('extensionsUsed', []):
        g['extensionsUsed'].append('KHR_materials_clearcoat')
    g['meshes'].append({'name': 'LCF_Body', 'primitives': [{'attributes': {'POSITION': a0, 'NORMAL': a0 + 1, 'TEXCOORD_0': a0 + 2},
                                                             'indices': a0 + 3, 'material': len(g['materials']) - 1}]})
    g['nodes'].append({'name': 'LCF_Body', 'mesh': len(g['meshes']) - 1})
    g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    json.dump(g, open(os.path.join(dst, 'DLF.gltf'), 'w'), separators=(',', ':'))

    idx_path = os.path.join(out, 'index.json')
    index = json.load(open(idx_path, encoding='utf-8'))
    base = next(e for e in index['aircraft'] if e['id'] == SRC_ID)
    e = json.loads(json.dumps(base))
    e.update(id=ID, fdm=ID, name='Boeing 747-400LCF Dreamlifter',
             source=base['source'] + ' + SkyLine LCF fuselage (tools/fgconv/lcf.py)',
             defaultLivery='DLF', liveries=[{'id': 'DLF', 'name': 'Boeing Dreamlifter', 'file': 'DLF.gltf'}])
    e['bounds']['max'][1] = max(e['bounds']['max'][1], max(p[1] for p in pos))
    index['aircraft'] = [x for x in index['aircraft'] if x['id'] != ID] + [e]
    json.dump(index, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(dst) for f in fs)
    print(f'{ID:14s}   1 liveries  (747-400 + LCF fuselage)  {size / 1e6:6.1f} MB')
    return e


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='web-aircraft')
    ap.add_argument('--src', default='Unreal/SkyLine/Aircraft')
    a = ap.parse_args()
    build(a.out, a.src)
