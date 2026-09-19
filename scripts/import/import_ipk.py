"""Импорт реквизитов ИПК и карты на иностранцев из эталонных бланков (Фаза 1.5, FR-44).

Источник: new_cards/ИПК.doc и ИПК иностранец.doc, однократно пересохраненные в .docx нативным
Microsoft Word в data-private/blanks-src/. Из бланка берутся только печатные наименования
реквизитов и варианты кодов («наименование – код») из перечисленных строк таблиц; значения,
вписанные в ячейки образца, не берутся. Контроль – список фрагментов образца в
data-private/blanks-src/scrub.json. Номера реквизитов – как напечатаны в бланке; у полей без
печатного номера – «б/н». Все наименования – label_status «source», проверяется предметно.
Запуск после import_forms.py: python3 scripts/import/import_ipk.py
"""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data-private/blanks-src"
OUT = ROOT / "data/forms/2026"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def cell_text(tc):
    parts = []
    for p in tc.iter(W + "p"):
        s = "".join((t.text or "") for t in p.iter(W + "t"))
        if s.strip():
            parts.append(s.strip())
    return " ".join(parts).replace("\xa0", " ")


def tables(docx):
    root = ET.fromstring(zipfile.ZipFile(docx).read("word/document.xml"))
    out = []
    for tbl in root.find(W + "body").iter(W + "tbl"):
        out.append([[cell_text(tc) for tc in tr.findall(W + "tc")] for tr in tbl.findall(W + "tr")])
    return out


# «наименование – код»: перед тире не цифра (иначе «(6-12 час.)» и «16–летнего» читаются как код)
PAIR = re.compile(r"(.+?)(?<!\d)\s*[–-]\s*(\d{1,3})(?=\s|$|[,.;/)])")


def parse_options(texts, group=None):
    opts = []
    for text in texts:
        first = True
        for seg in re.split(r";|\|", text):
            seg = seg.strip(" ,.")
            while seg:
                m = PAIR.match(seg)
                if not m:
                    break
                label = re.sub(r"\s+", " ", m.group(1)).strip(" :,.")
                if first and re.search(r"[а-я]", label):  # заголовок строки прописными перед первым вариантом ячейки
                    label = re.sub(r"^(?:[А-Я.]+\s+)+(?=[а-яА-Я«(]*[а-я])", "", label)
                first = False
                sub = None
                if ":" in label:  # подзаголовок: «населенный пункт: город – 17»; кому еще он относится – в CORRECTIONS
                    sub, label = [x.strip() for x in label.rsplit(":", 1)]
                if label and not re.fullmatch(r"[\d\s().–-]*", label):
                    g = ", ".join(x for x in (group, sub) if x) or None
                    opts.append({"code": m.group(2), "value": label, "group": g})
                seg = seg[m.end():].strip(" ,.;")
    return opts


def rows_text(tbls, refs):
    """refs: список (таблица, строка, ячейки или None) с нумерацией с 1 для таблицы и с 0 для строки."""
    out = []
    for t, r, cells in refs:
        row = tbls[t - 1][r]
        out += [row[i] for i in (cells if cells is not None else range(len(row))) if i < len(row)]
    return out


def req(number, label, ftype="text", section="", variants=None, options=None, multiple=False, fills_by="investigator", slug=None, raw=None):
    rid = number if re.fullmatch(r"\d+(\.\d+)*", number) else slug
    select = None if ftype in ("text", "date") else ("multiple" if multiple else "single")
    return {"id": rid, "number": number, "label": label, "label_status": "source", "field_type": ftype, "classifier_no": None,
            "options": options or [], "multiple": multiple if select else None, "has_text": ftype == "text", "has_date": ftype == "date",
            "section": section, "fills_by": fills_by, "raw": raw, "input": ({"select": select} if select else {}),
            **({"variants": variants} if variants else {})}


# Разовые поправки разбора по бланку ИПК (сверено с текстом бланка вручную 16.09.2026):
# value – наименование; split – код без тире в бланке; group – подзаголовок, к которому относятся коды.
CORRECTIONS = {
    "44": [("split", "95", [("94", "против правосудия"), ("95", "заведомо ложные сообщения")]),
           ("split", "98", [("97", "угроза убийством"), ("98", "прест. против безопасности движения и эксплуатации транспорта")])],
    "means": [("split", "106", [("98", "пневматическое оружие"), ("106", "оружие, переделанное под боевой патрон")]),
              ("group", ["6", "8"], "документы"), ("group", ["72", "74", "76"], "маскировочные")],
    "hair": [("group", ["29", "31", "33"], "облысение")],
    "28": [("value", "36", "ФССП России")],
    "17": [("group", ["2", "4", "6", "8", "10"], "вождения")],
    "47": [("group", ["8", "10", "12"], "использование"), ("group", ["14", "16", "18", "20"], "нарушение"),
           ("group", ["26", "28"], "отключение"), ("group", ["36", "38", "40"], "через"),
           ("group", ["42", "44", "46", "48", "50"], "пропил (пролом)"), ("group", ["70", "72"], "подбор"), ("value", "50", "стены")],
    "51": [("group", ["21", "25", "45", "59"], "работника")],
    "58": [("group", ["17", "33", "61", "93", "141"], "населенный пункт"),
           ("group", ["21", "29", "43", "49", "167", "73", "79", "83", "125", "163", "165", "169", "219", "223"], "открытая местность"),
           ("group", ["113", "115", "117", "119", "121", "123", "55", "3", "9", "11", "45", "47", "75", "31", "143", "171"], "транспорт"),
           ("group", ["19", "25", "27", "77", "37", "23", "59", "161"], "жилые помещения"),
           ("group", ["57", "89", "101", "103", "107", "111", "135"], "нежилые помещения"),
           ("group", ["65", "157", "69", "53"], "предприятия, учреждения, организации"),
           ("group", ["145", "147", "149", "151", "153", "155"], "магазины"),
           ("group", ["129", "127", "139", "85", "91", "99", "87", "109", "97", "39", "13", "131", "5", "41", "105", "7", "211", "159", "213", "71"], None),
           ("group", ["15", "35", "51", "81", "63", "95", "217", "133"], "внутри здания")],
    "marks": [("group", ["20", "21", "30", "32", "41", "31", "40", "50"], "татуировки")],
    "68": [("value", "10", "подделка")],
}


def correct(key, opts):
    for op in CORRECTIONS.get(key, []):
        if op[0] == "split":
            i = next(i for i, x in enumerate(opts) if x["code"] == op[1])
            g = opts[i]["group"]
            opts[i:i + 1] = [{"code": c, "value": v, "group": g} for c, v in op[2]]
        elif op[0] == "group":
            hits = [x for x in opts if x["code"] in op[1]]
            assert len(hits) == len(op[1]), f"поправка {key}: найдено {len(hits)} из {len(op[1])}"
            for x in hits:
                x["group"] = op[2]
        elif op[0] == "value":
            next(x for x in opts if x["code"] == op[1])["value"] = op[2]
    return opts


def blood(opts):
    """Реквизит 39: коды 1–4 – группа крови, после них 1–2 – резус (одна строка бланка)."""
    for i, x in enumerate(opts):
        x["value"] = re.sub(r"^(ГРУППА КРОВИ|РЕЗУС)\s*", "", x["value"])
        x["group"] = "группа крови" if i < 4 else "резус"
    return opts


def build_ipk(t):
    LC, BOTH = ["lc"], ["lc", "pr"]
    S1, S2, S3 = "Сведения о лице", "Документ, эпизод, решение", "Сведения о преступлении"
    o = lambda refs, group=None: parse_options(rows_text(t, refs), group)
    grouped = lambda items: [x for refs, g in items for x in o(refs, g)]
    R = [
        req("02", "Фамилия", section=S1, variants=LC), req("03", "Имя", section=S1, variants=LC), req("4", "Отчество", section=S1, variants=LC),
        req("05", "Дата рождения", "date", S1, LC), req("06", "Паспорт (другой документ, удостоверение личности, свидетельство)", section=S1, variants=LC),
        req("07", "Место рождения: республика; край, область; район; населенный пункт", section=S1, variants=LC),
        req("08", "Адрес: республика; край, область; район; населенный пункт; улица; дом; корпус; квартира; микрорайон; административный участок", section=S1, variants=LC),
        req("09", "Адрес фактического проживания: республика; край, область; район; населенный пункт; улица; дом; корпус; квартира; микрорайон; административный участок", section=S1, variants=LC),
        req("70", "Гражданство", section=S1, variants=LC), req("10", "Национальность", section=S1, variants=LC),
        req("11", "Место работы", section=S1, variants=LC), req("12", "Специальность", section=S1, variants=LC), req("13", "Клички", section=S1, variants=LC),
        req("14", "Выезжает, посещает (республика, край, область, район, населенный пункт, улица, дом, корпус или наименование объекта)", section=S1, variants=LC),
        req("15", "Порочные наклонности", "enum", S1, LC, o([(2, 23, [1, 2, 3])]), True),
        req("16", "Интересы", "enum", S1, LC, o([(2, 24, [1, 2, 3, 4, 5])]), True),
        req("17", "Имеет навык", "enum", S1, LC, o([(2, 25, [1, 2, 3, 4])]), True),
        req("18", "Знает язык", section=S1, variants=LC),
        req("22", "Вид документа", "enum", S2, BOTH, o([(2, 27, [1])])),
        req("23", "Номер документа", section=S2, variants=BOTH),
        req("б/н", "Дата документа", "date", S2, BOTH, slug="doc_date"),
        req("78", "Номер эпизода", section=S2, variants=BOTH),
        req("б/н", "Дата выявления эпизода", "date", S2, BOTH, slug="episode_date"),
        req("б/н", "Код территориального органа и ИЦ, где подлежит учету", section=S2, variants=BOTH, slug="ic_code",
            raw="Код территориального органа и ИЦ УТ МВД России по ФО, ЛУ МВД России на транспорте, территориального органа МВД России на региональном уровне, где подлежит учету"),
        req("79", "Наименование органа", section=S2, variants=BOTH),
        req("76", "Решение по УД / отказному материалу", "enum", S2, BOTH, o([(2, 32, [1])])),
        req("77", "Дата принятия решения по УД / отказному материалу", "date", S2, BOTH),
        req("28", "Подследственность", "enum", S2, BOTH, o([(2, 34, [1, 2])])),
        req("б/н", "Категория", "enum", S1, LC, o([(2, 35, [1])]), True, slug="category"),
        req("б/н", "Внешне похож на", "enum", S1, LC, o([(3, 0, [1, 2, 3, 4])]), slug="looks_like"),
        req("б/н", "Пол", "enum", S1, LC, o([(3, 1, [1])]), slug="sex"),
        req("б/н", "Рост", "enum", S1, LC, o([(3, 1, [4, 5])]), slug="height"),
        req("б/н", "Телосложение", "enum", S1, LC, o([(3, 2, [1, 2, 3, 4, 5, 6])]), slug="build"),
        req("б/н", "Волосы", "enum", S1, LC, o([(3, 3, [1, 2, 3, 4, 6])]), True, slug="hair"),
        req("37", "Особенности внешности", "enum", S1, LC, grouped([([(3, r, None)], g) for r, g in
            [(5, "лицо"), (6, "брови"), (7, "нос"), (8, "губы"), (9, "подбородок"), (10, "глаза"), (11, "зубы"), (12, "рот"), (13, "уши, лоб")]]), True),
        req("38", "Особенности поведения", "enum", S1, LC, grouped([([(3, 14, None)], None), ([(3, 16, None)], "речь"), ([(3, 17, None)], "жесты и мимика"), ([(3, 18, None)], "походка")]), True),
        req("39", "Группа крови, резус", "enum", S1, LC, blood(o([(3, 19, [0])])), True),
        req("б/н", "Особые приметы и татуировки: код расположения, код приметы (татуировки), описание", "enum", S1, LC,
            grouped([([(3, 21, None)], "расположение"), ([(3, 23, None)], "примета, татуировка")]), True, slug="marks"),
        req("41", "Описание иных характерных признаков", section=S1, variants=LC),
        req("42", "Примерный год рождения неустановленного лица", section=S1, variants=["pr"]),
        req("б/н", "Статья УК", section=S3, variants=BOTH, slug="uk_article"),
        req("44", "Вид преступления", "enum", S3, BOTH, o([(4, 1, None)])),
        req("71", "Характер преступления", "enum", S3, BOTH, o([(4, 3, [0])]), True),
        req("72", "Наименование юридического лица", section=S3, variants=BOTH), req("74", "ОГРН", section=S3, variants=BOTH),
        req("73", "Фактический адрес юридического лица", section=S3, variants=BOTH),
        req("б/н", "Отношение к объекту учета", "enum", S3, BOTH, o([(4, 6, [0])]), slug="object_relation"),
        req("45", "Отношение к преступлению", "enum", S3, LC, grouped([([(4, 9, [0, 1, 2]), (4, 10, [0, 1])], None), ([(4, 9, [3]), (4, 10, [3])], "содержатель притона"), ([(4, 9, [4, 5]), (4, 10, [4])], "лицо, склоняющее")]), True),
        req("46", "Совершено", "enum", S3, BOTH, o([(4, 11, None), (4, 12, [0, 1, 2])]), True),
        req("47", "Способ проникновения", "enum", S3, BOTH, o([(4, 14, None), (4, 15, [0, 1, 2])]), True),
        req("48", "Способ насильственных действий", "enum", S3, BOTH, o([(4, 17, None), (4, 18, [0, 1, 2])]), True),
        req("б/н", "Способ мошенничества", "enum", S3, BOTH, o([(4, 20, None)]), True, slug="fraud_method"),
        req("б/н", "Средства", "enum", S3, BOTH, o([(4, 23, None), (4, 24, None)]), True, slug="means"),
        req("б/н", "Под видом", "enum", S3, BOTH, o([(4, 26, None), (4, 27, None)]), True, slug="disguise"),
        req("б/н", "Под предлогом", "enum", S3, BOTH, o([(4, 29, None)]), True, slug="pretext"),
        req("51", "В отношении", "enum", S3, BOTH, o([(4, 32, None)]), True),
        req("57", "Предмет посягательства", "enum", S3, BOTH, o([(4, 35, None)]), True),
        req("58", "Место", "enum", S3, BOTH, o([(4, 38, None), (4, 39, [1, 2])]), True),
        req("59", "Фабула преступления (когда, где, совместно с кем и что совершено, характерные приемы совершения и сокрытия преступления, похищенные предметы, следы и вещественные доказательства)", section=S3, variants=BOTH),
        req("б/н", "Дата установления лица", "date", S3, LC, slug="identified_date"),
        req("61", "Дата совершения", "date", S3, BOTH),
        req("б/н", "День недели", "enum", S3, BOTH, [{"code": c, "value": v, "group": None} for c, v in
            [("1", "ПН"), ("2", "ВТ"), ("3", "СР"), ("4", "ЧТ"), ("5", "ПТ"), ("6", "СБ"), ("7", "ВС")]], slug="weekday"),
        req("б/н", "Время совершения преступления", "enum", S3, BOTH, o([(4, 44, None)]), slug="daytime"),
        req("64", "Место совершения: республика; край, область; район; населенный пункт; улица; дом", section=S3, variants=BOTH),
        req("б/н", "Территория", section=S3, variants=BOTH, slug="territory"),
        req("66", "Связи лица", section=S3, variants=LC),
        req("67", "По делу имеются", "enum", S3, BOTH, o([(4, 48, None)]), True),
        req("68", "Способ сокрытия преступления", "enum", S3, BOTH, o([(4, 50, [1, 2, 3, 4]), (4, 51, [1, 2, 3, 4])]), True),
        req("65", "Отметка о коррекции и снятии", "enum", S2, BOTH, [{"code": c, "value": v, "group": None} for c, v in
            [("СУ", "снять с учета"), ("К", "корректировка"), ("СМ", "постановка на учет умершего лица"),
             ("СМ, К", "корректировка умершего лица или корректировка в связи со смертью лица"), ("СМ, СУ", "снятие с учета умершего лица")]]),
        req("85", "Основание снятия с учета", "enum", S2, BOTH, o([(4, 53, [1])])),
        req("б/н", "Заполнил: должность, фамилия, подпись", section="Подписи", variants=BOTH, slug="filled_by"),
        req("б/н", "Руководитель: должность, фамилия, подпись", section="Подписи", variants=BOTH, fills_by="head", slug="head_sign"),
    ]
    for r in R:
        if r["options"]:
            correct(r["id"], r["options"])
    return {"form": "ipk", "variants": [{"id": "lc", "title": "лицо – ЛЦ"}, {"id": "pr", "title": "событие – ПР"}],
            "title": "ИНФОРМАЦИОННО-ПОИСКОВАЯ КАРТА (ИПК)", "edition": "2026", "effective_from": "2026-01-01", "effective_to": None,
            "legal_basis": "эталонный бланк заказчика", "source": "new_cards/ИПК.doc (нормализован в .docx нативным Word); реквизиты извлечены scripts/import/import_ipk.py",
            "requisites_count": len(R), "requisites": R}


def build_ipk_in(t):
    A = "А. Регистр преступления (происшествия)"
    B = "Б. Сведения о подозреваемом / потерпевшем / обвиняемом"
    V = "В. Дополнительные сведения о преступлении (происшествии)"
    G = "Г. Сведения об уголовном деле и подозреваемом"
    D = "Д. Фабула"
    items = [
        ("1", "Территориальный орган МВД России, ИЦ, где подлежит учету", "text", A), ("2", "Наименование органа: служба; полное наименование органа", "text", A),
        ("3", "№ по КУСП; № дополнительного преступления", "text", A), ("4", "Дата регистрации", "date", A),
        ("5", "Вид преступления (происшествия)", "text", A), ("6", "Дата совершения преступления (происшествия)", "date", A),
        ("7", "Фамилия", "text", B), ("8", "Имя", "text", B), ("9", "Отчество", "text", B), ("10", "Дата рождения", "date", B), ("11", "Пол", "text", B),
        ("12", "Гражданство", "text", B), ("13", "Место рождения: страна, республика; край, область, район, город, населенный пункт", "text", B),
        ("14", "Паспорт (или иной документ): тип документа; № документа; дата выдачи; кем выдан", "text", B),
        ("15", "Страна выбытия", "text", B), ("16", "Дата въезда", "date", B), ("17", "Цель въезда, статус", "text", B),
        ("18", "Место работы, учебы: тип предприятия (учреждения); наименование", "text", B),
        ("19", "Сведения о регистрации по месту жительства: страна, республика, субъект Российской Федерации; край, область, район; город, населенный пункт", "text", B),
        ("20", "Процессуальный статус (подозреваемый, обвиняемый, потерпевший)", "text", B),
        ("21", "Предмет преступного посягательства", "text", V), ("22", "Время совершения преступления (происшествия): часов, минут", "text", V),
        ("23", "Место преступления (происшествия)", "text", V), ("24", "Способ совершения", "text", V),
        ("25", "№ УД", "text", G), ("26", "Дата возбуждения", "date", G), ("27", "Подследственность", "text", G),
        ("28", "Статьи УК: пункты; часть; статья; примечание", "text", G), ("29", "№ отказного материала", "text", G),
        ("30", "Дата отказа в возбуждении УД", "date", G), ("31", "Дата задержания", "date", G), ("32", "Дата предъявления обвинения", "date", G),
        ("33", "Мера пресечения: вид; дата", "text", G), ("34", "Решение по УД", "text", G), ("35", "Дата принятия решения по УД", "date", G),
        ("36", "Фабула", "text", D), ("37", "Дополнительные сведения", "text", D),
        ("38", "Карту заполнил (должность, ФИО, телефон)", "text", "Подписи"), ("39", "Дата заполнения", "date", "Подписи"),
    ]
    R = [req(n, l, ft, s) for n, l, ft, s in items]
    R.append(req("б/н", "Начальник органа (ФИО, подпись)", section="Подписи", fills_by="head", slug="head_sign"))
    R.append(req("б/н", "Дата передачи Карты-ИГ ответственному лицу", "date", "Подписи", slug="transfer_date"))
    return {"form": "ipk-in", "title": "КАРТА НА ПРЕСТУПЛЕНИЕ (ПРОИСШЕСТВИЕ), СОВЕРШЕННОЕ ИНОСТРАННЫМИ ГРАЖДАНАМИ ИЛИ ЛБГ, А ТАКЖЕ НА ПРЕСТУПЛЕНИЕ (ПРОИСШЕСТВИЕ), СОВЕРШЕННОЕ В ОТНОШЕНИИ ИХ",
            "edition": "2026", "effective_from": "2026-01-01", "effective_to": None, "legal_basis": "эталонный бланк заказчика",
            "source": "new_cards/ИПК иностранец.doc (нормализован в .docx нативным Word); реквизиты извлечены scripts/import/import_ipk.py. Примечание бланка: для учетного документа заполняются блоки А, Б, В, Д, для корректирующего (дополнительного) – А, Б, Г, Д",
            "requisites_count": len(R), "requisites": R}


def main():
    if not (SRC / "ipk.docx").exists() or not (SRC / "ipk-in.docx").exists():
        print("нет нормализованных бланков ИПК в data-private/blanks-src – пропуск (пакет ИПК не пересобран)")
        return
    t1, t2 = tables(SRC / "ipk.docx"), tables(SRC / "ipk-in.docx")
    assert len(t1) == 4 and len(t2) == 6, f"структура бланков изменилась: таблиц {len(t1)} и {len(t2)}"
    forms = [build_ipk(t1), build_ipk_in(t2)]
    scrub = json.loads((SRC / "scrub.json").read_text(encoding="utf-8"))["fragments"] if (SRC / "scrub.json").exists() else []
    for f in forms:
        for r in f["requisites"]:  # типографика пакета: «е» вместо «ё»
            for o in r["options"]:
                o["value"] = o["value"].replace("ё", "е").replace("Ё", "Е")
        dump = json.dumps(f, ensure_ascii=False)
        leaked = [x for x in scrub if x in dump]
        if leaked:
            sys.exit(f"ф. {f['form']}: в пакет попал образец заполнения бланка ({len(leaked)} фрагм.) – импорт остановлен")
        ids = [r["id"] for r in f["requisites"]]
        assert len(ids) == len(set(ids)), f"повтор идентификаторов в {f['form']}"
        (OUT / f"forma-{f['form']}.json").write_text(json.dumps(f, ensure_ascii=False, indent=1), encoding="utf-8")
    idx = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    idx["forms"] = [x for x in idx["forms"] if x["form"] not in ("ipk", "ipk-in")] + [
        {"form": f["form"], "title": f["title"], "file": f"forma-{f['form']}.json", "requisites": f["requisites_count"]} for f in forms]
    (OUT / "index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    for f in forms:
        enums = [r for r in f["requisites"] if r["field_type"] == "enum"]
        print(f"ф. {f['form']}: реквизитов {f['requisites_count']}, кодовых {len(enums)}, вариантов {sum(len(r['options']) for r in enums)}")
        for r in enums:
            if not r["options"]:
                print("  без вариантов:", r["number"], r["label"])


if __name__ == "__main__":
    main()
