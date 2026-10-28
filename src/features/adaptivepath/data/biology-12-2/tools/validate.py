"""Validate schemas, provenance, quotas, geometry and referential integrity.

Run from any directory: python tools/validate.py [--check-pdf] [--report PATH]
No application server, database service or API key is required.
"""
from collections import Counter
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import struct

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
QUESTION_FILES = ["questions/concepts-01-03.json", "questions/concepts-04-06.json", "questions/concepts-07-10.json", "questions/integrated.json"]

def read(file):
    return json.loads((ROOT / file).read_text(encoding="utf-8"))

def require(condition, message):
    if not condition:
        raise ValueError(message)

def keyed(rows, label):
    result = {r["id"]: r for r in rows}
    require(len(result) == len(rows), f"Duplicate {label} ID")
    return result

def png_size(path):
    content = path.read_bytes()
    require(content[:8] == b"\x89PNG\r\n\x1a\n", f"Not a PNG: {path}")
    return struct.unpack(">II", content[16:24])

def px(box):
    return [math.floor(box[0]*2), math.floor(box[1]*2), math.ceil(box[2]*2), math.ceil(box[3]*2)]

def main(check_pdf=False):
    schema = read("schema.json")
    Draft202012Validator.check_schema(schema)
    files = {"source.json":"source", "concepts.json":"concepts", "chunks.json":"chunks", "figures.json":"figures", "combinations.json":"combinations", **{p:"questions" for p in QUESTION_FILES}}
    for path, definition in files.items():
        selected = {**schema, "$ref":f"#/$defs/{definition}"}
        errors = list(Draft202012Validator(selected).iter_errors(read(path)))
        require(not errors, f"Schema {path}: " + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:5]))
    source = read("source.json")
    concepts = keyed(read("concepts.json"), "concept")
    chunks = keyed(read("chunks.json"), "chunk")
    figures = keyed(read("figures.json"), "figure")
    combinations = keyed(read("combinations.json"), "combination")
    questions = keyed([q for p in QUESTION_FILES for q in read(p)], "question")
    pages = {p["page"]:p for p in source["pages"]}
    require(set(pages) == set(range(1,13)), "Page manifest must cover the 12-page supplied PDF")
    require(source["source_sha256"] == hashlib.sha256((ROOT/source["source_file"]).read_bytes()).hexdigest(), "Source PDF hash mismatch")
    require(len(concepts)==10 and len(questions)==320 and len(combinations)==5, "Expected 10 concepts, 320 questions, 5 combinations")
    def refs(values, target, label):
        require(set(values) <= set(target), f"Dangling reference: {label}: {set(values)-set(target)}")
    def geometry(page, box, label):
        w,h = pages[page]["width_pixels"], pages[page]["height_pixels"]
        require(all(isinstance(n,int) for n in box), f"Pixel box must be integers: {label}")
        require(0 <= box[0] < box[2] <= w and 0 <= box[1] < box[3] <= h, f"Out-of-page box: {label}")
    for p in pages.values():
        require(png_size(ROOT/p["image_path"]) == (p["width_pixels"],p["height_pixels"]), f"Page render size mismatch {p['page']}")
        require(p["printed_page"]==p["page"]+315, "Printed page mapping changed")
    ordered = list(chunks.values())
    for i,c in enumerate(ordered):
        refs(c["concept_ids"], concepts, c["id"])
        refs(c["figure_ids"], figures, c["id"])
        require(c["primary_concept_id"] in c["concept_ids"], f"Primary concept missing: {c['id']}")
        require(c["normalized_text"] == re.sub(r"\s+", " ", c["raw_text"]).strip(), f"Text normalization mismatch: {c['id']}")
        require(len(c["raw_text"].splitlines())==len(c["regions"]), f"One region required per text line: {c['id']}")
        require(c["printed_page"]==c["page"]+315, f"Chunk printed page mismatch: {c['id']}")
        require("12.3 Laws of Inheritance" not in c["raw_text"], "Adjacent section leaked into ingestion")
        geometry(c["page"], c["bbox"], c["id"])
        for r in c["regions"]:
            require(r["page"]==c["page"], "Region page mismatch")
            geometry(r["page"],r["bbox"],c["id"])
            # Point serialization rounds to 4 decimals; integer floor/ceil can differ
            # by one pixel only at an exact boundary after this rounding.
            require(all(abs(a-b)<=1 for a,b in zip(px(r["bbox_points"]),r["bbox"])), f"Point/pixel scale mismatch {c['id']}")
        union=[min(r["bbox"][0] for r in c["regions"]),min(r["bbox"][1] for r in c["regions"]),max(r["bbox"][2] for r in c["regions"]),max(r["bbox"][3] for r in c["regions"])]
        require(union==c["bbox"], f"Enclosing box mismatch {c['id']}")
        require(c["previous_chunk_id"] == (ordered[i-1]["id"] if i else None), "Previous chunk link mismatch")
        require(c["next_chunk_id"] == (ordered[i+1]["id"] if i+1<len(ordered) else None), "Next chunk link mismatch")
        if c["continuation_of"]:
            require(c["continuation_of"]==c["previous_chunk_id"], "Continuation must follow its source fragment")
            require(chunks[c["continuation_of"]]["page"]+1==c["page"], "Continuation page mismatch")
    for f in figures.values():
        refs(f["concept_ids"],concepts,f["id"])
        refs(f["chunk_ids"],chunks,f["id"])
        geometry(f["page"],f["bbox"],f["id"])
        require(px(f["bbox_points"])==f["bbox"], f"Figure scale mismatch: {f['id']}")
        require(png_size(ROOT/f["image_path"])==(f["image_width"],f["image_height"]), f"Crop size mismatch {f['id']}")
        require((f["bbox"][2]-f["bbox"][0],f["bbox"][3]-f["bbox"][1])==(f["image_width"],f["image_height"]), f"Crop dimensions do not match page region {f['id']}")
        require(set(f["chunk_ids"])=={c["id"] for c in ordered if f["id"] in c["figure_ids"]}, f"Reverse figure links mismatch {f['id']}")
    for c in concepts.values():
        refs(c["prerequisite_ids"],concepts,c["id"])
        refs(c["chunk_ids"],chunks,c["id"])
        require(c["id"] not in c["prerequisite_ids"], "Self prerequisite")
    def visit(concept_id, ancestors):
        require(concept_id not in ancestors, "Cyclic concept prerequisites")
        for parent in concepts[concept_id]["prerequisite_ids"]: visit(parent,ancestors|{concept_id})
    for c in concepts: visit(c,set())
    quotas=Counter(); answers=Counter(); prompts=set()
    for q in questions.values():
        refs(q["concept_ids"],concepts,q["id"])
        refs(q["chunk_ids"],chunks,q["id"])
        refs(q["figure_ids"],figures,q["id"])
        require([o["id"] for o in q["options"]]==list("ABCD"),f"Option order/IDs: {q['id']}")
        # Genetic notation is case-sensitive: VV, Vv and vv are distinct options.
        require(len({re.sub(r"\s+", " ", o["text"]).strip() for o in q["options"]})==4, f"Duplicate option text {q['id']}")
        require(len(set(q["option_explanations"].values()))==4, f"Option-specific rationales required {q['id']}")
        require(not q["requires_figure"] or bool(q["figure_ids"]), f"Missing required diagram: {q['id']}")
        if q["requires_figure"]:
            require(all(any(figures[f]["page"]==chunks[c]["page"] or f in chunks[c]["figure_ids"] for c in q["chunk_ids"]) for f in q["figure_ids"]),f"Required figure lacks linked evidence {q['id']}")
        require({e["chunk_id"] for e in q["evidence"]}==set(q["chunk_ids"]), f"Each cited chunk needs quoted evidence: {q['id']}")
        for e in q["evidence"]:
            require(e["quote"] in chunks[e["chunk_id"]]["normalized_text"], f"Non-verbatim evidence: {q['id']} / {e['chunk_id']}")
            require(chunks[e["chunk_id"]]["kind"] not in ["heading","context"], f"Heading/context alone is not answer evidence: {q['id']}")
        prompt=re.sub(r"\s+", " ", q["question"]).strip()
        require(prompt not in prompts, f"Duplicate question stem: {q['id']}")
        prompts.add(prompt); answers[q["correct_answer"]]+=1
        if q["question_type"]=="single_concept":
            require(q["primary_concept_id"]==q["concept_ids"][0],f"Single-concept primary mismatch: {q['id']}")
            quotas[(q["primary_concept_id"],q["difficulty"])]+=1
        else:
            combo=combinations[q["combination_id"]]
            require(set(q["concept_ids"])==set(combo["concept_ids"]), f"Combination concept mismatch: {q['id']}")
            require({s["concept_id"] for s in q["concept_steps"]}==set(q["concept_ids"]),f"Each integrated concept needs an explicit reasoning step: {q['id']}")
            quotas[(combo["id"],q["difficulty"])]+=1
    for c in concepts:
        for d in ["easy","medium","hard"]: require(quotas[(c,d)]==10,f"Expected 10 {d} items for {c}, got {quotas[(c,d)]}")
    for combo in combinations.values():
        refs(combo["chunk_ids"],chunks,combo["id"])
        refs(combo["concept_ids"],concepts,combo["id"])
        require(set(combo["question_ids"])=={q["id"] for q in questions.values() if q["combination_id"]==combo["id"]}, "Combination reverse question links mismatch")
        for d in ["medium","hard"]: require(quotas[(combo["id"],d)]==2,f"Expected two {d} items per combination")
    require(all(60 <= answers[l] <=100 for l in "ABCD"), f"Extreme answer-position imbalance: {answers}")
    index=read("retrieval-index.json")
    eligible={"paragraph","figure_caption","table","exercise","learning_objective","footnote"}
    require(index["concept_to_chunk_ids"]=={c:[v["id"] for v in ordered if c in v["concept_ids"] and v["kind"] in eligible] for c in concepts},"Stale concept-to-chunk index")
    require(index["concept_to_question_ids"]=={c:[q["id"] for q in questions.values() if c in q["concept_ids"]] for c in concepts},"Stale concept-to-question index")
    require(index["chunk_to_question_ids"]=={c:[q["id"] for q in questions.values() if c in q["chunk_ids"]] for c in chunks},"Stale chunk-to-question index")
    require(index["figure_to_chunk_ids"]=={f["id"]:f["chunk_ids"] for f in figures.values()},"Stale figure-to-chunk index")
    pdf_checks = "not_requested"
    if check_pdf:
        import pdfplumber
        from PIL import Image, ImageChops
        with pdfplumber.open(ROOT/source["source_file"]) as doc:
            def line_key(page,text,box): return (page,text,tuple(round(n,4) for n in box))
            expected=Counter(line_key(i,l["text"],[l["x0"],l["top"],l["x1"],l["bottom"]]) for i,p in enumerate(doc.pages,1) for l in p.extract_text_lines(x_tolerance=2,y_tolerance=3,return_chars=False))
            actual=Counter(line_key(c["page"],text,r["bbox_points"]) for c in ordered for text,r in zip(c["raw_text"].splitlines(),c["regions"]))
            actual.update(line_key(e["page"],e["text"],e["bbox_points"]) for e in source["extraction"]["excluded_lines"])
            require(expected==actual, f"Source-line coverage failure: missing={list((expected-actual).elements())[:2]}, extra={list((actual-expected).elements())[:2]}")
            for page in pages.values():
                rerender=doc.pages[page["page"]-1].to_image(resolution=144).original.convert("RGB")
                stored=Image.open(ROOT/page["image_path"]).convert("RGB")
                require(ImageChops.difference(rerender,stored).getbbox() is None,f"Stored page differs from PDF render: {page['page']}")
                for f in figures.values():
                    if f["page"]==page["page"]:
                        crop=Image.open(ROOT/f["image_path"]).convert("RGB")
                        require(ImageChops.difference(stored.crop(f["bbox"]),crop).getbbox() is None,f"Figure is not its claimed page crop: {f['id']}")
        pdf_checks="passed: every source line accounted for; all renders and crops pixel-matched"
    catalog=read("catalog.json")
    for artifact in catalog["files"]:
        path=ROOT/artifact["path"]
        require(path.is_file(),f"Missing catalog file {path}")
        require(hashlib.sha256(path.read_bytes()).hexdigest()==artifact["sha256"],f"Catalog hash mismatch {path}")
        if "record_count" in artifact:require(len(read(artifact["path"]))==artifact["record_count"],f"Catalog count mismatch {path}")
    return dict(status="passed",source_id=source["id"],source_sha256=source["source_sha256"],counts=dict(pages=len(pages),concepts=len(concepts),chunks=len(chunks),figures=sum(f["type"]=="figure" for f in figures.values()),tables=sum(f["type"]=="table" for f in figures.values()),single_concept_questions=300,integrated_questions=20,total_questions=len(questions),combinations=len(combinations)),answer_positions=dict(sorted(answers.items())),checks=["JSON Schema Draft 2020-12","unique IDs and question stems","source SHA-256 and catalog file hashes","all foreign keys and evidence quotes","all concept/difficulty quotas","option IDs, unique options and option rationales","three explicit concept steps per integrated item","pixel bounds, crop sizes and point conversion","printed page mapping and adjacent-section exclusion","bidirectional figure and combination links","all four derived retrieval lookup tables","acyclic prerequisites and chunk adjacency"],pdf_checks=pdf_checks,limitations="Structural and provenance validation does not prove biological correctness, semantic uniqueness, or empirical difficulty. Items received author and cross-agent content review; difficulty is a designed level, not a calibrated measurement.")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-pdf",action="store_true")
    parser.add_argument("--report",type=Path)
    args=parser.parse_args()
    result=main(args.check_pdf)
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    print(json.dumps(result,ensure_ascii=False,indent=2))
