# AI Incident & Support Management System

A beginner-friendly MVP for IT incident/support management.

## Features
- Create incidents/support tickets
- AI-assisted category and priority classification
- AI summary, likely root-cause hypothesis, and recommended next steps
- P1/P2/P3/P4 priority model
- Incident lifecycle: Open → In Progress → Resolved
- Assignee field
- Search/filter
- Re-run AI triage
- SQLite database
- Works without an API key using deterministic fallback triage

## Run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Optional: add OPENAI_API_KEY to .env
uvicorn app.main:app --reload
```
Open http://127.0.0.1:8000

## Production roadmap
1. PostgreSQL + migrations
2. Login/RBAC (admin, agent, requester)
3. SLA timers and escalation rules
4. Email/Slack/Teams integrations
5. Knowledge-base RAG for grounded resolutions
6. Audit logs and immutable activity history
7. Attachments and log ingestion
8. Analytics dashboard: MTTR, SLA breaches, volume, backlog
9. Docker + CI/CD
10. Human approval before AI-triggered external actions
