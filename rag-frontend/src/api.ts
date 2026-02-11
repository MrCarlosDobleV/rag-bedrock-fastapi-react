// src/api.ts
export type Paper = {
  paperId: string;
  title: string;
  status: "processing" | "indexed" | "failed";
};

export type Citation = {
  paperId: string;
  paperTitle: string;
  section?: string;
  pageStart?: number;
  pageEnd?: number;
  chunkId: string;
  snippet?: string;
  text?: string;      // full chunk text (MVP)
  pdfUrl?: string;    // presigned URL (MVP)
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
};

// =====================
// Config
// =====================
const API_BASE = import.meta.env.VITE_API_BASE ?? "mock";
const USE_MOCK = API_BASE === "mock";

// =====================
// Real backend helpers
// =====================
async function jsonFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${msg || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// =====================
// Mock state + data
// =====================
type MockState = {
  papers: Paper[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// keep mock data persistent across hot reloads (dev only)
const g = globalThis as any;
const mockState: MockState =
  g.__RAG_MOCK_STATE__ ??
  (g.__RAG_MOCK_STATE__ = {
    papers: [
      {
        paperId: "p_demo_1",
        title: "Attention Is All You Need",
        status: "indexed",
      },
      {
        paperId: "p_demo_2",
        title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        status: "indexed",
      },
    ],
  } as MockState);

function makeFakePdfUrl(): string {
  // Public sample PDF that can be opened. Replace later with S3 presigned.
  return "https://arxiv.org/pdf/1706.03762.pdf";
}

function makePaperTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  // Make it look nicer
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || filename;
}

function makeMockCitations(paperFilter: string): Citation[] {
  const chosenPaper =
    paperFilter !== "all"
      ? mockState.papers.find((p) => p.paperId === paperFilter) ?? mockState.papers[0]
      : mockState.papers[0];

  const otherPaper = mockState.papers[1] ?? chosenPaper;

  return [
    {
      paperId: chosenPaper.paperId,
      paperTitle: chosenPaper.title,
      section: "Methods",
      pageStart: 3,
      pageEnd: 4,
      chunkId: "c12",
      snippet: "The proposed approach defines the core architecture and training objective…",
      text:
        "Chunk c12 (Methods, p.3–4)\n\nThe method introduces a model architecture and learning objective. Key design choices include attention-based layers, residual connections, and normalization. The training objective optimizes likelihood under teacher forcing, and the authors discuss computational complexity considerations and scaling behavior.\n\nNotes: This is mock text for UI development; replace with real extracted PDF chunks later.",
      pdfUrl: makeFakePdfUrl(),
    },
    {
      paperId: otherPaper.paperId,
      paperTitle: otherPaper.title,
      section: "Experiments",
      pageStart: 7,
      pageEnd: 8,
      chunkId: "c41",
      snippet: "The evaluation compares baselines and reports key metrics across datasets…",
      text:
        "Chunk c41 (Experiments, p.7–8)\n\nThe paper evaluates the method against baselines, reporting metrics and ablations. Limitations include sensitivity to retrieval quality, incomplete coverage of edge cases, and potential domain shift when test data differs from training corpora.\n\nNotes: This is mock text for UI development; replace with real extracted PDF chunks later.",
      pdfUrl: makeFakePdfUrl(),
    },
  ];
}

function makeMockAnswer(question: string): string {
  const q = question.toLowerCase();

  if (q.includes("limitation") || q.includes("weakness") || q.includes("failure")) {
    return (
      "Based on the provided papers, the main limitations are:\n\n" +
      "1) **Dependence on retrieval quality**: if relevant passages are not retrieved, the generator can miss key details or answer incompletely.\n" +
      "2) **Coverage gaps**: the system may not contain evidence for niche claims, so answers should explicitly report when support is missing.\n" +
      "3) **Domain shift**: performance can degrade when queries or documents differ from the distribution used during development.\n\n" +
      "These limitations are discussed in the experimental analysis and methodological sections, including how retrieval impacts downstream generation.\n\n" +
      "Citations: [1] Methods (p.3–4), [2] Experiments (p.7–8)."
    );
  }

  if (q.includes("summarize") || q.includes("contribution")) {
    return (
      "The papers propose a pipeline that combines **retrieval** with **generation** to answer questions using external documents. " +
      "Core contributions include: (i) using retrieved passages as grounding context, (ii) training / prompting strategies to produce evidence-based outputs, and " +
      "(iii) empirical evaluation demonstrating improved performance on knowledge-intensive tasks.\n\n" +
      "Citations: [1] Methods (p.3–4), [2] Experiments (p.7–8)."
    );
  }

  return (
    "Here’s an evidence-grounded response (mock): the system retrieves relevant chunks and generates an answer constrained to those chunks, " +
    "returning citations for traceability. For deeper detail, open the cited pages.\n\n" +
    "Citations: [1] Methods (p.3–4), [2] Experiments (p.7–8)."
  );
}

// =====================
// Public API (used by UI)
// =====================

export async function getPapers(): Promise<Paper[]> {
  if (!USE_MOCK) return jsonFetch<Paper[]>("/papers");
  await sleep(250);
  return mockState.papers;
}

export async function getUploadUrl(filename: string): Promise<{ uploadUrl: string; s3Key: string }> {
  if (!USE_MOCK) {
    return jsonFetch("/upload-url", { method: "POST", body: JSON.stringify({ filename }) });
  }
  // mock: fake S3 key + fake url
  await sleep(250);
  const s3Key = `mock/${Date.now()}_${filename}`;
  return { uploadUrl: "mock://upload-url", s3Key };
}

export async function uploadToS3(uploadUrl: string, file: File, onProgress?: (pct: number) => void) {
  if (!USE_MOCK) {
    await fetch(uploadUrl, { method: "PUT", body: file });
    onProgress?.(100);
    return;
  }
  // mock: pretend upload takes time
  onProgress?.(10);
  await sleep(250);
  onProgress?.(55);
  await sleep(300);
  onProgress?.(100);
}

export async function ingest(s3Key: string): Promise<{ paperId: string }> {
  if (!USE_MOCK) return jsonFetch("/ingest", { method: "POST", body: JSON.stringify({ s3Key }) });

  // mock ingestion pipeline:
  // 1) Add paper as processing
  // 2) Flip to indexed after a short delay
  await sleep(300);

  const filename = s3Key.split("_").slice(1).join("_") || "Uploaded Paper";
  const paperId = `p_${Math.random().toString(16).slice(2, 10)}`;
  const title = makePaperTitleFromFilename(filename);

  mockState.papers.unshift({ paperId, title, status: "processing" });

  // async flip (simulate background indexing)
  setTimeout(() => {
    const p = mockState.papers.find((x) => x.paperId === paperId);
    if (p) p.status = "indexed";
  }, 1800);

  return { paperId };
}

export async function chat(question: string, paperFilter: string): Promise<ChatResponse> {
  if (!USE_MOCK) {
    return jsonFetch("/chat", { method: "POST", body: JSON.stringify({ question, paperFilter }) });
  }

  await sleep(450);
  const citations = makeMockCitations(paperFilter);
  const answer = makeMockAnswer(question);

  return { answer, citations };
}
