"""Канон типографики для пакетов данных: «ё» → «е», «—» → «–».

Применяется ко всем строковым значениям JSON в data/ и data-private/ (кроме схем).
Запуск: python3 scripts/normalize_typography.py
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dehyphen import fix as dehyphen, split_glued

ROOT = Path(__file__).resolve().parents[1]
TABLE = str.maketrans({"ё": "е", "Ё": "Е", "—": "–"})


def fix(v, split=False):
    if isinstance(v, str):
        t = dehyphen(v)
        return (split_glued(t) if split else t).translate(TABLE)
    if isinstance(v, list):
        return [fix(x, split) for x in v]
    if isinstance(v, dict):
        return {fix(k): fix(x, split) for k, x in v.items()}
    return v


def main():
    changed = 0
    for base in ("data", "data-private"):
        for p in sorted((ROOT / base).rglob("*.json")):
            if "schema" in p.parts:
                continue
            raw = p.read_text(encoding="utf-8")
            orig = json.loads(raw)
            data = fix(orig, split="classifiers" in p.parts)
            if data == orig:
                continue
            compact = p.stat().st_size > 5_000_000 or "data-private" in p.parts
            p.write_text(json.dumps(data, ensure_ascii=False, indent=None if compact else 1), encoding="utf-8")
            changed += 1
            print("исправлен:", p.relative_to(ROOT))
    print("файлов исправлено:", changed)


if __name__ == "__main__":
    main()
