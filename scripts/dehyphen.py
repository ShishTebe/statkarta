"""Исправление переносов из верстки: «следова- теля» → «следователя», «организационно- правовой» → «организационно-правовой».

Решение принимается по словарю самих источников (УК РФ, бланки, сборники справочников): если в них
встречается слитное написание – склеиваем без дефиса; если встречается написание через дефис – с дефисом.
Если нет ни того, ни другого: левая часть на «-о»/«-е» или латиница и цифры – дефис, иначе слитно.
Конструкции «радио- и телевидение» не трогаются.
"""
import re
from pathlib import Path
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ["data-private/sources/uk-rf.txt", "data-private/sources/blanks-2026.txt", "data-private/sources/sprav-2025.layout.txt",
           "data-private/sources/sprav-2026.layout.txt", "data-private/sources/razj-gp-2025-07-01.txt"]
PAT = re.compile(r"([A-Za-zА-Яа-яЁё0-9]+)-\s+([A-Za-zА-Яа-яЁё]+)")
SPACE_BEFORE = re.compile(r"([А-Яа-яЁё])\s+-([А-Яа-яЁё])")


@lru_cache(maxsize=1)
def vocab():
    words, hyph = set(), set()
    for rel in SOURCES:
        p = ROOT / rel
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8", errors="ignore").lower().replace("ё", "е")
        t = PAT.sub(lambda m: m.group(0), t)
        words.update(re.findall(r"[a-zа-я0-9]+", t))
        hyph.update(re.findall(r"[a-zа-я0-9]+-[a-zа-я0-9]+", t))
    return words, hyph


def fix(s):
    if not isinstance(s, str) or "-" not in s:
        return s
    words, hyph = vocab()

    def rep(m):
        left, right = m.group(1), m.group(2)
        if right.lower() in ("и", "или", "либо", "а"):
            return m.group(0)
        joined, hy = (left + right).lower().replace("ё", "е"), f"{left}-{right}".lower().replace("ё", "е")
        if hy in hyph and joined not in words:
            return f"{left}-{right}"
        if joined in words:
            return left + right
        if re.search(r"[оеOE0-9A-Za-z]$", left) and len(left) > 2 or len(left) <= 2 or left[:1].isupper() and left.isupper():
            return f"{left}-{right}"
        return left + right

    s = PAT.sub(rep, s)
    return SPACE_BEFORE.sub(r"\1-\2", s)


if __name__ == "__main__":
    for t in ["следова- теля", "организационно- правовой", "интернет- мессенджеров", "Н- индазол", "радио- и телевидение",
              "преступле- ний", "пре- ступная", "Северо -Кавказскому", "социально- экономического", "стран- участников", "ме- сяцев", "о- п"]:
        print(t, "→", fix(t))


def split_glued(s):
    """«ценныебумаги» → «ценные бумаги»: слово, которого нет в словаре источников, делится на известные слова."""
    if not isinstance(s, str):
        return s
    words, _ = vocab()

    @lru_cache(maxsize=4096)
    def seg(t):
        if t in words and (len(t) >= 3 or t in ("и", "в", "с", "к", "о")):
            return [t]
        if len(t) < 3:
            return None
        best = None
        for i in range(len(t) - 2, 1, -1):
            left = t[:i]
            if left in words and (len(left) >= 3 or left in ("и", "в", "с", "к", "о", "из", "за", "по", "на", "от", "до")):
                rest = seg(t[i:])
                if rest and (best is None or len(rest) + 1 < len(best)):
                    best = [left] + rest
        return best

    def rep(m):
        w = m.group(0)
        low = w.lower().replace("ё", "е")
        if len(w) < 11 or low in words:
            return w
        parts = seg(low)
        if not parts or len(parts) < 2 or len(parts) > 6:
            return w
        out, pos = [], 0
        for part in parts:
            out.append(w[pos:pos + len(part)])
            pos += len(part)
        return " ".join(out)

    return re.sub(r"[а-яё]{11,}", rep, s)
