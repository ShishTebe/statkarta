"""Разбор текста УК РФ (RTF, выгрузка ГАРАНТ) на статьи и части с расчетом категории.

Расчетная категория – вспомогательная, для перекрестной сверки с перечнями № 4–7
(указание ГП и МВД от 28.07.2025 № 147). Эталон – перечни.
Вход: текст УК (textutil -convert txt). Выход: JSON в stdout-файл.
"""
import json, re, sys
from pathlib import Path

NUM = {"одного": 1, "двух": 2, "трех": 3, "четырех": 4, "пяти": 5, "шести": 6, "семи": 7,
       "восьми": 8, "девяти": 9, "десяти": 10, "одиннадцати": 11, "двенадцати": 12,
       "тринадцати": 13, "четырнадцати": 14, "пятнадцати": 15, "шестнадцати": 16,
       "семнадцати": 17, "восемнадцати": 18, "девятнадцати": 19, "двадцати": 20}
ART = re.compile(r"^Статья (\d+(?:\.\d+)?)\. (.*)$")
PART = re.compile(r"^(\d+(?:\.\d+)?)\. (.*)$")
IMPR = re.compile(r"лишением свободы на срок (?:от [а-я]+(?: [а-я]+)? (?:месяцев |лет )?)?до ([а-я]+(?: [а-я]+)?) (лет|года|месяцев)")


ANY_TERM = re.compile(r"на срок (?:от [а-я]+(?: [а-я]+)? (?:месяцев |лет )?)?до ([а-я]+(?: [а-я]+)?) (лет|года|месяцев)")


def _val(m):
    val = sum(NUM.get(w, 0) for w in m.group(1).split())
    return val / 12 if m.group(2) == "месяцев" else float(val)


def max_years(text):
    best = 0.0
    # «лишением свободы на тот же срок» – срок равен предшествующему в той же санкции
    for sent in re.split(r"(?<=[.;])\s", text):
        if "лишением свободы на тот же срок" in sent:
            head = sent.split("лишением свободы на тот же срок")[0]
            terms = [_val(m) for m in ANY_TERM.finditer(head)]
            if terms:
                best = max(best, terms[-1])
    if re.search(r"пожизненн[а-я]+ лишени[а-я]+ свободы|смертн[а-я]+ казн", text):
        return 99.0
    for m in IMPR.finditer(text):
        words = m.group(1).split()
        val = sum(NUM.get(w, 0) for w in words)
        if not val:
            continue
        if m.group(2) == "месяцев":
            val = val / 12
        best = max(best, float(val))
    return best


def category(years, careless):
    if years <= 3:
        return "small"
    if careless:
        return "medium" if years <= 10 else "grave"
    if years <= 5:
        return "medium"
    if years <= 10:
        return "grave"
    return "especially_grave"


def parse(path):
    arts, cur, part = {}, None, None
    in_notes = False
    for line in Path(path).read_text(encoding="utf-8").replace("\xa0", " ").splitlines():
        if line.startswith((" ", "ГАРАНТ", "Информация об изменениях")) or not line.strip():
            continue
        m = ART.match(line)
        if m:
            no, title = m.groups()
            cur = arts.setdefault(no, {"article": no, "title": title.strip(), "repealed": title.startswith("Утратила"), "parts": {}, "text": ""})
            part, in_notes = None, False
            continue
        if cur is None or line.startswith(("Раздел ", "Глава ")):
            if line.startswith(("Раздел ", "Глава ")):
                cur = None
            continue
        if line.startswith("Примечани"):
            in_notes = True
            continue
        if in_notes:
            continue
        pm = PART.match(line)
        if pm and not line.startswith("наказыва"):
            part = pm.group(1)
            cur["parts"].setdefault(part, {"part": part, "text": ""})
            cur["parts"][part]["text"] += pm.group(2) + "\n"
            continue
        if part:
            cur["parts"][part]["text"] += line + "\n"
        else:
            cur["text"] += line + "\n"
    out = []
    for no, a in arts.items():
        try:
            if float(no.split(".")[0]) < 105:
                continue
        except ValueError:
            continue
        careless_title = "неосторожност" in a["title"]
        parts = []
        src = a["parts"] or {"": {"part": None, "text": a["text"]}}
        for p in src.values():
            y = max_years(p["text"])
            careless = careless_title or ("по неосторожности" in p["text"][:300] and a["title"].startswith("Нарушение"))
            parts.append({"part": p["part"], "max_imprisonment_years": y,
                          "careless_heuristic": careless,
                          "category_computed": None if a["repealed"] else category(y, careless)})
        out.append({"article": no, "title": a["title"], "repealed": a["repealed"], "parts": parts})
    return out


if __name__ == "__main__":
    data = parse(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("статей особенной части:", len(data), "; частей:", sum(len(a["parts"]) for a in data))
