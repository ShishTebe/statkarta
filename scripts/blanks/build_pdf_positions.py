"""Координаты мест бланка на странице PDF – для чтения заполненной карточки из PDF.

Заполненную карточку пользователь может принести не только файлом Word, но и PDF, напечатанным
из Word («Сохранить как PDF»). Чтобы понять, в какую клетку попал знак, нужно знать, где на
странице стоит каждая фигура бланка. Это уже известно из разметки бланка (scripts/blanks/build_layout.py):
размеченный бланк с меткой в каждой фигуре напечатан нативным Word в PDF
(data-private/blanks/work/<бланк>-marked.pdf), а файл меток говорит, какой фигуре принадлежит метка.

Скрипт сохраняет для каждой формы:
- cells – [номер фигуры, страница, x, y]: только места карты раскладки; x – середина метки по
  горизонтали (знак в клетке выравнивается по центру), y – верх строки метки (текст надписи прижат
  к ее верху, поэтому верх строки не зависит от размера шрифта); пункты, от левого верхнего угла;
- printed – печатные слова бланка рядом с клетками («зн.», «/»): [страница, x0, x1, верх, текст] –
  при чтении они не принимаются за вписанные знаки;
- anchors – номера реквизитов в левом поле («7.1.»): по ним проверяется, что PDF напечатан с того же
  бланка, и вычисляется сдвиг полей принтера;
- regions – области текстовых реквизитов (фабула р. 12 ф. 1 и т. п.): от номера реквизита до номера
  следующего; blank_text – печатный текст бланка в области (он вычитается из прочитанного).

Результат – data/layout/2026/pdf/forma-<форма>.json (публичный: в нем только геометрия бланка).

Запуск: python3 scripts/blanks/build_pdf_positions.py [форма …]
"""
import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
LAYOUT = ROOT / "data/layout/2026"
OUT = LAYOUT / "pdf"
WORK = ROOT / "data-private/blanks/work"
FORMS = {"1": "cards_1", "1.1": "cards_1.1", "2": "cards_2", "2.1": "cards_2.1", "4": "cards_4", "5": "cards_5", "6": "cards_6"}
FILE_NAME = {"1": "forma-1", "1.1": "forma-1-1", "2": "forma-2", "2.1": "forma-2-1", "4": "forma-4", "5": "forma-5", "6": "forma-6"}
MARK = re.compile(r"^[a-z][a-zA-Z0-9]$")   # формат меток – scripts/blanks/mark.mjs
NUM = re.compile(r"^0?(\d{1,2}(?:\.\d{1,2})?)\.?$")
LEFT = 46.0   # номера реквизитов печатаются в левом поле бланка


def line_text(words):
    """Слова области в порядке чтения: строки по вертикали, внутри строки – слева направо."""
    lines = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if lines and abs(lines[-1][0] - w[1]) < 3:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])
    return " ".join(" ".join(x[4] for x in sorted(ws, key=lambda w: w[0])) for _, ws in lines)


def build(form):
    pdf = WORK / f"{FORMS[form]}-marked.pdf"
    marks_file = WORK / f"{FORMS[form]}-marks.json"
    if not pdf.exists() or not marks_file.exists():
        print(f"ф. {form}: нет размеченной копии бланка – пропущено")
        return
    layout = json.loads((LAYOUT / f"{FILE_NAME[form]}.json").read_text())
    shape_of = {m["mark"]: m["shape"] for m in json.loads(marks_file.read_text())["marks"]}
    used = {s for f in layout["fields"] for g in (f.get("groups") or []) + [g for p in f.get("parts", []) for g in (p.get("groups") or []) + (p.get("fills") or [])] for s in g}
    doc = fitz.open(pdf)
    cells, anchors, pages, printed = [], [], [], []
    words_by_page = []
    for pi, page in enumerate(doc):
        pages.append([round(page.rect.width, 2), round(page.rect.height, 2)])
        words = page.get_text("words")
        words_by_page.append(words)
        own = []
        for w in words:
            x0, y0, x1, y1, text = w[:5]
            if MARK.match(text) and text in shape_of:
                if shape_of[text] in used:
                    own.append([shape_of[text], pi, round((x0 + x1) / 2, 1), round(y0, 1)])
            elif x0 < LEFT and NUM.match(text):
                anchors.append([NUM.match(text).group(1), pi, round(x0, 1), round(y0, 1)])
        for w in words:
            x0, y0, x1, y1, text = w[:5]
            if MARK.match(text):
                continue
            if any(x0 - 4.5 <= c[2] <= x1 + 4.5 and abs(c[3] - y0) < 5 for c in own):
                printed.append([pi, round(x0, 1), round(x1, 1), round(y0, 1), text])
        cells.extend(own)
    # клетка, чья метка не напечаталась (узкая фигура), достраивается по соседним клеткам того же ряда:
    # клетки ряда идут слева направо с одинаковым шагом
    known = {c[0]: c for c in cells}
    groups = [g for f in layout["fields"] for g in (f.get("groups") or []) + [g for p in f.get("parts", []) for g in (p.get("groups") or []) + (p.get("fills") or [])]]
    for g in groups:
        idx = [(i, known[s]) for i, s in enumerate(g) if s in known]
        if not idx or len(idx) == len(g):
            continue
        steps = [(b[1][2] - a[1][2]) / (b[0] - a[0]) for a, b in zip(idx, idx[1:]) if b[1][1] == a[1][1] and abs(b[1][3] - a[1][3]) < 1]
        step = sorted(steps)[len(steps) // 2] if steps else 7.1
        for i, s in enumerate(g):
            if s in known:
                continue
            j, ref = min(idx, key=lambda x: abs(x[0] - i))
            known[s] = [s, ref[1], round(ref[2] + (i - j) * step, 1), ref[3]]
            cells.append(known[s])
    missing = sorted(used - {c[0] for c in cells})
    regions = []
    for f in layout["fields"]:
        for i, part in enumerate(f.get("parts") or []):
            if part.get("role") != "text":
                continue
            own = [a for a in anchors if a[0] == f["requisite"]]
            if not own:
                print(f"ф. {form} р. {f['requisite']}: номер реквизита в левом поле не найден – область текста не задана")
                continue
            _, pi, _, y0 = own[0]
            below = [a[3] for a in anchors if a[1] == pi and a[3] > y0 + 2]
            y1 = min(below) if below else pages[pi][1] - 20
            x1 = pages[pi][0] - 20
            inside = [w for w in words_by_page[pi] if w[1] >= y0 - 2 and w[3] <= y1 + 1 and w[0] >= LEFT - 4 and w[2] <= x1 + 5
                      and not MARK.match(w[4])]
            regions.append({"requisite": f["requisite"], "part": i, "page": pi,
                            "box": [LEFT - 4, round(y0 - 2, 1), round(x1 + 5, 1), round(y1 - 0.5, 1)],
                            "blank_text": line_text(inside)})
    out = {"form": form, "blank": layout["blank"], "blank_sha256": layout["blank_sha256"],
           "source_note": "Середины мест бланка на странице PDF, напечатанного Word (scripts/blanks/build_pdf_positions.py); пункты, от левого верхнего угла",
           "pages": pages, "cells": sorted(cells), "printed": printed, "anchors": anchors, "regions": regions}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{FILE_NAME[form]}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"ф. {form}: клеток {len(cells)}, печатных слов у клеток {len(printed)}, номеров реквизитов {len(anchors)}, текстовых областей {len(regions)}"
          + (f"; без координат мест карты: {len(missing)}" if missing else ""))


if __name__ == "__main__":
    for form in sys.argv[1:] or FORMS:
        build(form)
