"""Генерация черновых пакетов правил (факты, вопросы, сопоставление, контроль, извлечение, документы).

Вопросы и сопоставления строятся из пакета форм: предметные данные не придумываются.
Общие факты – реквизиты разных форм об одной сущности с одинаковым ключевым словом
в наименовании и одинаковым справочником или набором кодов. Все правила – статус draft,
требуют предметной ревизии (риск Д-4). Запуск: python3 scripts/build_rules.py
"""
import json, re, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORMS = ROOT / "data/forms/2026"
OUT = ROOT / "data/rules/2026"
DOCS = ROOT / "data/documents/2026"

# Сущность реквизита: диапазоны по структуре бланков (числовая часть номера)
ENTITY = {
    "1":   [(0, 7.99, "case"), (8, 29.99, "crime"), (30, 38.99, "victims"), (39, 99, "case")],
    "1.1": [(0, 17.99, "crime"), (18, 24.99, "person"), (25, 99, "crime")],
    "2":   [(0, 6.99, "case"), (7, 20.99, "person"), (21, 34.99, "crime_by_person"), (35, 99, "person")],
    "2.1": [(0, 6.99, "case"), (7, 13.99, "person"), (14, 20.99, "crime_by_person"), (21, 99, "person")],
    "3":   [(0, 99, "case")],
    "4":   [(0, 8.99, "case"), (9, 99, "damage")],
    "5":   [(0, 7.99, "case"), (8, 16.99, "victim"), (17, 20.99, "crime"), (21, 99, "victim")],
    "6":   [(0, 99, "court")],
}
SHARE_GROUPS = {"crime": "crime", "crime_by_person": "crime", "person": "person", "victims": "victims", "victim": "victim", "case": "case", "damage": "damage", "court": "court"}
KEYWORDS = [
    ("arrival_purpose", r"цель приезда"), ("laundering_predicate", r"предшествовавшего легализации"),
    ("prev_citizenship", r"гражданство, предшествовавш"), ("residence_country", r"страна проживания"), ("citizenship", r"гражданств"),
    ("nationality", r"национальност"), ("social_status", r"социальное"), ("position", r"должностное"),
    ("okato", r"окато"), ("new_regions", r"после принятия в рф"), ("place", r"место совершения"), ("method", r"способ совершения"),
    ("extra_char", r"дополнительная характеристика"), ("weapon", r"оружие, боеприпасы"), ("subject", r"предмет преступного"),
    ("opf", r"организационно-правовая"), ("ownership", r"форма собственности"), ("category", r"категория преступления"),
    ("attempt", r"по ст\. 30"), ("size", r"совершено в крупном"), ("orientation", r"коррупционной|направленность преступления"),
    ("sex", r"^пол\b|пол:"), ("age", r"дата рождения|возраст"), ("education", r"образование"),
    ("service", r"служба|силы и средства|установлено \(служб"), ("qualification", r"квалификация"), ("motive", r"мотив"),
    ("intoxication", r"опьянени"), ("group", r"в составе"), ("record", r"ранее судимо"), ("organ", r"^орган"),
    ("record_kind", r"^учесть|признак учета"), ("case_number", r"номер уд|номер уголовного дела"),
    ("vud_date", r"дата возбуждения"), ("kusp", r"номер регистрации сообщения"), ("fabula", r"описание \(краткая фабула"),
    ("victims_count", r"количество потерпевших"), ("public_place", r"в общественном месте"), ("crime_date", r"дата совершения преступления"),
]


KEY_ENTITY = {"qualification": "crime", "organ": "case", "case_number": "case", "vud_date": "case", "kusp": "case",
              "crime_date": "crime", "fabula": "crime", "record_kind": "case",
              "orientation": "crime", "extra_char": "crime", "method": "crime", "place": "crime", "okato": "crime",
              "new_regions": "crime", "ownership": "crime", "subject": "crime", "weapon": "crime", "opf": "crime",
              "size": "crime", "attempt": "crime", "category": "crime", "laundering_predicate": "crime"}


def num(n):
    try:
        return float(n.split("~")[0].split(".")[0] + ("." + n.split(".")[1] if "." in n and n.split(".")[1].isdigit() else ""))
    except ValueError:
        return 0.0


# Область действия факта в деле из нескольких экземпляров (Фаза 1.5): по префиксу идентификатора.
# victims.* – сведения о потерпевших эпизода (р. 30–38 ф. 1); damage.* – ущерб один на дело (уточнение порядка учета В-1);
# court.* и fN.* – реквизиты конкретной карточки; признак учета – режим карточки.
SCOPE = {"case": "case", "crime": "crime", "person": "person", "victim": "victim", "victims": "crime", "damage": "case", "court": "card"}


def scope_of(fid):
    if not fid:
        return "card"
    if fid.startswith("fact.case.record_kind"):
        return "card"
    return SCOPE.get(fid.split(".")[1], "card")


# ИПК и карта на иностранцев (FR-44): ключ факта задается явно – переносы из общих сведений дела
# (номер дела, квалификация, даты, фабула, анкета лица), остальные реквизиты – по блоку бланка.
IPK_SHARED = {
    ("ipk", "02"): "person.surname", ("ipk", "03"): "person.first_name", ("ipk", "4"): "person.patronymic",
    ("ipk-in", "7"): "person.surname", ("ipk-in", "8"): "person.first_name", ("ipk-in", "9"): "person.patronymic",
    ("ipk", "05"): "person.birth_date", ("ipk-in", "10"): "person.birth_date",
    ("ipk", "23"): "case.case_number", ("ipk-in", "25"): "case.case_number",
    ("ipk", "79"): "case.organ_name", ("ipk-in", "2"): "case.organ_name",
    ("ipk", "uk_article"): "crime.qualification", ("ipk-in", "28"): "crime.qualification",
    ("ipk", "61"): "crime.crime_date", ("ipk-in", "6"): "crime.crime_date",
    ("ipk-in", "26"): "case.vud_date",
    ("ipk", "59"): "crime.fabula", ("ipk-in", "36"): "crime.fabula",
}
# Ф. 6: реквизиты раздела 1 и р. 15, которые заполняет следователь (практика учета СК России, уточнение от 16.09.2026, п. 14), –
# перенос из общих сведений дела и анкеты лица; полный ключ группы факта
FORM_SHARED = {
    ("6", "1"): "case.organ_name.text", ("6", "2"): "case.case_number.text",
    ("6", "3"): "person.surname.text", ("6", "4"): "person.first_name.text", ("6", "5"): "person.patronymic.text",
    ("6", "6"): "person.birth_date.date", ("6", "15"): "crime.qualification.text",
}
IPK_BLOCK = {"Сведения о лице": "person", "Сведения о преступлении": "crime",
             "А. Регистр преступления (происшествия)": "case", "Б. Сведения о подозреваемом / потерпевшем / обвиняемом": "person",
             "В. Дополнительные сведения о преступлении (происшествии)": "crime", "Д. Фабула": "card"}
IPK_ENTITY = {("ipk", "78"): "crime", ("ipk", "ic_code"): "case", ("ipk-in", "5"): "crime", ("ipk-in", "27"): "case",
              ("ipk-in", "29"): "case", ("ipk-in", "30"): "case", ("ipk-in", "31"): "person", ("ipk-in", "32"): "person", ("ipk-in", "33"): "person"}


def ipk_key(f, r, sig):
    k = (f["form"], r["id"])
    if k in IPK_SHARED:
        return f"{IPK_SHARED[k]}.{sig}"
    ent = IPK_ENTITY.get(k) or IPK_BLOCK.get(r["section"], "card")
    code = f"{f['form'].replace('-', '_')}_r{r['id']}"
    return f"f{code}" if ent == "card" else f"{ent}.{code}.{sig}"


def entity(form, number):
    v = num(number)
    if form not in ENTITY:
        return "case"
    for lo, hi, e in ENTITY[form]:
        if lo <= v <= hi:
            return e
    return "case"


def keyword(label):
    l = label.lower().replace("ё", "е")
    for k, rx in KEYWORDS:
        if re.search(rx, l):
            return k
    return None


def sentence(label):
    s = re.sub(r"\s+", " ", label).strip(" :(")
    s = re.sub(r"\s+\d+(?:\.\d+)?$", "", s)
    return s[:1].upper() + s[1:].lower() if s.isupper() or sum(c.isupper() for c in s) > len(s) * 0.5 else s


def note_id(fragment):
    notes = json.loads((ROOT / "data/legal/2026/explanations.json").read_text(encoding="utf-8"))["notes"]
    hits = [n for n in notes if fragment in n["text"].replace("\n", " ")]
    if not hits:
        raise SystemExit(f"Разъяснение с фрагментом «{fragment}» не найдено")
    order = {"gp-razj-2025-07": 0, "giac-razj-2026": 1, "giac-razj-2025": 2}
    return sorted(hits, key=lambda n: order.get(n["act"], 9))[0]["id"]


def main():
    N_F11_R13 = note_id("Код «8» в реквизите 13")
    N_F1_R9 = note_id("пункта 2 части 2 статьи 37 УПК РФ")
    N_MINORS = note_id("статья 106, пункт «д» части 2 статьи 126")
    forms = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(FORMS.glob("forma-*.json"))]
    groups = {}
    for f in forms:
        for r in f["requisites"]:
            if r["fills_by"] in ("ic", "registrar", "court"):
                continue
            if (f["form"], r["id"]) in FORM_SHARED:
                groups.setdefault(FORM_SHARED[(f["form"], r["id"])], []).append((f, r))
                continue
            if f["form"] in ("ipk", "ipk-in"):
                sig = f"spr{r['classifier_no']}" if r["classifier_no"] else ("opt" + hashlib.md5(",".join(sorted({o["code"] for o in r["options"]})).encode()).hexdigest()[:6] if r["options"] else r["field_type"])
                groups.setdefault(ipk_key(f, r, sig), []).append((f, r))
                continue
            k = keyword(r["label"])
            ent = SHARE_GROUPS[entity(f["form"], r["number"])]
            if ent != "court":
                ent = KEY_ENTITY.get(k, ent)
            if k:
                if r["classifier_no"]:
                    sig = f"spr{r['classifier_no']}"
                elif r["options"]:
                    sig = "opt" + hashlib.md5(",".join(sorted({o["code"] for o in r["options"]})).encode()).hexdigest()[:6]
                else:
                    sig = r["field_type"]
                key = f"{ent}.{k}.{sig}"
            else:
                key = f"f{f['form'].replace('.', '_')}.r{r['id'].replace('.', '_').replace('~', '_v')}"
            groups.setdefault(key, []).append((f, r))

    facts, questions, mapping = [], [], []
    shared = 0
    for key, items in sorted(groups.items()):
        forms_in = sorted({f["form"] for f, _ in items})
        is_shared = len(forms_in) > 1 and not key.startswith("f")
        base = key.rsplit(".", 1)[0] if not key.startswith("f") else key
        same_base = [g for g in groups if not g.startswith("f") and g.rsplit(".", 1)[0] == base]
        fid = f"fact.{base}" if len(same_base) == 1 else f"fact.{key}"
        f0, r0 = items[0]
        shared += is_shared
        answer = {"type": r0["field_type"], "multiple": r0["multiple"]}
        if r0["classifier_no"]:
            answer["classifier_no"] = r0["classifier_no"]
        if r0["options"]:
            answer["options_from"] = {"form": f0["form"], "requisite": r0["id"]}
        facts.append({"id": fid, "entity": entity(f0["form"], r0["number"]), "scope": scope_of(fid), "type": r0["field_type"],
                      "classifier_no": r0["classifier_no"], "shared": is_shared,
                      "label": sentence(r0["label"]), "status": "draft"})
        why = [f"ф. {f['form']} р. {r['number']}" for f, r in items]
        questions.append({"id": "q." + fid[5:], "text": sentence(r0["label"]) + ("?" if not sentence(r0["label"]).endswith("?") else ""),
                          "why": ", ".join(why), "forms": forms_in, "entity": facts[-1]["entity"],
                          "answer": answer, "ask_when": {"not_derived": [fid]}, "sets": [fid],
                          "allow_unknown": True, "status": "draft", "review": "pending"})
        for f, r in items:
            mapping.append({"id": f"m.f{f['form']}.r{r['id']}", "form": f["form"], "requisite": r["id"],
                            "value_from": fid, "source_note": f"Бланк ф. {f['form']} ред. 2026, реквизит {r['number']}"
                            + (f"; справочник № {r['classifier_no']}" if r["classifier_no"] else ""),
                            "match": "shared" if is_shared else "direct", "scope": scope_of(fid), "status": "draft"})
        # ИЦ, регистрационный работник, суд – без вопросов, но с сопоставлением «не заполнять»
    for f in forms:
        for r in f["requisites"]:
            if r["fills_by"] in ("ic", "registrar", "court"):
                k = keyword(r["label"])
                hint = f"fact.{KEY_ENTITY.get(k, 'case')}.{k}" if k in ("case_number", "kusp", "vud_date", "crime_date") else None
                if hint and not any(x["id"] == hint for x in facts):
                    facts.append({"id": hint, "entity": KEY_ENTITY.get(k, "case"), "type": "date" if k in ("vud_date", "crime_date") else "text", "classifier_no": None, "shared": False,
                                  "label": sentence(r["label"]), "status": "draft", "service": True})
                mapping.append({"value_hint_from": hint,"id": f"m.f{f['form']}.r{r['id']}", "form": f["form"], "requisite": r["id"],
                                "value_from": None, "status_value": {"ic": "fills_ic", "registrar": "fills_registrar", "court": "fills_court"}[r["fills_by"]],
                                "source_note": f"Бланк ф. {f['form']}: {(r['section'] or '')[:90]}", "match": "direct", "scope": scope_of(hint), "status": "draft"})

    # Производные значения (умолчания) – ссылка на пакет УК
    derived = [
        {"id": "d.category", "sets": "fact.crime.category", "expr": {"fn": "uk.category", "args": ["fact.crime.qualification"]},
         "map_codes": {"small": "2", "medium": "3", "grave": "1", "especially_grave": "4"},
         "status_value": "default", "source_note": "ст. 15 УК РФ; перечни № 4–7 (указание от 28.07.2025 № 147); коды реквизита «Категория преступления» бланков ф. 1, 2, 2.1"},
        {"id": "d.attempt", "sets": "fact.crime.attempt", "expr": {"fn": "uk.stage", "args": ["fact.crime.qualification"]},
         "status_value": "default", "source_note": "Наличие ст. 30 УК РФ в квалификации: ч. 1 – приготовление (1), ч. 3 – покушение (2)"},
        {"id": "d.corruption_hint", "sets": "fact.crime.orientation", "expr": {"fn": "uk.in_list", "args": ["fact.crime.qualification", 23]},
         "when_true_code": "10", "status_value": "hint", "source_note": "Перечень № 23 (коррупционная направленность) – только подсказка, требует проверки признаков п. 1 перечня"},
        {"id": "d.economic_hint", "sets": "fact.crime.orientation", "expr": {"fn": "uk.in_list", "args": ["fact.crime.qualification", 2]},
         "when_true_code": "02", "status_value": "hint", "source_note": "Перечень № 2 (экономическая направленность) – подсказка, отнесение зависит от дополнительных условий перечня"},
    ]

    checks = [
        {"id": "c.attempt_vs_art30", "forms": ["1", "2"], "severity": "error",
         "when": {"exists": "fact.crime.attempt"}, "assert": {"matches": ["fact.crime.qualification", "(^|\\D)30(\\D|$)"]},
         "message": "Отмечено приготовление или покушение, но в квалификации нет ссылки на ст. 30 УК РФ",
         "source_note": "Бланк ф. 1 р. 16, ф. 2 р. 25 «По ст. 30 УК РФ»"},
        {"id": "c.art30_vs_attempt", "forms": ["1", "2"], "severity": "warning",
         "when": {"matches": ["fact.crime.qualification", "ч\\.\\s*[13]\\s*ст\\.\\s*30"]}, "assert": {"exists": "fact.crime.attempt"},
         "message": "В квалификации есть ст. 30 УК РФ, но стадия (приготовление или покушение) не отмечена",
         "source_note": "Бланк ф. 1 р. 16, ф. 2 р. 25"},
        {"id": "c.category_vs_uk", "forms": ["1", "2", "2.1"], "severity": "warning",
         "when": {"all": [{"exists": "fact.crime.category"}, {"exists": "fact.crime.qualification"}]},
         "assert": {"eq": ["fact.crime.category", {"fn": "uk.category_code", "args": ["fact.crime.qualification"]}]},
         "message": "Категория преступления не соответствует статье УК РФ по перечням № 4–7",
         "source_note": "ст. 15 УК РФ; перечни № 4–7 (указание от 28.07.2025 № 147)"},
        {"id": "c.f11_r13_code8", "forms": ["1.1"], "severity": "error",
         "when": {"eq": ["req.13", "08"]}, "assert": {"fn": "uk.article_in", "args": ["fact.crime.qualification", ["263", "263.1", "264", "264.1"]]},
         "message": "Код «8» реквизита 13 ф. 1.1 применяется только для ст. 263–264.1 УК РФ при невыполнении требования о медицинском освидетельствовании",
         "source_note": f"Разъяснения ГП на 01.07.2025, ф. 1.1 р. 13 ({N_F11_R13})"},
        {"id": "c.f1_r9_prosecutor", "forms": ["1"], "severity": "warning",
         "when": {"eq": ["fact.case.report_source", "prosecutor_materials"]}, "assert": {"eq": ["req.9", "000125"]},
         "message": "Дело возбуждено по материалам прокурора (п. 2 ч. 2 ст. 37 УПК РФ): в реквизите 9 ф. 1 указывается код «000125»",
         "source_note": f"Разъяснения ГП на 01.07.2025, ф. 1 р. 9 ({N_F1_R9})"},
        {"id": "c.minors_extra_char", "forms": ["1"], "severity": "warning",
         "when": {"fn": "uk.article_in_note", "args": ["fact.crime.qualification", N_MINORS]},
         "assert": {"any_in": ["req.27", ["134", "181", "246", "247"]]},
         "message": "По данной статье обязательно отражение дополнительной характеристики «в отношении несовершеннолетних» (коды 134, 181, 246, 247 справочника № 15)",
         "source_note": f"Разъяснения ГП на 01.07.2025, справочник № 15 ({N_MINORS})"},
        {"id": "c.ic_fields_empty", "forms": ["1", "1.1", "2", "2.1", "3", "4", "5"], "severity": "warning",
         "when": {"fills_by": "ic"}, "assert": {"empty": "req.*"},
         "message": "Реквизит заполняет информационный центр – следователем не заполняется",
         "source_note": "Бланки: «Дата направления/поступления карточки в ИЦ», служебные реквизиты 7.2, 7.3 ф. 1"},
        {"id": "c.vud_after_report", "forms": ["1"], "severity": "warning",
         "when": {"all": [{"exists": "fact.case.vud_date"}, {"exists": "fact.case.kusp_date"}]},
         "assert": {"gte": ["fact.case.vud_date", "fact.case.kusp_date"]},
         "message": "Дата возбуждения уголовного дела раньше даты регистрации сообщения о преступлении",
         "source_note": "ст. 144–146 УПК РФ; ф. 1 р. 5 и р. 11"},
        {"id": "c.f3_extension_date", "forms": ["3"], "severity": "error",
         "when": {"all": [{"exists": "req.10"}, {"exists": "req.9.1"}]}, "assert": {"gt": ["req.10", "req.9.1"]},
         "message": "Дата, до которой продлен срок, должна быть позже даты решения о продлении",
         "source_note": "Бланк ф. 3 р. 9.1 и р. 10"},
        {"id": "c.classifier_code_valid", "forms": ["*"], "severity": "error",
         "when": {"field_type": "classifier"}, "assert": {"fn": "classifier.has_code", "args": ["req.*"]},
         "message": "Код отсутствует в справочнике действующей редакции",
         "source_note": "Справочники № 1–17 ред. 2026"},
        {"id": "c.enum_code_valid", "forms": ["*"], "severity": "error",
         "when": {"field_type": "enum"}, "assert": {"fn": "form.has_option", "args": ["req.*"]},
         "message": "Код отсутствует среди вариантов реквизита в бланке",
         "source_note": "Бланки ред. 2026"},
        {"id": "c.victims_count_vs_f5", "forms": ["1"], "severity": "warning",
         "when": {"gt": ["req.30", 0]}, "assert": {"fn": "case.has_form", "args": ["5"]},
         "message": "Указаны потерпевшие – по каждому потерпевшему физическому лицу составляется карточка ф. 5",
         "source_note": "Методичка по статкарточкам, раздел 4 (связи карточек)"},
    ]
    # Межкарточные соотношения пакета (Фаза 1.5, FR-34): проверяются по составу пакета события,
    # per – по каждому эпизоду события или один раз на пакет. Статус – черновик до ревизии заказчика.
    package_checks = [
        {"id": "c.pkg.f11_each_crime", "per": "crime", "forms": ["1.1"], "severity": "warning",
         "when": {"fn": "package.has_form", "args": ["1.1"]}, "assert": {"gte": [{"fn": "package.count_cards", "args": [["1.1"]]}, 1]},
         "message": "По эпизоду события нет карточки ф. 1.1 – она составляется на каждое преступление",
         "source_note": "ТЗ версии 1.2, разд. 8 (состав пакета); методичка, разд. 3"},
        {"id": "c.pkg.f2_each_person", "per": "crime", "forms": ["2"], "severity": "warning",
         "when": {"fn": "package.has_form", "args": ["2"]},
         "assert": {"gte": [{"fn": "package.count_cards", "args": [["2"]]}, {"fn": "package.count_objects", "args": ["persons"]}]},
         "message": "Не на каждое лицо эпизода, указанное в событии, есть карточка ф. 2",
         "source_note": "Бланк ф. 2 «на лицо, совершившее преступление»; практика учета СК России, уточнения от 16.09.2026, пп. 8, 10, 18.1"},
        {"id": "c.pkg.ipk_each_crime", "per": "crime", "forms": ["ipk"], "severity": "warning",
         "when": {"fn": "package.has_form", "args": ["ipk"]}, "assert": {"gte": [{"fn": "package.count_cards", "args": [["ipk"]]}, 1]},
         "message": "По эпизоду события нет ИПК – ИПК выставляется на каждый эпизод",
         "source_note": "практика учета СК России, уточнения от 16.09.2026, пп. 12 и 18.4"},
        {"id": "c.pkg.f5_vs_victims_count", "per": "crime", "forms": ["1", "5"], "severity": "warning",
         "when": {"all": [{"fn": "package.has_form", "args": ["1"]}, {"gt": ["fact.victims.victims_count", 0]}]},
         "assert": {"gte": [{"fn": "package.count_cards_case", "args": [["5"]]}, "fact.victims.victims_count"]},
         "message": "Карточек ф. 5 по эпизоду меньше, чем потерпевших в р. 30 ф. 1",
         "source_note": "Бланк ф. 1 р. 30; методичка, разд. 3 (ф. 5 на каждого потерпевшего); практика учета СК России, уточнение от 16.09.2026, п. 1"},
        {"id": "c.pkg.f4_vs_f11_damage", "per": "case", "forms": ["4", "1.1"], "severity": "warning",
         "when": {"all": [{"fn": "package.has_form", "args": ["4"]}, {"fn": "package.has_form", "args": ["1.1"]}, {"exists": {"fn": "package.req", "args": ["4", "10"]}}]},
         "assert": {"exists": {"fn": "package.req", "args": ["1.1", "28"]}},
         "message": "В ф. 4 указана установленная сумма материального ущерба (р. 10), а в ф. 1.1 р. 28 – нет",
         "source_note": "Бланк ф. 4 р. 10, бланк ф. 1.1 р. 28 «Установленная сумма материального ущерба»"},
        {"id": "c.pkg.f3_vs_f11_decision", "per": "case", "forms": ["3", "1.1"], "severity": "warning",
         "when": {"all": [{"fn": "package.has_form", "args": ["3"]}, {"exists": {"fn": "package.req", "args": ["1.1", "25"]}}]},
         "assert": {"any": [{"exists": {"fn": "package.req", "args": ["3", "7"]}}, {"exists": {"fn": "package.req", "args": ["3", "12"]}},
                            {"exists": {"fn": "package.req", "args": ["3", "12.2"]}}, {"exists": {"fn": "package.req", "args": ["3", "13"]}}]},
         "message": "В ф. 1.1 р. 25 указано решение по преступлению, а в ф. 3 не отмечено движение дела (р. 7, 12, 12.2 или 13)",
         "source_note": "Бланк ф. 1.1 р. 25; бланк ф. 3 р. 7, 12, 12.2, 13"},
        {"id": "c.pkg.event_after_vud", "per": "case", "forms": ["*"], "severity": "error",
         "when": {"all": [{"exists": "fact.case.vud_date"}, {"exists": "event.date"}]}, "assert": {"gte": ["event.date", "fact.case.vud_date"]},
         "message": "Дата события раньше даты возбуждения уголовного дела",
         "source_note": "ст. 146, 162, 208, 211 УПК РФ: решения по делу принимаются после его возбуждения"},
    ]

    # Правила извлечения ведутся вручную (Фаза 2): scripts/import/extract-vud-2026.json
    extract = json.loads((ROOT / "scripts" / "import" / "extract-vud-2026.json").read_text(encoding="utf-8"))["extract"]
    documents = [
        {"doc_type": "vud", "title": "Постановление о возбуждении уголовного дела и принятии его к производству", "required_for": ["1", "1.1", "2", "2.1", "3", "4", "5"],
         "priority": "required", "provides": ["fact.case.case_number", "fact.case.vud_date", "fact.case.kusp", "fact.case.kusp_date", "fact.crime.qualification", "fact.case.investigator", "fact.case.suspect_known", "fact.crime.crime_date", "fact.crime.ipk_in_r22", "fact.crime.ipk_in_r23", "fact.crime.fabula", "fact.damage.amount", "fact.case.report_source", "fact.person.surname", "fact.person.first_name", "fact.person.patronymic", "fact.person.birth_date"],
         "detect": ["о возбуждении уголовного дела"]},
        {"doc_type": "report", "title": "Рапорт об обнаружении признаков преступления, выписка из КРСП (КУСП)", "required_for": ["1"], "priority": "desirable",
         "provides": ["fact.case.kusp", "fact.case.report_source"], "detect": ["рапорт об обнаружении признаков преступления"]},
        {"doc_type": "victim_decision", "title": "Постановление о признании потерпевшим, протокол допроса потерпевшего", "required_for": ["1", "5"], "priority": "desirable",
         "provides": [], "detect": ["о признании потерпевшим"]},
        {"doc_type": "detention", "title": "Протокол задержания подозреваемого, уведомление о подозрении, постановление об избрании меры пресечения", "required_for": ["2", "2.1"], "priority": "desirable",
         "provides": [], "detect": ["протокол задержания", "уведомление о подозрении", "об избрании меры пресечения"]},
        {"doc_type": "charge", "title": "Постановление о привлечении в качестве обвиняемого", "required_for": ["1.1", "2", "2.1"], "priority": "desirable",
         "provides": ["fact.crime.qualification"], "detect": ["о привлечении в качестве обвиняемого"]},
        {"doc_type": "criminal_record", "title": "Требование о судимости (сведения ИЦ), характеристики, справки с места работы или учебы", "required_for": ["2"], "priority": "desirable",
         "provides": [], "detect": ["требование", "судимост"]},
        {"doc_type": "movement", "title": "Постановления о продлении срока, приостановлении, возобновлении, соединении, передаче по подследственности", "required_for": ["3"], "priority": "desirable",
         "provides": [], "detect": ["о продлении срока", "о приостановлении", "о возобновлении", "о соединении", "по подследственности"]},
        {"doc_type": "final", "title": "Обвинительное заключение, постановление о прекращении, о направлении дела в суд", "required_for": ["1.1", "2", "3"], "priority": "desirable",
         "provides": [], "detect": ["обвинительное заключение", "о прекращении уголовного дела"]},
        {"doc_type": "damage", "title": "Протоколы выемки, обыска, осмотра с изъятием, документы об ущербе и его возмещении, постановление о наложении ареста на имущество", "required_for": ["4"], "priority": "desirable",
         "provides": ["fact.damage.amount"], "detect": ["протокол выемки", "протокол обыска", "о наложении ареста на имущество"]},
        {"doc_type": "verdict", "title": "Приговор или постановление суда", "required_for": ["6"], "priority": "required",
         "provides": [], "detect": ["приговор", "именем российской федерации"]},
    ]
    # служебные факты, которые не являются реквизитами, но нужны правилам
    for extra in [("fact.case.kusp_date", "case", "date", "Дата регистрации сообщения о преступлении"),
                  ("fact.case.investigator", "case", "text", "Следователь (должность, Ф.И.О.)"),
                  ("fact.case.suspect_known", "case", "boolean", "Лицо установлено на момент возбуждения дела"),
                  ("fact.case.report_source", "case", "enum", "Повод к возбуждению дела"),
                  ("fact.damage.amount", "damage", "number", "Сумма ущерба, руб.")]:
        if not any(f["id"] == extra[0] for f in facts):
            facts.append({"id": extra[0], "entity": extra[1], "type": extra[2], "classifier_no": None, "shared": False, "label": extra[3], "status": "draft", "service": True})
    # Общие сведения о деле: задаются первыми, от них зависят умолчания, подсказки и проверки
    core = [
        ("fact.crime.qualification", "text", "Квалификация преступления по постановлению о возбуждении уголовного дела",
         "Например: п. «в» ч. 2 ст. 158 УК РФ; при покушении – ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ. От квалификации зависят категория, стадия, направленность", None),
        ("fact.crime.crime_date", "date", "Дата совершения преступления (по наиболее тяжкому)",
         "Нужна для категории по перечням статей УК на дату преступления; если дату установить нельзя – дата выявления", None),
        ("fact.case.vud_date", "date", "Дата возбуждения уголовного дела", "Реквизиты даты возбуждения; проверка с датой регистрации сообщения", None),
        ("fact.case.case_number", "text", "Номер уголовного дела",
         "Раздел 1 карточек: номер впечатывается в клетки бланка (вид, год, код подразделения, № – 17 цифр, например 12600000000000001); если номер не внесен, его вписывает работник учета", None),
        ("fact.case.kusp", "text", "Номер регистрации сообщения о преступлении (КРСП, КУСП)", "Раздел 1 ф. 1 (р. 5) и ф. 5 (р. 4): номер впечатывается в бланк вместе с датой регистрации", None),
        ("fact.case.kusp_date", "date", "Дата регистрации сообщения о преступлении", "Проверка: дело не может быть возбуждено раньше регистрации сообщения", None),
        ("fact.case.report_source", "enum", "Повод к возбуждению уголовного дела", "Проверка кода реквизита 9 ф. 1 (разъяснения ГП на 01.07.2025)",
         [{"code": "report", "value": "рапорт об обнаружении признаков преступления"}, {"code": "statement", "value": "заявление о преступлении"},
          {"code": "confession", "value": "явка с повинной"}, {"code": "prosecutor_materials", "value": "материалы, направленные прокурором (п. 2 ч. 2 ст. 37 УПК РФ)"},
          {"code": "other", "value": "иной повод"}]),
    ]
    known = {f["id"] for f in facts}
    for i, (fid, typ, text, why, opts) in enumerate(core):
        if fid not in known:
            facts.append({"id": fid, "entity": fid.split(".")[1], "type": typ, "classifier_no": None, "shared": False, "label": text, "status": "draft", "service": True})
        questions = [q for q in questions if fid not in q["sets"]]
        answer = {"type": typ, "multiple": False}
        if opts:
            answer["options"] = opts
        questions.insert(i, {"id": "q.core." + fid.split(".")[-1], "text": text, "why": why, "forms": ["*"], "entity": fid.split(".")[1],
                             "core": True, "answer": answer, "ask_when": {"always": True}, "sets": [fid], "allow_unknown": True,
                             "status": "draft", "review": "pending"})
    # --- подсказки кодов по статье и обстоятельствам (не умолчания: пользователь выбирает сам) ---
    N_ITT = note_id("заполнение соответствующих кодовых значений является обязательным")
    N_MIGR = note_id("157 – преступление совершено в сфере миграции")
    N_REGIME = note_id("Заполнение информации о режиме пребывания является обязательным в случаях, когда потерпевшим (лицом, совершившим преступление) является находящийся")
    N_ARRIVAL = note_id("в обязательном порядке проставляется кодовое значение «14 - незаконный мигрант»")
    N_R40 = note_id("должно быть заполнено в обязательном порядке при возбуждении уголовного дела")
    ITT_CODES = ["049", "055", "057", "059", "060", "072", "073", "086", "087", "088", "089", "091", "092", "094", "095",
                 "126", "127", "128", "129", "130", "131", "132", "134", "135", "141", "142", "144", "145"]
    MKB_CODES = [str(c) for c in range(101, 126)]
    MKB_ARTICLES = ["105", "106", "107", "108", "111", "205", "206", "277", "281", "295", "317"]
    hints = [
        {"id": "h.itt_method", "fact": "fact.crime.method", "when": {"fn": "uk.in_list", "args": ["fact.crime.qualification", 25]},
         "codes": ITT_CODES, "text": "Статья в перечне № 25 (преступления с использованием ИТТ): укажите способ – коды использования ИТТ справочника № 12",
         "source_note": f"Перечень № 25 указания от 28.07.2025 № 147; разъяснения 2026 к справочнику № 12 ({N_ITT})"},
        {"id": "h.mkb_method", "fact": "fact.crime.method", "when": {"fn": "uk.article_in", "args": ["fact.crime.qualification", MKB_ARTICLES]},
         "codes": MKB_CODES, "text": "Умышленное причинение смерти или тяжкого вреда, повлекшего гибель: механизм по МКБ-10 (коды 101–125 справочника № 12) обязателен по оконченным преступлениям",
         "source_note": "Сноска к справочнику № 12 (ред. 2026): ст. 105–107, ч. 2 ст. 108, п. «б» ч. 3 ст. 205, ч. 4 ст. 206, ст. 277, ч. 3 ст. 281, ст. 295, 317, ч. 4 ст. 111 УК РФ"},
        {"id": "h.minors_extra", "fact": "fact.crime.extra_char", "when": {"fn": "uk.article_in_note", "args": ["fact.crime.qualification", N_MINORS]},
         "codes": ["134", "181", "246", "247"], "text": "По статье обязательно отражение характеристики «в отношении несовершеннолетнего (малолетнего)»",
         "source_note": f"Разъяснения ГП на 01.07.2025, справочник № 15 ({N_MINORS})"},
        {"id": "h.migration_extra", "fact": "fact.crime.extra_char", "when": {"fn": "uk.article_in", "args": ["fact.crime.qualification", ["322", "322.1", "322.2", "322.3"]]},
         "codes": ["157"], "text": "Преступление в сфере миграции – код 157 справочника № 15", "source_note": f"Разъяснения ГИАЦ 2025 к справочнику № 15 ({N_MIGR})"},
        {"id": "h.svo_extra", "fact": "fact.crime.extra_char", "when": {"any_in": ["fact.victims.social_status", ["0054", "0055"]]},
         "codes": ["062"], "text": "Потерпевший – участник СВО: если преступление связано с участием в СВО, обязательна характеристика 062",
         "source_note": "Сноска к кодам 0054, 0055 справочника № 9 (ред. 2026)"},
        {"id": "h.foreign_extra", "fact": "fact.crime.extra_char", "when": {"all": [{"exists": "fact.victims.citizenship"}, {"not_any_in": ["fact.victims.citizenship", ["589"]]}]},
         "codes": ["287"], "text": "Потерпевший – иностранный гражданин или лицо без гражданства: характеристика 287", "source_note": "Справочник № 15 (ред. 2026), код 287"},
        {"id": "h.foreign_regime", "fact": "fact.victims.social_status", "when": {"all": [{"exists": "fact.victims.citizenship"}, {"not_any_in": ["fact.victims.citizenship", ["589"]]}]},
         "codes": ["0041", "0042", "0043", "0050"], "text": "Потерпевший – иностранец: режим пребывания в России обязателен",
         "source_note": f"Разъяснения ГИАЦ 2025 ({N_REGIME})"},
        {"id": "h.foreign_regime_person", "fact": "fact.person.social_status", "when": {"all": [{"exists": "fact.person.citizenship"}, {"not_any_in": ["fact.person.citizenship", ["589"]]}]},
         "codes": ["0041", "0042", "0043", "0050"], "text": "Лицо – иностранец: режим пребывания в России обязателен", "source_note": f"Разъяснения ГИАЦ 2025 ({N_REGIME})"},
        {"id": "h.art322_arrival", "fact": "fact.person.arrival_purpose", "when": {"fn": "uk.article_in", "args": ["fact.crime.qualification", ["322"]]},
         "codes": ["14"], "text": "Ст. 322 УК РФ: цель приезда – код 14 «незаконный мигрант»", "source_note": f"Разъяснения ГИАЦ 2025 ({N_ARRIVAL})"},
    ]
    # --- неактивность вопросов ---
    victims_facts = sorted({m["value_from"] for m in mapping if m["form"] == "1" and m.get("value_from") and m["requisite"] in ("33", "34", "35", "36", "37", "38")})
    availability = [{"id": "a.no_victims", "facts": victims_facts, "disabled_when": {"any": [{"eq": ["fact.victims.victims_count", "0"]}, {"na": "fact.victims.victims_count"}]},
                     "reason": "В р. 30 ф. 1 указано, что потерпевших (физических лиц) нет – характеристики потерпевших не заполняются",
                     "source_note": "Бланк ф. 1: р. 33–38 характеризуют потерпевших, указанных в р. 30"}]
    checks += [
        {"id": "c.no_victims_characteristics", "forms": ["1"], "severity": "error",
         "when": {"any": [{"eq": ["fact.victims.victims_count", "0"]}, {"na": "fact.victims.victims_count"}]},
         "assert": {"all": [{"empty": "req.33"}, {"empty": "req.34"}, {"empty": "req.35"}, {"empty": "req.36"}, {"empty": "req.37"}, {"empty": "req.38"}]},
         "message": "Потерпевших нет (р. 30), но заполнены характеристики потерпевших (р. 33–38)", "source_note": "Бланк ф. 1, р. 30 и р. 33–38"},
        {"id": "c.f1_r40_required", "forms": ["1"], "severity": "error", "when": {"always": True}, "assert": {"exists": "req.40"},
         "message": "Реквизит 40 (подразделение, в производстве которого находится дело) заполняется обязательно при возбуждении дела", "source_note": f"Разъяснения ГИАЦ 2025 ({N_R40})"},
        {"id": "c.itt_method_required", "forms": ["1", "2"], "severity": "warning", "when": {"fn": "uk.in_list", "args": ["fact.crime.qualification", 25]},
         "assert": {"any_in": ["fact.crime.method", ITT_CODES]}, "message": "Статья в перечне № 25: способ совершения должен содержать код использования ИТТ (справочник № 12)",
         "source_note": f"Разъяснения 2026 к справочнику № 12 ({N_ITT})"},
        {"id": "c.mkb_method_required", "forms": ["1", "2"], "severity": "warning", "when": {"fn": "uk.article_in", "args": ["fact.crime.qualification", MKB_ARTICLES]},
         "assert": {"any_in": ["fact.crime.method", MKB_CODES]}, "message": "По преступлению против жизни с гибелью потерпевшего укажите механизм по МКБ-10 (коды 101–125 справочника № 12)",
         "source_note": "Сноска к справочнику № 12 (ред. 2026)"},
        {"id": "c.svo_extra_char", "forms": ["1"], "severity": "warning", "when": {"any_in": ["fact.victims.social_status", ["0054", "0055"]]},
         "assert": {"any_in": ["fact.crime.extra_char", ["062"]]}, "message": "Потерпевший – участник СВО: если преступление связано с участием в СВО, в р. 27 обязательна характеристика 062",
         "source_note": "Сноска к кодам 0054, 0055 справочника № 9 (ред. 2026)"},
        {"id": "c.foreign_victim_regime", "forms": ["1"], "severity": "warning",
         "when": {"all": [{"exists": "fact.victims.citizenship"}, {"not_any_in": ["fact.victims.citizenship", ["589"]]}]},
         "assert": {"any_in": ["fact.victims.social_status", ["0041", "0042", "0043", "0050"]]},
         "message": "Потерпевший – иностранный гражданин или лицо без гражданства: в р. 34 обязателен режим пребывания (коды 0041, 0042, 0043, 0050)", "source_note": f"Разъяснения ГИАЦ 2025 ({N_REGIME})"},
        {"id": "c.art322_arrival_purpose", "forms": ["2"], "severity": "warning", "when": {"fn": "uk.article_in", "args": ["fact.crime.qualification", ["322"]]},
         "assert": {"any_in": ["fact.person.arrival_purpose", ["14"]]}, "message": "Ст. 322 УК РФ: в реквизите цели приезда обязателен код 14 «незаконный мигрант»", "source_note": f"Разъяснения ГИАЦ 2025 ({N_ARRIVAL})"},
        {"id": "c.select_limits", "forms": ["*"], "severity": "error", "when": {"field_type_in": ["enum", "classifier"]}, "assert": {"fn": "form.select_ok", "args": ["req.*"]},
         "message": "Выбрано больше кодов, чем полей в бланке, или коды одного разряда наложены друг на друга", "source_note": "Бланки ред. 2026: число кодовых полей; позиционные коды справочников"},
        {"id": "c.fabula_length", "forms": ["1"], "severity": "error", "when": {"exists": "req.12"}, "assert": {"fn": "text.max_len", "args": ["req.12", 355]},
         "message": "Фабула длиннее 355 знаков – не поместится в поле р. 12 бланка", "source_note": "Расчет по бланку cards_1.docx: 457 мм подчеркнутых строк, Times New Roman 8 пт"},
    ]
    for f in facts:
        f.setdefault("scope", scope_of(f["id"]))
    for c in checks:
        c["scope"] = "card"
    for c in package_checks:
        c["scope"] = "package"
    checks += package_checks
    OUT.mkdir(parents=True, exist_ok=True); DOCS.mkdir(parents=True, exist_ok=True)
    hdr = {"edition": "2026", "status": "draft", "review": "требует предметной ревизии (риск Д-4). Сгенерировано scripts/build_rules.py из пакета форм."}
    for name, key, data in [("facts.json", "facts", facts), ("questions.json", "questions", questions), ("mapping.json", "mapping", mapping),
                            ("derived.json", "derived", derived), ("checks.json", "checks", checks), ("extract.json", "extract", extract),
                            ("hints.json", "hints", hints), ("availability.json", "availability", availability)]:
        (OUT / name).write_text(json.dumps({**hdr, key: data}, ensure_ascii=False, indent=1), encoding="utf-8")
    (DOCS / "documents.json").write_text(json.dumps({**hdr, "documents": documents}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"фактов: {len(facts)} (общих для нескольких форм: {shared}); вопросов: {len(questions)}; сопоставлений: {len(mapping)}; производных: {len(derived)}; проверок: {len(checks)}; правил извлечения: {len(extract)}; документов: {len(documents)}")
    for f in facts:
        if f["shared"]:
            print("  общий:", f["id"], "|", f["label"][:50])


if __name__ == "__main__":
    main()
