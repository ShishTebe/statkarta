"""Региональные пакеты (ответ В-77, документ 24): data/regions/2026/index.json и <код региона>.json.

В пакете региона – ОКАТО региона (открытые данные Росстата, как в import_okato.py), местные коды
следственных подразделений для реквизитов «кем расследовано» и строка этих кодов для бланков
информационного центра (scripts/import/regions-2026.json). Код региона – первые две цифры ОКАТО.
Без файла Росстата в «Карточки/ОКАТО/» ОКАТО берется из уже собранных пакетов.
Запуск: python3 scripts/import/build_regions.py
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_okato as io  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/regions/2026"
SPEC = json.loads((ROOT / "scripts/import/regions-2026.json").read_text(encoding="utf-8"))


def okato_by_region():
    csvs = sorted((io.CARDS / "ОКАТО").glob("*.csv")) if (io.CARDS / "ОКАТО").exists() else []
    if not csvs:
        out = {}
        for f in sorted(OUT.glob("[0-9][0-9].json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            out[d["region"]] = (d["okato"]["rows"], d["okato"]["source"])
        return out
    entries, source = io.from_csv(csvs[-1], set())
    out = {}
    for e in entries:
        code = e["code"][:2]
        rows, _ = out.setdefault(code, ([], source))
        rows.append([e["code"], e["name"]] + ([e["center"]] if e.get("center") else []))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    okato = okato_by_region()
    index = {"schema": "regions-index/1", "edition": SPEC["edition"], "targets": SPEC["targets"], "targets_source": SPEC["targets_source"],
             "after": SPEC["after"], "blank_region": SPEC["blank_region"], "blank_fragments": SPEC["blank_fragments"],
             "blank_fragments_source": SPEC["blank_fragments_source"], "regions": []}
    for code in sorted(okato):
        rows, source = okato[code]
        top = next((r for r in rows if r[0] == code + "0" * 9), rows[0])
        spec = SPEC["regions"].get(code, {})
        pack = {"schema": "region/1", "edition": SPEC["edition"], "region": code, "name": top[1],
                "status": spec.get("status", "okato"), "unit_codes": spec.get("unit_codes", []),
                "blank_line": spec.get("blank_line"), "sources": spec.get("sources", []),
                "okato": {"source": source, "count": len(rows), "rows": rows}}
        (OUT / f"{code}.json").write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        index["regions"].append({"code": code, "name": top[1], "status": pack["status"], "units": len(pack["unit_codes"]),
                                 "okato": len(rows), "file": f"{code}.json"})
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    verified = [r["code"] for r in index["regions"] if r["status"] == "verified"]
    print(f"регионов: {len(index['regions'])}; с местными кодами: {', '.join(verified) or 'нет'}; ОКАТО записей: {sum(r['okato'] for r in index['regions'])}")


if __name__ == "__main__":
    main()
