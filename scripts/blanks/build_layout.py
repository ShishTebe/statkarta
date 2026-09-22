"""Сборка карт раскладки бланков (Фаза 1.6, шаг Ш-3).

Порядок для каждого бланка:
1) node scripts/blanks/mark.mjs – в каждое пустое место бланка вписывается метка;
2) osascript scripts/blanks/topdf.applescript – размеченный файл печатается в PDF нативным Word;
3) scripts/blanks/read_marks.py – по расположению меток определяется, какому реквизиту
   принадлежит каждое место;
4) результат сверяется с разметкой официального бланка (data-private/sources/pdf-cells-2026.json)
   и с составом реквизитов формы; расхождения выводятся списком для ручной сверки.

Карты пишутся в data/layout/2026/forma-<форма>.json (черновики – data-private/layout/2026/draft) со статусом «draft»; ручные
исправления берутся из scripts/blanks/layout-corrections-2026.json.

Запуск: python3 scripts/blanks/build_layout.py [форма …]
"""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vml  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BLANKS = ROOT / "data/blanks/2026"
OUT = ROOT / "data/layout/2026"
DRAFT = ROOT / "data-private/layout/2026/draft"  # промежуточная разметка – не публикуется
WORK = ROOT / "data-private/blanks/work"
CORRECTIONS = ROOT / "scripts/blanks/layout-corrections-2026.json"
PDF_CELLS = ROOT / "data-private/sources/pdf-cells-2026.json"

FORMS = {"3": "cards_3.xlsx", "1": "cards_1.docx", "1.1": "cards_1.1.docx", "2": "cards_2.docx", "2.1": "cards_2.1.docx",
         "4": "cards_4.docx", "5": "cards_5.docx", "6": "cards_6.docx",
         "ipk": "ipk.docx", "ipk-in": "ipk-in.docx"}
FILE_NAME = {"1": "forma-1", "1.1": "forma-1-1", "2": "forma-2", "2.1": "forma-2-1", "3": "forma-3",
             "4": "forma-4", "5": "forma-5", "6": "forma-6", "ipk": "forma-ipk", "ipk-in": "forma-ipk-in"}


def run(cmd):
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"Не выполнено: {' '.join(str(c) for c in cmd)}\n{res.stdout}\n{res.stderr}")
    return res.stdout.strip()


def build(form):
    blank = BLANKS / FORMS[form]
    WORK.mkdir(parents=True, exist_ok=True)
    marked = WORK / f"{blank.stem}-marked.docx"
    marks = WORK / f"{blank.stem}-marks.json"
    pdf = WORK / f"{blank.stem}-marked.pdf"
    cells = WORK / f"{blank.stem}-cells.json"
    # Помечаются только клетки кода: надпись в рисунке или рамке бланка Word не принимает.
    cells.write_text(json.dumps([c["index"] for c in vml.cells(vml.read_xml(blank))]))
    run(["node", "scripts/blanks/mark.mjs", str(blank), str(marked), str(marks), str(cells)])
    run(["osascript", "scripts/blanks/topdf.applescript", str(marked), str(pdf)])
    draft = json.loads(run(["python3", "scripts/blanks/read_marks.py", str(pdf), str(marks)]))
    manifest = json.loads((BLANKS / "blanks.json").read_text())
    entry = next(b for b in manifest["blanks"] if b["form"] == form)
    fields = {}
    for g in draft["groups"]:
        req = g["requisite"]
        shapes = [s for s in g["shapes"] if s]
        if req is None or not shapes:
            continue
        fields.setdefault(req, []).append({"cells": shapes, "page": g["page"],
                                           "x": g["x"], "y": g["y"], "printed": len(g["marks"]) - len(shapes)})
    forms_pack = json.loads((ROOT / f"data/forms/2026/{FILE_NAME[form]}.json").read_text())
    known = {r["id"]: r for r in forms_pack["requisites"]}
    layout = {"form": form, "blank": entry["file"], "blank_sha256": entry["sha256"],
              "part": "word/document.xml", "map_status": "draft",
              "source_note": "Разметка по размеченной копии бланка, напечатанной Word (scripts/blanks/build_layout.py)",
              "fields": []}
    for req in sorted(fields, key=lambda r: [int(p) for p in r.split(".")] if r.replace(".", "").isdigit() else [999]):
        r = known.get(req)
        layout["fields"].append({"requisite": req, "kind": "code_cells",
                                 "fills_by": r["fills_by"] if r else None,
                                 "label": r["label"] if r else None,
                                 "groups": [f["cells"] for f in fields[req]],
                                 "in_form": r is not None})
    DRAFT.mkdir(parents=True, exist_ok=True)
    (DRAFT / f"{FILE_NAME[form]}.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n")
    layout = apply_corrections(form)
    return layout, draft, known


def apply_corrections(form):
    """Черновик карты + ручные исправления → итоговая карта (без печати в Word).

    Исправление ссылается на группы черновика: ["11", "a"] – первая группа клеток, которую разбор
    отнес к реквизиту 11; ["34", "*"] – все его группы. Исправление заменяет запись реквизита целиком:
    либо простым списком групп («groups»), либо частями с назначением («parts»), см. src/core/blank.mjs.
    Реквизит, чьи группы целиком разобраны исправлениями, из карты убирается («drop»).
    """
    draft = json.loads((DRAFT / f"{FILE_NAME[form]}.json").read_text())
    by_req = {f["requisite"]: f for f in draft["fields"]}
    corrections = json.loads(CORRECTIONS.read_text()).get(form, {}) if CORRECTIONS.exists() else {}

    def resolve(refs, sort=False):
        out = []
        for ref in refs:
            if all(isinstance(x, int) for x in ref) or all(re.fullmatch(r"[A-Z]+\d+", str(x)) for x in ref):
                # группа задана номерами фигур (indexfill.mjs) или адресами ячеек листа (ф. 3)
                out.append(list(ref))
                continue
            req, letter = ref
            groups = by_req[req]["groups"]
            out.extend(groups if letter == "*" else [groups["abcdefghijklmnopqrstuvwxyz".index(letter)]])
        return sorted(out, key=min) if sort else out

    fields = {f["requisite"]: dict(f) for f in draft["fields"]}
    for req in corrections.get("drop", []):
        fields.pop(req, None)
    for fix in corrections.get("fields", []):
        base = fields.get(fix["requisite"], {"requisite": fix["requisite"], "kind": "code_cells", "fills_by": None, "label": None, "in_form": True})
        entry = {k: v for k, v in base.items() if k not in ("groups", "parts")}
        if "groups" in fix:
            entry["groups"] = resolve(fix["groups"], fix.get("sort") == "index")
        if "parts" in fix:
            entry["parts"] = []
            for part in fix["parts"]:
                p = {k: v for k, v in part.items() if k not in ("groups", "fills")}
                p["groups"] = resolve(part.get("groups", []), part.get("sort") == "index")
                # ряды «код – сумма» (р. 28 ф. 1.1): клетки суммы идут отдельным списком
                if "fills" in part:
                    p["fills"] = resolve(part["fills"], part.get("sort") == "index")
                entry["parts"].append(p)
            entry["groups"] = [g for p in entry["parts"] for g in (p["groups"] + p.get("fills", []))]
        if "parts_add" in fix:
            # дополнительные части к клеткам реквизита (наименование подразделения в р. 1)
            if "parts" not in entry:
                entry["parts"] = [{"role": "code", "groups": entry.get("groups", base.get("groups", []))}]
                entry["groups"] = entry["parts"][0]["groups"]
            for part in fix["parts_add"]:
                entry["parts"].append({**part, "groups": resolve(part.get("groups", []))})
        entry["note"] = fix.get("note")
        fields[fix["requisite"]] = entry
    known = json.loads((ROOT / f"data/forms/2026/{FILE_NAME[form]}.json").read_text())
    order = {r["id"]: i for i, r in enumerate(known["requisites"])}
    # контрольная сумма – по текущему пакету бланков: вычистка образцов меняет только текст ячеек,
    # порядок фигур и адреса ячеек при этом не меняются
    manifest = json.loads((BLANKS / "blanks.json").read_text())
    draft["blank_sha256"] = next(b["sha256"] for b in manifest["blanks"] if b["form"] == form)
    layout = {**draft, "fields": sorted(fields.values(), key=lambda f: order.get(f["requisite"], 999)),
              "map_status": corrections.get("status", draft["map_status"])}
    (OUT / f"{FILE_NAME[form]}.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n")
    return layout


def report(form, layout, draft, known):
    pdf = json.loads(PDF_CELLS.read_text())["forms"].get(form, [])
    official = Counter(c["requisite"] for c in pdf)
    mine = Counter({f["requisite"]: sum(len(g) for g in f["groups"]) for f in layout["fields"]})
    unknown = [f["requisite"] for f in layout["fields"] if not f["in_form"]]
    missing = [r for r, v in known.items() if v["fills_by"] in ("investigator", "head")
               and r not in mine]
    diff = [(r, mine.get(r, 0), official.get(r, 0)) for r in sorted(set(official) | set(mine))
            if official and mine.get(r, 0) != official.get(r, 0)]
    print(f"форма {form}: мест {sum(mine.values())} в {len(layout['fields'])} реквизитах; "
          f"свободных меток {len(draft['free'])}")
    if unknown:
        print(f"   реквизитов нет в пакете формы: {unknown}")
    if missing:
        print(f"   заполняет следователь, но места нет: {missing}")
    if diff:
        print(f"   расходится с официальным бланком (реквизит, файл, PDF): {diff}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--apply":
        # только применить исправления к готовым черновикам, без печати в Word
        for form in args[1:] or list(FORMS):
            if (DRAFT / f"{FILE_NAME[form]}.json").exists():
                layout = apply_corrections(form)
                print(f"форма {form}: исправления применены, реквизитов {len(layout['fields'])}, статус {layout['map_status']}")
        sys.exit(0)
    for form in args or list(FORMS):
        report(form, *build(form))
