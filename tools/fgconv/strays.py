#!/usr/bin/env python3
"""Find (and with --fix remove) stray meshes in the web aircraft: parts the conversion left floating away from the
airframe (e.g. a second copy of a nozzle 12 m behind an F-16). Every mesh primitive's world-space box is computed;
the airframe is the group of boxes connected (touching within a margin) to the biggest one; primitives of the
'Exterior' node outside that group are strays. Only glTF JSON is edited (primitives dropped), the .bin is untouched.
Usage: strays.py <public/aircraft dir> [--fix]"""
import json, sys, os, glob

def mat(n):
    if 'matrix' in n:
        m = n['matrix']; return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get('translation', [0, 0, 0]); s = n.get('scale', [1, 1, 1]); x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[r][0] * s[0], R[r][1] * s[1], R[r][2] * s[2], t[r]] for r in range(3)] + [[0, 0, 0, 1]]
def mul(a, b): return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
def ap(m, p): return [sum(m[r][k] * p[k] for k in range(3)) + m[r][3] for r in range(3)]
NORM = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}

def boxes(g):
    out = []  # (root name, mesh index, prim index, min, max)
    I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    def walk(i, M, root):
        n = g['nodes'][i]; M = mul(M, mat(n))
        if 'mesh' in n:
            for pi, pr in enumerate(g['meshes'][n['mesh']]['primitives']):
                a = g['accessors'][pr['attributes']['POSITION']]
                k = NORM.get(a['componentType'], 1) if a.get('normalized') else 1
                mi = [v / k for v in a['min']]; ma = [v / k for v in a['max']]
                corners = [ap(M, [(mi, ma)[(c >> j) & 1][j] for j in range(3)]) for c in range(8)]
                out.append((root, n['mesh'], pi, [min(c[j] for c in corners) for j in range(3)], [max(c[j] for c in corners) for j in range(3)]))
        for ch in n.get('children', []): walk(ch, M, root)
    for r in g['scenes'][g.get('scene', 0)]['nodes']: walk(r, I, g['nodes'][r].get('name', ''))
    return out

def strays(g, margin=0.6):
    b = boxes(g)
    if not b: return []
    vol = lambda x: (x[4][0] - x[3][0]) * (x[4][1] - x[3][1]) * (x[4][2] - x[3][2])
    touch = lambda p, q: all(p[3][j] - margin <= q[4][j] and q[3][j] - margin <= p[4][j] for j in range(3))
    seen = {max(range(len(b)), key=lambda i: vol(b[i]))}
    grow = True
    while grow:
        grow = False
        for i in range(len(b)):
            if i not in seen and any(touch(b[i], b[j]) for j in seen): seen.add(i); grow = True
    return [b[i] for i in range(len(b)) if i not in seen and b[i][0] == 'Exterior']

def main():
    root, fix = sys.argv[1], '--fix' in sys.argv
    for d in sorted(glob.glob(os.path.join(root, '*/'))):
        files = [f for f in glob.glob(d + '*.gltf') if not f.endswith('interior.gltf')]
        if not files: continue
        g = json.load(open(files[0]))
        bad = strays(g)
        if not bad: continue
        print(os.path.basename(d.rstrip('/')), [(m, p, [round(v, 1) for v in lo], [round(v, 1) for v in hi]) for _, m, p, lo, hi in bad])
        if fix:
            drop = {(m, p) for _, m, p, _, _ in bad}
            for f in files:   # every livery file shares the meshes: drop the same primitives everywhere
                gg = json.load(open(f))
                for mi, mesh in enumerate(gg['meshes']):
                    mesh['primitives'] = [pr for pi, pr in enumerate(mesh['primitives']) if (mi, pi) not in drop]
                json.dump(gg, open(f, 'w'), separators=(',', ':'))
main()
