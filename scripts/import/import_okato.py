"""Классификатор ОКАТО для реквизитов «Место совершения преступления по ОКАТО» (ф. 1 р. 19.1, ф. 2 р. 28.1, ф. 5 р. 18.3).

Источники:
1) официальный набор открытых данных Росстата «ОКАТО» (rosstat.gov.ru/opendata/7708234640-okato), CSV со структурой
   20140709: TER;KOD1;KOD2;KOD3;RAZDEL;NAME1;CENTRUM;NOMDESCR;NOMAKT;STATUS;DATEUTV;DATEVVED (кодировка windows-1251).
   Файл кладется в «Карточки/ОКАТО/». Регионы отбираются параметром --regions (коды ТЕР через запятую), по умолчанию все.
2) если CSV нет – фрагмент «Карточки/!!Общероссийский классификатор ОКАТО.doc» (Камчатский край, верхние уровни).
Запуск: python3 scripts/import/import_okato.py [--regions 30]
"""
import csv, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT.parents[1] / "Карточки"
OUT = ROOT / "data/classifiers/2026/okato.json"


def from_csv(path, regions):
    raw = path.read_bytes()
    text = raw.decode("utf-8") if raw[:3] == b"\xef\xbb\xbf" or b"\xd0" in raw[:2000] else raw.decode("cp1251")
    rows = list(csv.reader(text.splitlines(), delimiter=";"))
    entries, names = [], {}
    for r in rows:
        if len(r) < 7 or not r[0].strip().isdigit():
            continue
        ter, k1, k2, k3 = (x.strip().strip('"') for x in r[:4])
        if regions and ter.zfill(2) not in regions:
            continue
        code = ter.zfill(2) + k1.zfill(3) + k2.zfill(3) + k3.zfill(3)
        name = re.sub(r"\s*\^\s*", " ", r[5].strip().strip('"')).strip()
        if name.startswith("Объекты административно-территориального деления") or name == "Сельские населенные пункты" or name.rstrip().endswith("/"):
            continue  # заголовки групп («Поселки городского типа …/») – не объекты
        section = r[4].strip().strip('"')
        if section == "1" or code not in names:
            names.setdefault(code, name)
        entries.append({"code": code, "name": name, "center": re.sub(r"\s*\^\s*", " ", r[6].strip().strip('"')).strip(), "section": r[4].strip().strip('"')})
    for e in entries:
        c = e["code"]
        parents = [c[:2] + "0" * 9, c[:5] + "0" * 6, c[:8] + "000"]
        e["path"] = [names[p].lstrip("- ").strip() for p in dict.fromkeys(parents) if p != c and p in names]
        e["name"] = e["name"].lstrip("- ").strip()
        if e.pop("section", "1") == "2":
            e["name"] = f"{e['name']} (сельский населенный пункт)"
        if not e["center"]:
            e.pop("center")
    seen, uniq = set(), []
    for e in entries:
        if e["code"] in seen:
            continue
        seen.add(e["code"])
        uniq.append(e)
    return uniq, f"Росстат, открытые данные «ОКАТО»: {path.name}"


def from_doc():
    doc = CARDS / "!!Общероссийский классификатор ОКАТО.doc"
    text = subprocess.run(["textutil", "-convert", "txt", "-stdout", str(doc)], capture_output=True, text=True).stdout
    entries, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^│(\d{2}(?: \d{3}){0,3})\s+\d\s+(.*?)\s{2,}(.*?)\s*│$", line) or re.match(r"^│(\d{2}(?: \d{3}){0,3})\s+\d\s+(.*?)\s*│$", line)
        if m:
            parts = m.group(1).split()
            code = (parts + ["000"] * 4)[:4]
            code = code[0] + "".join(p.zfill(3) for p in code[1:])
            cur = {"code": code, "name": m.group(2).strip(), "center": (m.group(3).strip() if m.lastindex >= 3 else "")}
            entries.append(cur)
            continue
        m = re.match(r"^│(\s{10,}\S.*?)\s*│$", line)
        if m and cur:
            t = m.group(1)
            indent = len(t) - len(t.lstrip())
            cols = re.split(r"\s{2,}", t.strip())
            if len(cols) == 2:
                cur["name"] += " " + cols[0]
                cur["center"] += " " + cols[1]
            elif indent >= 40:
                cur["center"] += " " + t.strip()
            else:
                cur["name"] += " " + t.strip()
    names = {e["code"]: e["name"] for e in entries}
    for e in entries:
        e["name"] = re.sub(r"\s+", " ", e["name"]).strip(" /").lstrip("- ")
        e["center"] = re.sub(r"-\s+", "-", re.sub(r"\s+", " ", e["center"])).strip()
        c = e["code"]
        e["path"] = [re.sub(r"\s+", " ", names[p]).strip(" /").lstrip("- ") for p in dict.fromkeys([c[:2] + "0" * 9, c[:5] + "0" * 6]) if p != c and p in names]
        if not e["center"]:
            e.pop("center")
    return entries, "Фрагмент ОКАТО (Карточки/!!Общероссийский классификатор ОКАТО.doc): Камчатский край, верхние уровни"


def main():
    regions = set()
    if "--regions" in sys.argv:
        regions = {x.strip().zfill(2) for x in sys.argv[sys.argv.index("--regions") + 1].split(",")}
    csvs = sorted((CARDS / "ОКАТО").glob("*.csv")) if (CARDS / "ОКАТО").exists() else []
    entries, source = from_csv(csvs[-1], regions) if csvs else from_doc()
    doc = {"no": "okato", "title": "ОКАТО – Общероссийский классификатор объектов административно-территориального деления",
           "edition": "2026", "source": source, "complete": bool(csvs), "regions": sorted(regions) if regions else "все",
           "count": len(entries), "entries": entries}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=None), encoding="utf-8")
    print(f"ОКАТО: {len(entries)} записей; источник: {source}")
    for e in entries[:6]:
        print("  ", e["code"], " / ".join(e["path"]), "→", e["name"], e.get("center", ""))


if __name__ == "__main__":
    main()
