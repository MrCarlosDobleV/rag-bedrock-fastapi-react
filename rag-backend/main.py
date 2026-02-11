from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal, Optional
from pathlib import Path
import time
import uuid

from bedrock_llm import generate_answer_nova_micro
from storage import load_papers, upsert_paper
from rag import ingest_pdf, retrieve, format_citations, answer_extractively

DATA_DIR = Path(__file__).parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Paper(BaseModel):
    paperId: str
    title: str
    status: Literal["processing", "indexed", "failed"]

class UploadUrlReq(BaseModel):
    filename: str

class UploadUrlResp(BaseModel):
    uploadUrl: str
    s3Key: str

class IngestReq(BaseModel):
    s3Key: str

class IngestResp(BaseModel):
    paperId: str

class ChatReq(BaseModel):
    question: str
    paperFilter: str  # "all" or paperId

class Citation(BaseModel):
    paperId: str
    paperTitle: str
    section: Optional[str] = None
    pageStart: Optional[int] = None
    pageEnd: Optional[int] = None
    chunkId: str
    snippet: Optional[str] = None
    text: Optional[str] = None
    pdfUrl: Optional[str] = None

class ChatResp(BaseModel):
    answer: str
    citations: List[Citation]

@app.get("/papers", response_model=List[Paper])
def get_papers():
    return load_papers()

@app.post("/upload-url", response_model=UploadUrlResp)
def upload_url(req: UploadUrlReq):
    # Create a stable key and a local "presigned-like" URL that accepts PUT
    key = f"{int(time.time())}_{uuid.uuid4().hex}_{req.filename}"
    upload_url = f"http://localhost:3001/upload?key={key}"
    return {"uploadUrl": upload_url, "s3Key": key}

@app.put("/upload")
async def upload_pdf(request: Request, key: str):
    # Receives raw bytes body (like a presigned PUT)
    pdf_bytes = await request.body()
    if not pdf_bytes:
        return {"ok": False, "error": "Empty body"}

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = UPLOAD_DIR / key
    out_path.write_bytes(pdf_bytes)
    return {"ok": True, "path": str(out_path)}

@app.post("/ingest", response_model=IngestResp)
def ingest(req: IngestReq):
    pdf_path = UPLOAD_DIR / req.s3Key
    paper_id = f"p_{uuid.uuid4().hex[:10]}"
    title = req.s3Key.split("_")[-1].replace(".pdf", "").replace("-", " ")

    # mark processing
    upsert_paper({"paperId": paper_id, "title": title, "status": "processing", "pdfKey": req.s3Key})


    try:
        n_chunks = ingest_pdf(pdf_path, paper_id=paper_id, title=title)
        upsert_paper({"paperId": paper_id, "title": title, "status": "indexed", "chunks": n_chunks, "pdfKey": req.s3Key})
    except Exception:
        upsert_paper({"paperId": paper_id, "title": title, "status": "failed"})
        raise

    return {"paperId": paper_id}

@app.post("/chat", response_model=ChatResp)
def chat(req: ChatReq):
    papers = load_papers()
    indexed = [p for p in papers if p.get("status") == "indexed"]

    if req.paperFilter != "all":
        paper_ids = [req.paperFilter]
    else:
        paper_ids = [p["paperId"] for p in indexed]

    docs = retrieve(req.question, paper_ids=paper_ids, k=6)
    citations = format_citations(docs)
    for c in citations:
        c["pdfUrl"] = f"http://localhost:3001/pdf/{c['paperId']}"

    # Use Nova Micro to generate an answer grounded on retrieved chunks
    try:
        answer = generate_answer_nova_micro(req.question, citations)
    except Exception as e:
        print("Error generating answer with Nova Micro:", repr(e))
        # Safe fallback so your app doesn't break during testing
        answer = answer_extractively(req.question, docs)

    
    print("\n===== DEBUG: /chat response.answer (raw) =====\n")
    print(answer)
    print("\n===== END DEBUG =====\n")    

    return {"answer": answer, "citations": citations}


@app.get("/pdf/{paper_id}")
def get_pdf(paper_id: str):
    papers = load_papers()
    paper = next((p for p in papers if p.get("paperId") == paper_id), None)
    if not paper or not paper.get("pdfKey"):
        return {"ok": False, "error": "PDF not found"}

    pdf_path = UPLOAD_DIR / paper["pdfKey"]
    if not pdf_path.exists():
        return {"ok": False, "error": "PDF file missing on disk"}

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=paper.get("title", "paper") + ".pdf",
    )
