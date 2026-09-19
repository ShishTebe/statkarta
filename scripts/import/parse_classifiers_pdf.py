"""Разбор справочников ГИАЦ МВД из машиночитаемых PDF с иерархией и сносками.

Полужирная строка без кода – заголовок группы; обычная строка без кода – продолжение
наименования; горизонтальный отступ задает вложенность; строки со звездочки – сноски.
Вход: PDF, выход: JSON {no: {title, entries[{code,name,path,level,group,marks}], notes[]}}.
"""
import fitz, re, json, sys
from pathlib import Path

CODE = re.compile(r"^(\d{2,6})$")


def lines_of(page):
    spans = []
    for blk in page.get_text("dict")["blocks"]:
        for l in blk.get("lines", []):
            for sp in l["spans"]:
                if sp["text"].strip():
                    x0, y0, x1, y1 = sp["bbox"]
                    spans.append({"x": round(x0, 1), "x1": x1, "yc": (y0 + y1) / 2, "text": sp["text"], "size": sp["size"],
                                  "bold": "Bold" in sp["font"] or bool(sp["flags"] & 16)})
    spans.sort(key=lambda s: (s["yc"], s["x"]))
    rows = []
    for sp in spans:
        if rows and abs(rows[-1]["yc"] - sp["yc"]) <= 3.5:
            rows[-1]["spans"].append(sp)
        else:
            rows.append({"yc": sp["yc"], "spans": [sp]})
    out = []
    for r in rows:
        sps = sorted(r["spans"], key=lambda s: s["x"])
        # части строки: разрыв по горизонтали больше 12 пт – отдельная колонка (код | наименование)
        parts = []
        for sp in sps:
            if parts and sp["x"] - parts[-1]["x_end"] < 12:
                gap = sp["x"] - parts[-1]["x_end"]
                sep = " " if gap > sp["size"] * 0.18 and not parts[-1]["text"].endswith((" ", "-")) and not sp["text"].startswith((" ", "-", ",", ".", ")")) else ""
                parts[-1]["text"] += sep + sp["text"]
                parts[-1]["x_end"] = sp["x1"]
                parts[-1]["bold_chars"] += len(sp["text"].strip()) if sp["bold"] else 0
                parts[-1]["chars"] += len(sp["text"].strip())
            else:
                parts.append({"x": sp["x"], "x_end": sp["x1"], "text": sp["text"], "size": sp["size"],
                              "bold_chars": len(sp["text"].strip()) if sp["bold"] else 0, "chars": len(sp["text"].strip())})
        for p_ in parts:
            p_["text"] = re.sub(r"\s+", " ", p_["text"]).strip()
            p_["bold"] = p_["chars"] > 0 and p_["bold_chars"] > 0.6 * p_["chars"]
        parts = [p_ for p_ in parts if p_["text"]]
        if parts:
            out.append({"y": r["yc"], "parts": parts})
    # одиночные знаки со смещенной базовой линией («-», «*», надстрочная цифра) – вернуть в строку выше
    fixed = []
    for row in out:
        if fixed and all(re.fullmatch(r"[-–*]{1,5}\d?|\d", p_["text"]) for p_ in row["parts"]) and abs(row["y"] - fixed[-1]["y"]) <= 12:
            prev = fixed[-1]
            for mark in row["parts"]:
                target = None
                for p_ in prev["parts"]:
                    if p_["x"] - 2 <= mark["x"] <= p_["x_end"] + 15:
                        target = p_
                if target is None:
                    continue
                t = target["text"]
                ratio = (mark["x"] - target["x"]) / max(1.0, target["x_end"] - target["x"])
                idx = max(0, min(len(t), round(ratio * len(t))))
                if mark["text"] in ("-", "–"):
                    spaces = [i for i, ch in enumerate(t) if ch == " "]
                    near = min(spaces, key=lambda i: abs(i - idx)) if spaces else None
                    if near is not None and abs(near - idx) <= 4:
                        target["text"] = t[:near] + "-" + t[near + 1:]
                else:
                    tail = re.search(r"\s(\d)$", t)
                    if idx >= len(t) - 2 and tail:
                        target["text"] = t[:tail.start()] + mark["text"] + tail.group(1)
                    elif idx >= len(t) - 2:
                        target["text"] = t + mark["text"]
                    else:
                        target["text"] = t[:idx] + mark["text"] + t[idx:]
            continue
        fixed.append(row)
    out = fixed
    # код, выровненный по центру многострочного наименования, стоит отдельной строкой – присоединить
    merged, pending = [], None
    is_code = lambda row: bool(CODE.match(row["parts"][0]["text"].split()[0]))
    for row in out:
        lone = len(row["parts"]) == 1 and CODE.match(row["parts"][0]["text"])
        if pending is not None:
            if not is_code(row) and abs(row["y"] - pending["y"]) <= 10:
                row["parts"].insert(0, pending["parts"][0])
            else:
                merged.append(pending)
            pending = None
        if lone:
            prev = merged[-1] if merged else None
            if prev and not is_code(prev) and abs(row["y"] - prev["y"]) <= 10 and prev["parts"][0]["x"] > row["parts"][0]["x"]:
                prev["parts"].insert(0, row["parts"][0])
            else:
                pending = row
            continue
        merged.append(row)
    if pending is not None:
        merged.append(pending)
    # поля четных и нечетных страниц различаются: отступы – относительно колонки кодов страницы
    code_x = [r["parts"][0]["x"] for r in merged if CODE.match(r["parts"][0]["text"].split()[0])]
    base = min(set(round(x) for x in code_x), key=lambda v: -sum(1 for x in code_x if abs(x - v) < 3)) if code_x else 0
    for r in merged:
        for p_ in r["parts"]:
            p_["x"] = round(p_["x"] - base, 1)
    name_x = [r["parts"][1]["x"] for r in merged if len(r["parts"]) > 1 and CODE.match(r["parts"][0]["text"])]
    col = min(set(round(x) for x in name_x), key=lambda v: -sum(1 for x in name_x if abs(x - v) < 3)) if name_x else 45
    for r in merged:
        r["name_col"] = col
    return merged


def parse(pdf, wanted):
    d = fitz.open(pdf)
    res, cur, stack, last, note_buf, header_seen, prev_heading = {}, None, [], None, None, False, None
    for page in d:
        rows = lines_of(page)
        for ri, row in enumerate(rows):
            parts = row["parts"]
            first = parts[0]["text"]
            full = " ".join(p["text"] for p in parts)
            m = re.match(r"^СПРАВОЧНИК\s*№\s*(\d+)$", full)
            if m:
                no = int(m.group(1))
                cur = no if no in wanted and no not in res else None
                if cur:
                    res[cur] = {"title": "", "entries": [], "notes": []}
                    stack, last, note_buf, header_seen = [], None, None, False
                continue
            if cur is None:
                continue
            if re.match(r"^(СПРАВОЧНИК|Разъяснения общего характера|Разъяснения по использованию)", full):
                cur = None
                continue
            if full.startswith("Код ") and "Наименование" in full or full in ("Код", "Наименование"):
                header_seen = True
                continue
            if not header_seen:
                res[cur]["title"] = (res[cur]["title"] + " " + full).strip()
                continue
            if re.fullmatch(r"\d{1,3}", full) and parts[0]["x"] > 150:
                continue
            if full.startswith("*") or re.match(r"^\d\s+[А-Я]", full) and parts[0]["size"] < 13:
                note_buf = {"mark": re.match(r"^\*+\d*|^\d", full).group(0), "text": re.sub(r"^(\*+\d*|\d)\s*", "", full), "page": page.number}
                res[cur]["notes"].append(note_buf)
                continue
            if note_buf and parts[0]["size"] < 13.5 and not CODE.match(first.split()[0]):
                note_buf["text"] += " " + full
                continue
            note_buf = None
            tokens = first.split(maxsplit=1)
            code = tokens[0] if CODE.match(tokens[0]) else None
            if code:
                name_parts = ([tokens[1]] if len(tokens) > 1 else []) + [p["text"] for p in parts[1:]]
                name = " ".join(name_parts).strip(" ,")
                single = not (len(parts) > 1 and len(tokens) == 1)
                if single:
                    heads = [st for st in stack if st["entry"] is None]
                    x = (heads[-1]["x"] + 5) if heads else row["name_col"]
                    while stack and stack[-1]["entry"] is not None:
                        stack.pop()
                else:
                    x = parts[1]["x"]
                if not re.sub(r"[\s*]+", "", name):
                    # наименование стоит в соседней строке (выравнивание по центру)
                    for nb in (rows[ri - 1] if ri else None, rows[ri + 1] if ri + 1 < len(rows) else None):
                        if nb and not CODE.match(nb["parts"][0]["text"].split()[0]) and abs(nb["y"] - row["y"]) <= 12:
                            name = nb["parts"][0]["text"] + " " + name
                            nb["consumed"] = True
                            break
                bold = any(p["bold"] for p in parts[1:]) if len(parts) > 1 else parts[0]["bold"]
                while stack and ((stack[-1]["x"] >= x - 3 if stack[-1]["entry"] is not None else stack[-1]["x"] > x + 1) or stack[-1].get("child_x") is not None and x < stack[-1]["child_x"] - 3):
                    stack.pop()
                if stack and stack[-1].get("child_x") is None:
                    stack[-1]["child_x"] = x
                prev_heading = None
                e = {"code": code, "name": name, "path": [s_["label"] for s_ in stack], "level": len(stack), "group": False,
                     "new_bold": bold, "x": x, "page": page.number, "single": single}
                res[cur]["entries"].append(e)
                stack.append({"x": x, "label": name or code, "entry": e})
                last = e
                continue
            if row.get("consumed"):
                continue
            x = parts[0]["x"]
            is_bold = all(p["bold"] for p in parts)
            incomplete = last is not None and re.search(r"(,|-|\b(и|или|в|во|на|по|с|со|к|от|для|особо|а|также|их|его|за|при|из|о|об))$", last["name"].strip())
            continuation = last is not None and (abs(x - last["x"]) <= 3 or incomplete and -3 <= x - last["x"] <= 25 or last.get("single") and not is_bold) and not full.endswith(":") \
                and not re.search(r"\*+\d*$", last["name"]) and not last["name"].lstrip().startswith(("–", "-"))
            if continuation and (not is_bold or last.get("new_bold")):
                prev_heading = None
                last["name"] = (last["name"] + " " + full).strip()
                if stack and stack[-1]["entry"] is last:
                    stack[-1]["label"] = last["name"]
                continue
            if last is None and stack and abs(x - stack[-1]["x"]) <= 3 and not full.endswith(":") and not is_bold:
                stack[-1]["label"] = (stack[-1]["label"] + " " + full).strip()
                continue
            # заголовок группы (вторая строка заголовка того же отступа присоединяется)
            if prev_heading is not None and abs(x - prev_heading["x"]) <= 3 and (full.startswith("(") or not prev_heading["label"].endswith(":")):
                prev_heading["label"] += " " + full.strip()
                continue
            while stack and (stack[-1]["x"] >= x - 3 or stack[-1].get("child_x") is not None and x < stack[-1]["child_x"] - 3):
                stack.pop()
            if stack and stack[-1].get("child_x") is None:
                stack[-1]["child_x"] = x
            prev_heading = {"x": x, "label": full.strip(), "entry": None}
            stack.append(prev_heading)
            last = None
    for c in res.values():
        for e in c["entries"]:
            e["name"] = re.sub(r"\s+", " ", e["name"]).replace(" ,", ",")
            e["marks"] = re.findall(r"\*+\d*", e["name"])
            e["name"] = re.sub(r"\s*\*+\d*", "", e["name"]).strip(" ,")
            # надстрочный номер сноски, отделившийся от звездочки: «технологий 1»
            tail = re.search(r"(?<=[а-яё»)])\s(\d)$", e["name"])
            if tail and any(n["mark"].endswith(tail.group(1)) for n in c["notes"]):
                e["marks"].append("*" + tail.group(1))
                e["name"] = e["name"][:tail.start()].rstrip()
            # сноски: та же страница или ближайшая следующая
            own = []
            for mk in e["marks"]:
                cand = [n for n in c["notes"] if n["mark"] in (mk, mk.rstrip("0123456789")) and n["page"] >= e["page"]]
                if cand:
                    own.append(min(cand, key=lambda n: n["page"])["text"])
            e["note_texts"] = own
            e["group"] = any(x["path"][:len(e["path"]) + 1] == e["path"] + [e["name"]] for x in c["entries"] if len(x["path"]) > len(e["path"]))
            e.pop("x", None)
            e.pop("single", None)
    return res


if __name__ == "__main__":
    wanted = {int(x) for x in sys.argv[2].split(",")}
    json.dump(parse(sys.argv[1], wanted), open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
