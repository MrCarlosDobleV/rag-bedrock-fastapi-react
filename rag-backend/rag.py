from pathlib import Path
from typing import List, Tuple, Optional, Dict
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_aws import BedrockEmbeddings

DATA_DIR = Path(__file__).parent / "data"
INDEX_DIR = DATA_DIR / "indexes"

# Small + fast, good for local dev
# EMBEDDINGS = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
BEDROCK_REGION = "us-east-2"  # must match your aws configure region (or set explicitly)
EMBEDDINGS = BedrockEmbeddings(
    region_name=BEDROCK_REGION,
    model_id="amazon.titan-embed-text-v2:0",
)

def ingest_pdf(pdf_path: Path, paper_id: str, title: str) -> int:
    """
    Loads PDF with page metadata, chunks it, builds FAISS index, saves to disk.
    Returns number of chunks indexed.
    """
    loader = PyPDFLoader(str(pdf_path))
    docs = loader.load()  # each doc has metadata including "page"

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=150
    )
    chunks = splitter.split_documents(docs)

    # Add your metadata needed for citations
    for i, d in enumerate(chunks):
        d.metadata["paperId"] = paper_id
        d.metadata["paperTitle"] = title
        d.metadata["chunkId"] = f"c{i:05d}"
        # PyPDFLoader uses 0-index page; we’ll store 1-index for user display
        if "page" in d.metadata and isinstance(d.metadata["page"], int):
            d.metadata["pageStart"] = d.metadata["page"] + 1
            d.metadata["pageEnd"] = d.metadata["page"] + 1

    vs = FAISS.from_documents(chunks, EMBEDDINGS)

    out_dir = INDEX_DIR / paper_id
    out_dir.mkdir(parents=True, exist_ok=True)
    vs.save_local(str(out_dir))

    return len(chunks)

def load_vectorstore(paper_id: str) -> FAISS:
    path = INDEX_DIR / paper_id
    return FAISS.load_local(str(path), EMBEDDINGS, allow_dangerous_deserialization=True)

def retrieve(query: str, paper_ids: List[str], k: int = 6):
    """
    Global top-k across multiple FAISS indexes using similarity scores.
    """
    scored = []
    per_paper_k = max(2, k)  # get enough from each paper to compete globally

    for pid in paper_ids:
        vs = load_vectorstore(pid)
        # Returns: List[Tuple[Document, score]] (lower score = closer for L2)
        docs_scores = vs.similarity_search_with_score(query, k=per_paper_k)
        for doc, score in docs_scores:
            scored.append((doc, score))

    # Sort by score (best first) and take global top-k
    scored.sort(key=lambda x: x[1])
    top_docs = [doc for doc, _ in scored[:k]]
    return top_docs


def format_citations(docs) -> List[Dict]:
    citations = []
    for d in docs:
        md = d.metadata or {}
        citations.append({
            "paperId": md.get("paperId", "unknown"),
            "paperTitle": md.get("paperTitle", "unknown"),
            "section": md.get("section"),  # optional if you add sectioning later
            "pageStart": md.get("pageStart"),
            "pageEnd": md.get("pageEnd"),
            "chunkId": md.get("chunkId", "unknown"),
            "snippet": (d.page_content[:160] + "…") if len(d.page_content) > 160 else d.page_content,
            "text": d.page_content,
            "pdfUrl": None,  # local mode: we’ll fill this in main.py
        })
    return citations

def answer_extractively(question: str, docs) -> str:
    """
    MVP answer without an LLM: stitches a concise response from evidence.
    Later you’ll replace this with an LLM call (Bedrock/Ollama).
    """
    if not docs:
        return "Not found in the provided papers."

    bullets = []
    for i, d in enumerate(docs, start=1):
        md = d.metadata or {}
        page = md.get("pageStart", "?")
        bullets.append(f"- Evidence [{i}] (p. {page}): {d.page_content.strip()[:220]}")

    return (
        "Evidence-based response (MVP, extractive):\n\n"
        + "\n".join(bullets)
        + "\n\nIf you want, I can switch this to a real LLM answer next (still grounded with citations)."
    )
