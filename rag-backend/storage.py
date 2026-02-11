import json
from pathlib import Path
from typing import Dict, List

DATA_DIR = Path(__file__).parent / "data"
PAPERS_JSON = DATA_DIR / "papers.json"

def load_papers() -> List[Dict]:
    if not PAPERS_JSON.exists():
        return []
    return json.loads(PAPERS_JSON.read_text(encoding="utf-8"))

def save_papers(papers: List[Dict]) -> None:
    PAPERS_JSON.parent.mkdir(parents=True, exist_ok=True)
    PAPERS_JSON.write_text(json.dumps(papers, indent=2), encoding="utf-8")

def upsert_paper(paper: Dict) -> None:
    papers = load_papers()
    idx = next((i for i,p in enumerate(papers) if p["paperId"] == paper["paperId"]), None)
    if idx is None:
        papers.insert(0, paper)
    else:
        papers[idx] = paper
    save_papers(papers)
