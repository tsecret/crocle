import asyncio
import json
import re
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
templates = Jinja2Templates(directory="templates")
FILE_ROOT = Path("files")

TRANSFERS = {}
TRANSFER_TIMEOUT_SECONDS = 600
ALLOWED_HASHES = {"imohash", "default"}


class Transfer:
    def __init__(self, transfer_id: str, filename: str, file_path: Path, hash_algo: str):
        self.id = transfer_id
        self.filename = filename
        self.file_path = file_path
        self.hash_algo = hash_algo
        self.command = self._build_command()
        self.status: str = "starting"
        self.progress: int = 0
        self.code: Optional[str] = None
        self.last_output: str = ""
        self.started_at = time.time()
        self.queue = asyncio.Queue()
        self.process: Optional[asyncio.subprocess.Process] = None
        self.timeout_task: Optional[asyncio.Task] = None

    def _build_command(self) -> list[str]:
        return ["croc", "send", "--hash", self.hash_algo, str(self.file_path)]

def list_files(root: Path):
    if not root.exists() or not root.is_dir():
        return []

    files = []
    for entry in root.iterdir():
        if entry.is_dir():
            files.append({"name": entry.name, "kind": "folder", "icon": "folder"})
        elif entry.is_file():
            files.append({"name": entry.name, "kind": "file", "icon": "file"})

    return sorted(
        files,
        key=lambda item: (item["kind"] != "folder", item["name"].lower()),
    )


def resolve_file(root: Path, name: str) -> Optional[Path]:
    candidate = (root / name).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if not candidate.is_file() and not candidate.is_dir():
        return None
    return candidate


def parse_progress(line: str) -> Optional[int]:
    match = re.search(r"(\d{1,3})%", line)
    if not match:
        return None
    value = int(match.group(1))
    if value < 0 or value > 100:
        return None
    return value


def parse_code(line: str) -> Optional[str]:
    secret_match = re.search(r"CROC_SECRET=\"([a-z0-9-]+)\"", line, re.IGNORECASE)
    if secret_match:
        return secret_match.group(1)

    code_match = re.search(r"Code:\s*([a-z0-9-]+)", line, re.IGNORECASE)
    if code_match:
        return code_match.group(1)

    croc_match = re.search(r"\bcroc\s+([a-z0-9-]+)\b", line, re.IGNORECASE)
    if croc_match:
        token = croc_match.group(1)
        if token.lower() != "send":
            return token

    return None


def parse_status(line: str) -> Optional[str]:
    lower = line.lower()
    if lower.startswith("sending "):
        return "preparing"
    if "on the other computer run" in lower:
        return "waiting"
    if "waiting" in lower and "receiver" in lower:
        return "waiting"
    return None


async def send_event(transfer: Transfer, event: dict):
    payload = json.dumps(event)
    await transfer.queue.put(payload)


async def watch_timeout(transfer: Transfer):
    await asyncio.sleep(TRANSFER_TIMEOUT_SECONDS)
    if transfer.process and transfer.process.returncode is None:
        transfer.status = "timeout"
        transfer.process.terminate()
        await send_event(
            transfer,
            {
                "type": "timeout",
                "status": transfer.status,
                "message": "Transfer timed out.",
            },
        )


async def read_process_output(transfer: Transfer):
    if not transfer.process:
        return

    stdout = transfer.process.stdout
    if not stdout:
        return

    async for raw_line in stdout:
        chunk = raw_line.decode(errors="replace")
        for line in chunk.replace("\r", "\n").split("\n"):
            line = line.strip()
            if not line:
                continue
            transfer.last_output = line

            status = parse_status(line)
            if status:
                transfer.status = status

            code = parse_code(line)
            if code:
                transfer.code = code
                transfer.status = "waiting"

            progress = parse_progress(line)
            if progress is not None:
                transfer.progress = progress
                transfer.status = "transferring"

            await send_event(
                transfer,
                {
                    "type": "output",
                    "line": line,
                    "status": transfer.status,
                    "progress": transfer.progress,
                    "code": transfer.code,
                },
            )

    await transfer.process.wait()
    if transfer.status != "timeout":
        transfer.status = "done" if transfer.process.returncode == 0 else "failed"

    await send_event(
        transfer,
        {
            "type": "complete",
            "status": transfer.status,
            "exit_code": transfer.process.returncode,
        },
    )

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/files", response_class=HTMLResponse)
async def get_files(request: Request):
    files = list_files(FILE_ROOT)
    return templates.TemplateResponse(
        request=request,
        name="files.html",
        context={"files": files, "file_root": str(FILE_ROOT)}
    )


@app.post("/transfer/start", response_class=JSONResponse)
async def start_transfer(request: Request):
    form = await request.form()
    name = form.get("filename", "")
    hash_value = form.get("hash", "imohash")
    hash_algo = hash_value if isinstance(hash_value, str) else "imohash"
    if hash_algo not in ALLOWED_HASHES:
        hash_algo = "imohash"

    if not isinstance(name, str) or not name:
        return JSONResponse({"error": "No file selected."}, status_code=400)

    file_path = resolve_file(FILE_ROOT, name)
    if not file_path:
        return JSONResponse({"error": "Invalid file selection."}, status_code=400)

    transfer_id = f"tx-{int(time.time() * 1000)}"
    transfer = Transfer(transfer_id, name, file_path, hash_algo)
    TRANSFERS[transfer_id] = transfer

    try:
        transfer.process = await asyncio.create_subprocess_exec(
            *transfer.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError:
        return JSONResponse(
            {"error": "croc is not installed or not in PATH."},
            status_code=500,
        )

    transfer.timeout_task = asyncio.create_task(watch_timeout(transfer))
    asyncio.create_task(read_process_output(transfer))

    await send_event(
        transfer,
        {
            "type": "start",
            "status": transfer.status,
            "command": " ".join(transfer.command),
        },
    )

    return JSONResponse(
        {
            "id": transfer.id,
            "status": transfer.status,
            "command": " ".join(transfer.command),
        }
    )


@app.get("/transfer/{transfer_id}/stream")
async def stream_transfer(transfer_id: str):
    transfer = TRANSFERS.get(transfer_id)
    if not transfer:
        return JSONResponse({"error": "Transfer not found."}, status_code=404)

    async def event_stream():
        while True:
            payload = await transfer.queue.get()
            yield f"data: {payload}\n\n"
            event = json.loads(payload)
            if event.get("type") in {"complete", "timeout"}:
                break

    return StreamingResponse(event_stream(), media_type="text/event-stream")
