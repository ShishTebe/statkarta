"""Разбор эталонного бланка .docx: места, куда можно вписать значение (Фаза 1.6).

Бланки карточек сверстаны фигурами VML: ряд клеток кода – это <v:rect> внутри <v:group>,
координаты клетки заданы в системе координат группы и пересчитываются здесь в пункты.

Фигуры нумеруются в том же порядке, что и в src/core/ooxml.mjs (по вхождению тега в
word/document.xml), поэтому номер места из этого разбора можно передавать в заполнение бланка.

Используется скриптами mark_cells.py, build_layout.py и normalize.mjs; отдельного запуска не имеет.
"""
import re
import zipfile

CELL_W = (6.3, 7.9)     # ширина клетки кода, пункты (по официальному бланку – 7,2)
CELL_H = (11.5, 15.4)   # высота клетки кода, пункты (по официальному бланку – 14,2)

TAG = re.compile(r"<(v:group|v:rect|v:shape|v:roundrect|wps:wsp)(?=[\s>/])|</v:group>|<mc:Fallback>|</mc:Fallback>")
EXT = re.compile(r'<a:ext cx="(\d+)" cy="(\d+)"')
EMU = 12700.0   # единиц EMU в пункте
ATTR = re.compile(r'([\w:.-]+)="([^"]*)"')


def _attrs(head):
    return dict(ATTR.findall(head))


def _style(attrs):
    return dict(p.split(":", 1) for p in (attrs.get("style") or "").split(";") if ":" in p)


def _num(v, default=None):
    if v is None:
        return default
    m = re.match(r"^(-?[\d.]+)(pt)?$", v.strip())
    return float(m.group(1)) if m else default


def _dim(v, scale):
    """Размер фигуры в пунктах: с «pt» – как есть, без единиц – в координатах родителя."""
    if v is None:
        return None
    s = v.strip()
    if s.endswith("pt"):
        return float(s[:-2])
    try:
        return float(s) * scale
    except ValueError:
        return None


def _pair(v, default=(0.0, 0.0)):
    if not v:
        return default
    a = v.split(",")
    try:
        return (float(a[0]), float(a[1]))
    except (ValueError, IndexError):
        return default


def read_xml(path, part="word/document.xml"):
    return zipfile.ZipFile(path).read(part).decode("utf8")


def places(xml):
    """Все фигуры бланка в порядке документа с координатами в пунктах.

    Номер места («index») совпадает с нумерацией фигур в src/core/ooxml.mjs.
    Для фигур внутри групп координаты приведены к пунктам через систему координат группы;
    начало отсчета – привязка группы к абзацу, поэтому сравнивать координаты можно внутри
    одной привязки, а не по всей странице.
    """
    out, stack, index, fallback = [], [], 0, 0
    for m in TAG.finditer(xml):
        if m.group(0) == "</v:group>":
            if stack:
                stack.pop()
            continue
        if m.group(0) == "<mc:Fallback>":
            fallback += 1
            continue
        if m.group(0) == "</mc:Fallback>":
            fallback -= 1
            continue
        if m.group(1) == "wps:wsp":
            # Размер фигуры DrawingML берется из ее же свойств; положение на странице не нужно –
            # его дает печать размеченного бланка.
            e = EXT.search(xml, m.start(), m.start() + 4000)
            w = round(int(e.group(1)) / EMU, 2) if e else 0.0
            h = round(int(e.group(2)) / EMU, 2) if e else 0.0
            out.append({"index": index, "tag": "wps:wsp", "id": None, "spid": None, "kind": "dml",
                        "x": 0.0, "y": 0.0, "w": w, "h": h, "picture": False,
                        "fallback": fallback > 0, "start": m.start()})
            index += 1
            continue
        tag = m.group(1)
        end = xml.index(">", m.start())
        head = xml[m.start():end + 1]
        self_closing = head.endswith("/>")
        attrs = _attrs(head)
        st = _style(attrs)
        parent = stack[-1] if stack else None
        kx, ky = (parent["kx"], parent["ky"]) if parent else (1.0, 1.0)
        ox, oy = (parent["x"], parent["y"]) if parent else (0.0, 0.0)
        cox, coy = (parent["co"] if parent else (0.0, 0.0))
        if parent:
            x = ox + (_num(st.get("left"), 0.0) - cox) * kx
            y = oy + (_num(st.get("top"), 0.0) - coy) * ky
        else:
            x = _num(st.get("margin-left"), 0.0)
            y = _num(st.get("margin-top"), 0.0)
        w = _dim(st.get("width"), kx) or 0.0
        h = _dim(st.get("height"), ky) or 0.0
        if tag == "v:group":
            cs = _pair(attrs.get("coordsize"), (1000.0, 1000.0))
            co = _pair(attrs.get("coordorigin"))
            group = {"x": x, "y": y, "kx": (w or cs[0] * kx) / cs[0], "ky": (h or cs[1] * ky) / cs[1], "co": co}
            if not self_closing:
                stack.append(group)
            continue
        out.append({"index": index, "tag": tag, "id": attrs.get("id"), "spid": attrs.get("o:spid"),
                    "kind": "vml", "x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2),
                    "picture": attrs.get("type") == "#_x0000_t75" or "<v:imagedata" in xml[m.start():m.start() + 600],
                    "fallback": fallback > 0, "start": m.start()})
        index += 1
    return out


def is_cell(place):
    return CELL_W[0] <= place["w"] <= CELL_W[1] and CELL_H[0] <= place["h"] <= CELL_H[1]


def cells(xml):
    """Места бланка, которые помечаются при разметке, в порядке документа.

    Для фигур VML отбор по размеру клетки кода: надпись в рисунке или рамке Word не принимает.
    Фигуры DrawingML берутся все – рисунки в этой записи имеют другой тег (<pic:pic>), а размер
    вложенной фигуры задан в координатах группы и по нему клетку не отличить; лишние метки потом
    отсеет печать (они не попадут ни в одну клетку бланка).
    Запасная копия фигур (<mc:Fallback>) пропускается: Word печатает основную запись.
    """
    return [p for p in places(xml)
            if not p["picture"] and not p["fallback"] and (p["kind"] == "dml" or is_cell(p))]


def tables(path, part="word/document.xml"):
    """Ячейки таблиц (бланки ИПК): [{'table': i, 'row': r, 'cell': c, 'text': …}]."""
    from xml.etree import ElementTree as ET
    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    root = ET.fromstring(zipfile.ZipFile(path).read(part))
    body = root.find(W + "body")
    out = []
    for ti, tbl in enumerate(body.iter(W + "tbl")):
        for ri, tr in enumerate(tbl.findall(W + "tr")):
            for ci, tc in enumerate(tr.findall(W + "tc")):
                text = " ".join(s for s in ("".join(t.text or "" for t in p.iter(W + "t")).strip()
                                            for p in tc.iter(W + "p")) if s)
                out.append({"table": ti, "row": ri, "cell": ci, "text": text})
    return out
