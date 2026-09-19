"""Чтение размеченного бланка (Фаза 1.6, шаг Ш-3).

На вход – PDF, напечатанный нативным Word из размеченного бланка (scripts/blanks/mark.mjs),
и файл меток «метка → фигура». Клетки кода находятся по нарисованным прямоугольникам, номер
реквизита – по напечатанному в бланке номеру слева на той же строке или в левом поле сверху
(тот же разбор, что и для официального бланка в scripts/blanks/pdf_cells.py).

Результат – черновик карты раскладки: реквизит → места файла в порядке бланка.

Запуск: python3 scripts/blanks/read_marks.py <размеченный.pdf> <метки.json> > <черновик.json>
"""
import json
import re
import sys

import fitz

NUM = re.compile(r"^0?(\d{1,2}(?:\.\d{1,2})?)\.?$")
MARK = re.compile(r"^[a-z][a-zA-Z0-9]$")   # формат меток – scripts/blanks/mark.mjs


def cells_of(page):
    return sorted({(round(it[1].x0, 1), round(it[1].y0, 1), round(it[1].width, 1), round(it[1].height, 1))
                   for g in page.get_drawings() for it in g["items"]
                   if it[0] == "re" and 6.3 < it[1].width < 7.9 and 11.5 < it[1].height < 15.4},
                  key=lambda c: (c[1], c[0]))


def assign(page, pi):
    """Ряды клеток страницы с номерами реквизитов: [(реквизит, [клетки ряда])]."""
    cells = cells_of(page)
    words = page.get_text("words")
    labels = [w for w in words if NUM.match(w[4]) and w[0] > 150]
    margin = [w for w in words if w[0] < 60 and re.fullmatch(r"\d{1,2}(?:\.\d{1,2})*\.", w[4])]
    rows, out, last = [], [], None
    for c in cells:
        for r in rows:
            if abs(r["y"] - c[1]) < 3:
                r["cells"].append(c)
                break
        else:
            rows.append({"y": c[1], "cells": [c]})
    for r in rows:
        r["cells"].sort()
        segs = [[r["cells"][0]]]
        for c in r["cells"][1:]:
            if c[0] - segs[-1][-1][0] > 30:
                segs.append([c])
            else:
                segs[-1].append(c)
        for seg in segs:
            x0, yc = seg[0][0], r["y"] + 7.1
            cand = [w for w in labels if abs((w[1] + w[3]) / 2 - yc) < 9 and w[2] <= x0 + 1]
            lm_best = None
            if cand:
                num = NUM.match(max(cand, key=lambda w: w[2])[4]).group(1)
            else:
                lm = [w for w in margin if -12 < yc - (w[1] + w[3]) / 2 < 40]
                lm_best = max(lm, key=lambda w: w[1]) if lm else None
                if lm_best and (not last or lm_best[1] > last[2] - 2):
                    num = lm_best[4].rstrip(".")
                elif last and r["y"] - last[1] < 60:
                    num = last[0]
                else:
                    out.append((None, seg, pi))
                    continue
            label_y = (max(cand, key=lambda w: w[2])[1] if cand
                       else (lm_best[1] if lm_best and num == lm_best[4].rstrip(".") else (last[2] if last else r["y"])))
            last = (num, r["y"], label_y)
            groups = [[seg[0]]]
            for c in seg[1:]:
                if c[0] - groups[-1][-1][0] > 8.5:
                    groups.append([c])
                else:
                    groups[-1].append(c)
            for g in groups:
                out.append((num, g, pi))
    return out


def main(pdf_path, marks_path):
    marks = json.load(open(marks_path))
    doc = fitz.open(pdf_path)
    placed, free = [], []
    for pi, page in enumerate(doc):
        words = [w for w in page.get_text("words") if MARK.fullmatch(w[4])]
        segs = assign(page, pi)
        used = set()
        for num, cells, _ in segs:
            group = []
            for ci, c in enumerate(cells):
                x0, y0, w, h = c
                hit = [i for i, wd in enumerate(words)
                       if i not in used and x0 - 1 <= wd[0] <= x0 + w + 1 and y0 - 2 <= (wd[1] + wd[3]) / 2 <= y0 + h + 2]
                if not hit:
                    group.append(None)
                    continue
                used.add(hit[0])
                group.append(words[hit[0]][4])
            placed.append({"requisite": num, "page": pi, "x": cells[0][0], "y": cells[0][1], "marks": group})
        for i, wd in enumerate(words):
            if i not in used:
                free.append({"mark": wd[4], "page": pi, "x": round(wd[0], 1), "y": round(wd[1], 1)})
    shapes = {m["mark"]: m["shape"] for m in marks["marks"]}   # метка → номер фигуры в бланке
    for p in placed:
        p["shapes"] = [shapes.get(m) if m else None for m in p["marks"]]
    for f in free:
        f["shape"] = shapes.get(f["mark"])
    json.dump({"blank": marks["blank"], "pdf": pdf_path, "groups": placed, "free": free},
              sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
