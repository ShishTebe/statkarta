"""Пакет нормативной базы: реестр актов и разъяснения с привязкой к реквизитам.

Разъяснения – дословные абзацы из «Разъяснения ГП по ДПУ с 01.07.2025.rtf».
Вход: текст RTF (textutil). Запуск: python3 scripts/import/import_legal.py <razj.txt>
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/legal/2026"
FORMS = ROOT / "data/forms/2026"

ACTS = [
    {"id": "order-39-2005", "kind": "межведомственный приказ", "date": "2005-12-29", "number": "39/1070/1021/253/780/353/399",
     "title": "О едином учете преступлений", "issuer": "Генпрокуратура России, МВД России, МЧС России, Минюст России, ФСБ России, Минэкономразвития России, ФСКН России",
     "summary": "Основной акт единого учета: Положение о едином порядке регистрации уголовных дел и учета преступлений, Инструкция о порядке заполнения и представления учетных документов, формы документов первичного учета.",
     "applies_to_forms": ["1", "1.1", "2", "3", "4", "5", "6"], "status": "действует (с изменениями)", "publication": "public"},
    {"id": "mvd-73-2025", "kind": "приказ", "date": "2025-02-25", "number": "73", "issuer": "МВД России",
     "title": "Об утверждении формы статистической карточки на лицо, подозреваемое (обвиняемое) в совершении преступления, и руководства по ее заполнению",
     "summary": "Утверждены форма № 2.1 и Руководство по ее заполнению; применяется с 01.01.2026.",
     "applies_to_forms": ["2.1"], "status": "действует", "publication": "public",
     "source_file": "Карточки/СПРАВОЧНИКИ/Об утверждении ДПУ ф. 2.1 и руководство по его заполнению с 01.04.2025.pdf",
     "note": "Наименование акта приведено по смыслу; сверить с официальным текстом."},
    {"id": "gp-mvd-147-2025", "kind": "указание", "date": "2025-07-28", "number": "147", "issuer": "Генпрокуратура России, МВД России",
     "title": "О введении в действие перечней статей Уголовного кодекса Российской Федерации, используемых при формировании статистической отчетности",
     "summary": "Перечни № 1–14, 20–26 статей УК РФ (дознание, экономическая направленность, наркотики, категории тяжести, размеры ущерба, коррупция, терроризм, экстремизм, ИТТ и др.). Заменило указание от 27.12.2024 № 952/11/3.",
     "applies_to_forms": ["1", "1.1", "2", "2.1"], "status": "действует", "publication": "public",
     "source_file": "Карточки/Перечни УК РФ от 28.07.2025.pdf", "package": "data/uk/2026/lists.json"},
    {"id": "fz-64-2024", "kind": "федеральный закон", "date": "2024-03-23", "number": "64-ФЗ", "issuer": "Федеральное Собрание",
     "title": "О внесении изменений в Уголовно-процессуальный кодекс Российской Федерации (приостановление по п. 3.1 ч. 1 ст. 208 УПК РФ)",
     "summary": "Введено основание приостановления по п. 3.1 ч. 1 ст. 208 УПК РФ; такие преступления не включаются в число нераскрытых (ф. 1 р. 7.2, ф. 3 р. 12).",
     "applies_to_forms": ["1", "3"], "status": "действует", "publication": "public",
     "note": "Наименование закона приведено по смыслу; сверить с официальным текстом."},
    {"id": "gp-razj-2025-07", "kind": "разъяснения и рекомендации", "date": "2025-07-01", "number": None, "issuer": "Генеральная прокуратура Российской Федерации",
     "title": "Разъяснения по использованию отдельных кодов и рекомендации по дополнению документов первичного учета (на 01.07.2025)",
     "summary": "Разъяснения к ф. 1 р. 9, ф. 1.1 р. 13, ф. 4 р. 12, 15, 29, справочникам № 12, 15, 16; дополнения реквизитов 5.1, 7.2, 7.3, 19.2 и др.",
     "applies_to_forms": ["1", "1.1", "2", "3", "4", "5"], "status": "действует", "publication": "public",
     "source_file": "Карточки/СПРАВОЧНИКИ/Разъяснения ГП по ДПУ с 01.07.2025.rtf", "package": "data/legal/2026/explanations.json"},
    {"id": "giac-razj-2026", "kind": "разъяснения", "date": "2026-01-01", "number": None, "issuer": "ГИАЦ МВД России, Генеральная прокуратура Российской Федерации",
     "title": "Разъяснения по использованию отдельных кодов (сборник «Справочники и разъяснения», 2026)",
     "summary": "Разъяснения к кодам справочников № 12, 15, 16 и реквизитам форм, действующие с 2026 года.",
     "applies_to_forms": ["1", "1.1", "2", "3", "4", "5"], "status": "действует", "publication": "public",
     "source_file": "Карточки/СПРАВОЧНИКИ/Справочники_и_разъяснения_2026.pdf"},
    {"id": "giac-razj-2025", "kind": "разъяснения", "date": "2025-01-01", "number": None, "issuer": "ГИАЦ МВД России",
     "title": "Разъяснения по использованию отдельных кодов (сборник «Справочники для заполнения документов первичного учета», 2025)",
     "summary": "Разъяснения к кодам справочников № 2, 4, 9, 10, 12, 14, 15, 16 и к реквизитам форм.",
     "applies_to_forms": ["1", "1.1", "2", "4", "5", "6"], "status": "действует", "publication": "public",
     "source_file": "Карточки/Справочники_и_разъяснения.pdf"},
    {"id": "gp-izm-all-2025", "kind": "обобщение изменений", "date": "2025-01-01", "number": None, "issuer": "Генеральная прокуратура Российской Федерации (обобщение)",
     "title": "Изменения и разъяснения по документам первичного учета (обобщено за все годы, на 01.01.2025)",
     "summary": "Хронология изменений реквизитов и разъяснений прошлых лет. Изменения уже отражены в бланках ред. 2026; в пакет разъяснений не разбиралось.",
     "applies_to_forms": ["1", "1.1", "2", "3", "4", "5", "6"], "status": "справочно", "publication": "public",
     "source_file": "Карточки/СПРАВОЧНИКИ/Изменения и разъяснения по ДПУ с 01.01.2025 (обобщено все года).rtf"},
    {"id": "giac-sprav-2026", "kind": "справочники", "date": "2026-01-01", "number": None, "issuer": "ГИАЦ МВД России",
     "title": "Справочники для заполнения документов первичного учета (ред. 2026)",
     "summary": "Справочники № 1–12, 14–16; справочник № 17 – реестр подразделений на 01.01.2025.",
     "applies_to_forms": ["1", "1.1", "2", "2.1", "4", "5", "6"], "status": "действует", "publication": "public",
     "source_file": "Карточки/СПРАВОЧНИКИ/Справочники_и_разъяснения_2026.pdf", "package": "data/classifiers/2026/"},
]

CTX_FORM = re.compile(r"КАРТОЧКА ФОРМЫ\s*№\s*(\d(?:\.\d)?)")
CTX_CLS = re.compile(r"^СПРАВОЧНИК\s*№\s*(\d+)")
PAIR = re.compile(r"реквизит\w*\s+(\d+(?:\.\d+)?)\s+(?:статистической\s+)?(?:карточки\s+)?формы\s*№\s*(\d(?:\.\d)?)")
REQS = re.compile(r"реквизит\w*\s+(?:№\s*)?((?:\d+(?:\.\d+)?)(?:\s*(?:,|и|–|-)\s*\d+(?:\.\d+)?)*)", re.I)
FORMS_RE = re.compile(r"форм\w*\s*№\s*(\d(?:\.\d)?)(?:\s*и\s*№\s*(\d(?:\.\d)?))?")
CODE_LEAD = re.compile(r"^(\d{3})\s*[–-]")
CODES = re.compile(r"\b[Кк]од(?:ы|ом|ов)?\s*«?((?:\d{2,3})(?:\s*(?:,|и)\s*\d{2,3})*)")


def classifier_usage():
    use = {}
    for f in sorted(FORMS.glob("forma-*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for r in d["requisites"]:
            if r.get("classifier_no"):
                use.setdefault(r["classifier_no"], []).append({"form": d["form"], "requisite": r["number"]})
    return use


def bind_text(t, ctx_form):
    binds, last_form = [], ctx_form
    for sent in re.split(r"(?<=[.;])\s+(?=[А-ЯЁ])", t):
        fpos = [(m.start(), m.group(1)) for m in re.finditer(r"(?:форм\w*|карточк\w*)\s*№\s*(\d(?:\.\d)?)", sent)]
        for m in REQS.finditer(sent):
            nums = re.findall(r"\d+(?:\.\d+)?", m.group(1))
            after = [x for x in fpos if x[0] > m.start()]
            before = [x for x in fpos if x[0] < m.start()]
            form = after[0][1] if after else before[-1][1] if before else last_form
            if form:
                binds += [{"form": form, "requisite": n} for n in nums]
        if fpos:
            last_form = fpos[-1][1]
    seen = set()
    return [b for b in binds if not ((b["form"], b["requisite"]) in seen or seen.add((b["form"], b["requisite"])))]


def classifier_codes():
    out = {}
    for f in (ROOT / "data/classifiers/2026").glob("spr-*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        out[d["no"]] = {e["code"]: e["name"] for e in d["entries"]}
    return out


def resolve_code(codes, raw_code, hint):
    if raw_code in codes:
        return raw_code
    for c in (raw_code + "0", raw_code + "00", "0" + raw_code, "00" + raw_code):
        if c in codes:
            return c
    cands = [c for c, n in codes.items() if hint and hint.lower()[:12] in n.lower()]
    return cands[0] if len(cands) == 1 else None


def parse_code_explanations(path, act, use, cls_codes, known_texts):
    """Разъяснения по использованию отдельных кодов из сборника ГИАЦ: блок текста на код справочника."""
    lines = Path(path).read_text(encoding="utf-8").replace("\u00a0", " ").splitlines()
    try:
        a = max(i for i, l in enumerate(lines) if l.startswith("Разъяснения по использованию отдельных кодов"))
        b = max(i for i, l in enumerate(lines) if l.startswith("РЕКОМЕНДАЦИИ ПО ДОПОЛНЕНИЮ"))
    except ValueError:
        return []
    blocks, cur, ctx_cls, ctx_form, heading = [], None, None, None, None
    i = a + 1
    while i < b:
        l = lines[i].strip()
        i += 1
        if not l or re.fullmatch(r"\d{1,3}", l):
            continue
        m = re.match(r"^СПРАВОЧНИК\s*№\s*(\d+)", l)
        if m:
            ctx_cls, ctx_form, heading = int(m.group(1)), None, l
            while i < b and lines[i].strip().isupper() and not re.match(r"^(СПРАВОЧНИК|СТАТИСТИЧЕСКАЯ)", lines[i].strip()):
                heading += " " + lines[i].strip()
                i += 1
            cur = None
            continue
        m = re.match(r"^СТАТИСТИЧЕСКАЯ КАРТОЧКА\s*ФОРМЫ\s*№\s*(\d(?:\.\d)?)", l)
        if m:
            ctx_form, ctx_cls, heading, cur = m.group(1), None, l, None
            while i < b and lines[i].strip().isupper() and not re.match(r"^(СПРАВОЧНИК|СТАТИСТИЧЕСКАЯ)", lines[i].strip()):
                heading += " " + lines[i].strip()
                i += 1
            continue
        m = re.match(r"^((?:\d{2,6})(?:\s*,\s*\d{2,6})*)\s+[–-]\s+(.+)$", l)
        if m and ctx_cls:
            raw_codes = re.findall(r"\d{2,6}", m.group(1))
            codes = [resolve_code(cls_codes.get(ctx_cls, {}), rc, m.group(2)) or rc for rc in raw_codes]
            cur = {"cls": ctx_cls, "form": None, "codes": codes, "heading": heading, "title": l, "lines": []}
            blocks.append(cur)
            continue
        if cur is None:
            cur = {"cls": ctx_cls, "form": ctx_form, "codes": [], "heading": heading, "title": None, "lines": []}
            blocks.append(cur)
        cur["lines"].append(l)
    notes = []
    for bl in blocks:
        paras, buf = [], ""
        for l in bl["lines"]:
            if buf and re.search(r"[.:;!?]$", buf) and (l[:1].isupper() or re.match(r"^[а-я]\)|^\d+\.", l)):
                paras.append(buf)
                buf = l
            else:
                buf = f"{buf} {l}".strip()
        if buf:
            paras.append(buf)
        if bl["form"] and not bl["cls"]:
            # раздел по форме: абзац «1. В реквизите …» – отдельное разъяснение со своими привязками
            chunks, cur_chunk = [], []
            for pr in paras:
                if re.match(r"^\d+\.\s", pr) and cur_chunk:
                    chunks.append(cur_chunk)
                    cur_chunk = []
                cur_chunk.append(pr)
            if cur_chunk:
                chunks.append(cur_chunk)
            groups = [("\n".join(c), bind_text("\n".join(c), bl["form"])) for c in chunks]
        else:
            text = "\n".join(paras)
            if bl["title"]:
                text = f"{bl['title']}\n{text}".strip()
            groups = [(text, None)]
        for text, binds in groups:
            text = re.sub(r"[ \t]+", " ", text).strip()
            if len(text) < 20:
                continue
            key = re.sub(r"\W+", "", text.lower())[:120]
            if any(key[:80] in k or k[:80] in key for k in known_texts):
                continue
            known_texts.add(key)
            n = {"id": f"{act}#{len(notes)+1:03d}", "act": act, "part": "Разъяснения по использованию отдельных кодов",
                 "heading": bl["heading"], "text": text, "verbatim": True, "bindings": [], "binding_inherited": False}
            if bl["cls"]:
                valid = cls_codes.get(bl["cls"], {})
                extra = re.findall(r"[Кк]од(?:ы|ом|ов|а)?\s*«?(\d{2,6})", text)
                codes = [c for c in dict.fromkeys(bl["codes"] + [resolve_code(valid, c, None) or c for c in extra]) if c in valid]
                n["classifier"] = {"no": bl["cls"], "codes": codes}
                n["bindings"] = use.get(bl["cls"], [])
                n["binding_via_classifier"] = True
            if binds is not None:
                n["bindings"] = binds
            notes.append(n)
    return notes


def main():
    text = Path(sys.argv[1]).read_text(encoding="utf-8").replace(" ", " ")
    use = classifier_usage()
    paras, quote = [], False
    for line in text.splitlines():
        l = re.sub(r"\s+", " ", line).strip()
        if not l:
            continue
        if l == "«":
            quote = True; paras.append({"quote": True, "text": ""}); continue
        if l.startswith("»"):
            quote = False; continue
        if quote:
            paras[-1]["text"] += (" " if paras[-1]["text"] else "") + l
            continue
        prev = paras[-1] if paras else None
        if prev and not prev["quote"] and (l[0].islower() or not re.search(r"[.:;»!?]$", prev["text"])) and not l.isupper() and not prev["text"].isupper():
            prev["text"] += " " + l
            continue
        paras.append({"quote": False, "text": l})
    notes, ctx_form, ctx_cls, heading, part = [], None, None, None, "Разъяснения по использованию отдельных кодов"
    last = None
    for p in paras:
        t = p["text"]
        if p["quote"]:
            if last:
                last["blank_text"] = (last.get("blank_text", "") + " " + t).strip()
            continue
        if t.startswith("РЕКОМЕНДАЦИИ ПО ДОПОЛНЕНИЮ") or t == "ПЕРВИЧНОГО УЧЕТА":
            part = "Рекомендации по дополнению документов первичного учета"; ctx_form = ctx_cls = None; heading = None; continue
        m = CTX_FORM.search(t)
        if m and t.isupper():
            ctx_form, ctx_cls, heading = m.group(1), None, t; continue
        m = CTX_CLS.match(t)
        if m and t.upper() == t:
            ctx_cls, ctx_form, heading = int(m.group(1)), None, t; continue
        if t.isupper() and len(t) < 200:
            heading = (heading + " " + t) if heading else t; continue
        binds, last_form = [], ctx_form
        for sent in re.split(r"(?<=[.;])\s+(?=[А-ЯЁ])", t):
            fpos = [(m.start(), m.group(1)) for m in re.finditer(r"(?:форм\w*|карточк\w*)\s*№\s*(\d(?:\.\d)?)", sent)]
            for m in REQS.finditer(sent):
                nums = re.findall(r"\d+(?:\.\d+)?", m.group(1))
                after = [x for x in fpos if x[0] > m.start()]
                before = [x for x in fpos if x[0] < m.start()]
                if after:
                    form = after[0][1]
                elif before:
                    form = before[-1][1]
                else:
                    form = last_form
                if form:
                    binds += [{"form": form, "requisite": n} for n in nums]
            if fpos:
                last_form = fpos[-1][1]
        seen = set()
        binds = [b for b in binds if not ((b["form"], b["requisite"]) in seen or seen.add((b["form"], b["requisite"])))]
        cls_codes = []
        if ctx_cls:
            m = CODE_LEAD.match(t)
            cls_codes = [m.group(1)] if m else [c for g in CODES.findall(t) for c in re.findall(r"\d{2,3}", g)]
        inherited = False
        if not binds and not cls_codes and last and last.get("heading") == heading and last.get("part") == part:
            binds, cls_codes, inherited = last["bindings"], last.get("classifier", {}).get("codes", []), True
        n = {"id": f"gp-razj-2025-07#{len(notes)+1:03d}", "act": "gp-razj-2025-07", "part": part, "heading": heading,
             "text": t, "verbatim": True, "bindings": binds, "binding_inherited": inherited}
        if ctx_cls:
            n["classifier"] = {"no": ctx_cls, "codes": cls_codes}
            if not binds:
                n["bindings"] = use.get(ctx_cls, [])
                n["binding_via_classifier"] = True
        notes.append(n)
        last = n
    cls_codes = classifier_codes()
    known = {re.sub(r"\W+", "", n["text"].lower())[:120] for n in notes}
    extra = []
    for path, act in ((ROOT / "data-private/sources/sprav-2026.txt", "giac-razj-2026"), (ROOT / "data-private/sources/sprav-2025.txt", "giac-razj-2025")):
        if path.exists():
            got = parse_code_explanations(path, act, use, cls_codes, known)
            print(f"{act}: разъяснений к кодам и реквизитам: {len(got)}")
            extra += got
    notes += extra
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "acts.json").write_text(json.dumps({"edition": "2026", "acts": ACTS}, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "explanations.json").write_text(json.dumps({"edition": "2026", "source_act": "gp-razj-2025-07", "notes": notes}, ensure_ascii=False, indent=1), encoding="utf-8")
    bound = sum(1 for n in notes if n["bindings"])
    print("актов:", len(ACTS), "| абзацев разъяснений:", len(notes), "| с привязкой к форме и реквизиту:", bound, f"({bound*100//max(1,len(notes))} %)")
    for n in notes:
        if not n["bindings"]:
            print("  без привязки:", n["text"][:120])


if __name__ == "__main__":
    main()
