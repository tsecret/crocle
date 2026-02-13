# AGENTS.md

This file guides agentic coding tools working in this repository.
If something here conflicts with the codebase, follow the codebase.

## Sources of truth
- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot rules found in `.github/copilot-instructions.md`.
- Python version is pinned in `.python-version` (3.14).
- Dependencies are pinned in `requirements.txt`.

## Project overview
- FastAPI app in `main.py`.
- Jinja2 templates in `templates/`.
- Croc transfers run inside Docker containers (`schollz/croc`).
- Active transfers are polled via `/transfers` and rendered by `templates/transfers.html`.

## Setup
1. Create a virtual environment.
2. Install dependencies from `requirements.txt`.
3. Ensure Docker is running (Docker Desktop / dockerd).

Example:
```
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the app
- Local dev server:
  `uvicorn main:app --reload --host 0.0.0.0 --port 8000`
- Production-style run:
  `uvicorn main:app --host 0.0.0.0 --port 8000`

## Docker
- App image build (if needed): `docker build -t crocle .`
- App container run: `docker run --rm -p 8000:8000 crocle`
- Transfer containers are launched from `schollz/croc`.
- Transfer containers are labeled `crocle` and cleaned up by a background task.
- Transfer containers are started with `tty=True` and `stdin_open=True` for progress output.

## Lint and format
- No lint or format tooling is configured in this repo.
- If you add linting, prefer `ruff` configured in `pyproject.toml`.
- If you add formatting, prefer `black` or `ruff format`.

## Tests
- No tests are configured in this repo.
- If you add pytest later:
  - Run all tests: `pytest`
  - Run a single file: `pytest tests/test_file.py`
  - Run a single test: `pytest tests/test_file.py::test_name`
  - Run by name: `pytest -k "substring"`

## Key endpoints
- `GET /` renders the main UI (`templates/index.html`).
- `GET /files` renders file list (`templates/files.html`).
- `POST /transfer` starts a croc send in a Docker container.
- `GET /transfers` renders transfer cards (`templates/transfers.html`).

## Code style guidelines
Follow the existing patterns in `main.py` unless changing them globally.

### Imports
- Standard library first, then third-party, then local modules.
- Use a blank line between import groups.
- Prefer explicit imports over wildcard imports.
- Keep imports alphabetized within each group.

### Formatting
- Use 4 spaces for indentation.
- Keep line length reasonable (about 100 chars).
- One class or function per logical block; separate with blank lines.
- Prefer trailing commas in multi-line literals and calls.

### Types
- Use type hints for public functions.
- Use `Optional[T]` or `T | None` when `None` is possible.
- Prefer concrete container types like `list[str]`, `dict[str, Any]`.
- Use `Path` for filesystem paths, not raw strings.

### Naming
- Classes: `CamelCase`.
- Functions and variables: `snake_case`.
- Constants: `UPPER_SNAKE_CASE`.
- Use clear, descriptive names over abbreviations.

### Error handling
- Validate user input early and return clear errors.
- Use `JSONResponse` for API errors, include `status_code`.
- Avoid raising uncaught exceptions from request handlers.
- For Docker errors, return actionable messages.

### Async and concurrency
- Use `async`/`await` consistently in async paths.
- Avoid blocking calls in async handlers.
- Use `asyncio.to_thread` for Docker SDK calls.
- Long-running background tasks should use lifespan handlers.

### HTTP and FastAPI patterns
- Keep endpoint handlers short and focused.
- Separate parsing/validation from side effects.
- Return `HTMLResponse` for template routes, `JSONResponse` for APIs.

### Docker usage
- Transfer containers use image from `CROCLE_IMAGE` (default `schollz/croc`).
- Container command should be string-only args (no `Path` objects).
- Always mount `files/` read-only at `/files`.
- Always set `HOME=/tmp` and `XDG_CONFIG_HOME=/tmp/.config`.
- Use label `crocle` for cleanup and filtering.

### Log parsing
- Croc progress lines use carriage returns; split logs on `\r` and `\n`.
- Use the last line containing `% |` as the active progress line.
- Parse percent, speed, ETA, and filename from the progress line.

## Repository conventions
- `files/` is ignored in `.gitignore` and should not be committed.
- `.env` is ignored and should not be committed.
- Use `requirements.txt` for dependency updates.

## Behavior notes
- Cleanup task runs every minute and removes waiting containers older than 10 minutes.
- Waiting state is detected by presence of a croc code and no progress line.
- Transfer status is inferred from logs, not container exit status.

## Suggested local checks before shipping
- Run the app and manually exercise:
  - GET `/`
  - GET `/files`
  - POST `/transfer`
  - GET `/transfers`
- Verify Docker is running and `schollz/croc` image is pullable.
