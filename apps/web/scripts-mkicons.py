#!/usr/bin/env python3
"""
Icon generation for AgenSea. Derives every raster asset from the canonical
mark at design/agensea-mark-left.svg — never redraws it.

WHY PURE PYTHON: Chromium's screenshot encoder emits INDEXED-COLOUR PNGs for
low-colour images, and Next's ICO decoder rejects them with
"The PNG is not in RGBA format", failing the build. These are written as true
8-bit RGBA with 4x supersampled edges, so rounded corners stay smooth.
"""
import re, zlib, struct, sys

SRC = '/Users/minos/Projects/agensea/design/agensea-mark-left.svg'
BG  = (11, 11, 11, 255)      # --bg      #0B0B0B
FG  = (245, 245, 245, 255)   # --text    #F5F5F5
SS  = 4                      # supersampling factor

def load_cells(path=SRC):
    out = []
    for m in re.finditer(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"',
                         open(path).read()):
        x, y, w, h, r = map(float, m.groups())
        out.append(dict(x=x, y=y, w=w, h=h, r=r))
    return out

def png_rgba(width, height, rows):
    raw = bytearray()
    for r in rows:
        raw.append(0)          # filter 0 (None)
        raw.extend(r)
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)   # 8-bit RGBA
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))

def inside_rr(px, py, c):
    """Point-in-rounded-rectangle."""
    dx = max(c['x'] + c['r'] - px, 0.0, px - (c['x'] + c['w'] - c['r']))
    dy = max(c['y'] + c['r'] - py, 0.0, py - (c['y'] + c['h'] - c['r']))
    return dx * dx + dy * dy <= c['r'] * c['r']

def render(cells, size, view, centre=False, pad_frac=0.10):
    """view = (ox, oy, side) source-space square mapped onto size x size."""
    if centre:
        x0 = min(c['x'] for c in cells); y0 = min(c['y'] for c in cells)
        x1 = max(c['x'] + c['w'] for c in cells); y1 = max(c['y'] + c['h'] for c in cells)
        side = max(x1 - x0, y1 - y0) * (1 + 2 * pad_frac)
        ox = x0 + (x1 - x0) / 2 - side / 2      # centre the CONTENT, not the artboard
        oy = y0 + (y1 - y0) / 2 - side / 2
    else:
        ox, oy, side = view
    rows = []
    step = side / (size * SS)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            hits = 0
            for sy in range(SS):
                wy = oy + (py * SS + sy + 0.5) * step
                for sx in range(SS):
                    wx = ox + (px * SS + sx + 0.5) * step
                    if any(inside_rr(wx, wy, c) for c in cells):
                        hits += 1
            a = hits / (SS * SS)
            row.extend(bytes(int(round(BG[i] + (FG[i] - BG[i]) * a)) for i in range(3)) + b'\xff')
        rows.append(row)
    return png_rgba(size, size, rows)

def ico(pngs):
    n = len(pngs); off = 6 + 16 * n
    head = struct.pack('<HHH', 0, 1, n); ent = b''; pay = b''
    for size, data in pngs:
        ent += struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), off)
        pay += data; off += len(data)
    return head + ent + pay

if __name__ == '__main__':
    cells = load_cells()
    assert len(cells) == 10, f'expected 10 cells, got {len(cells)}'

    # Favicon variant A — a SUBSET of the canonical cells, not a redraw.
    # Indices are by descending area: [1] big-right, [2] big-upper-mid,
    # [7] mid-lower-left, [9] small-far-left. Keeps the size gradient legible
    # at 16px, which the full 10-cell mark cannot do (~2.8px cells).
    by_area = sorted(cells, key=lambda c: -c['w'] * c['h'])
    VARIANT_A = [by_area[i] for i in (1, 2, 7, 9)]
    pad = 26
    xs0 = min(c['x'] for c in VARIANT_A) - pad; ys0 = min(c['y'] for c in VARIANT_A) - pad
    xs1 = max(c['x'] + c['w'] for c in VARIANT_A) + pad; ys1 = max(c['y'] + c['h'] for c in VARIANT_A) + pad
    side = max(xs1 - xs0, ys1 - ys0)
    view = (xs0 - (side - (xs1 - xs0)) / 2, ys0 - (side - (ys1 - ys0)) / 2, side)

    p16 = render(VARIANT_A, 16, view)
    p32 = render(VARIANT_A, 32, view)
    open('app/favicon.ico', 'wb').write(ico([(16, p16), (32, p32)]))
    open('/tmp/icon/A16.png', 'wb').write(p16)
    open('/tmp/icon/A32.png', 'wb').write(p32)

    # apple-icon: FULL 10-cell mark, content CENTRED (the source artboard is
    # off-centre; letterboxing it raw looks like a bug on a home screen).
    open('app/apple-icon.png', 'wb').write(render(cells, 180, None, centre=True))
    print('  favicon.ico (variant A, 16+32) and apple-icon.png (10-cell, centred) written')
    for f in ('app/apple-icon.png',):
        d = open(f, 'rb').read(); w, h, bd, ct = struct.unpack('>IIBB', d[16:26])
        print(f'  {f}: {w}x{h} bitDepth={bd} colourType={ct} ({"RGBA" if ct == 6 else "NOT RGBA"})')
