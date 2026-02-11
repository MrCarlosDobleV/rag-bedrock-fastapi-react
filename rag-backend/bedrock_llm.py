import os
import boto3
from typing import List, Dict
import re 

def _bedrock_client():
    region = os.getenv("BEDROCK_REGION", "us-east-2")  # set to the region that works for you
    return boto3.client("bedrock-runtime", region_name=region)


def generate_answer_nova_micro(question: str, citations: List[Dict]) -> str:
    """
    Uses Amazon Nova Micro via Bedrock Converse API to generate a grounded answer.
    citations: list of dicts that include 'text' (chunk) and metadata for the UI.
    """
    # Build numbered evidence blocks for the model to cite as [1], [2], ...
    evidence_blocks = []
    for i, c in enumerate(citations, start=1):
        chunk = (c.get("text") or "").strip()
        # hard cap per chunk to reduce cost + keep prompt tight
        chunk = chunk[:1200]
        meta = []
        if c.get("paperTitle"):
            meta.append(c["paperTitle"])
        if c.get("section"):
            meta.append(f"§ {c['section']}")
        if c.get("pageStart") is not None:
            if c.get("pageEnd") and c["pageEnd"] != c["pageStart"]:
                meta.append(f"p. {c['pageStart']}-{c['pageEnd']}")
            else:
                meta.append(f"p. {c['pageStart']}")
        meta_str = " · ".join(meta) if meta else "source"
        evidence_blocks.append(f"[{i}] {meta_str}\n{chunk}")

    evidence_text = "\n\n".join(evidence_blocks) if evidence_blocks else "(no evidence retrieved)"

    system_text = (
        "You are an academic research assistant.\n\n"
        "Your task:\n"
        "1) FIRST decide whether the user's question is a factual, technical question "
        "that can be answered using ONLY the provided Evidence.\n"
        "2) If the question is not about the content of the papers, is a greeting, "
        "or cannot be answered using the Evidence, respond EXACTLY with:\n"
        "\"Please ask a question related to the content of the uploaded papers.\"\n\n"
        "IMPORTANT:\n"
        "- You must EITHER provide an answer OR provide the refusal message, NEVER both.\n\n"
        "If the question IS answerable using the Evidence:\n"
        "- Answer using ONLY the Evidence.\n"
        "- Cite every non-trivial claim using bracket citations like [1] or [1][2].\n"
        "- Do NOT add external knowledge.\n"
        "- Keep the answer concise, technical, and neutral.\n"
        "- Do not use Markdown formatting in the response.\n\n"
        "Mathematical formatting rules (MANDATORY):\n"
        "- Any mathematical expression MUST be written in LaTeX.\n"
        "- Do NOT use Unicode math symbols (e.g., γ, ϵ, −, ×) outside LaTeX.\n"
        "- Use inline math with \\( ... \\).\n"
        "- Use display equations with \\[ ... \\] on their own lines.\n"
        "- Do NOT format equations using plain square brackets [ ... ].\n"
        "- Plain-text math is not allowed.\n"
        "- Do NOT wrap natural language sentences in LaTeX.\n"
        "- Do NOT use \\text{...} for explanatory text.\n"
        "- LaTeX is ONLY for mathematical symbols, equations, or formulas."
    )




    user_text = (
        f"Question:\n{question}\n\n"
        f"Evidence:\n{evidence_text}\n\n"
        "Instructions:\n"
        "- FIRST determine whether the question can be answered using the Evidence above.\n"
        "- If the question is not about the content of the papers, respond EXACTLY with:\n"
        "  \"Please ask a question related to the content of the uploaded papers.\"\n"
        "- Otherwise, answer using ONLY the Evidence.\n"
        "- Do NOT add external knowledge.\n"
        "- Cite every non-trivial claim using bracket citations like [1] or [1][2].\n"
        "- Do NOT use Markdown formatting in the response.\n\n"
        "Mathematical formatting rules:\n"
        "- Rewrite ALL mathematical expressions in LaTeX.\n"
        "- Use inline math with \\( ... \\).\n"
        "- Use block equations with \\[ ... \\] on their own lines.\n"
        "- Do NOT use Unicode math symbols outside LaTeX.\n"
        "- Do NOT use plain square brackets [ ... ] for equations.\n\n"
        "- Do NOT wrap explanatory sentences in LaTeX or \\text{...}.\n"
        "- Use LaTeX ONLY for equations or symbolic expressions.\n"
        "Style rules:\n"
        "- Keep the answer concise, technical, and neutral.\n"
        "- Do not include greetings or conversational filler."
    )

    client = _bedrock_client()

    # Nova models work with Converse API. :contentReference[oaicite:2]{index=2}
    resp = client.converse(
        modelId="us.amazon.nova-micro-v1:0",
        messages=[
            {"role": "user", "content": [{"text": user_text}]}
        ],
        system=[{"text": system_text}],
        inferenceConfig={
            "maxTokens": int(os.getenv("NOVA_MAX_TOKENS", "450")),
            "temperature": float(os.getenv("NOVA_TEMPERATURE", "0.2")),
            "topP": float(os.getenv("NOVA_TOP_P", "0.9")),
        },
    )

    # Standard Converse response shape: output.message.content[...].text :contentReference[oaicite:3]{index=3}
    content = resp["output"]["message"]["content"]
    text_parts = []
    for part in content:
        if "text" in part:
            text_parts.append(part["text"])
    return "\n".join(text_parts).strip() or "Not found in the provided papers."
