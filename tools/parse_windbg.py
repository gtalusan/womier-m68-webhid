#!/usr/bin/env python3
"""Parse WinDbg .logopen captures (db poi(esp+4) L40) into 64-byte frames."""
import re, sys, collections

DUMP_RE = re.compile(r'^[0-9a-f]{8}\s+(?:[0-9a-f]{2}[\s-]+){8,}')

def parse(path):
    lines = [ln.rstrip('\r') for ln in open(path, encoding='utf-8', errors='replace').read().split('\n')]
    frames, cur, start = [], [], None
    def flush():
        nonlocal cur
        if len(cur) == 64:
            frames.append(bytes(cur))
        elif cur:
            print(f'  WARN: partial dump at {start} ({len(cur)} bytes)', file=sys.stderr)
        cur = []
    for ln in lines:
        m = DUMP_RE.match(ln)
        if m:
            if len(cur) == 64:
                flush()
            if not cur:
                start = ln[:8]
            body = re.sub(r'^[0-9a-f]{8}\s+', '', ln)
            tokens = re.sub(r'-', ' ', body).split()[:16]  # dash separates byte 8/9, then ascii column
            cur += [int(b, 16) for b in tokens]
        else:
            if cur: flush()
    if cur: flush()
    return frames

def main():
    frames = parse(sys.argv[1])
    print(f'frames parsed: {len(frames)}')
    bywire = collections.Counter(f[1] for f in frames)
    print('wire commands seen:', {f'0x{k:02x}': v for k, v in sorted(bywire.items())})
    # reconstruct 0x18 uploads: keyed by [2], packets by [4]
    ups = collections.defaultdict(dict)
    for f in frames:
        if f[1] == 0x18:
            ups[f[2]][f[4]] = f
    for seg, pkts in ups.items():
        order = sorted(pkts)
        print(f'\n== 0x18 upload segment [2]={seg}: {len(order)} packets, packet#s {order}')
        payload = b''.join(pkts[p][6:6 + pkts[p][5]] for p in order)
        print(f'   total payload {len(payload)} bytes')
        # interpret as uint32 LE
        vals = [int.from_bytes(payload[i:i+4], 'little') for i in range(0, len(payload)//4*4, 4)]
        print(f'   as {len(vals)} x uint32 LE:')
        for r in range(0, len(vals), 22):
            print('   ' + ' '.join(f'{v:4d}' if v < 65536 else f'{v:08x}' for v in vals[r:r+22]))

if __name__ == '__main__':
    main()
