"""Refresh derived lookup tables and file hashes after an intentional data edit."""
from collections import Counter
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text(encoding="utf-8"))
def write(path,data):(ROOT/path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")

def main():
    question_files=["questions/concepts-01-03.json","questions/concepts-04-06.json","questions/concepts-07-10.json","questions/integrated.json"]
    collections={"concepts":"concepts.json","chunks":"chunks.json","figures":"figures.json","combinations":"combinations.json","questions":question_files}
    concepts=read("concepts.json");chunks=read("chunks.json");figures=read("figures.json")
    questions=[q for path in question_files for q in read(path)]
    eligible={"paragraph","figure_caption","table","exercise","learning_objective","footnote"}
    index=dict(schema_version="1.0.0",source_id="b2e-12-2",concept_to_chunk_ids={c["id"]:[v["id"] for v in chunks if c["id"] in v["concept_ids"] and v["kind"] in eligible] for c in concepts},concept_to_question_ids={c["id"]:[q["id"] for q in questions if c["id"] in q["concept_ids"]] for c in concepts},chunk_to_question_ids={c["id"]:[q["id"] for q in questions if c["id"] in q["chunk_ids"]] for c in chunks},figure_to_chunk_ids={f["id"]:f["chunk_ids"] for f in figures})
    write("retrieval-index.json",index)
    files=[]
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path.name in ["catalog.json","validation-report.json"]:continue
        relative=path.relative_to(ROOT).as_posix()
        if path.suffix==".pyc":continue
        entry=dict(path=relative,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size)
        if relative in ["concepts.json","chunks.json","figures.json","combinations.json"]+question_files:entry["record_count"]=len(read(relative))
        files.append(entry)
    write("catalog.json",dict(schema_version="1.0.0",id="b2e-12-2",title="Biology 2e Section 12.2 static content database",source="source.json",schema="schema.json",retrieval_index="retrieval-index.json",collections=collections,language="en",concept_label_languages=["en","zh"],counts=dict(concepts=len(concepts),chunks=len(chunks),figures=sum(f["type"]=="figure" for f in figures),tables=sum(f["type"]=="table" for f in figures),single_concept_questions=sum(q["question_type"]=="single_concept" for q in questions),integrated_questions=sum(q["question_type"]=="integrated" for q in questions),total_questions=len(questions),combinations=len(read("combinations.json"))),difficulty_definitions=dict(easy="Recognize or directly interpret one concept.",medium="Apply a stated rule to a new cross, observation, or short inference.",hard="Combine several reasoning steps within the target concept, handle conditioning or uncertainty, or evaluate competing models."),assessment_notes=["All items have four options and exactly one intended correct answer.","Single-concept items may apply prerequisites while assessing one primary concept.","Each integrated item assesses exactly three concepts and records a reasoning step for each.","Questions are original AI-assisted educational items reviewed by authoring and coordinating agents, not copied textbook exercises or empirically calibrated assessments.","Hypothetical scenarios are distinguished from source quotations through assumptions and evidence fields.","The existing UI and its legacy question bank are unchanged. This dataset can be imported explicitly by a future adapter.","This is RAG-ready ingestion and deterministic lookup data; no embedding model or vector search is claimed."],file_hash_policy="SHA-256 of committed files; catalog.json and validation-report.json are excluded to avoid self-reference. Refresh after intentional edits, then run validation.",files=files))
    print(f"Refreshed retrieval index and catalog for {len(questions)} questions / {len(files)} files.")

if __name__=="__main__":main()
