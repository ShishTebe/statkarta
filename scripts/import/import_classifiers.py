"""Импорт справочников № 1–17 (ред. 2026) с иерархией, сносками и происхождением кодов.

Источники по приоритету:
1) «Справочники_и_разъяснения_2026.pdf» – для обновленных в 2026 году № 3, 9, 12, 14, 15;
2) «Справочники_и_разъяснения.pdf» (ГИАЦ МВД, 2025) – остальные, кроме двухколоночных № 5, 6, 7;
3) Word-файлы «Карточки/СПРАВОЧНИКИ/sprav_N.docx» (через базу _СТАТКАРТОЧКИ_MD) – № 5, 6, 7 и коды,
   отсутствующие в PDF (сохраняются с пометкой).
Справочник № 17 – в data-private/. Разбор PDF: scripts/import/parse_classifiers_pdf.py.
"""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT.parents[1] / "Методики/_СТАТКАРТОЧКИ_MD/model"
SRC = ROOT / "data-private/sources"
OUT = ROOT / "data/classifiers/2026"
PRIV = ROOT / "data-private/classifiers/2026"
PDF26 = "Карточки/СПРАВОЧНИКИ/Справочники_и_разъяснения_2026.pdf"
PDF25 = "Карточки/Справочники_и_разъяснения.pdf (ГИАЦ МВД России, 2025)"


def clean_name(n):
    n = re.sub(r"\s+", " ", str(n)).strip()
    # «т о в а р ы», «д е н ь г и, ц е н н ы е» – текст вразрядку
    if re.search(r"(?:\b\w\s){3,}", n):
        n = re.sub(r"(?<=\b\w)\s(?=\w\b)", "", n)
        n = re.sub(r"(?<=\w)-\s", "-", n)
    n = re.sub(r"^[–-]\s*", "", n)
    return re.sub(r"[\s,;]+$", "", n)


def main():
    word = json.loads((BASE / "spravochniki-2026.json").read_text(encoding="utf-8"))["spravochniki"]
    p25 = json.loads((SRC / "spr-2025-pdf.json").read_text(encoding="utf-8"))
    p26 = json.loads((SRC / "spr-2026-pdf.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    index, log = [], ["# Журнал импорта справочников (ред. 2026)", ""]
    for no, sp in word.items():
        wentries = {str(c["code"]).strip(): c for c in sp["codes"]}
        if no in p26:
            src, pdf, edition, label = p26[no], PDF26, "2026", "PDF 2026"
        elif no in p25 and p25[no]["entries"]:
            src, pdf, edition, label = p25[no], PDF25, "2025", "PDF 2025"
        else:
            src, pdf, edition, label = None, None, "2026", "Word"
        entries, notes = [], []
        if src:
            marks = {n["mark"]: n["text"] for n in src["notes"]}
            notes = [{"mark": n["mark"], "text": n["text"]} for n in src["notes"] if n["text"]]
            for e in src["entries"]:
                item = {"code": e["code"], "name": clean_name(e["name"])}
                path = [clean_name(re.sub(r"\*+\d*", "", x)).rstrip(":") for x in e["path"] if clean_name(x)]
                if path:
                    item["path"] = path
                if e.get("group"):
                    item["group"] = True
                own = [t for t in e.get("note_texts", []) if t]
                if own:
                    item["notes"] = own
                entries.append(item)
            pdf_codes = {e["code"] for e in entries}
            only_word = [c for c in wentries if c not in pdf_codes]
            only_pdf = sorted(pdf_codes - set(wentries))
            for c in only_word:
                w = wentries[c]
                item = {"code": c, "name": clean_name(w.get("name", "")), "source": "word"}
                if w.get("section"):
                    item["path"] = [clean_name(w["section"]).rstrip(":")]
                if edition == "2026":
                    item["active"] = False
                    item["availability"] = "Нет в редакции справочника 2026 года (есть только в Word-версии) – вероятно, исключен"
                else:
                    item["availability"] = "Есть в Word-версии справочника, в сборнике ГИАЦ 2025 года отсутствует – проверьте актуальность"
                entries.append(item)
            log.append(f"- № {no}: источник {label}; позиций {len(entries)}; только в PDF: {', '.join(only_pdf) or 'нет'}; "
                       f"только в Word: {', '.join(only_word) or 'нет'}{' (помечены неактивными)' if only_word and edition == '2026' else ''}")
        else:
            for c, w in wentries.items():
                item = {"code": c, "name": clean_name(w.get("name", ""))}
                if w.get("section"):
                    item["path"] = [clean_name(w["section"]).rstrip(":")]
                entries.append(item)
            log.append(f"- № {no}: источник Word (двухколоночная верстка PDF); позиций {len(entries)}")
        seen = set()
        for e in entries:
            if e["code"] in seen:
                raise SystemExit(f"№ {no}: повтор кода {e['code']}")
            seen.add(e["code"])
        doc = {"no": int(no), "title": sp["title"], "edition": edition, "effective_from": f"{edition}-01-01", "effective_to": None,
               "source": pdf or f"Карточки/СПРАВОЧНИКИ/sprav_{no}.docx", "applies_note": sp.get("primenenie"),
               "notes": notes, "count": len(entries), "entries": entries}
        name = f"spr-{int(no):02d}.json"
        (OUT / name).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        index.append({"no": int(no), "title": sp["title"], "file": name, "count": len(entries), "public": True, "edition": edition})
    # № 17
    PRIV.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader((BASE / "spravochnik-17-podrazdeleniya.csv").open(encoding="utf-8")))
    ent = [{k.strip(): (v or "").strip() for k, v in r.items()} for r in rows]
    (PRIV / "spr-17.json").write_text(json.dumps({
        "no": 17, "title": "Код подразделения (реестр подразделений правоохранительных органов)",
        "edition": "01.01.2025", "effective_from": "2025-01-01", "effective_to": None,
        "source": "Карточки/!Справочник подразделений органов 01.01.2025.xlsx",
        "publication": "private – до решения заказчика по риску П-1",
        "count": len(ent), "fields": list(ent[0].keys()) if ent else [], "entries": ent,
    }, ensure_ascii=False), encoding="utf-8")
    index.append({"no": 17, "title": "Код подразделения", "file": "../../../data-private/classifiers/2026/spr-17.json", "count": len(ent), "public": False, "edition": "2025"})
    index.sort(key=lambda x: x["no"])
    (OUT / "index.json").write_text(json.dumps({"edition": "2026", "classifiers": index}, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "docs/import-log-classifiers-2026.md").write_text("\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))


if __name__ == "__main__":
    main()
