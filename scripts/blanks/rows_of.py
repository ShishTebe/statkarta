"""Фигуры бланка по строкам реквизитов (Фаза 1.6, сверка карт раскладки).

По размеченной печати (метка → фигура, scripts/blanks/mark.mjs) находит положение каждой метки
и относит ее к строке бланка по ближайшему сверху напечатанному номеру реквизита в правой части
листа. Печатает «реквизит: фигуры слева направо» – без чтения номеров с картинки.

Запуск: python3 scripts/blanks/rows_of.py <размеченный.pdf> <метки.json>
"""
import json
import re
import sys

import fitz

MARK = re.compile(r"^[a-z][a-zA-Z0-9]$")
NUM = re.compile(r"^0?(\d{1,2}(?:\.\d{1,2})?)\.?$")


def main(pdf, marks_path):
    marks = {m["mark"]: m["shape"] for m in json.load(open(marks_path))["marks"]}
    doc = fitz.open(pdf)
    for pi, page in enumerate(doc):
        words = page.get_text("words")
        labels = sorted([(w[1], NUM.match(w[4]).group(1)) for w in words
                         if NUM.match(w[4]) and w[0] > page.rect.width * 0.55], key=lambda t: t[0])
        rows = {}
        for w in words:
            if not MARK.match(w[4]) or w[4] not in marks:
                continue
            yc = (w[1] + w[3]) / 2
            above = [lab for lab in labels if lab[0] <= yc + 4]
            key = above[-1][1] if above else "?"
            rows.setdefault(key, []).append((round(w[0]), round(yc), marks[w[4]]))
        for key in sorted(rows, key=lambda k: min(y for _, y, _ in rows[k])):
            cells = sorted(rows[key], key=lambda t: (round(t[1] / 6), t[0]))
            print(f"стр. {pi + 1}, р. {key}: " + " ".join(f"{s}" for _, _, s in cells))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
