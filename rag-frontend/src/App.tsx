import { useEffect, useMemo, useState } from "react";
import { chat, getPapers, getUploadUrl, ingest, uploadToS3, type Citation, type Paper } from "./api";
import "./styles.css";
import { BlockMath, InlineMath } from "react-katex";


type Message = { role: "user" | "assistant"; content: string };

function renderMessageWithMath(text: string) {
  const parts = text.split(/\\\[([\s\S]*?)\\\]/g);

  return parts.map((part, i) => {
    // Odd indexes are math blocks
    if (i % 2 === 1) {
      return <BlockMath key={i} math={part.trim()} />;
    }

    // Render inline math \( ... \)
    const inlineParts = part.split(/\\\((.*?)\\\)/g);

    return inlineParts.map((p, j) =>
      j % 2 === 1 ? (
        <InlineMath key={`${i}-${j}`} math={p} />
      ) : (
        <span key={`${i}-${j}`}>{p}</span>
      )
    );
  });
}

export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paperFilter, setPaperFilter] = useState<string>("all");

  const [uploadState, setUploadState] = useState<{ status: "idle" | "uploading" | "ingesting" | "done" | "error"; msg?: string; }>({ status: "idle" });

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Upload a paper and ask questions. I will answer with citations." },
  ]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);

  const [citations, setCitations] = useState<Citation[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  async function refreshPapers() {
    const list = await getPapers();
    setPapers(list);
  }

  useEffect(() => {
    refreshPapers().catch(() => { });
    const t = setInterval(() => refreshPapers().catch(() => { }), 4000);
    return () => clearInterval(t);
  }, []);

  const paperOptions = useMemo(() => {
    return [{ paperId: "all", title: "All papers", status: "indexed" as const }, ...papers];
  }, [papers]);

  async function onDrop(file: File) {
    try {
      setUploadState({ status: "uploading", msg: "Requesting upload URL..." });
      const { uploadUrl, s3Key } = await getUploadUrl(file.name);

      setUploadState({ status: "uploading", msg: "Uploading PDF to S3..." });
      await uploadToS3(uploadUrl, file);

      setUploadState({ status: "ingesting", msg: "Starting ingestion / indexing..." });
      await ingest(s3Key);

      setUploadState({ status: "done", msg: "Uploaded. Indexing in progress..." });
      await refreshPapers();
      setTimeout(() => setUploadState({ status: "idle" }), 2500);
    } catch (e: any) {
      setUploadState({ status: "error", msg: e?.message ?? "Upload failed" });
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || isAsking) return;

    setIsAsking(true);
    setQuestion("");
    setSelectedCitation(null);

    setMessages((m) => [...m, { role: "user", content: q }]);

    try {
      const res = await chat(q, paperFilter);
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
      setCitations(res.citations ?? []);
      setSelectedCitation(res.citations?.[0] ?? null);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e?.message ?? "chat failed"}` }]);
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="title">Academic Papers RAG Assistant</div>
        <div className="subtitle">Upload PDFs → Ask questions → Get cited answers</div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>Upload</h2>
          <Dropzone onFile={onDrop} disabled={uploadState.status === "uploading" || uploadState.status === "ingesting"} />

          <div className="status">
            <span className={`pill ${uploadState.status}`}>{uploadState.status}</span>
            <span className="muted">{uploadState.msg ?? "Drag & drop a PDF to ingest."}</span>
          </div>

          <h3>Papers</h3>
          <div className="paperList">
            {papers.length === 0 ? (
              <div className="muted">No papers yet.</div>
            ) : (
              papers.map((p) => (
                <div key={p.paperId} className="paperRow">
                  <div className="paperTitle">{p.title || p.paperId}</div>
                  <span className={`pill ${p.status}`}>{p.status}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <div className="chatHeader">
            <h2>Chat</h2>
            <div className="filter">
              <label className="muted">Paper filter</label>
              <select value={paperFilter} onChange={(e) => setPaperFilter(e.target.value)}>
                {paperOptions.map((p) => (
                  <option key={p.paperId} value={p.paperId}>
                    {p.paperId === "all" ? "All papers" : p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="chatBox">
            {messages.map((m, idx) => (
              <div key={idx} className={`msg ${m.role}`}>
                <div className="role">{m.role}</div>
                <div className="bubble">
                  {renderMessageWithMath(m.content)}
                </div>
              </div>
            ))}
            {isAsking && <div className="muted">Thinking…</div>}
          </div>

          <div className="composer">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about contributions, assumptions, limitations…"
              onKeyDown={(e) => {
                if (e.key === "Enter") ask();
              }}
            />
            <button onClick={ask} disabled={isAsking || !question.trim()}>
              Send
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Evidence</h2>

          <div className="evidenceGrid">
            <div className="citList">
              {citations.length === 0 ? (
                <div className="muted">Ask a question to see citations here.</div>
              ) : (
                citations.map((c, idx) => (
                  <button
                    key={`${c.paperId}-${c.chunkId}-${idx}`}
                    className={`cit ${selectedCitation?.chunkId === c.chunkId ? "active" : ""}`}
                    onClick={() => setSelectedCitation(c)}
                    title={`Citation [${idx + 1}]`}
                  >
                    <div className="citTopRow">
                      <span className="citBadge">[{idx + 1}]</span>
                      <div className="citTitle">{c.paperTitle}</div>
                    </div>

                    <div className="citMeta">
                      {c.section ? `§ ${c.section} · ` : ""}
                      {c.pageStart != null
                        ? `p. ${c.pageStart}${c.pageEnd ? `–${c.pageEnd}` : ""}`
                        : "page ?"}{" "}
                      · {c.chunkId}
                    </div>

                    {c.snippet && <div className="citSnippet">{c.snippet}</div>}
                  </button>
                ))
              )}
            </div>

            <div className="citDetail">
              {!selectedCitation ? (
                <div className="muted">Select a citation to view the chunk text.</div>
              ) : (
                <>
                  {/** find the selected citation's index for consistent numbering */}
                  {(() => {
                    const selectedIdx = citations.findIndex(
                      (x) => x.paperId === selectedCitation.paperId && x.chunkId === selectedCitation.chunkId
                    );

                    return (
                      <div className="detailHeader">
                        <div>
                          <div className="detailTitle">
                            {selectedIdx >= 0 ? `[${selectedIdx + 1}] ` : ""}
                            {selectedCitation.paperTitle}
                          </div>
                          <div className="muted">
                            {selectedCitation.section ? `§ ${selectedCitation.section} · ` : ""}
                            {selectedCitation.pageStart != null
                              ? `p. ${selectedCitation.pageStart}${selectedCitation.pageEnd ? `–${selectedCitation.pageEnd}` : ""}`
                              : ""}
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            if (!selectedCitation.pdfUrl) return;
                            const page = selectedCitation.pageStart ?? 1;
                            window.open(`${selectedCitation.pdfUrl}#page=${page}`, "_blank");
                          }}
                          disabled={!selectedCitation.pdfUrl}
                          title={!selectedCitation.pdfUrl ? "Backend must return a presigned PDF URL" : "Open PDF"}
                        >
                          Open PDF
                        </button>
                      </div>
                    );
                  })()}

                  <pre className="chunkText">{selectedCitation.text ?? "(No chunk text returned.)"}</pre>
                </>
              )}
            </div>
          </div>
        </section>

      </main>

      <footer className="footer muted"> MVP: Upload → Ask → Evidence with chunk text + PDF link.</footer>
    </div>
  );
}

function Dropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      className={`dropzone ${isOver ? "over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (disabled) return;
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="dzText">Drag & drop a PDF here</div>
      <div className="muted">or</div>
      <label className="btnLike">
        Choose file
        <input
          type="file"
          accept="application/pdf"
          disabled={disabled}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </label>
    </div>
  );
}
