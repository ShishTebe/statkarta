"""Кодовые поля реквизитов по официальному бланку «Статистические карточки на 2026.pdf».

Ячейка кода – векторный прямоугольник около 7,2 × 14,2 пт. Ряд ячеек связывается с ближайшим
номером реквизита на той же строке слева. Поля в ряду разделяются промежутками. Запуск:
python3 scripts/import/blank_cells.py > data-private/sources/blank-cells-2026.json
"""
import fitz, re, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT.parents[1] / "Карточки/Статистические карточки на 2026.pdf"
PAGES = {"1": [0, 1], "1.1": [2, 3], "2": [4, 5], "3": [6, 7], "4": [8, 9], "5": [10], "6": [11, 12]}
NUM = re.compile(r"^0?(\d{1,2}(?:\.\d{1,2})?)\.?$")


def main():
    d = fitz.open(PDF)
    out, unassigned = {}, []
    for form, pages in PAGES.items():
        res = {}
        for pi in pages:
            pg = d[pi]
            cells = sorted({(round(it[1].x0, 1), round(it[1].y0, 1)) for g in pg.get_drawings() for it in g["items"]
                            if it[0] == "re" and 6.3 < it[1].width < 7.8 and 13 < it[1].height < 14.8}, key=lambda c: (c[1], c[0]))
            words = pg.get_text("words")
            labels = [w for w in words if NUM.match(w[4]) and w[0] > 150]
            margin = [w for w in words if w[0] < 60 and re.fullmatch(r"\d{1,2}(?:\.\d{1,2})*\.", w[4])]
            last = None
            rows = []
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
                    x0 = seg[0][0]
                    yc = r["y"] + 7.1
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
                            unassigned.append((form, pi, x0, r["y"], len(seg)))
                            continue
                    label_y = (max(cand, key=lambda w: w[2])[1] if cand else (lm_best[1] if not cand and lm_best and num == lm_best[4].rstrip(".") else (last[2] if last else r["y"])))
                    last = (num, r["y"], label_y)
                    groups = [[seg[0]]]
                    for c in seg[1:]:
                        if c[0] - groups[-1][-1][0] > 8.5:
                            groups.append([c])
                        else:
                            groups[-1].append(c)
                    res.setdefault(num, []).append([len(g) for g in groups])
        out[form] = res
    json.dump({"source": str(PDF.name), "fields": out, "unassigned": unassigned}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
