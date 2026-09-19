"""Разбор перечней статей УК РФ (указание ГП России и МВД России от 28.07.2025 № 147).

Вход: распознанный текст скана (macOS Vision) и разбор УК (parse_uk.py).
Выход: data/uk/2026/lists.json и data/uk/2026/articles.json, отчет docs/import-log-uk-2026.md.
"""
import json, re, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR, UKJ = Path(sys.argv[1]), Path(sys.argv[2])
OUT = ROOT / "data/uk/2026"
CAT_LISTS = {4: "small", 5: "medium", 6: "grave", 7: "especially_grave"}
REF_DATE = "2026-01-01"

TOK = re.compile(r"""
 (?P<DATE>\((?:\s*(?P<d0>\d{2}\.\d{2}\.\d{4})\s*(?P<op0><=|=<|<|>=|=>|>)\s*)?дата\s*(?P<op>[<>]=?)\s*(?P<d1>\d{2}\.\d{2}\.\d{4})\s*\))
|(?P<POINTS>пп?\.\s*«[^»]{1,6}»(?:\s*(?:,|и)\s*«[^»]{1,6}»)*)
|(?P<PARTS>чч?\.\s*\d+(?:\.\d+)?(?:\s*(?:,|и)\s*\d+(?:\.\d+)?)*)
|(?P<ART>ст\.)
|(?P<NUM>\d+(?:\.\d+)?)
|(?P<WORD>[А-Яа-яЁёA-Za-z]{2,})
""", re.X)


def iso(d):
    dd, mm, yy = d.split(".")
    return f"{yy}-{mm}-{dd}"


def normalize(line):
    s = line.replace("Nº", "№").replace(" ", " ")
    s = re.sub(r"\b(?:СТ|CT|Ст|Cт)\.", "ст.", s)
    s = re.sub(r"\bЧ\.", "ч.", s)
    s = re.sub(r"\bчч(?=\s\d)", "чч.", s)
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r"\(дата\(", "(дата<", s)
    # Исправления распознавания (сверено с контекстом скана)
    s = re.sub(r"^З\.(\d)", r"3.\1", s)                 # «З.3.» – пункт 3.3 перечня № 23
    s = re.sub(r"^3\.а\.І\.", "3.4.1.", s)               # «3.а.І.» – пункт 3.4.1 (между 3.4 и 3.5)
    s = re.sub(r"(?<![\d.])44\.\s(?=\d)", "чч. ", s)     # «44. 2 и 3 ст. 260» – «чч.»
    s = re.sub(r"(?<![\d.])4ч\.", "чч.", s)               # «4ч. 4, 5 и 6 ст. 222.2»
    s = re.sub(r"\s*\*\d+", "", s)                         # «ст. 291 *2823 (…)» – мусор распознавания
    s = re.sub(r"\bП\.\s*«", "п. «", s)
    s = re.sub(r"(\d)ст\.", r"\1 ст.", s)
    s = s.replace("датах=", "дата<=")
    s = re.sub(r"\b(чч?\.)\s*З\b", r"\1 3", s)
    s = re.sub(r"(\d)\s*[иu]\s*З\b", r"\1 и 3", s)
    s = re.sub(r"\bЗ\s*и\s*(\d)", r"3 и \1", s)
    # «4.2 ст.» – искажение «ч. 2 ст.»: голое число перед «ст.» без «ч.»
    s = re.sub(r"(?<![\d.])(?<!ч\. )(?<!чч\. )\b4\.\s?(\d{1,2})\s+ст\.", r"ч. \1 ст.", s)
    return s


def refs(text):
    items, pend_parts, pend_points, mode = [], None, None, False
    for m in TOK.finditer(text):
        k = m.lastgroup
        if k == "DATE":
            if items:
                c = items[-1].setdefault("date", [])
                if m.group("d0"):
                    flip = {"<": ">", "<=": ">=", "=<": ">=", ">": "<", ">=": "<=", "=>": "<="}[m.group("op0")]
                    c.append({"op": flip, "date": iso(m.group("d0"))})
                c.append({"op": m.group("op"), "date": iso(m.group("d1"))})
                lows = [x["date"] for x in c if x["op"] in (">", ">=")]
                highs = [x["date"] for x in c if x["op"] in ("<", "<=")]
                if lows and highs and max(lows) >= min(highs):
                    # «30.10.2009>дата>=24.12.2024» – вне диапазона: до первой даты ИЛИ начиная со второй
                    items[-1]["date_mode"] = "any"
        elif k == "POINTS":
            pend_points = re.findall(r"«([^»]+)»", m.group(0)); mode = False
        elif k == "PARTS":
            pend_parts = re.findall(r"\d+(?:\.\d+)?", m.group(0)[3:]); mode = False
        elif k == "ART":
            mode = True
        elif k == "NUM" and mode and text[m.end():m.end() + 1] == ")":
            mode = False
        elif k == "NUM" and mode:
            it = {"article": m.group(0), "parts": pend_parts, "points": pend_points, "_span": (m.start(), m.end())}
            items.append(it)
            pend_parts = pend_points = None
        elif k == "WORD" and m.group(0) not in ("и",):
            mode = False
            pend_parts = pend_points = None if m.group(0) not in ("УК", "РФ") else (pend_parts, pend_points)[0:0] or None
    return items


def kind(heading):
    h = heading.lower()
    if "исключен" in h:
        return "excluded"
    if "зависит от времени" in h:
        return "date"
    if "без дополнительных" in h:
        return "unconditional"
    if "при наличии" in h or "условий" in h:
        return "conditional"
    return "other"


def parse_lists():
    lines = [normalize(l) for l in OCR.read_text(encoding="utf-8").splitlines()]
    lists, cur, sec = {}, None, None
    desc_mode = False
    for raw in lines:
        l = raw.strip()
        if not l or l.startswith("<<<PAGE") or re.fullmatch(r"\d{1,2}", l):
            continue
        if re.match(r"^[’'`]\s|^\d\s+(В случае|Здесь и далее|Под|При)", l):
            continue
        m = re.match(r"^(?:ПЕРЕЧЕНЬ|Перечень)\s*№\s*(\d+)\s*$", l)
        if m:
            cur = lists.setdefault(int(m.group(1)), {"no": int(m.group(1)), "title": "", "sections": []})
            sec = None
            continue
        m = re.match(r"^Перечень\s*№\s*(\d+)\s*[-–—]\s*(содерж\w+.*)$", l)
        if m:
            desc_mode = True
            cur = lists.setdefault(int(m.group(1)), {"no": int(m.group(1)), "title": "", "sections": []})
            cur["description"] = m.group(2)
            cur["_desc"] = True
            sec = None
            continue
        if cur is None:
            continue
        if cur.get("_desc"):
            if desc_mode and not l.startswith("Перечни"):
                cur["description"] += " " + l
            continue
        m = re.match(r"^(\d+(?:\.\d+)*)\.\s*([А-ЯЁ].*)$", l)
        if m:
            sec = {"number": m.group(1), "heading": m.group(2), "text": "", "_open": True}
            cur["sections"].append(sec)
            if ":" in m.group(2):
                sec["heading"], rest = m.group(2).split(":", 1)
                sec["text"] = rest + "\n"
                sec["_open"] = False
            continue
        if sec is None:
            cur["title"] = (cur["title"] + " " + l).strip()
            continue
        if sec["_open"]:
            if ":" in l:
                h, rest = l.split(":", 1)
                sec["heading"] += " " + h
                sec["text"] += rest + "\n"
                sec["_open"] = False
            else:
                sec["heading"] += " " + l
            continue
        sec["text"] += l + "\n"
    for L in lists.values():
        L.pop("_desc", None)
        for s in L["sections"]:
            s.pop("_open", None)
            s["heading"] = re.sub(r"\s+", " ", s["heading"]).strip()
            s["kind"] = kind(s["heading"])
            s["items"] = refs(s["text"].replace("\n", " "))
            s["text"] = re.sub(r"\s+", " ", s["text"]).strip()
    return lists


def active(item, date=REF_DATE):
    conds = item.get("date") or []
    if item.get("date_mode") == "any":
        return any(_ok(c, date) for c in conds)
    return all(_ok(c, date) for c in conds)


def _ok(c, date):
    op, d = c["op"], c["date"]
    return {"<": date < d, "<=": date <= d, ">=": date >= d, ">": date > d}[op]


def main():
    uk = {a["article"]: a for a in json.loads(UKJ.read_text(encoding="utf-8"))}
    lists = parse_lists()
    log, bad, info, hist = [], [], [], []
    for L in lists.values():
        for s_ in L["sections"]:
            if s_["kind"] == "date":
                for it in s_["items"]:
                    if not it.get("date"):
                        it["check"] = "date_missing"
                        bad.append(f"перечень № {L['no']}, п. {s_['number']}: ст. {it['article']} – в подразделе «по дате» не распознано условие даты")
                    it.pop("_span", None)
            for it in s_["items"]:
                it.pop("_span", None)
    for L in sorted(lists.values(), key=lambda x: x["no"]):
        n = sum(len(s["items"]) for s in L["sections"])
        log.append(f"| {L['no']} | {len(L['sections'])} | {n} |")
        for s in L["sections"]:
            for it in s["items"]:
                a = uk.get(it["article"])
                past = it.get("date_mode") != "any" and any(c["op"] in ("<", "<=") and c["date"] < REF_DATE for c in it.get("date") or [])
                if it.get("check") == "date_missing":
                    continue
                if not a:
                    bad.append(f"перечень № {L['no']}, п. {s['number']}: ст. {it['article']} нет в УК")
                    it["check"] = "article_not_found"
                elif it["parts"]:
                    known = {p["part"] for p in a["parts"]}
                    fixed = []
                    for p in it["parts"]:
                        if p not in known and "." in p and all(x in known for x in p.split(".")):
                            fixed += p.split(".")
                            info.append(f"перечень № {L['no']}, п. {s['number']}: ст. {it['article']} – «{p}» прочитано как части {', '.join(p.split('.'))}")
                        else:
                            fixed.append(p)
                    it["parts"] = fixed
                    miss = [p for p in it["parts"] if p not in known]
                    if miss:
                        if a["repealed"] or past:
                            it["check"] = "historical"
                            hist.append(f"перечень № {L['no']}, п. {s['number']}: ч. {', '.join(miss)} ст. {it['article']}" + (" (статья утратила силу)" if a["repealed"] else f" (условие даты в прошлом)"))
                        else:
                            it["check"] = "stale_in_source"
                            info.append(f"перечень № {L['no']}, п. {s['number']}: ч. {', '.join(miss)} ст. {it['article']} – таких частей нет в действующей редакции УК; ссылка перечня устарела, в категорию не учитывается")
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"act": "Указание Генеральной прокуратуры Российской Федерации и МВД России от 28.07.2025 № 147 «О введении в действие перечней статей Уголовного кодекса Российской Федерации, используемых при формировании статистической отчетности»",
            "replaces": "указание от 27.12.2024 № 952/11/3", "source": "Карточки/Перечни УК РФ от 28.07.2025.pdf (скан, распознан локально macOS Vision)",
            "edition": "2025-07-28", "status": "draft – распознанный текст, требует выборочной сверки со сканом"}
    (OUT / "lists.json").write_text(json.dumps({"meta": meta, "lists": sorted(lists.values(), key=lambda x: x["no"])}, ensure_ascii=False, indent=1), encoding="utf-8")

    # articles.json
    arts = []
    agree = disagree = nocat = 0
    diffs = []
    for no, a in uk.items():
        parts = []
        for p in a["parts"]:
            memb, tiers = [], {1: set(), 2: set(), 3: set(), 4: set()}
            for L in lists.values():
                for s in L["sections"]:
                    for it in s["items"]:
                        if it["article"] != no:
                            continue
                        if it["parts"] and p["part"] not in it["parts"]:
                            continue
                        if it.get("check") in ("stale_in_source", "date_missing", "article_not_found", "part_not_found"):
                            continue
                        entry = {"list": L["no"], "section": s["number"], "kind": s["kind"]}
                        if it.get("points"): entry["points"] = it["points"]
                        if it.get("date"): entry["date"] = it["date"]
                        if it.get("date_mode"): entry["date_mode"] = it["date_mode"]
                        entry["scope"] = "part" if it["parts"] else "article"
                        memb.append(entry)
                        if L["no"] in CAT_LISTS and s["kind"] in ("unconditional", "date") and active(it) and not it.get("check") == "date_missing":
                            tier = (1 if it["parts"] else 2) if it.get("date") else (3 if it["parts"] else 4)
                            tiers[tier].add(CAT_LISTS[L["no"]])
            cats = next((tiers[t] for t in (1, 2, 3, 4) if tiers[t]), set())
            cat = sorted(cats)[0] if len(cats) == 1 else None
            status = "lists" if cat else ("conflict" if len(cats) > 1 else "computed_only")
            if not a["repealed"]:
                if cat and cat == p["category_computed"]: agree += 1
                elif cat:
                    disagree += 1; diffs.append(f"ст. {no} ч. {p['part']}: перечни – {cat}, расчет – {p['category_computed']} ({p['max_imprisonment_years']} лет)")
                else:
                    nocat += 1
            parts.append({"part": p["part"], "category": cat or p["category_computed"], "category_source": status,
                          "category_computed": p["category_computed"], "max_imprisonment_years": p["max_imprisonment_years"],
                          "lists": memb})
        arts.append({"article": no, "title": a["title"], "repealed": a["repealed"], "parts": parts})
    arts.sort(key=lambda x: [float(x["article"].split(".")[0])] + [int(y) for y in x["article"].split(".")[1:]])
    (OUT / "articles.json").write_text(json.dumps({"meta": {
        "source_uk": "Уголовный кодекс Российской Федерации (выгрузка ГАРАНТ, RTF в корне рабочей папки)",
        "source_lists": meta["act"], "category_reference_date": REF_DATE,
        "category_values": {"small": "небольшой тяжести", "medium": "средней тяжести", "grave": "тяжкое", "especially_grave": "особо тяжкое"},
        "category_source_values": {"lists": "по перечням № 4–7 (эталон)", "computed_only": "расчет по санкции, в перечнях № 4–7 не найдено – проверить", "conflict": "противоречие перечней – проверить"},
        "status": "draft"}, "articles": arts}, ensure_ascii=False, indent=1), encoding="utf-8")
    rep = ["# Журнал импорта пакета УК (перечни от 28.07.2025)", "",
           "| Перечень | Подразделов | Ссылок |", "|---|---|---|", *log, "",
           f"Категории частей статей (без утративших силу): совпало с расчетом – {agree}; расхождение – {disagree}; нет в перечнях № 4–7 на {REF_DATE} – {nocat}.", "",
           "## Дефекты распознавания (требуют исправления)", "", *([f"- {b}" for b in bad] or ["Нет."]), "",
           "## Устаревшие ссылки в тексте перечней и уточнения чтения", "", *([f"- {x}" for x in info] or ["Нет."]), "",
           "## Исторические ссылки (утратившие силу статьи и части с условием даты в прошлом)", "", *([f"- {x}" for x in hist] or ["Нет."]), "",
           "## Расхождения категорий «перечни – расчет»", "", *[f"- {d}" for d in diffs], ""]
    (ROOT / "docs/import-log-uk-2026.md").write_text("\n".join(rep), encoding="utf-8")
    print("перечней:", len(lists), "| ссылок:", sum(len(s["items"]) for L in lists.values() for s in L["sections"]),
          "| дефектов:", len(bad), "| устаревших:", len(info), "| исторических:", len(hist), "| совпало:", agree, "расхождений:", disagree, "без категории по перечням:", nocat)


if __name__ == "__main__":
    main()
