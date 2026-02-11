# Retrieval-Augmented Generation System for Academic Papers  
**FastAPI · React (Vite + TypeScript) · Amazon Bedrock · LangChain · FAISS**

This repository implements an end-to-end **Retrieval-Augmented Generation (RAG)** system designed specifically for working with **academic papers**.  
Its primary objective is to extract, retrieve, and synthesize useful information from research documents while ensuring that all generated answers are **strictly grounded in the content of the papers**.

The system is explicitly **prompt-tuned and pipeline-constrained** so that the language model only produces an answer when sufficient supporting information is found in the retrieved documents. When relevant evidence is missing, the system avoids hallucinations and indicates that the question cannot be answered based on the available papers.

---

## Purpose and Scope

This project targets research-oriented use cases such as:
- Exploring and querying academic literature
- Extracting specific technical details from papers
- Assisting systematic reviews and research workflows
- Demonstrating grounded RAG architectures for academic and scientific domains

A core design principle is **evidence-based answering**: the language model is not treated as a free-form generator, but as a synthesis component operating only on retrieved document chunks.

---

## System Architecture

```text
React (Vite) Frontend
        |
        v
FastAPI Backend
        |
        |-- LangChain document ingestion
        |-- Amazon Titan Embeddings
        |-- FAISS vector store (local)
        |-- Amazon Nova Micro (constrained generation)
```

## RAG Pipeline and Grounding Strategy

The backend implements a structured RAG pipeline using LangChain components:

- Document loading using `PyPDFLoader`

- Text splitting using `RecursiveCharacterTextSplitter`

- Embedding generation with `BedrockEmbeddings` (**Amazon Titan**)

- Vector storage using a local **FAISS** index

- Top-k semantic retrieval per query

- Answer generation with **Amazon Nova Micro**, constrained to retrieved context

The language model is instructed to:

- Use only the retrieved chunks as evidence

- Explicitly abstain from answering when the documents do not contain sufficient information

- This approach ensures that answers are traceable to specific papers, sections, and pages, reducing unsupported or fabricated outputs.

## Technology Stack
### Backend

- Python 3.11+

- FastAPI

- LangChain

- FAISS

- Amazon Bedrock

    - amazon.titan-embed-text-v2 (embeddings)

    - us.amazon.nova-micro-v1 (language model)

### Frontend

- React

- Vite

- TypeScript

## Backend API Design

The FastAPI backend exposes a minimal and well-defined API:

- `GET /papers`
Returns metadata and indexing status for all uploaded papers.

- `POST /upload-url`
Generates a temporary upload URL for PDF files.

- `PUT /upload`
Receives and stores raw PDF files.

- `POST /ingest`
Processes a PDF by chunking, embedding, and indexing it in FAISS.

- `POST /chat`
Accepts a natural-language question and an optional paper filter. Retrieves relevant document chunks and generates an answer only when supported by the papers, returning structured citations.

- `GET /pdf/{paper_id}`
Serves the original PDF associated with a given paper.

## Requirements

- Python 3.11 or higher

- Node.js 18 or higher

- AWS account with Amazon Bedrock access enabled

- AWS credentials configured locally


## Running Locally
### Backend
```bash
cd rag-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 3001
```

### Frontend
```bash
cd rag-frontend
npm install
npm run dev
```

### Project Structure
```text
rag-bedrock-fastapi-react/
├── rag-backend/
│   ├── main.py
│   ├── rag.py
│   ├── storage.py
│   ├── bedrock_llm.py
│   └── data/
│       ├── papers.json
│       ├── uploads/
│       └── indexes/
├── rag-frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## Intended Use

This project is intended as:

- A research-focused RAG prototype

- A reference implementation of grounded LLM applications

- A portfolio project demonstrating academic document retrieval and synthesis

- It is not intended to be a production-ready system.

## Author 
Carlos Mario Quiroga
M.Sc. Electronic and Computer Engineering