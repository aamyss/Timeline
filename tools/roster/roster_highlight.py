#!/usr/bin/env python3
"""Highlight one officer's cells on a photographed duty roster, for every officer.

Usage: python3 roster_highlight.py photo.jpg table.json out_dir/

table.json:
{
  "title": "เวร พ.ย. 2569",
  "people": {"AB": "ร.ต.ท.สมชาย", ...},          # code -> name as printed
  "columns": ["รับแจ้งความ", "รับแจ้งความ", "รับแจ้งความ", "ฝากขัง", "ออนไลน์"],
  "rows": [["DN","CH","JS","TW","SK"], ...]        # one list per day, "" = empty cell
}
The table is found from its ruled lines, so a slightly tilted photo is fine.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CANDIDATES = [os.path.join(HERE, 'fonts', 'Loma-Bold.otf'), '/usr/share/fonts/opentype/tlwg/Loma-Bold.otf']
FONT_BOLD = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None) or sys.exit('Thai font not found')


def groups(idx, gap=3):
    out = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return [float(np.mean(g)) for g in out]


def _consistent(vals, n):
    """First n values whose spacing looks like a table (no missing or extra line)."""
    if len(vals) < n:
        return None
    vals = vals[:n]
    gaps = np.diff(vals[1:])                 # skip the taller header row
    med = np.median(gaps)
    return vals if np.all(np.abs(gaps - med) < 0.35 * med) else None


def find_grid(img, n_rows, n_cols):
    """Fitted table lines as curves: horizontal y = h(x), vertical x = v(y) (2nd-degree, so a slightly
    bent page still lines up). n_rows+2 horizontal lines (top, header, rows), n_cols+3 vertical lines."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15)
    H, W = g.shape
    hmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (W // 18, 1)))
    vmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, H // 37)))
    n_v, n_h = n_cols + 3, n_rows + 2

    hs = []
    for x0 in np.linspace(W * 0.12, W * 0.92, 15).astype(int):
        prof = hmask[:, x0 - 12:x0 + 12].sum(axis=1)
        ys = _consistent(groups(np.where(prof > 255 * 12)[0]), n_h)   # from the top: the footer adds lines
        if ys is not None:
            hs.append((x0, ys))
    if len(hs) < 4:
        raise SystemExit('Could not find the table rows')
    deg_h = 2 if len(hs) >= 6 else 1
    hlines = [np.poly1d(np.polyfit([x for x, _ in hs], [y[i] for _, y in hs], deg_h)) for i in range(n_h)]

    vs = []
    for i in range(2, n_h - 1, 2):
        yc = int(hlines[i](W / 2) + (hlines[i + 1](W / 2) - hlines[i](W / 2)) / 2)
        prof = vmask[yc - 6:yc + 6].sum(axis=0)
        xs = groups(np.where(prof > 255 * 6)[0])
        if len(xs) >= n_v:
            vs.append((yc, xs[-n_v:]))                                 # from the right: the page edge adds lines
    if len(vs) < 4:
        raise SystemExit('Could not find the table columns')
    deg_v = 2 if len(vs) >= 6 else 1
    vlines = [np.poly1d(np.polyfit([y for y, _ in vs], [x[j] for _, x in vs], deg_v)) for j in range(n_v)]
    return hlines, vlines


def corner(h, v):
    """Where horizontal y = h(x) meets vertical x = v(y)."""
    y = h(v(0.0))
    for _ in range(6):
        x = v(y)
        y = h(x)
    return v(y), y


def cell_poly(hlines, vlines, r, c, inset=4):
    """Row r (0-based day), column c (0-based duty column, after the day and date columns)."""
    top, bot = hlines[r + 1], hlines[r + 2]
    left, right = vlines[c + 2], vlines[c + 3]
    pts = np.array([corner(top, left), corner(top, right), corner(bot, right), corner(bot, left)])
    centre = pts.mean(axis=0)
    return pts + np.sign(centre - pts) * inset


def render(img, hlines, vlines, cells, name, summary, out_path):
    fill = np.array((245, 205, 120), np.float32)   # BGR light blue, multiplied so the text stays readable
    edge = (170, 110, 30)
    mask = np.zeros(img.shape[:2], np.uint8)
    for r, c in cells:
        cv2.fillPoly(mask, [cell_poly(hlines, vlines, r, c).astype(np.int32)], 255)
    blended = img.copy()
    sel = mask > 0
    blended[sel] = (img[sel].astype(np.float32) * fill / 255.0).astype(np.uint8)
    for r, c in cells:
        p = cell_poly(hlines, vlines, r, c).astype(np.int32)
        cv2.polylines(blended, [p], True, edge, 3, cv2.LINE_AA)

    photo = Image.fromarray(cv2.cvtColor(blended, cv2.COLOR_BGR2RGB))
    W = photo.width
    big = ImageFont.truetype(FONT_BOLD, int(W * 0.036))
    small = ImageFont.truetype(FONT_BOLD, int(W * 0.024))
    band = int(W * 0.10)
    out = Image.new('RGB', (W, photo.height + band), (255, 255, 255))
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, W, band], fill=(123, 211, 247))
    d.rectangle([0, band - 6, W, band], fill=(23, 110, 170))
    d.text((int(W * 0.03), int(band * 0.12)), name, font=big, fill=(10, 30, 60))
    d.text((int(W * 0.03), int(band * 0.56)), summary, font=small, fill=(10, 30, 60))
    out.paste(photo, (0, band))
    out.save(out_path, quality=92)


def main(photo, table_path, out_dir):
    t = json.load(open(table_path, encoding='utf-8'))
    img = cv2.imread(photo)
    rows, cols = t['rows'], t['columns']
    hlines, vlines = find_grid(img, len(rows), len(cols))
    os.makedirs(out_dir, exist_ok=True)
    report = {}
    for code, name in t['people'].items():
        cells = [(r, c) for r, row in enumerate(rows) for c, v in enumerate(row) if v == code]
        if not cells:
            continue
        counts = {}
        for _, c in cells:
            counts[cols[c]] = counts.get(cols[c], 0) + 1
        parts = []
        for label in dict.fromkeys(cols):
            if counts.get(label):
                unit = 'เวร' if label == 'รับแจ้งความ' else 'วัน'
                parts.append('%s %d %s' % (label, counts[label], unit))
        summary = t['title'] + '  •  ' + '  •  '.join(parts)
        path = os.path.join(out_dir, '%s_%s.jpg' % (t.get('file_prefix', 'roster'), name))
        render(img, hlines, vlines, cells, name, summary, path)
        report[name] = {'summary': summary, 'file': path, 'cells': len(cells)}
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:4])
