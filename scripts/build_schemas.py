"""Генерация JSON-схем пакетов данных (data/schema/*.schema.json)."""
import json
from pathlib import Path

S = Path(__file__).resolve().parents[1] / "data/schema"
DATE = {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
STR = {"type": "string"}
NSTR = {"type": ["string", "null"]}
SCOPE = {"enum": ["case", "crime", "person", "victim", "card", "event", "profile"]}
FORM_ID = {"type": "string", "pattern": "^(\\d+(\\.\\d+)?|ipk|ipk-in)$"}


def obj(req, props):
    return {"type": "object", "required": req, "properties": props}


def arr(items, **kw):
    return {"type": "array", "items": items, **kw}


def enum(*v):
    return {"enum": list(v)}


def top(title, key, item, extra_req=("edition",)):
    return {"title": title, **obj(list(extra_req) + [key], {key: arr(item)})}


SCHEMAS = {
    "form": {"title": "Пакет формы статистической карточки", **obj(
        ["form", "title", "edition", "effective_from", "requisites_count", "requisites"],
        {"form": FORM_ID, "variants": arr(obj(["id", "title"], {"id": STR, "title": STR})), "title": STR, "edition": STR, "effective_from": DATE,
         "effective_to": NSTR, "legal_basis": STR, "source": STR, "requisites_count": {"type": "integer"},
         "requisites": arr(obj(["id", "number", "label", "label_status", "field_type", "options", "fills_by"], {
             "id": {"type": "string", "pattern": "^(\\d+(\\.\\d+)*(~\\d+)?|[a-z][a-z_]*)$"}, "number": STR, "variants": arr(STR),
             "label": {"type": "string", "minLength": 2}, "label_status": enum("source", "derived", "corrected", "verified", "needs_review"),
             "correction_source": STR,
             "field_type": enum("enum", "classifier", "date", "text"), "classifier_no": {"type": ["integer", "null"]},
             "multiple": {"type": ["boolean", "null"]}, "has_text": {"type": "boolean"}, "has_date": {"type": "boolean"},
             "section": NSTR, "fills_by": enum("investigator", "registrar", "ic", "head", "court"), "raw": NSTR,
             "input": obj([], {"code_digits": {"type": "integer"}, "fields": {"type": "integer"}, "select": enum("single", "multiple", "overlay", "overlay_slots"),
                               "max_codes": {"type": "integer"}, "max_chars": {"type": "integer"}, "lookup": STR,
                               "fills": arr(obj(["label", "type"], {"label": STR, "type": enum("number", "text", "date"), "unit": STR, "digits_exact": {"type": "integer"}, "for_code": STR,
                                                                    "for_codes": arr(STR), "key": STR})), "sources": arr(STR)}),
             "options": arr(obj(["code", "value"], {"code": STR, "value": STR, "group": NSTR, "hint": STR}))})),
         "embedded_classifiers": arr(obj(["id", "title", "applies_to", "options"], {"id": STR, "title": STR, "applies_to": arr(STR),
                                                                                  "options": arr(obj(["code", "value"], {"code": STR, "value": STR, "group": NSTR, "hint": STR}))}))})},
    "classifier": {"title": "Пакет справочника", **obj(
        ["no", "title", "edition", "effective_from", "count", "entries"],
        {"no": {"type": "integer"}, "title": STR, "edition": STR, "effective_from": DATE, "effective_to": NSTR, "source": STR,
         "count": {"type": "integer"},
         "notes": arr(obj(["mark", "text"], {"mark": STR, "text": STR})),
         "entries": arr(obj(["code", "name"], {"code": {"type": "string", "minLength": 1}, "name": {"type": "string", "minLength": 1}, "section": STR,
                                             "path": arr(STR), "group": {"type": "boolean"}, "notes": arr(STR), "active": {"type": "boolean"},
                                             "availability": STR, "source": enum("word")}))})},
    "facts": top("Словарь фактов", "facts", obj(["id", "entity", "type", "label", "status"], {
        "id": {"type": "string", "pattern": "^fact\\.[a-z0-9_.]+$"}, "entity": STR, "type": STR,
        "scope": SCOPE, "classifier_no": {"type": ["integer", "null"]}, "shared": {"type": "boolean"}, "label": STR, "status": enum("draft", "approved")})),
    "questions": top("Вопросы опросника", "questions", obj(["id", "text", "why", "answer", "ask_when", "sets", "allow_unknown", "status"], {
        "id": {"type": "string", "pattern": "^q\\."}, "text": STR, "why": STR, "answer": obj(["type"], {"type": STR}),
        "ask_when": {"type": "object"}, "sets": arr(STR, minItems=1), "allow_unknown": {"type": "boolean"},
        "status": enum("draft", "approved"), "review": enum("pending", "done")})),
    "mapping": top("Сопоставление фактов и реквизитов", "mapping", obj(["id", "form", "requisite", "source_note", "status"], {
        "id": STR, "form": STR, "requisite": STR, "value_from": NSTR, "value_hint_from": NSTR,
        "status_value": enum("fills_ic", "fills_registrar", "fills_court", "default", "hint"), "source_note": STR,
        "match": enum("shared", "direct"), "scope": SCOPE,
        "status": enum("draft", "approved")})),
    "derived": top("Производные значения", "derived", obj(["id", "sets", "expr", "status_value", "source_note"], {
        "id": STR, "sets": STR, "expr": {"type": "object"}, "status_value": enum("default", "hint"), "source_note": STR})),
    "checks": top("Контрольные соотношения", "checks", obj(["id", "forms", "scope", "severity", "when", "assert", "message", "source_note"], {
        "id": {"type": "string", "pattern": "^c\\."}, "forms": arr(STR, minItems=1), "scope": enum("card", "package"),
        "per": enum("case", "crime"), "severity": enum("error", "warning"),
        "when": {"type": "object"}, "assert": {"type": "object"}, "message": STR, "source_note": STR})),
    "events": top("События дела и состав пакета карточек", "events", obj(["id", "title", "final", "cards", "source_note", "status"], {
        "id": {"type": "string", "pattern": "^ev\\.[a-z_]+$"}, "title": STR, "hint": STR,
        "final": {"type": ["boolean", "object"]},
        "refs": obj([], {"crimes": enum("required", "optional", "none"), "persons": enum("required", "optional", "none"),
                         "victims": enum("required", "optional", "none")}),
        "attrs": arr(obj(["id", "label", "type"], {"id": {"type": "string", "pattern": "^[a-z_]+$"}, "label": STR,
                                                   "type": enum("enum", "boolean", "text", "date"), "required": {"type": "boolean"},
                                                   "options": arr(obj(["code", "value"], {"code": STR, "value": STR})), "sets": STR})),
        "sets_facts": arr(obj(["fact"], {"fact": STR, "from": STR, "value": {}, "note": STR})),
        "cards": arr(obj(["form", "per"], {"form": FORM_ID, "variant": STR,
                                           "per": enum("case", "crime", "person", "victim", "person_crime", "crime_without_person", "foreign_participant"),
                                           "when": {"type": "object"}, "note": STR, "source_note": STR,
                                           "requisites": arr(STR), "optional_requisites": arr(STR), "requisites_note": STR,
                                           "card_fills": arr(obj(["requisite", "index", "from"], {"requisite": STR, "index": {"type": "integer"}, "from": STR})),
                                           "card_facts": arr(obj(["fact", "value"], {"fact": STR, "value": {}}))})),
        "optional_cards": arr(obj(["form", "per"], {"form": FORM_ID, "per": STR, "note": STR})),
        "action": enum("spawn_case"), "reopens": {"type": "boolean"},
        "source_note": STR, "status": enum("draft", "confirmed")}), extra_req=("edition", "status", "object_attrs")),
    "hints": top("Подсказки кодов", "hints", obj(["id", "fact", "when", "codes", "text", "source_note"], {
        "id": {"type": "string", "pattern": "^h\\."}, "fact": STR, "when": {"type": "object"}, "codes": arr(STR, minItems=1), "text": STR, "source_note": STR})),
    "availability": top("Неактивность вопросов", "availability", obj(["id", "facts", "disabled_when", "reason", "source_note"], {
        "id": {"type": "string", "pattern": "^a\\."}, "facts": arr(STR, minItems=1), "disabled_when": {"type": "object"}, "reason": STR, "source_note": STR})),
    "extract": top("Правила извлечения", "extract", obj(["id", "doc_type", "field", "label", "kind", "parts", "patterns", "confidence"], {
        "id": {"type": "string", "pattern": "^x\\."}, "doc_type": STR, "field": NSTR, "label": STR,
        "kind": enum("text", "date", "time", "number", "enum", "case_number", "episodes", "fabula", "victims", "person", "citation", "term", "orgs"),
        "parts": arr(enum("title", "header", "intro", "descriptive", "resolutive"), minItems=1),
        "fallback_parts": arr(enum("title", "header", "intro", "descriptive", "resolutive")),
        "patterns": arr(STR, minItems=1), "values": arr(STR), "confidence": enum("high", "medium", "low"),
        "pattern_confidence": arr(enum("high", "medium", "low")),
        "pick": enum("first", "earliest"), "sentence": STR, "exclude_after": arr(STR), "exclude_before": arr(STR),
        "after_field": STR, "window": {"type": "integer"}, "info": {"type": "boolean"}, "target": {"type": "object"}, "attr": STR, "max_len": {"type": "integer"}, "digits": {"type": "integer"},
        "clause": STR, "person": STR, "unknown_person": STR, "note": STR})),
    "documents": top("Документы дела", "documents", obj(["doc_type", "title", "required_for", "priority", "provides", "detect"], {
        "doc_type": STR, "title": STR, "required_for": arr(STR), "priority": enum("required", "desirable"),
        "provides": arr(STR), "detect": arr(STR, minItems=1)})),
    "legal": top("Нормативная база", "acts", obj(["id", "kind", "date", "title", "summary", "applies_to_forms", "status", "publication"], {
        "id": STR, "kind": STR, "date": DATE, "title": STR, "summary": STR, "applies_to_forms": arr(STR), "status": STR,
        "publication": enum("public", "pending", "private")})),
    "explanations": top("Разъяснения", "notes", obj(["id", "act", "text", "verbatim", "bindings"], {
        "id": STR, "act": STR, "text": {"type": "string", "minLength": 2}, "verbatim": {"type": "boolean"},
        "bindings": arr(obj(["form", "requisite"], {"form": STR, "requisite": STR}))})),
    "uk-articles": {"title": "Статьи УК РФ", **obj(["meta", "articles"], {"meta": {"type": "object"}, "articles": arr(obj(
        ["article", "title", "repealed", "parts"], {"article": {"type": "string", "pattern": "^\\d+(\\.\\d+)?$"}, "title": STR,
         "repealed": {"type": "boolean"}, "parts": arr(obj(["part", "category", "category_source", "lists"], {
             "part": NSTR, "category": enum("small", "medium", "grave", "especially_grave", None),
             "category_source": enum("lists", "computed_only", "conflict"), "lists": arr({"type": "object"})}))}))})},
    "uk-lists": {"title": "Перечни статей УК РФ", **obj(["meta", "lists"], {"meta": {"type": "object"}, "lists": arr(obj(
        ["no", "sections"], {"no": {"type": "integer"}, "sections": arr(obj(["number", "heading", "kind", "items", "text"], {
            "number": STR, "heading": STR, "kind": enum("unconditional", "date", "conditional", "excluded", "other"),
            "items": arr(obj(["article"], {"article": STR})), "text": STR}))}))})},
    "manifest": {"title": "Манифест пакетов данных", **obj(["schema_version", "data_version", "edition", "generated", "files"], {
        "schema_version": {"type": "integer"}, "data_version": STR, "edition": STR, "generated": STR,
        "files": arr(obj(["path", "sha256", "bytes", "schema", "public"], {"path": STR, "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                                                                          "bytes": {"type": "integer"}, "schema": NSTR, "public": {"type": "boolean"}}))})},
}

if __name__ == "__main__":
    S.mkdir(parents=True, exist_ok=True)
    for name, sch in SCHEMAS.items():
        (S / f"{name}.schema.json").write_text(json.dumps({"$schema": "https://json-schema.org/draft/2020-12/schema", **sch}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(SCHEMAS), "схем записано")
