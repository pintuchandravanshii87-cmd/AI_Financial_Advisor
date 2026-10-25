import os, re, statistics
from collections import Counter, defaultdict
from typing import List, Optional

import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import JSON, Column, DateTime, Float, Integer, String, Text, create_engine, func
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
EMBED_MODEL = os.getenv("EMBED_MODEL", "models/gemini-embedding-001")

if api_key:
    client = genai.Client(api_key=api_key)
else:
    client = None
    print("GEMINI_API_KEY is not set. Gemini requests will fail until it is configured.")

DEFAULT_DATABASE_URL = "sqlite:///./finadvisor.db"

def get_database_url():
    url = os.getenv("DATABASE_URL")
    if not url:
        return DEFAULT_DATABASE_URL
    if url.startswith("mysql"):
        try:
            test_engine = create_engine(url, pool_pre_ping=True)
            with test_engine.connect() as conn:
                conn.exec_driver_sql("SELECT 1")
            return url
        except Exception as exc:
            print(f"MySQL unavailable ({exc}). Falling back to SQLite.")
    return DEFAULT_DATABASE_URL


DATABASE_URL = get_database_url()
DB_KIND = "mysql" if DATABASE_URL.startswith("mysql") else "sqlite"
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
Session = sessionmaker(bind=engine)
Base = declarative_base()


class Profile(Base):
    __tablename__ = "profiles"
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    age = Column(Integer)
    income = Column(Float)            # monthly net income
    savings = Column(Float)
    debt = Column(Float)
    risk = Column(String(20))
    goal = Column(String(255))
    monthly_expenses = Column(JSON)   # list of numbers; null = missing month


class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(Integer, primary_key=True)
    source = Column(String(200))
    text = Column(Text)
    embedding = Column(JSON)


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    role = Column(String(10))
    content = Column(Text)
    created = Column(DateTime, server_default=func.now())


Base.metadata.create_all(engine)

SEED = [
    ("Emergency fund", "An emergency fund should cover 3 to 6 months of essential expenses, held in a liquid, low-risk account. Build it before taking investment risk."),
    ("Debt priority", "Pay off high-interest debt such as credit cards before investing. If a debt's interest rate is higher than expected investment returns, repaying it is a guaranteed return."),
    ("Savings rate", "A common guideline is to save 15 to 20 percent of income. The 50/30/20 rule splits income into needs, wants and savings or debt repayment."),
    ("Diversification", "Diversifying across asset classes and low-cost index funds reduces the risk of any single investment. Risk tolerance and time horizon should drive the equity share."),
    ("Debt-to-income", "A debt-to-income ratio under 36 percent of gross income is generally considered manageable by lenders."),
]


#  RAG helpers
def embed(text: str, query: bool = False) -> List[float]:
    if client is None:
        raise HTTPException(503, "Gemini API key is not configured")
    try:
        task_type = "RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"
        r = client.models.embed_content(
            model=EMBED_MODEL,
            contents=text,
            config=types.EmbedContentConfig(task_type=task_type),
        )
        return list(r.embeddings[0].values)
    except Exception as exc:
        raise HTTPException(502, f"Embedding error: {exc}")


def split(text: str, size: int = 800) -> List[str]:
    parts, buf = [], ""
    for para in text.split("\n"):
        if len(buf) + len(para) > size and buf:
            parts.append(buf.strip()); buf = ""
        buf += para + "\n"
    if buf.strip():
        parts.append(buf.strip())
    return parts


def ingest(db, source: str, text: str) -> int:
    chunks = split(text)
    for c in chunks:
        db.add(Chunk(source=source, text=c, embedding=embed(c)))
    db.commit()
    return len(chunks)


def retrieve(db, question: str, k: int = 3):
    rows = db.query(Chunk).all()
    if not rows:
        return []
    q = np.array(embed(question, query=True))
    mat = np.array([r.embedding for r in rows])
    sims = mat @ q / (np.linalg.norm(mat, axis=1) * np.linalg.norm(q) + 1e-9)
    return [rows[i] for i in np.argsort(-sims)[:k]]


# deterministic numbers (LLMs are weak at arithmetic)
def series_stats(xs):
    vals = [x for x in xs or [] if x is not None]
    if not vals:
        return None
    trend = "upward" if sum(b - a for a, b in zip(vals, vals[1:])) > 0 else "downward"
    return dict(min=min(vals), max=max(vals), median=statistics.median(vals),
                mean=sum(vals) / len(vals), trend=trend)


def serialize_profile(p: Profile) -> str:
    exp = ", ".join("NaN" if x is None else f"{x:.0f}" for x in (p.monthly_expenses or []))
    return (f"The user is {p.name}, aged {p.age}. Monthly net income is {p.income:.0f}. "
            f"Savings are {p.savings:.0f}. Total debt is {p.debt:.0f}. "
            f"Risk tolerance is {p.risk}. Goal: {p.goal}. "
            f"Monthly expenses over recent months: {exp}.")


def computed_facts(p: Profile) -> str:
    s = series_stats(p.monthly_expenses)
    lines = []
    if s:
        lines.append(f"Expenses: min {s['min']:.0f}, max {s['max']:.0f}, median {s['median']:.0f}, "
                     f"average {s['mean']:.0f}; the overall trend is {s['trend']}.")
        if p.income:
            lines.append(f"Savings rate: {(p.income - s['mean']) / p.income * 100:.1f}% of income.")
        if s["mean"]:
            lines.append(f"Emergency fund covers {p.savings / s['mean']:.1f} months of average expenses.")
    if p.income:
        lines.append(f"Debt equals {p.debt / (p.income * 12) * 100:.0f}% of annual income.")
    return " ".join(lines)


SYSTEM = ("You are an educational financial assistant. You are not a licensed advisor. "
          "Use ONLY the numbers in [Statistics] and [Profile]; never do your own calculations. "
          "Ground advice in [Knowledge] and cite sources like [S1]. If the knowledge does not cover "
          "the question, say so. Be clear about uncertainty and recommend a licensed professional "
          "for large decisions.")


def build_prompt(p: Profile, question: str, ctx, history: str) -> str:
    knowledge = "\n".join(f"[S{i+1}] ({c.source}) {c.text}" for i, c in enumerate(ctx)) or "(none)"
    return (f"[Domain]: Personal finance for an individual household.\n"
            f"[Instruction]: Answer the user's question with personalised, practical guidance.\n"
            f"[Profile]: {serialize_profile(p)}\n"
            f"[Statistics]: {computed_facts(p)}\n"
            f"[Knowledge]:\n{knowledge}\n"
            f"[History]:\n{history}\n"
            f"[Question]: {question}")


#  API
app = FastAPI(title="AI Financial Advisor")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


class ProfileIn(BaseModel):
    name: str
    age: int
    income: float
    savings: float
    debt: float
    risk: str = "moderate"
    goal: str = ""
    monthly_expenses: List[Optional[float]] = []


class ChatIn(BaseModel):
    user_id: int
    question: str


class DocIn(BaseModel):
    source: str
    text: str


@app.on_event("startup")
def seed():
    db = Session()
    if db.query(Chunk).count() == 0:
        for src, txt in SEED:
            ingest(db, src, txt)
    db.close()


@app.post("/profile")
def save_profile(p: ProfileIn):
    db = Session()
    row = Profile(**p.dict())
    db.add(row); db.commit()
    uid = row.id
    db.close()
    return {"user_id": uid}


@app.post("/ingest")
def add_document(d: DocIn):
    db = Session()
    n = ingest(db, d.source, d.text)
    db.close()
    return {"chunks_added": n}


@app.post("/chat")
def chat(c: ChatIn):
    db = Session()
    p = db.get(Profile, c.user_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    ctx = retrieve(db, c.question)
    past = db.query(Message).filter_by(user_id=c.user_id).order_by(Message.id.desc()).limit(6).all()
    history = "\n".join(f"{m.role}: {m.content}" for m in reversed(past))
    if client is None:
        raise HTTPException(503, "Gemini API key is not configured")
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=build_prompt(p, c.question, ctx, history),
            config=types.GenerateContentConfig(system_instruction=SYSTEM, temperature=0.2),
        )
        answer = "".join(part.text for part in response.candidates[0].content.parts if getattr(part, "text", None))
        if not answer:
            answer = getattr(response, "text", "") or ""
    except Exception as e:
        raise HTTPException(502, f"Gemini error: {e}")
    db.add_all([Message(user_id=c.user_id, role="user", content=c.question),
                Message(user_id=c.user_id, role="advisor", content=answer)])
    db.commit()
    sources = [{"id": f"S{i+1}", "source": x.source} for i, x in enumerate(ctx)]
    db.close()
    return {"answer": answer, "sources": sources}


@app.get("/history/{user_id}")
def history(user_id: int):
    db = Session()
    rows = db.query(Message).filter_by(user_id=user_id).order_by(Message.id).all()
    out = [{"id": m.id, "role": m.role, "content": m.content,
            "created": m.created.isoformat() if m.created else None} for m in rows]
    db.close()
    return out


# ───────────────────────── dashboard + past-conversation analytics ─────────────────────────
TOPICS = {
    "Emergency fund": ["emergency", "rainy", "buffer"],
    "Debt": ["debt", "loan", "credit card", "emi", "repay", "interest rate"],
    "Investing": ["invest", "stock", "mutual", "etf", "index", "sip", "portfolio", "equity", "bond"],
    "Savings": ["saving", "save", "savings rate"],
    "Budgeting": ["budget", "spend", "expense", "cut", "50/30/20"],
    "Home & goals": ["home", "house", "mortgage", "goal", "car", "wedding", "down payment"],
    "Retirement": ["retire", "pension", "401", "nps", "ppf"],
    "Tax": ["tax", "deduction", "80c", "itr"],
}


def _iso(dt):
    return dt.isoformat() if dt else None


def _topic_of(text: str):
    t = (text or "").lower()
    hits = [name for name, words in TOPICS.items() if any(w in t for w in words)]
    return hits or ["Other"]


@app.get("/health")
def health():
    """Tells the UI which database is REALLY connected (MySQL vs the SQLite fallback)."""
    db = Session()
    try:
        counts = {"profiles": db.query(Profile).count(),
                  "messages": db.query(Message).count(),
                  "chunks": db.query(Chunk).count()}
    finally:
        db.close()
    name = engine.url.database
    return {"ok": True, "db": DB_KIND, "database": name, "counts": counts}


@app.get("/profile/{user_id}")
def get_profile(user_id: int):
    db = Session()
    p = db.get(Profile, user_id)
    db.close()
    if not p:
        raise HTTPException(404, "Profile not found")
    return {"user_id": p.id, "name": p.name, "age": p.age, "income": p.income, "savings": p.savings,
            "debt": p.debt, "risk": p.risk, "goal": p.goal, "monthly_expenses": p.monthly_expenses or []}


@app.get("/analytics/conversations")
def conversation_analytics(user_id: Optional[int] = None):
    """Everything the 'Past conversations' page needs, built only from the messages table
    (profiles is joined just to show names)."""
    db = Session()
    q = db.query(Message)
    if user_id is not None:
        q = q.filter(Message.user_id == user_id)
    msgs = q.order_by(Message.id).all()
    names = {p.id: p.name for p in db.query(Profile).all()}
    db.close()

    per_day = defaultdict(lambda: {"user": 0, "advisor": 0})
    heat = [[0] * 24 for _ in range(7)]            # weekday (Mon=0) x hour
    topics = Counter()
    convs = {}
    ans_lens, cited = [], 0
    answers = 0

    for m in msgs:
        role = "user" if m.role == "user" else "advisor"
        c = convs.setdefault(m.user_id, {
            "user_id": m.user_id, "name": names.get(m.user_id) or (f"User #{m.user_id}" if m.user_id is not None else "Unknown"),
            "messages": 0, "questions": 0, "first_at": None, "last_at": None,
            "first_question": None, "last_question": None, "topics": Counter()})
        c["messages"] += 1
        if m.created:
            day = m.created.date().isoformat()
            per_day[day][role] += 1
            if role == "user":
                heat[m.created.weekday()][m.created.hour] += 1
            c["first_at"] = c["first_at"] or _iso(m.created)
            c["last_at"] = _iso(m.created)
        if role == "user":
            c["questions"] += 1
            c["first_question"] = c["first_question"] or m.content
            c["last_question"] = m.content
            for t in _topic_of(m.content):
                topics[t] += 1
                c["topics"][t] += 1
        else:
            answers += 1
            ans_lens.append(len(m.content or ""))
            if re.search(r"\[S\d+\]", m.content or ""):
                cited += 1

    conv_list = []
    for c in convs.values():
        c["topics"] = [t for t, _ in c["topics"].most_common(3)]
        conv_list.append(c)
    conv_list.sort(key=lambda c: c["last_at"] or "", reverse=True)

    days = sorted(per_day)
    return {
        "kpis": {
            "messages": len(msgs),
            "conversations": len(convs),
            "questions": sum(c["questions"] for c in conv_list),
            "answers": answers,
            "avg_answer_chars": round(sum(ans_lens) / len(ans_lens)) if ans_lens else 0,
            "cited_pct": round(cited / answers * 100) if answers else 0,
            "active_days": len(days),
        },
        "per_day": [{"date": d, **per_day[d]} for d in days],
        "heatmap": heat,
        "topics": [{"topic": t, "count": n} for t, n in topics.most_common()],
        "conversations": conv_list,
    }
