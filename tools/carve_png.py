#!/usr/bin/env python3
"""Carve PNG files out of a binary, report dimensions + sizes."""
import struct
import sys
import os

def carve(path, outdir):
    data = open(path, "rb").read()
    sig = b"\x89PNG\r\n\x1a\n"
    results = []
    start = 0
    idx = 0
    while True:
        i = data.find(sig, start)
        if i < 0:
            break
        # read IHDR
        if i + 8 + 25 > len(data):
            start = i + 1
            continue
        ihdr_len = struct.unpack(">I", data[i+8:i+12])[0]
        if ihdr_len != 13 or data[i+12:i+16] != b"IHDR":
            start = i + 1
            continue
        w, h = struct.unpack(">II", data[i+16:i+24])
        # find IEND
        j = i + 8
        end = -1
        while j < len(data):
            ln = struct.unpack(">I", data[j:j+4])[0]
            if data[j+4:j+8] == b"IEND":
                end = j + 12 + ln
                break
            j += 12 + ln
            if ln > (1 << 26):
                break
        if end < 0:
            start = i + 1
            continue
        blob = data[i:end]
        out = os.path.join(outdir, f"png_{idx:03d}_{w}x{h}_{len(blob)}.png")
        with open(out, "wb") as f:
            f.write(blob)
        results.append((idx, w, h, len(blob), i, end))
        idx += 1
        start = end
    return results

if __name__ == "__main__":
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    results = carve(sys.argv[1], outdir)
    print(f"carved {len(results)} PNGs")
    for r in sorted(results, key=lambda r: -r[3])[:25]:
        print(f"  #{r[0]:03d} {r[1]}x{r[2]} {r[3]:>8} B @ 0x{r[4]:x}")
