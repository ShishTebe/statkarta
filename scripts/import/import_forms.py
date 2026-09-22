"""Импорт пакета форм из готовой базы _СТАТКАРТОЧКИ_MD (ред. 2026).

Исправляет артефакты разбора исходной схемы и пишет журнал исправлений.
Запуск: python3 scripts/import/import_forms.py
"""
import json, re, sys, collections
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from options_parser import parse_options, drop_needless_groups
import field_model as FM
CELLS = json.loads((Path(__file__).resolve().parents[2] / "data-private/sources/blank-cells-2026.json").read_text(encoding="utf-8"))["fields"]
CLS_CODES = {}
for _f in (Path(__file__).resolve().parents[2] / "data/classifiers/2026").glob("spr-*.json"):
    _d = json.loads(_f.read_text(encoding="utf-8"))
    CLS_CODES[_d["no"]] = [e["code"] for e in _d["entries"] if e.get("active", True)]

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT.parents[1] / "Методики/_СТАТКАРТОЧКИ_MD/model/cards-2026-schema.json"
OUT = ROOT / "data/forms/2026"
LOG = []
STATS = collections.Counter()

ORGAN_CODES = {"01", "02", "04", "05", "06", "07", "08", "09", "10", "11", "14"}
TEXT_LABELS = re.compile(r"^(ОПИСАНИЕ|КВАЛИФИКАЦИЯ|ФАМИЛИЯ|ИМЯ|ОТЧЕСТВО|МЕСТО РАБОТЫ|ВИД экономической|Фамилия|Имя|Отчество|Квалификация|Порядковый номер|КОЛИЧЕСТВО|Количество)")
DATE_MARK = re.compile(r"[«“\"]_+[»”\"]|20_+\s*г|год\s+мес")
CLS_IN_TEXT = re.compile(r"по справочнику\s*№\s*(\d+)")
TITLES = {}
_CORR = json.loads((Path(__file__).resolve().parent / "form-corrections-2026.json").read_text(encoding="utf-8"))
CORR = _CORR["corrections"]
ADD = _CORR.get("additions", [])
LABELS = json.loads((Path(__file__).resolve().parent / "form-labels-2026.json").read_text(encoding="utf-8"))["forms"]
# хвост единицы измерения предыдущего варианта или номер графы, приклеенные разметкой к началу варианта
OPT_JUNK = re.compile(r"^(?:(?:руб\.|кг|карат|тонн|ед\.|штук|граммов)\s*,?\s*|\d+\.\d+\s+)")
EMB_RX = re.compile(r"Справочник для заполнения реквизит\w*\s*№\s*([\d, ]+?)\s+(?=[А-ЯЁ])")


def split_embedded(fid, reqs):
    """Встроенные в бланк справочники (ф. 6) склеены в текст одного реквизита – выделяем их."""
    emb = []
    for r in reqs:
        raw = r.get("raw") or ""
        ms = list(EMB_RX.finditer(raw))
        if not ms:
            continue
        for i, m in enumerate(ms):
            nums = [x.strip() for x in m.group(1).split(",") if x.strip()]
            text = raw[m.end(): ms[i + 1].start() if i + 1 < len(ms) else len(raw)].strip()
            eopts = parse_options(text)
            for o in eopts:
                o.pop("_ctx", None)
            first = re.split(r":\s", text, 1)[0].strip() if ":" in text[:200] else None
            if first and any(o.get("group") for o in eopts):
                for o in eopts:
                    o.setdefault("group", first)
            emb.append({"id": f"f{fid.replace('.', '_')}-{'-'.join(nums)}".replace("f6_", "f6"), "title": f"Справочник для заполнения реквизитов № {', '.join(nums)}",
                        "applies_to": nums, "raw": text, "options": eopts})
        LOG.append(f"ф. {fid}: из реквизита {r['code']} выделено встроенных справочников: {len(ms)}")
        r["raw"], r["options"] = None, []
    return emb


def has_letters(s):
    return bool(re.search(r"[А-Яа-яЁё]", s or ""))


def clean_label(label):
    s = (label or "").strip()
    s = re.sub(r"\(по спр[а-я.]*\s*№?\s*\d*\)?\s*$", "", s)
    s = re.sub(r"[\s(«“\"№]+$", "", s)
    s = re.sub(r"\s+(ст|зн|ч|п)$", "", s)
    return s.strip(" _")


def fills_by(form, section, label):
    sec = (section or "").upper()
    if "в ИЦ" in (label or ""):
        return "ic"
    if form == "6":
        if sec.startswith("РАЗДЕЛ 1"):
            return "investigator"
        return "court"
    if sec.startswith("РАЗДЕЛ 1"):
        return "registrar"
    if sec.startswith("РАЗДЕЛ 3"):
        return "head"
    return "investigator"


def derive_type(r):
    raw = r.get("raw") or r.get("label") or ""
    opts = r.get("options") or []
    has_date = bool(DATE_MARK.search(raw)) or bool(re.match(r"^Дата", r["label"]))
    rest = DATE_MARK.sub("", raw)
    has_text = "___" in rest or "№" in rest or bool(TEXT_LABELS.match(r["label"]))
    if r.get("classifier_no"):
        t = "classifier"
    elif opts:
        t = "enum"
    elif TEXT_LABELS.match(r["label"]):
        t = "text"
    elif has_date and not ("___" in rest):
        t = "date"
    elif has_date and re.match(r"^Дата", r["label"]):
        t = "date"
    else:
        t = "text"
    return t, has_text, has_date


def fix_form(form):
    fid = form["form"]
    reqs = [dict(r) for r in form["requisites"]]
    # 1. «1 Текст» у реквизита N – на деле подреквизит N.1
    for r in reqs:
        m = re.match(r"^(\d)\s+(.*)$", r.get("label") or "")
        if m and has_letters(m.group(2)) and "." not in r["code"]:
            new = f"{r['code']}.{m.group(1)}"
            LOG.append(f"ф. {fid}: реквизит {r['code']} «{r['label'][:40]}…» перенумерован в {new}")
            r["code"] = new
            r["label"] = m.group(2)
            if r.get("raw"):
                r["raw"] = re.sub(r"^\d\s+", "", r["raw"])
    # 2. пустые артефакты
    nonempty = collections.Counter(r["code"] for r in reqs if has_letters(r.get("label")) or has_letters(r.get("raw")))
    out = []
    for r in reqs:
        empty = not (has_letters(r.get("label")) or has_letters(r.get("raw")))
        if empty and nonempty[r["code"]]:
            LOG.append(f"ф. {fid}: удален пустой дубль реквизита {r['code']}")
            continue
        out.append(r)
    # 3. метки
    by_code = {}
    for r in out:
        by_code.setdefault(r["code"], r)
    for r in out:
        r["label_status"] = "source"
        if set((r.get("label") or "").strip()) <= set("_ ") and r.get("options") and {o["code"] for o in r["options"]} <= ORGAN_CODES:
            r["label"] = "Орган (составитель карточки)"
            r["label_status"] = "derived"
            LOG.append(f"ф. {fid}: реквизиту {r['code']} присвоено наименование «Орган» по составу кодов")
        elif not has_letters(r.get("label")) and not has_letters(r.get("raw")):
            parent = by_code.get(r["code"].split(".")[0])
            base = clean_label(parent["label"]) if parent else "Подреквизит"
            r["label"] = f"{base} – графа {r['code']}"
            r["label_status"] = "needs_review"
            LOG.append(f"ф. {fid}: реквизит {r['code']} без текста в источнике – наименование по родителю, требует сверки с бланком")
        else:
            r["label"] = clean_label(r["label"]) or r["label"]
    # 4. уникальность номеров
    seen = collections.Counter()
    for r in out:
        seen[r["code"]] += 1
        r["id"] = r["code"] if seen[r["code"]] == 1 else f"{r['code']}~{seen[r['code']]}"
        if seen[r["code"]] > 1:
            LOG.append(f"ф. {fid}: номер {r['code']} встречается повторно – идентификатор {r['id']}, требует сверки")
    # 5. типы, привязки, кто заполняет
    res = []
    for r in out:
        cls = r.get("classifier_no")
        if not cls:
            m = CLS_IN_TEXT.search(r.get("raw") or "")
            if m:
                cls = int(m.group(1))
                LOG.append(f"ф. {fid}: реквизит {r['code']} – привязка к справочнику № {cls} найдена в тексте бланка")
        if fid == "1" and r["code"] == "22" and not cls:
            cls = 1
            LOG.append("ф. 1: реквизит 22 привязан к справочнику № 1 (вид экономической деятельности)")
        r["classifier_no"] = cls
        t, ht, hd = derive_type(r)
        if t != r.get("field_type"):
            LOG.append(f"ф. {fid}: реквизит {r['code']} – тип {r.get('field_type')} исправлен на {t}")
        opts = [{"code": o["code"], "value": o["value"]} for o in (r.get("options") or [])]
        if opts and r.get("raw"):
            new = parse_options(r["raw"], number=r["code"])
            if collections.Counter(o["code"] for o in new) == collections.Counter(o["code"] for o in opts):
                opts = drop_needless_groups(new)
                STATS["options_reparsed"] += 1
            else:
                LOG.append(f"ф. {fid}: реквизит {r['code']} – новый разбор вариантов не совпал по кодам, оставлен исходный")
        item = {
            "id": r["id"],
            "number": r["code"],
            "label": r["label"],
            "label_status": r["label_status"],
            "field_type": t,
            "classifier_no": cls,
            "options": opts,
            "multiple": None,
            "has_text": ht,
            "has_date": hd,
            "section": r.get("section"),
            "fills_by": fills_by(fid, r.get("section"), r["label"]),
            "raw": r.get("raw"),
        }
        if r.get("input"):
            item["input"] = r["input"]
        res.append(item)
    return res


def apply_labels(fid, reqs):
    """Наименования реквизитов, сверенные вручную с бланком (form-labels-2026.json), и очистка вариантов."""
    spec = LABELS.get(fid, {})
    ids = {r["id"] for r in reqs}
    for key in ("labels", "options", "fix", "options_add", "fill_labels"):
        for rid in spec.get(key, {}):
            if rid not in ids:
                sys.exit(f"form-labels ф. {fid} р. {rid}: реквизит не найден")
    out = []
    for r in reqs:
        if r["id"] in spec.get("drop", []):
            LOG.append(f"ф. {fid}: строка разметки {r['id']} «{r['label']}» – не реквизит (заголовок группы на бланке), исключена")
            continue
        if r["id"] in spec.get("labels", {}):
            r["label"] = spec["labels"][r["id"]]
            r["label_status"] = "verified"
        r.update(spec.get("fix", {}).get(r["id"], {}))
        # варианты бланка информационного центра, которых нет в источнике (региональные коды подразделений)
        for add in spec.get("options_add", {}).get(r["id"], []):
            at = next((i for i, o in enumerate(r["options"]) if o["code"] == add["after"]), None)
            if at is None:
                sys.exit(f"form-labels ф. {fid} р. {r['id']}: для дополнения нет варианта {add['after']}")
            opt = {"code": add["code"], "value": add["value"]}
            if add.get("hint"):
                opt["hint"] = add["hint"]
            r["options"].insert(at + 1 + sum(1 for x in spec["options_add"][r["id"]][:spec["options_add"][r["id"]].index(add)] if x["after"] == add["after"]), opt)
            LOG.append(f"ф. {fid} р. {r['id']}: добавлен вариант бланка {add['code']} «{add['value']}»")
        # подписи дополнительных полей, сверенные с бланком (замечание 22.09.2026)
        for idx, label in spec.get("fill_labels", {}).get(r["id"], {}).items():
            fills = (r.get("input") or {}).get("fills") or []
            if int(idx) >= len(fills):
                sys.exit(f"form-labels ф. {fid} р. {r['id']}: нет дополнительного поля № {idx}")
            fills[int(idx)]["label"] = label
            fills[int(idx)]["label_status"] = "verified"
        fixes = spec.get("options", {}).get(r["id"], {})
        for o in r["options"]:
            # исправление варианта: по коду или по «группа|код» (одинаковые коды в разных группах);
            # строка – новое наименование, объект – наименование и (или) подсказка с полным смыслом кода
            fix = fixes.get(f"{o.get('group') or ''}|{o['code']}", fixes.get(o["code"]))
            if isinstance(fix, dict):
                o.update({k: v for k, v in fix.items() if k in ("value", "hint")})
            elif fix is not None:
                o["value"] = fix
            else:
                v = OPT_JUNK.sub("", o["value"]).strip()
                if v and v != o["value"]:
                    o["value"] = v
                    STATS["options_cleaned"] += 1
        out.append(r)
    return out


def main():
    s = json.loads(SRC.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    total_src = total_out = 0
    index = []
    for f in s["forms"]:
        src_reqs = [dict(r) for r in f["requisites"]]
        # реквизиты бланка заказчика, которых нет в источнике (региональные, ф. 3 р. 7.2, 18)
        for a in [a for a in ADD if a["form"] == f["form"]]:
            at = next((i for i, r in enumerate(src_reqs) if r["code"] == a["after"]), None)
            if at is None:
                sys.exit(f"дополнение ф. {a['form']}: нет реквизита {a['after']}")
            src_reqs.insert(at + 1, {"section": src_reqs[at].get("section"), **a["requisite"]})
            LOG.append(f"ф. {a['form']}: добавлен реквизит {a['requisite']['code']} – {a['source']}")
        emb = split_embedded(f["form"], src_reqs)
        reqs = fix_form({**f, "requisites": src_reqs})
        emb_map = {e["id"]: e for e in emb}
        for c in [c for c in CORR if c["form"] == f["form"]]:
            hit = [r for r in reqs if r["id"] == c["id"]]
            if len(hit) != 1:
                sys.exit(f"исправление ф. {c['form']} р. {c['id']}: реквизит не найден")
            r = hit[0]
            for k in ("label", "field_type", "classifier_no", "has_text", "has_date", "fills_by", "raw"):
                if k in c:
                    r[k] = c[k]
            if c.get("options_from_embedded"):
                r["options"] = [dict(o) for o in emb_map[c["options_from_embedded"]]["options"]]
            if any(k in c for k in ("label", "field_type", "classifier_no", "raw")) or c.get("options_from_embedded"):
                r["label_status"] = "corrected"
                r["correction_source"] = c["source"]
            if c.get("input"):
                r.setdefault("input_override", {}).update(c["input"])
                r.setdefault("input_sources", []).append(c["source"])
            STATS["corrected"] += 1
        for r in reqs:
            codes = [o["code"] for o in r["options"]] or CLS_CODES.get(r.get("classifier_no"), [])
            L = FM.code_length(codes)
            fields = FM.fields_from_cells(CELLS.get(f["form"], {}).get(r["number"]), L)
            inp = {"code_digits": L, "fields": fields, "fields_source": "бланк" if fields else None}
            if codes:
                if (fields or 1) > 1:
                    inp.update(select="multiple", max_codes=min(fields, len(codes)))
                elif FM.overlay_capable(codes, r.get("classifier_no")):
                    inp.update(select="overlay", max_codes=1)
                else:
                    inp.update(select="single", max_codes=1)
            fills = FM.fills_from_raw(r.get("raw"), codes) if r["field_type"] in ("enum", "classifier", "text") and r["id"] not in ("13", "13.1", "19.1") else []
            if fills:
                inp["fills"] = fills
            inp.update(r.pop("input_override", {}))
            if r.get("input_sources"):
                inp["sources"] = r.pop("input_sources")
            r["input"] = {k: v for k, v in inp.items() if v is not None}
        reqs = apply_labels(f["form"], reqs)
        total_src += len(f["requisites"])
        total_out += len(reqs)
        doc = {
            "form": f["form"],
            "title": f["title"],
            "edition": "2026",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "legal_basis": "приказ МВД России от 25.02.2025 № 73" if f["form"] == "2.1" else
                           "совместный приказ Генпрокуратуры России, МВД России и др. от 29.12.2005 № 39/1070/1021/253/780/353/399 «О едином учете преступлений» (в ред. на 2026)",
            "source": "Карточки/Статистические карточки на 2026.pdf; Карточки/cards_*.docx; через Методики/_СТАТКАРТОЧКИ_MD/model/cards-2026-schema.json",
            "requisites_count": len(reqs),
            **({"embedded_classifiers": emb} if emb else {}),
            "requisites": reqs,
        }
        name = f"forma-{f['form'].replace('.', '-')}.json"
        (OUT / name).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        index.append({"form": f["form"], "title": f["title"], "file": name, "requisites": len(reqs)})
        print(f"ф. {f['form']:>4}: {len(f['requisites'])} → {len(reqs)}")
    (OUT / "index.json").write_text(json.dumps({"edition": "2026", "forms": index}, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "docs/import-log-forms-2026.md").write_text(
        "# Журнал импорта пакета форм (ред. 2026)\n\n"
        f"Источник: `{SRC.relative_to(ROOT.parents[1])}`. Реквизитов в источнике: {total_src}; в пакете: {total_out}.\n\n"
        + "\n".join(f"- {x}" for x in LOG) + "\n", encoding="utf-8")
    print("итого", total_src, "→", total_out, "; записей журнала:", len(LOG), "; вариантов переразобрано:", STATS["options_reparsed"], "; исправлено по таблице:", STATS["corrected"], "; вариантов очищено:", STATS["options_cleaned"])


if __name__ == "__main__":
    main()
