"""Rebuild source records from the supplied PDF; never generate assessment text.

Usage: python tools/ingest.py /path/to/Biology_2e_Section_12_2.pdf
Dependency: pdfplumber==0.11.9 (including its Pillow/pypdfium2 renderer).
"""
from pathlib import Path
import hashlib
import json
import math
import re
import shutil
import sys

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DPI = 144
SOURCE_ID = "b2e-12-2"
EXPECTED_SOURCE_SHA256 = "4beec1826a156c86ab1e45e8dbb015e031991708d125ad78fe80d4519d42dc04"
URL = "https://openstax.org/books/biology-2e/pages/12-2-characteristics-and-traits"

def write(name, value):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

CONCEPT_SPECS = [
    ("genes-alleles-ploidy", "Genes, alleles, and ploidy", "基因、等位基因与倍性", "Locate alleles on homologous chromosomes and trace haploid gametes to a diploid zygote.", "genotype_phenotype", []),
    ("genotype-phenotype-dominance", "Genotype, phenotype, and complete dominance", "基因型、表型与完全显性", "Distinguish genotype from phenotype, homozygotes from heterozygotes, and dominance from allele loss.", "genotype_phenotype", [1]),
    ("monohybrid-punnett", "Monohybrid crosses and Punnett probabilities", "单因子杂交与庞尼特方格", "Calculate gamete, genotype, and phenotype probabilities, including conditional F2 proportions.", "allele_segregation", [1, 2]),
    ("test-cross", "Test crosses and sampling uncertainty", "测交与抽样不确定性", "Infer an unknown dominant-expressing genotype using a recessive tester and interpret finite samples.", "genotype_phenotype", [2, 3]),
    ("recessive-pedigrees", "Recessive pedigrees and carrier inference", "隐性遗传家系与携带者推断", "Use a recessive pedigree to infer obligate carriers while retaining genuinely unknown genotypes.", "genotype_phenotype", [2, 3]),
    ("incomplete-dominance", "Incomplete dominance", "不完全显性", "Predict intermediate heterozygotes and distinguish intermediate phenotype from irreversible allele blending.", "incomplete_dominance", [2, 3]),
    ("codominance", "Codominance and MN blood groups", "共显性与 MN 血型", "Explain simultaneous expression of both alleles and predict distinct MN phenotypes.", "codominance", [2, 3]),
    ("multiple-alleles", "Multiple alleles, wild type, and gene-product effects", "复等位基因、野生型与基因产物效应", "Distinguish population diversity from individual copy number; interpret rabbit alleles, mutant dominance, and the haploid parasite example.", "multiple_alleles", [1, 2]),
    ("x-linked-inheritance", "X-linked inheritance and hemizygosity", "X 连锁遗传与半合子", "Trace X-linked alleles by offspring sex, distinguish reciprocal crosses, and interpret carriers within the stated model.", "sex_linkage", [1, 2, 3]),
    ("lethal-alleles", "Lethal alleles and survival-conditioned ratios", "致死等位基因与存活者比例", "Distinguish recessive from dominant lethality, normalize survivor ratios, and explain delayed-onset transmission.", "lethality", [2, 3]),
]

def cid(n):
    return f"b2e-12-2-concept-{n:02}"

HEADINGS = {
    "12.2 Characteristics and Traits": ("Introduction: genes and alleles", [1]),
    "Phenotypes and Genotypes": (None, [2]),
    "Dominant and Recessive Alleles": (None, [2]),
    "The Punnett Square Approach for a Monohybrid Cross": (None, [3, 1, 2]),
    "The Test Cross Distinguishes the Dominant Phenotype": (None, [4, 2, 3]),
    "Alternatives to Dominance and Recessiveness": (None, [2, 6, 7]),
    "Incomplete Dominance": (None, [6, 2, 3]),
    "Codominance": (None, [7, 2, 3]),
    "Multiple Alleles": (None, [8, 1, 2]),
    "Multiple Alleles Confer Drug Resistance in the Malaria Parasite": (None, [8, 1]),
    "X-Linked Traits": (None, [9, 1, 2, 3]),
    "Human Sex-linked Disorders": (None, [9, 2]),
    "Lethality": (None, [10, 2, 3]),
}

def bbox(lines):
    return [min(l["x0"] for l in lines), min(l["top"] for l in lines), max(l["x1"] for l in lines), max(l["bottom"] for l in lines)]

def px(box):
    return [math.floor(box[0] * 2), math.floor(box[1] * 2), math.ceil(box[2] * 2), math.ceil(box[3] * 2)]

def main(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != EXPECTED_SOURCE_SHA256:
        raise ValueError("This ingestion recipe is pinned to the supplied PDF. Review the layout, chapter boundaries and evidence before adapting it to another source.")
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "assets/figures").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets/pages").mkdir(parents=True, exist_ok=True)
    target = ROOT / "assets/Biology_2e_Section_12_2.pdf"
    if source.resolve() != target.resolve():
        shutil.copyfile(source, target)
    chunks, figures, pages, exclusions = [], [], [], []
    subtitle, concepts, kind = "Introduction: genes and alleles", [1], "paragraph"
    active_section = False
    document = pdfplumber.open(source)
    assert len(document.pages) == 12, "This manifest is specific to the supplied 12-page excerpt."
    for page_number, page in enumerate(document.pages, 1):
        lines = page.extract_text_lines(x_tolerance=2, y_tolerance=3, return_chars=False)
        full_image = page.to_image(resolution=DPI).original.convert("RGB")
        image_path = f"assets/pages/page-{page_number:02}.png"
        full_image.save(ROOT / image_path, optimize=True)
        pages.append(dict(page=page_number, printed_page=315 + page_number, width_points=page.width, height_points=page.height, width_pixels=full_image.width, height_pixels=full_image.height, image_path=image_path))
        groups, group = [], []
        def flush():
            nonlocal group
            if group:
                groups.append(group)
                group = []
        for line in lines:
            text = line["text"]
            if line["top"] < 40 or text == "Access for free at openstax.org":
                exclusions.append(dict(page=page_number, text=text, reason="running_header_or_footer", bbox_points=bbox([line])))
                continue
            if text == "12.2 Characteristics and Traits":
                active_section = True
            if text == "12.3 Laws of Inheritance":
                flush()
                active_section = False
            if not active_section:
                exclusions.append(dict(page=page_number, text=text, reason="outside_section_12.2", bbox_points=bbox([line])))
                continue
            special = text in HEADINGS or text in ["LEARNING OBJECTIVES", "VISUAL CONNECTION", "EVOLUTION CONNECTION", "LINK TO LEARNING"]
            table_line = page_number == 2 and line["top"] < 300
            if group and not table_line and (special or group[-1]["text"] in HEADINGS or group[-1]["text"] in ["LEARNING OBJECTIVES", "VISUAL CONNECTION", "EVOLUTION CONNECTION", "LINK TO LEARNING"] or line["top"] - group[-1]["bottom"] > 6):
                flush()
            group.append(line)
        flush()
        # Image XObjects contain the complete textbook diagrams including labels.
        captions = [g for g in groups if g[0]["text"].startswith("FIGURE ")]
        assert len(page.images) == len(captions), f"Image/caption count mismatch on PDF page {page_number}"
        for im, cap in zip(page.images, captions):
            number = re.match(r"FIGURE (12\.\d+)", cap[0]["text"])[1]
            box = [im["x0"], im["top"], im["x1"], im["bottom"]]
            file = f"assets/figures/figure-{number.replace('.', '-')}.png"
            crop = full_image.crop(px(box))
            crop.save(ROOT / file, optimize=True)
            text = "\n".join(l["text"] for l in cap)
            figures.append(dict(id=f"b2e-12-2-figure-{number.replace('.', '-')}", source_id=SOURCE_ID, type="figure", label=f"Figure {number}", page=page_number, printed_page=315+page_number, section="12.2", bbox=px(box), bbox_points=box, image_path=file, image_width=crop.width, image_height=crop.height, caption=text, credit=text[text.index("(credit"):] if "(credit" in text else None, concept_ids=[], chunk_ids=[], figure_text_status="labels_preserved_in_image_not_ocr_transcribed"))
        if page_number == 2:
            table = [l for l in lines if 60 < l["top"] < 300]
            box = [185, 57, 455, 301]
            file = "assets/figures/table-12-4.png"
            crop = full_image.crop(px(box))
            crop.save(ROOT / file, optimize=True)
            figures.append(dict(id="b2e-12-2-table-12-4", source_id=SOURCE_ID, type="table", label="Table 12.4", page=2, printed_page=317, section="12.2", bbox=px(box), bbox_points=box, image_path=file, image_width=crop.width, image_height=crop.height, caption="Human Inheritance in Dominant and Recessive Patterns", raw_text="\n".join(l["text"] for l in table), columns=["Dominant Traits", "Recessive Traits"], rows=[["Achondroplasia", "Albinism"], ["Brachydactyly", "Cystic fibrosis"], ["Huntington’s disease", "Duchenne muscular dystrophy"], ["Marfan syndrome", "Galactosemia"], ["Neurofibromatosis", "Phenylketonuria"], ["Widow’s peak", "Sickle-cell anemia"], ["Wooly hair", "Tay-Sachs disease"]], credit=None, concept_ids=[], chunk_ids=[]))
        for index, g in enumerate(groups, 1):
            first = g[0]["text"]
            if first in HEADINGS:
                title, concepts = HEADINGS[first]
                subtitle = title or first
                kind = "heading"
            elif first == "LEARNING OBJECTIVES": kind = "heading"
            elif first.startswith("By the end of this section"): kind = "learning_objective"
            elif first.startswith("FIGURE "): kind = "figure_caption"
            elif page_number == 2 and g[0]["top"] < 300: kind = "table"
            elif first.startswith(("In pea plants, round peas", "What are the genotypes", "What ratio of offspring")): kind = "exercise"
            elif first in ["VISUAL CONNECTION", "EVOLUTION CONNECTION", "LINK TO LEARNING"] or first.startswith(("Watch this video", "Access multimedia")): kind = "context"
            elif page_number == 8 and g[0]["top"] > 705: kind = "footnote"
            else: kind = "paragraph"
            local_concepts = [5, 2, 3] if (page_number == 4 and first.startswith("Many human")) or (page_number == 5 and g[0]["top"] < 400) else concepts
            if kind == "learning_objective": local_concepts = list(range(1, 11))
            if kind == "footnote": local_concepts = [8]
            text = "\n".join(l["text"] for l in g)
            refs = [f"b2e-12-2-figure-{n.replace('.', '-')}" for n in re.findall(r"(?:Figure|FIGURE)\s+(12\.\d+)", text)]
            if re.search(r"(?:Table|TABLE)\s+12\.4", text): refs.append("b2e-12-2-table-12-4")
            # The exercise directly below the diagram uses it even without repeating its number.
            if kind == "exercise": refs += {4:["b2e-12-2-figure-12-5"],5:["b2e-12-2-figure-12-6"],10:["b2e-12-2-figure-12-12"]}.get(page_number, [])
            chunks.append(dict(id=f"b2e-12-2-p{page_number:02}-c{index:02}", source_id=SOURCE_ID, page=page_number, printed_page=315+page_number, section="12.2", subsection="Recessive pedigrees" if local_concepts[0] == 5 else subtitle, kind=kind, primary_concept_id=cid(local_concepts[0]), raw_text=text, normalized_text=re.sub(r"\s+", " ", text).strip(), concept_ids=[cid(n) for n in local_concepts], bbox=px(bbox(g)), regions=[dict(page=page_number, bbox=px(bbox([l])), bbox_points=[round(n,4) for n in bbox([l])]) for l in g], figure_ids=sorted(set(refs)), previous_chunk_id=None, next_chunk_id=None, continuation_of=None))
    valid_figures = {f["id"] for f in figures}
    for i,c in enumerate(chunks):
        assert set(c["figure_ids"]) <= valid_figures
        c["previous_chunk_id"] = chunks[i-1]["id"] if i else None
        c["next_chunk_id"] = chunks[i+1]["id"] if i+1 < len(chunks) else None
        if i and c["kind"] == "paragraph" and chunks[i-1]["kind"] == "paragraph" and c["page"] == chunks[i-1]["page"] + 1 and c["raw_text"][0].islower():
            c["continuation_of"] = chunks[i-1]["id"]
    for f in figures:
        linked = [c for c in chunks if f["id"] in c["figure_ids"]]
        f["chunk_ids"] = [c["id"] for c in linked]
        f["concept_ids"] = sorted({v for c in linked for v in c["concept_ids"]})
    concepts_out = [dict(id=cid(i), slug=s[0], name=s[1], name_zh=s[2], learning_objective=s[3], legacy_topic=s[4], prerequisite_ids=[cid(n) for n in s[5]], chunk_ids=[c["id"] for c in chunks if c["primary_concept_id"]==cid(i) and c["kind"] in ["paragraph","figure_caption","table","exercise"]]) for i,s in enumerate(CONCEPT_SPECS,1)]
    source_meta = dict(schema_version="1.0.0", id=SOURCE_ID, title="Biology 2e — 12.2 Characteristics and Traits", authors=["Mary Ann Clark", "Matthew Douglas", "Jung Choi"], publisher="OpenStax", language="en", section="12.2", section_url=URL, source_file="assets/Biology_2e_Section_12_2.pdf", source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), supplied_pdf_page_count=12, printed_page_range=[316,327], page_numbering="page is 1-based within the supplied 12-page PDF; printed_page is the textbook page. Full-book PDF indices are intentionally not inferred.", coordinate_system=dict(origin="top-left", bbox_order=["x0","y0","x1","y1"], unit="pixel", render_dpi=DPI, points_per_inch=72, scale_pixels_per_point=2, rounding="floor left/top; ceil right/bottom", regions="one rectangle per extracted text line; bbox is their enclosing rectangle"), pages=pages, extraction=dict(tool="pdfplumber", version=pdfplumber.__version__, method="native PDF text lines and image XObject boundaries; 144-DPI page-render crops", raw_text_policy="line breaks, punctuation and PDF extraction artifacts retained; normalized_text only collapses whitespace", scope="starts at 12.2 heading on page 1; stops before 12.3 heading on page 12", excluded_lines=exclusions), attribution="OpenStax, Biology 2e, Section 12.2. Access for free at "+URL, rights=dict(license="CC BY-NC-SA 4.0", license_url="https://creativecommons.org/licenses/by-nc-sa/4.0/", licensing_source=URL, checked_on="2026-10-28", third_party_figures="Retain individual caption credits; third-party rights may differ.", changes="Extracted excerpt text, line coordinates, page renders and figure/table crops; authored learning taxonomy and assessment items."), content_notes=[dict(id="pod-color-example", chunk_ids=[c["id"] for c in chunks if "yellow pods" in c["raw_text"]], note="The supplied text describes yellow pods as dominant. Preserve its raw wording, but do not use this pod-color statement as an assessed biological fact; seed-color examples are used instead."),dict(id="rabbit-chinchilla", note="The text describes chinchilla as incompletely dominant over Himalayan and albino. Do not silently replace it with a simplified complete-dominance hierarchy."),dict(id="human-examples", note="Questions use explicitly stated single-gene teaching models; do not infer real clinical penetrance or simplify all human traits in Table 12.4 into diagnostic rules.")])
    write("source.json", source_meta)
    write("concepts.json", concepts_out)
    write("chunks.json", chunks)
    write("figures.json", figures)
    print(f"Extracted {len(chunks)} chunks, {len(figures)} figures/tables, {len(concepts_out)} concepts from {len(pages)} pages.")

if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT / "assets/Biology_2e_Section_12_2.pdf")
