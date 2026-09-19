"""Разбор вариантов кодов из дословного текста реквизита бланка.

«Дело приостановлено: по п. 2 ч. 1 ст. 208 УПК РФ (1): вид дела: НРД (1), РД (2)» →
[{code: "1", value: "по п. 2 ч. 1 ст. 208 УПК РФ"}, {code: "1", value: "НРД", group: "вид дела"}, ...].
Значение – текст от предыдущего кода (или разделителя) до скобки с кодом.
Новая группа начинается при подзаголовке с двоеточием или при повторе кода.
"""
import re

CODE = re.compile(r"\((\d{1,6})\)")
NOT_CODE_BEFORE = re.compile(r"(?:(?<![А-Яа-яЁёA-Za-z])(?:ч|п|ст|пп|чч|зн)\.\s*|№\s*)$")


HINT = re.compile(r"\((?:орган,|орган\s|наименование|фамилия|Ф\.И\.О)[^()]*\)")


def clean(s):
    # подсказки бланка в скобках «(орган, в который направлено дело…)» – не часть значения
    hints = list(HINT.finditer(s))
    if hints:
        s = s[hints[-1].end():]
    s = re.sub(r"_{2,}", " ", s)
    s = re.sub(r"^[\s/№,.;:–-]+", "", s)
    if s.count("«") > s.count("»"):
        s = s.replace("«", "", 1) if s.lstrip().startswith("«") else s + "»"
    s = re.sub(r"[«“\"]\s*[»”\"]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" ,;.:–-")


def parse_options(raw, label_hint=None, number=None):
    if not raw:
        return []
    opts, pos, group, ctx = [], 0, None, None
    groups = {None: set()}
    for m in CODE.finditer(raw):
        before = raw[pos:m.start()]
        if NOT_CODE_BEFORE.search(before) and not before.strip().endswith(")"):
            continue  # «ст. (123)» – не код
        chunk = before
        heading = None
        parts = re.split(r"(?<=[^\d]):\s", chunk)
        if len(parts) > 1:
            h = clean(re.split(r"[;]\s|\.\s(?=[А-ЯЁ])", parts[-2])[-1])
            ctx = h or ctx
            if opts:
                heading = h  # подзаголовок группы: «…; вид дела: НРД (1)»
            chunk = parts[-1]
        elif re.search(r";\s", chunk):
            ctx = None
        chunk = re.split(r";\s|\.\s(?=[А-ЯЁ])", chunk)[-1]
        if re.search(r"№|\(Ф\.И\.О|\(фамилия|\(наименование|осн\.", chunk):
            tail = list(re.finditer(r"по (?:п|ч|ст)\.", chunk))
            if tail:
                chunk = chunk[tail[-1].start():]
        chunk = re.sub(r"^\s*(?:,|и|или|а также)\s+", "", chunk)
        chunk = re.sub(r"^\s*количество\b[\s_]*", "", chunk)
        chunk = re.sub(r"(на сумму|количество|в сумме)\s*_*\s*(руб\.?|ед\.?|штук)?\s*", " ", chunk)
        if number:
            chunk = re.sub(rf"(^|\s){re.escape(number)}(?=\s|$)", " ", chunk)
        value = clean(chunk)
        code = m.group(1)
        if heading:
            group = heading
            groups.setdefault(group, set())
        elif code in groups.setdefault(group, set()):
            if group and code not in groups[None]:
                group = None  # возврат к основному перечню после подгруппы
            else:
                parent = opts[-1]["value"] if opts else ""
                group = parent if parent and parent not in groups else f"{group or ''}#{len(groups) + 1}"
                groups[group] = set()
        groups[group].add(code)
        o = {"code": code, "value": value, "_ctx": ctx}
        if group:
            o["group"] = group
        opts.append(o)
        pos = m.end()
    return opts


def drop_needless_groups(opts):
    codes = [o["code"] for o in opts]
    if len(codes) == len(set(codes)):
        for o in opts:
            o.pop("group", None)
    values = [(o.get("group"), o["value"]) for o in opts]
    for o in opts:
        ctx = o.pop("_ctx", None)
        if values.count((o.get("group"), o["value"])) > 1 and ctx and ctx != o["value"] and not o.get("group"):
            o["value"] = f"{ctx}: {o['value']}"
    return opts
