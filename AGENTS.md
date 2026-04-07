# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

SolEdu is an AI-driven K12 education platform (Chinese-market). Single monorepo with:
- **Python FastAPI backend** (port 8000) — all business logic
- **React + Vite frontend** (port 5173) — proxies `/api` to backend
- **No database** — all data is file-based (YAML/JSON on disk)

### Running services

See `README.md` § "本地编译" for standard commands. Key quick-ref:

| Service | Command | Port |
|---------|---------|------|
| Backend | `python3 -m uvicorn solaire.web.app:app --host 127.0.0.1 --port 8000` | 8000 |
| Frontend | `cd web && npm run dev` | 5173 |

Or use `./start-web.sh` to launch both at once.

### Testing

- Backend: `pytest` (from repo root)
- Frontend: `cd web && npm test` (vitest)
- TypeScript check: `cd web && npx tsc -b --noEmit`
- The test `test_multiple_exams_sorted_newest_first` in `tests/test_result_service.py` is a known pre-existing failure (sort-order bug in the codebase, not an environment issue).

### Non-obvious caveats

- `python-multipart` is required by FastAPI for file-upload endpoints but is **not** listed in `pyproject.toml` dependencies. It gets installed as a transitive dependency in some environments but may need explicit installation: `pip install python-multipart`.
- Scripts installed by `pip install -e .` (e.g. `uvicorn`, `pytest`) go to `~/.local/bin` — ensure this is on `PATH` (`export PATH="$HOME/.local/bin:$PATH"`).
- Use `python3` (not `python`) on this VM — `python` is not symlinked by default.
- PDF export requires a TeX distribution (`latexmk` + `xelatex`). Not needed for general development/testing — the app gracefully detects and warns if TeX is missing.
- The AI assistant feature requires an OpenAI-compatible API key configured via the UI. All other features work without it.
- To work with a project, you must first create/open one via the API or UI. Example: `curl -X POST http://127.0.0.1:8000/api/project/create -H 'Content-Type: application/json' -d '{"parent": "/tmp/solaire-projects", "name": "test", "template": "math"}'`
