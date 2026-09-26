"""Полная пересборка пакетов данных из локальных источников (Фаза 0).

Порядок: формы → справочники → УК и перечни → нормативная база → правила → схемы →
типографика → манифест → валидация. Источники – соседние папки рабочего каталога
и data-private/sources (распознанные тексты). Запуск: python3 scripts/build_data.py
"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data-private/sources"
STEPS = [
    ["python3", "scripts/import/import_forms.py"],
    ["python3", "scripts/import/import_ipk.py"],
    ["python3", "scripts/import/import_classifiers.py"],
    ["python3", "scripts/import/build_regions.py"],
    ["python3", "scripts/import/parse_uk.py", str(SRC / "uk-rf.txt"), str(SRC / "uk-parsed.json")],
    ["python3", "scripts/import/parse_lists.py", str(SRC / "perechni-2025-07-28.vision.txt"), str(SRC / "uk-parsed.json")],
    ["python3", "scripts/import/import_legal.py", str(SRC / "razj-gp-2025-07-01.txt")],
    ["python3", "scripts/build_rules.py"],
    ["python3", "scripts/build_schemas.py"],
    ["python3", "scripts/normalize_typography.py"],
    ["node", "scripts/build-manifest.mjs"],
    ["node", "scripts/validate-data.mjs"],
]

for cmd in STEPS:
    print("\n>>>", " ".join(cmd[:2]))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode:
        sys.exit(r.returncode)
