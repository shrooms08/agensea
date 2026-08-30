import zlib, struct

def png_rgba(width, height, pixel_fn):
    """Minimal 8-bit RGBA PNG writer. Next's ICO decoder requires RGBA; the
    browser screenshot encoder emitted indexed-colour for 2-colour images,
    which failed the build with 'The PNG is not in RGBA format'."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)                      # filter type 0 (None)
        for x in range(width):
            raw.extend(pixel_fn(x, y))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # bitdepth 8, colour type 6 = RGBA
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))

BG = (11, 11, 11, 255)        # #0B0B0B
FG = (245, 245, 245, 255)     # #F5F5F5

def grid_icon(size, grid, cells):
    cs = set(map(tuple, cells))
    def px(x, y):
        gx = (x * grid) // size
        gy = (y * grid) // size
        return FG if (gx, gy) in cs else BG
    return png_rgba(size, size, px)

C    = [[3,0],[1,1],[0,2],[3,3]]                        # chosen favicon variant
FULL = [[6,0],[3,2],[5,3],[2,4],[4,5],[1,6],[6,6]]      # full 7-cell mark

open('/tmp/icon/rgba-16.png','wb').write(grid_icon(16, 4, C))
open('/tmp/icon/rgba-32.png','wb').write(grid_icon(32, 4, C))
open('app/apple-icon.png','wb').write(grid_icon(180, 8, FULL))
print('  wrote RGBA 16, 32, and apple-icon 180 (full 7-cell mark)')

# ICO container from the RGBA PNGs
imgs = [(16, open('/tmp/icon/rgba-16.png','rb').read()),
        (32, open('/tmp/icon/rgba-32.png','rb').read())]
n = len(imgs); off = 6 + 16*n
head = struct.pack('<HHH', 0, 1, n); ent = b''; pay = b''
for size, data in imgs:
    ent += struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), off)
    pay += data; off += len(data)
open('app/favicon.ico','wb').write(head + ent + pay)
print(f'  favicon.ico: {len(head+ent+pay)} bytes')

# verify colour type of each
for f in ['/tmp/icon/rgba-16.png','/tmp/icon/rgba-32.png','app/apple-icon.png']:
    d = open(f,'rb').read()
    w,h,bd,ct = struct.unpack('>IIBB', d[16:26])
    print(f'  {f}: {w}x{h} bitDepth={bd} colourType={ct} ({"RGBA" if ct==6 else "NOT RGBA"})')
