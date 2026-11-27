"""Builds the vanilla area environments from a folder of scanned structures (<name>.mcstructure + scenes).

For each scan: scans/<name>.mcstructure (copied), scans/<name>.solid (one byte per block, x fastest, then z, then y;
1 = particles collide) and an entry in scans/scans.json with the size, the biome and where the structure goes so that
the ground under its centre is at y = 0.

python tools/make_scans.py <scans folder>
"""
import json
import shutil
import struct
import sys
from pathlib import Path

SCANS = ['plains', 'cherry_grove', 'desert', 'snowy_plains', 'jungle', 'swamp']
PASSABLE = ('air', 'grass', 'fern', 'flower', 'tulip', 'poppy', 'dandelion', 'daisy', 'orchid', 'allium', 'bluet',
            'cornflower', 'lily_of_the_valley', 'rose_bush', 'peony', 'lilac', 'sunflower', 'sapling', 'deadbush',
            'dead_bush', 'water', 'lava', 'vine', 'seagrass', 'kelp', 'reeds', 'sugar_cane', 'snow_layer', 'torch',
            'petals', 'pink_petals', 'leaf_litter', 'bush', 'mushroom', 'sweet_berry', 'waterlily', 'lily_pad',
            'cactus_flower', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass', 'wildflowers', 'cocoa', 'propagule')
LOW = ('air', 'short_grass', 'tallgrass', 'fern', 'snow_layer', 'leaf_litter', 'pink_petals', 'wildflowers', 'short_dry_grass')


class Reader:
    def __init__(self, data):
        self.data, self.at = data, 0
        self.int_lists = []

    def take(self, fmt):
        v = struct.unpack_from('<' + fmt, self.data, self.at)
        self.at += struct.calcsize('<' + fmt)
        return v[0]

    def string(self):
        n = self.take('H')
        s = self.data[self.at:self.at + n].decode('utf-8', 'replace')
        self.at += n
        return s

    def payload(self, tag):
        simple = {1: 'b', 2: 'h', 3: 'i', 4: 'q', 5: 'f', 6: 'd'}
        if tag in simple:
            return self.take(simple[tag])
        if tag == 7:
            n = self.take('i')
            self.at += n
            return None
        if tag == 8:
            return self.string()
        if tag == 9:
            inner, n = self.take('b'), self.take('i')
            if inner == 3:
                self.int_lists.append((self.at, n))
            return [self.payload(inner) for _ in range(n)]
        if tag == 10:
            out = {}
            while True:
                t = self.take('b')
                if t == 0:
                    return out
                key = self.string()
                out[key] = self.payload(t)
        if tag == 11:
            n = self.take('i')
            v = list(struct.unpack_from('<%di' % n, self.data, self.at))
            self.at += 4 * n
            return v
        if tag == 12:
            n = self.take('i')
            self.at += 8 * n
            return None
        raise ValueError('unknown NBT tag %d' % tag)


def read_structure(path):
    r = Reader(path.read_bytes())
    if r.take('b') != 10:
        raise ValueError(f'{path}: not an NBT compound')
    r.string()
    nbt = r.payload(10)
    sx, sy, sz = nbt['size']
    nbt['_first_layer_at'] = next(at for at, n in r.int_lists if n == sx * sy * sz)
    return nbt


def without_calibration_blocks(path, nbt):
    """The scan's bytes with the calibration concrete row turned into structure void (-1), and the NBT to match."""
    data = bytearray(path.read_bytes())
    palette = nbt['structure']['palette']['default']['block_palette']
    drop = {i for i, b in enumerate(palette) if b['name'].endswith('_concrete')}
    layer, at = nbt['structure']['block_indices'][0], nbt['_first_layer_at']
    for i, p in enumerate(layer):
        if p in drop:
            layer[i] = -1
            struct.pack_into('<i', data, at + 4 * i, -1)
    return bytes(data)


def passable(name):
    short = name.split(':')[-1]
    if short.endswith('_block') or 'leaves' in short or short.endswith('_log'):
        return False
    return any(p in short for p in PASSABLE)


def grids(nbt):
    """(solid, filled): solid = particles collide; filled = anything but air and low plants is there."""
    sx, sy, sz = nbt['size']
    st = nbt['structure']
    palette = st['palette']['default']['block_palette']
    solid_of = [0 if passable(b['name']) else 1 for b in palette]
    filled_of = [0 if b['name'].split(':')[-1] in LOW else 1 for b in palette]
    layer = st['block_indices'][0]
    solid, filled = bytearray(sx * sy * sz), bytearray(sx * sy * sz)
    for i, p in enumerate(layer):
        if p < 0:
            continue
        x, rest = divmod(i, sy * sz)
        y, z = divmod(rest, sz)
        solid[x + sx * (z + sz * y)] = solid_of[p]
        filled[x + sx * (z + sz * y)] = filled_of[p]
    return solid, filled


def clear_spot(solid, filled, size, radius=4, height=8):
    """The open, flat spot nearest the centre: same ground height and nothing standing within radius."""
    sx, sy, sz = size
    best = None
    for x in range(radius, sx - radius):
        for z in range(radius, sz - radius):
            g = ground(solid, size, x, z)
            if abs(x - sx // 2) > sx // 4 or abs(z - sz // 2) > sz // 4 or g == 0 or g + height > sy:
                continue
            ok = all(ground(solid, size, x + dx, z + dz) == g and
                     not any(filled[x + dx + sx * (z + dz + sz * y)] for y in range(g, g + height))
                     for dx in range(-radius, radius + 1) for dz in range(-radius, radius + 1))
            d = (x - sx // 2) ** 2 + (z - sz // 2) ** 2
            if ok and (best is None or d < best[0]):
                best = (d, x, g, z)
    return best and best[1:]


def try_spot(solid, filled, size, radius):
    spot = clear_spot(solid, filled, size, radius)
    if spot:
        print(f'  open spot radius {radius}: {spot}')
    return spot


def ground(cells, size, x, z):
    sx, sy, sz = size
    for y in range(sy - 1, -1, -1):
        if cells[x + sx * (z + sz * y)]:
            return y + 1
    return 0


def main():
    src = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / 'scans'
    out.mkdir(exist_ok=True)
    index = []
    for name in SCANS:
        st = src / name / f'{name}.mcstructure'
        nbt = read_structure(st)
        cleaned = without_calibration_blocks(st, nbt)
        size = nbt['size']
        cells, filled = grids(nbt)
        cx, gy, cz = next(s for s in (try_spot(cells, filled, size, r) for r in (4, 3, 2, 1, 0)) if s)
        origin = [-cx, -gy, -cz]
        (out / f'{name}.mcstructure').write_bytes(cleaned)
        (out / f'{name}.solid').write_bytes(bytes(cells))
        scene = json.loads(next((src / name).glob('*_noon_fancy.json')).read_text())
        index.append({'name': name, 'size': size, 'origin': origin, 'biome': scene.get('biome', 'minecraft:plains')})
        print(name, size, origin, f'{sum(cells)} solid')
    (out / 'scans.json').write_text(json.dumps(index, indent=1))


if __name__ == '__main__':
    main()
