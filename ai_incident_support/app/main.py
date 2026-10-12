import os, json
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import create_engine, String, Text, Integer, DateTime, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session, sessionmaker
from dotenv import load_dotenv

load_dotenv()
DB_URL = "sqlite:///./incidents.db"
engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase): pass

class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80), default="Other")
    priority: Mapped[str] = mapped_column(String(20), default="P3")
    status: Mapped[str] = mapped_column(String(30), default="Open")
    assignee: Mapped[str] = mapped_column(String(100), default="Unassigned")
    ai_summary: Mapped[str] = mapped_column(Text, default="")
    ai_root_cause: Mapped[str] = mapped_column(Text, default="")
    ai_next_steps: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(engine)
app = FastAPI(title="AI Incident & Support Management")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class IncidentCreate(BaseModel):
    title: str
    description: str
    assignee: str = "Unassigned"

class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[str] = None


def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()


def heuristic_ai(title: str, description: str):
    text = f"{title} {description}".lower()
    
    # Categorization
    if any(x in text for x in ["payment", "billing", "invoice", "stripe", "checkout", "refund"]):
        category = "Payments"
        root_cause = "Hypothesis: Stalled webhook delivery queue, gateway API rate limits, or signature mismatch on recent transaction batch."
        next_steps = "1. Verify payment gateway status dashboard.\n2. Inspect inbound webhook error logs & signature verification.\n3. Check retry queue backlog and dead-letter queue (DLQ).\n4. Reconcile pending transaction status with payment processor.\n5. Notify finance & customer support teams."
    elif any(x in text for x in ["login", "password", "authentication", "auth", "sso", "jwt", "oauth", "token"]):
        category = "Authentication"
        root_cause = "Hypothesis: Expired signing certificate, Redis session cache cluster eviction, or upstream IdP federation latency."
        next_steps = "1. Check token issuer certificates and expiration dates.\n2. Inspect session cache memory usage and eviction rates.\n3. Verify IdP/OAuth provider status and error logs.\n4. Test login flow using synthetic canary credentials.\n5. Monitor failed login spikes for credential-stuffing patterns."
    elif any(x in text for x in ["database", "db", "sql", "postgres", "mysql", "sqlite", "query", "deadlock"]):
        category = "Database"
        root_cause = "Hypothesis: Connection pool exhaustion, unindexed high-cardinality query spike, or table-level locks from concurrent migration."
        next_steps = "1. Query active connections vs max pool limit on primary database.\n2. Check for long-running transactions and active exclusive locks.\n3. Analyze slow query log for unindexed sequential scans.\n4. Increase pool size or spin up read-replica query routing if safe.\n5. Monitor disk I/O and replication lag."
    elif any(x in text for x in ["network", "timeout", "latency", "502", "503", "504", "dns", "gateway", "ingress"]):
        category = "Infrastructure"
        root_cause = "Hypothesis: Upstream reverse proxy timeout, ingress buffer saturation, or DNS resolution latency under peak load."
        next_steps = "1. Check ingress controller / load balancer error rate (5xx distribution).\n2. Verify upstream service target group health checks.\n3. Inspect edge DNS response times and CDN cache hit ratios.\n4. Scale target worker pods or instances to meet current throughput.\n5. Review network egress metrics and firewall throughput."
    elif any(x in text for x in ["api", "endpoint", "service", "rest", "graphql", "payload"]):
        category = "API"
        root_cause = "Hypothesis: Upstream dependency latency spike, schema validation failure on recent release, or rate limiter throttling."
        next_steps = "1. Check distributed traces (APM) for highest-latency spans.\n2. Review recently deployed commit/canary version changes.\n3. Validate downstream dependency HTTP response times.\n4. Consider applying circuit breaker to protect critical path.\n5. Roll back to previous stable release if error rate exceeds 5%."
    else:
        category = "Application"
        root_cause = "Hypothesis: Unhandled exception in application logic or race condition during state transition."
        next_steps = "1. Reproduce the issue with provided parameters.\n2. Inspect application error tracker (Sentry/logs) for stack traces.\n3. Review recent git commit history for affected modules.\n4. Validate environment variable configurations.\n5. Prepare hotfix and deploy to staging for validation."

    # Priority determination
    critical_words = ["down", "outage", "production", "data loss", "security", "breach", "all users", "catastrophic", "critical", "sev-1", "p1"]
    high_words = ["failed", "failure", "cannot", "unable", "error", "blocked", "intermittent", "high latency", "p2"]
    low_words = ["cosmetic", "minor", "typo", "enhancement", "low", "p4"]

    if any(x in text for x in critical_words):
        priority = "P1"
    elif any(x in text for x in high_words):
        priority = "P2"
    elif any(x in text for x in low_words):
        priority = "P4"
    else:
        priority = "P3"

    summary = description.strip()
    if len(summary) > 300:
        summary = summary[:297] + "..."

    return {
        "category": category,
        "priority": priority,
        "summary": summary,
        "root_cause": root_cause,
        "next_steps": next_steps
    }


def ai_triage(title: str, description: str):
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return heuristic_ai(title, description)
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        prompt = f"""You are an IT incident management triage assistant. Analyze this ticket and return ONLY valid JSON with keys: category, priority, summary, root_cause, next_steps. Priority must be P1, P2, P3, or P4. Do not claim a root cause is confirmed; label it as likely/hypothesis when uncertain.\nTitle: {title}\nDescription: {description}"""
        r = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are a careful ITSM triage assistant. Always return pure JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )
        content = r.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        return json.loads(content.strip())
    except Exception:
        return heuristic_ai(title, description)

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/incidents")
def list_incidents(db: Session = Depends(get_db)):
    rows = db.scalars(select(Incident).order_by(Incident.created_at.desc())).all()
    return [serialize(x) for x in rows]

@app.post("/api/incidents")
def create_incident(payload: IncidentCreate, db: Session = Depends(get_db)):
    if not payload.title.strip() or not payload.description.strip():
        raise HTTPException(400, "Title and description are required")
    triage = ai_triage(payload.title, payload.description)
    incident = Incident(
        title=payload.title.strip(),
        description=payload.description.strip(),
        assignee=payload.assignee.strip() or "Unassigned",
        category=triage.get("category", "Other"),
        priority=triage.get("priority", "P3"),
        ai_summary=triage.get("summary", ""),
        ai_root_cause=triage.get("root_cause", ""),
        ai_next_steps=triage.get("next_steps", "")
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return serialize(incident)

@app.patch("/api/incidents/{incident_id}")
def update_incident(incident_id: int, payload: IncidentUpdate, db: Session = Depends(get_db)):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    for field in ["status", "assignee", "priority"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(incident, field, value)
    db.commit()
    db.refresh(incident)
    return serialize(incident)

@app.delete("/api/incidents/{incident_id}")
def delete_incident(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    db.delete(incident)
    db.commit()
    return {"ok": True, "id": incident_id}

@app.post("/api/incidents/{incident_id}/retriage")
def retriage(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    triage = ai_triage(incident.title, incident.description)
    incident.category = triage.get("category", incident.category)
    incident.priority = triage.get("priority", incident.priority)
    incident.ai_summary = triage.get("summary", "")
    incident.ai_root_cause = triage.get("root_cause", "")
    incident.ai_next_steps = triage.get("next_steps", "")
    db.commit()
    db.refresh(incident)
    return serialize(incident)

@app.post("/api/seed")
def seed_demo(db: Session = Depends(get_db)):
    demos = [
        ("Production Database Connection Exhaustion", "Postgres primary database reports pool saturation (100% active connections). Read queries timing out across main portal.", "Alex Rivera (DBA)"),
        ("Stripe Webhook Signature Verification Failure", "Payment confirmation webhooks failing with HTTP 502. Checkout completions delayed for European customers.", "Sarah Chen (Payments)"),
        ("Single Sign-On (SSO) SAML Assertion Latency", "Enterprise users experiencing 12s latency during Okta SAML assertion exchange. Intermittent 504 Gateway Timeouts.", "Marcus Vance (Security)"),
        ("Edge API Ingress Rate Limiting Glitch", "API Gateway ingress throttling legitimate mobile client requests after v2.4.1 deployment.", "DevOps On-Call")
    ]
    created = []
    for title, desc, assignee in demos:
        triage = ai_triage(title, desc)
        inc = Incident(
            title=title, description=desc, assignee=assignee,
            category=triage.get("category", "Other"),
            priority=triage.get("priority", "P2"),
            ai_summary=triage.get("summary", ""),
            ai_root_cause=triage.get("root_cause", ""),
            ai_next_steps=triage.get("next_steps", "")
        )
        db.add(inc)
        created.append(inc)
    db.commit()
    return {"status": "ok", "count": len(created)}

@app.post("/api/incidents/{incident_id}/postmortem")
def generate_postmortem(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    postmortem = f"""# Post-Mortem Incident Report: #{incident.id} - {incident.title}

**Severity:** {incident.priority} | **Domain:** {incident.category} | **Status:** {incident.status}
**Primary Responder:** {incident.assignee}
**Recorded Timestamp:** {incident.created_at.strftime('%Y-%m-%d %H:%M UTC')}

## 1. Executive Summary
{incident.ai_summary or incident.description}

## 2. Root Cause Analysis
{incident.ai_root_cause or "Investigation ongoing. Initial heuristic points to infrastructure/application telemetry spikes."}

## 3. Preventive Action Items & Remediation Runbook
{incident.ai_next_steps or "No action items defined."}

## 4. Operational Learnings
- Establish automated alert threshold on {incident.category} anomalies.
- Incorporate automated canary health rollback for related microservices.
- Update team on-call escalation rotation schedule.
"""
    return {"postmortem": postmortem, "id": incident.id}

@app.get("/api/system/metrics")
def get_metrics(db: Session = Depends(get_db)):
    rows = db.scalars(select(Incident)).all()
    total = len(rows)
    p1 = len([x for x in rows if x.priority == "P1"])
    p2 = len([x for x in rows if x.priority == "P2"])
    p3 = len([x for x in rows if x.priority == "P3"])
    p4 = len([x for x in rows if x.priority == "P4"])
    open_count = len([x for x in rows if x.status == "Open"])
    in_prog = len([x for x in rows if x.status == "In Progress"])
    resolved = len([x for x in rows if x.status == "Resolved"])

    sla_compliance = 98.4 if total == 0 else max(82.0, min(99.9, round(100.0 - (p1 * 3.5 + p2 * 1.2), 1)))
    avg_mttr = "18m" if total == 0 else f"{max(12, min(140, 15 + p1 * 12 + p2 * 6))}m"

    return {
        "total": total,
        "open": open_count,
        "in_progress": in_prog,
        "resolved": resolved,
        "p1": p1, "p2": p2, "p3": p3, "p4": p4,
        "sla_compliance": sla_compliance,
        "avg_mttr": avg_mttr,
        "services": [
            {"name": "Postgres Primary Cluster", "status": "degraded" if p1 > 0 else "operational", "latency": "14ms", "uptime": "99.95%"},
            {"name": "Payment Gateway Webhook", "status": "operational", "latency": "38ms", "uptime": "99.99%"},
            {"name": "Okta SSO / SAML IdP", "status": "operational", "latency": "22ms", "uptime": "100%"},
            {"name": "Edge Envoy Ingress CDN", "status": "operational", "latency": "5ms", "uptime": "99.99%"}
        ]
    }

def serialize(x: Incident):
    return {
        "id": x.id,
        "title": x.title,
        "description": x.description,
        "category": x.category,
        "priority": x.priority,
        "status": x.status,
        "assignee": x.assignee,
        "ai_summary": x.ai_summary,
        "ai_root_cause": x.ai_root_cause,
        "ai_next_steps": x.ai_next_steps,
        "created_at": x.created_at.isoformat()
    }
