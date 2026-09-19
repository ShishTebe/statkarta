"""Модель ввода реквизита: число кодовых полей, режим выбора, дополнительные поля (сумма, количество, номер).

Число полей – по ячейкам официального бланка (blank_cells.py). Режим выбора:
- multiple – в бланке несколько кодовых полей: можно выбрать несколько кодов (не больше числа полей);
- overlay – одно поле, коды позиционные (разряды): коды из разных разрядов складываются наложением,
  например 2000 + 0030 = 2030; коды, занимающие одни и те же разряды, взаимоисключающие;
- single – один код.
"""
import re
from collections import Counter

UNITS = r"(руб\.?|рублей|ед\.?|единиц|штук|шт\.?|чел\.?|человек|г\.|лет|месяцев|мес\.|дней|часов|в рублях[^,;]*|в долларах США|кг|граммах|миллиграммах|килограммах)"


def code_length(codes):
    lens = Counter(len(c) for c in codes if c.isdigit())
    return lens.most_common(1)[0][0] if lens else None


def fields_from_cells(rows, L):
    if not rows or not L:
        return None
    best = 0
    for groups in rows:
        if L == 1:
            n = sum(1 for g in groups if g <= 2)
        else:
            total = sum(groups)
            if groups and groups[-1] % L == 1:
                total -= 1
            n = total // L
        best = max(best, n)
    return best or None


def positions(code):
    return {i for i, ch in enumerate(code) if ch != "0"}


def contiguous(code):
    pos = sorted(positions(code))
    return bool(pos) and pos[-1] - pos[0] + 1 == len(pos)


# Справочники с позиционными кодами (наложение): № 4 и № 14 – прямо в сносках и разъяснениях ГИАЦ
# («путем наложения кодов»), № 2, 3, 9, 10 – разрядная структура кодов (группы в старших разрядах,
# уточнения – в младших). Остальные справочники – порядковая нумерация.
OVERLAY_CLASSIFIERS = {2, 3, 4, 9, 10, 14}


def span(code):
    pos = positions(code)
    return (min(pos), max(pos)) if pos else None


def overlay_capable(codes, classifier_no=None):
    if classifier_no is not None:
        return classifier_no in OVERLAY_CLASSIFIERS
    codes = [c for c in codes if c.isdigit() and positions(c)]
    if len(codes) < 2 or len({len(c) for c in codes}) != 1 or len(codes[0]) < 2:
        return False
    L = len(codes[0])
    if L <= 3:
        if any(len(positions(c)) > 1 for c in codes):
            return False
    spans = [span(c) for c in codes]
    disjoint = any(a[1] < b[0] or b[1] < a[0] for i, a in enumerate(spans) for b in spans[i + 1:])
    tail = sum(1 for c in codes if c.endswith("0"))
    return disjoint and tail >= 1


FILL_OK = re.compile(r"сумм|количеств|кол-во|штук|единиц|погибш|тяжкий вред|вред здоровью|н/л|женщин|юридических лиц|№|размер|граммах|килограммах|миллиграммах", re.I)
FILL_BAD = re.compile(r"по справочнику|\bДата\b|\bгод\b|подпись|звание|фамилия|сотрудник|прокурор|дата направления|дата поступления|учтены в государственной|начальник|руководитель|ст\.\s*$|зн\.|\bч\.\s*$|\bп\.\s*$|по ст", re.I)


def fills_from_raw(raw, codes):
    """Поля для сумм, количеств, номеров: «на сумму ___ руб.», «количество ___», «№ ___»."""
    if not raw or "__" not in raw:
        return []
    out, seen = [], set()
    for m in re.finditer(r"_{3,}", raw):
        before = raw[:m.start()]
        after = raw[m.end():m.end() + 40]
        clause = re.split(r"[;:]|\)\s*,|\.\s(?=[А-ЯЁ])", before)[-1]
        label = re.sub(r"\(\d{1,6}\)", "", clause)
        label = re.sub(r"_+|\s+", " ", label).strip(" ,.«»“”\"")
        label = re.sub(r"^(в т\.ч\.|в том числе|из них)\s*", "", label)
        label = re.sub(r"\b\d{1,2}(\.\d{1,2})?(-\d{1,2}(\.\d{1,2})?)?\s+", "", label)
        if not FILL_OK.search(label + " " + after[:15]) or FILL_BAD.search(label):
            continue
        um = re.match(r"\s*" + UNITS, after)
        near = re.findall(r"\((\d{1,6})\)", before[-90:])
        label = label[-60:].strip()
        key = " ".join(label.split()[-3:]).lower()
        if not label or key in seen:
            continue
        seen.add(key)
        item = {"label": label}
        if um:
            item["unit"] = um.group(1)
        if near and near[-1] in codes:
            item["for_code"] = near[-1]
        item["type"] = "number" if re.search(r"сумм|руб|количеств|кол-во|штук|единиц|погибш|вред|н/л|женщин|лиц|граммах|килограммах|миллиграммах", label + (item.get("unit") or "")) else "text"
        out.append(item)
    return out
