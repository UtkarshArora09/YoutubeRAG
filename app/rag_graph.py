from typing import TypedDict, Optional

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END
from sqlalchemy.orm import Session

from app.config import settings
from app.retrieval import retrieve_chunks

llm = ChatGroq(model=settings.chat_model, api_key=settings.groq_api_key, temperature=0)


class RAGState(TypedDict):
    question: str
    video_ids: Optional[list[str]]
    documents: list
    answer: str
    needs_refinement: bool
    refined_query: Optional[str]
    answer_language: Optional[str]


LANGUAGE_INSTRUCTIONS = {
    "english": "Answer in English only.",
    "hindi": "Answer in Hindi, written in Devanagari script (हिन्दी).",
    "hinglish": "Answer in Hinglish — Hindi conversationally mixed with English, written in Latin/Roman script (e.g. 'Video mein unhone bataya ki...'), not Devanagari.",
    "auto": "Answer in the same language and style the question was asked in — if the question is in English, answer in English; if in Hindi, answer in Hindi; if in Hinglish, answer in Hinglish.",
}


def make_graph(db: Session):
    """Builds the LangGraph pipeline. `db` is closed over so nodes can query pgvector."""

    def retrieve_node(state: RAGState) -> RAGState:
        query = state.get("refined_query") or state["question"]
        docs = retrieve_chunks(db, query, video_ids=state.get("video_ids"))
        return {**state, "documents": docs}

    def grade_node(state: RAGState) -> RAGState:
        """Cheap relevance check: do the retrieved chunks actually relate to the question?
        If not, trigger one query-rewrite + re-retrieve pass instead of hallucinating."""
        if not state["documents"]:
            return {**state, "needs_refinement": True}

        context_preview = "\n".join(d.page_content[:150] for d in state["documents"][:3])
        grading_prompt = (
            f"Question: {state['question']}\n\n"
            f"Retrieved context snippets:\n{context_preview}\n\n"
            "Do these snippets contain information that could answer the question? "
            "Reply with only YES or NO."
        )
        result = llm.invoke([HumanMessage(content=grading_prompt)]).content.strip().upper()
        needs_refinement = "NO" in result and not state.get("refined_query")
        return {**state, "needs_refinement": needs_refinement}

    def refine_node(state: RAGState) -> RAGState:
        rewrite_prompt = (
            f"The search query '{state['question']}' did not retrieve useful results "
            "from a YouTube video transcript database. Rewrite it as a more specific, "
            "keyword-focused search query. Reply with ONLY the rewritten query."
        )
        rewritten = llm.invoke([HumanMessage(content=rewrite_prompt)]).content.strip()
        return {**state, "refined_query": rewritten}

    def generate_node(state: RAGState) -> RAGState:
        docs = state["documents"]
        if not docs:
            return {**state, "answer": "I couldn't find anything relevant to that in the ingested video(s)."}

        context_blocks = []
        for d in docs:
            m = d.metadata
            timestamp = f"{int(m['start_seconds'] // 60)}:{int(m['start_seconds'] % 60):02d}"
            context_blocks.append(
                f"[{m['title']} @ {timestamp}] {d.page_content}\n(source: {m['url']})"
            )
        context = "\n\n".join(context_blocks)

        lang_key = (state.get("answer_language") or "auto").lower()
        lang_instruction = LANGUAGE_INSTRUCTIONS.get(lang_key, LANGUAGE_INSTRUCTIONS["auto"])

        system = SystemMessage(content=(
            "You answer questions using ONLY the provided YouTube transcript excerpts. "
            "Always cite the video title and timestamp for each claim, and include the source URL. "
            "If the excerpts don't contain the answer, say so plainly instead of guessing. "
            "The transcript excerpts themselves may be in English or Hindi. You MUST translate all "
            "quotes, citations, and explanations to the requested answer language. Do not output Devanagari "
            "script (Hindi characters) if the requested language is English or Hinglish. "
            f"{lang_instruction}"
        ))
        human = HumanMessage(content=f"Context:\n{context}\n\nQuestion: {state['question']}")
        response = llm.invoke([system, human])
        return {**state, "answer": response.content}

    def route_after_grade(state: RAGState) -> str:
        return "refine" if state["needs_refinement"] else "generate"

    graph = StateGraph(RAGState)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("grade", grade_node)
    graph.add_node("refine", refine_node)
    graph.add_node("generate", generate_node)

    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "grade")
    graph.add_conditional_edges("grade", route_after_grade, {"refine": "refine", "generate": "generate"})
    graph.add_edge("refine", "retrieve")
    graph.add_edge("generate", END)

    return graph.compile()


def ask(db: Session, question: str, video_ids: list[str] = None, answer_language: str = None) -> dict:
    app = make_graph(db)
    result = app.invoke({
        "question": question,
        "video_ids": video_ids,
        "documents": [],
        "answer": "",
        "needs_refinement": False,
        "refined_query": None,
        "answer_language": answer_language,
    })
    sources = [
        {"title": d.metadata["title"], "url": d.metadata["url"]}
        for d in result["documents"]
    ]
    return {"answer": result["answer"], "sources": sources}
