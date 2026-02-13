import asyncio
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional, List
import re
import sys
import traceback
import docker
from docker.errors import DockerException
from docker.models.containers import Container
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi.responses import JSONResponse

@asynccontextmanager
async def lifespan(app: FastAPI):
    global cleanup_task
    cleanup_task = asyncio.create_task(cleanup_waiting_containers())
    try:
        yield
    finally:
        if cleanup_task and not cleanup_task.done():
            cleanup_task.cancel()


app = FastAPI(lifespan=lifespan)
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
templates = Jinja2Templates(directory="templates")
FILE_ROOT = Path("files")
DOCKER_IMAGE = os.getenv("CROCLE_IMAGE", "schollz/croc")

TRANSFERS = {}
TRANSFER_TIMEOUT_SECONDS = 600
CLEANUP_INTERVAL_SECONDS = 60
WAITING_MAX_AGE_SECONDS = 600
cleanup_task: Optional[asyncio.Task] = None
ALLOWED_HASHES = {"imohash", "default"}
DOCKER_CLIENT = docker.from_env()

def list_files(root: Path, current_path: Path) -> list[dict]:
    root_resolved = root.resolve()
    current_resolved = current_path.resolve()
    if not current_resolved.exists() or not current_resolved.is_dir():
        return []

    files = []
    for entry in current_resolved.iterdir():
        relative_path = entry.relative_to(root_resolved).as_posix()
        if entry.is_dir():
            files.append(
                {
                    "name": entry.name,
                    "kind": "folder",
                    "icon": "folder",
                    "path": relative_path,
                }
            )
        elif entry.is_file():
            files.append(
                {
                    "name": entry.name,
                    "kind": "file",
                    "icon": "file",
                    "path": relative_path,
                }
            )

    return sorted(
        files,
        key=lambda item: (item["kind"] != "folder", item["name"].lower()),
    )


def resolve_entry(root: Path, name: str) -> Optional[Path]:
    if not name:
        return root.resolve()
    candidate = (root / name).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if not candidate.exists():
        return None
    return candidate

PROGRESS_LINE_REGEX = re.compile(r"\b\d{1,3}%\s*\|")
SPEED_REGEX = re.compile(r"\b\d+(?:\.\d+)?\s*[kmgtpe]i?b\s*/\s*s\b", re.IGNORECASE)


def decode_log_lines(raw: bytes) -> list[str]:
    text = raw.decode("utf-8", errors="replace")
    parts = re.split(r"[\r\n]+", text)
    return [part.strip() for part in parts if part.strip()]


@lru_cache(maxsize=1)
def resolve_host_files_path() -> str:
    container_id = os.environ.get("HOSTNAME")
    if container_id:
        try:
            current = DOCKER_CLIENT.containers.get(container_id)
            target_paths = {
                str(FILE_ROOT.resolve()),
                "/app/files",
                "/files",
            }
            for mount in current.attrs.get("Mounts", []):
                destination = mount.get("Destination")
                if destination in target_paths:
                    source = mount.get("Source")
                    if source:
                        return source
        except DockerException:
            pass
    if Path("/.dockerenv").exists():
        raise RuntimeError(
            "FILES volume not mounted. Bind your host files folder to /app/files, e.g. "
            "- /Users/you/crocle/files:/app/files:ro"
        )
    return str(FILE_ROOT.resolve())


def parse_docker_time(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def parse_code(lines: list[str]) -> Optional[str]:
    for line in lines:
        match = re.search(r"CROC_SECRET=\"([a-z0-9-]+)\"", line, re.IGNORECASE)
        if match:
            return match.group(1)
        match = re.search(r"Code\s+is:\s*([a-z0-9-]+)", line, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def find_last_progress_line(lines: list[str]) -> Optional[str]:
    for line in reversed(lines):
        if PROGRESS_LINE_REGEX.search(line):
            return line
    return None


def parse_progress_details(line: str) -> dict:
    percent = None
    filename = None
    percent_match = re.search(r"(\d{1,3})%\s*\|", line)
    if percent_match:
        percent = int(percent_match.group(1))

    filename_match = re.search(r"^(.*?)\s+\d{1,3}%\s*\|", line)
    if filename_match:
        filename = filename_match.group(1).strip()

    speed = None
    speed_match = SPEED_REGEX.search(line)
    if speed_match:
        speed = speed_match.group(0).replace(" ", "")

    eta = None
    bracket_match = re.search(r"\[([^\]]+)\]", line)
    if bracket_match:
        content = bracket_match.group(1).strip()
        if content:
            parts = [part.strip() for part in content.split(":") if part.strip()]
            if parts:
                eta = parts[-1]

    return {"percent": percent, "speed": speed, "eta": eta, "filename": filename}

def handle_container(container: Container):
    status: str = "preparing"
    code: str = ""

    try:
        container.reload()
    except DockerException:
        pass

    created_at = None
    started_at = None
    if container.attrs:
        created_at = container.attrs.get("Created")
        started_at = container.attrs.get("State", {}).get("StartedAt")

    logs = decode_log_lines(container.logs(tail=200))
    last_progress = find_last_progress_line(logs)
    details = parse_progress_details(last_progress) if last_progress else {}
    code = parse_code(logs) or ""

    if details.get("percent") is not None:
        status = "transferring"
    elif code:
        status = "waiting"

    created_timestamp = parse_docker_time(created_at)
    waiting_minutes_ago = None
    waiting_minutes_remaining = None
    if status == "waiting" and created_timestamp is not None:
        elapsed_seconds = time.time() - created_timestamp
        waiting_minutes_ago = int(elapsed_seconds / 60)
        waiting_minutes_remaining = max(0, int((WAITING_MAX_AGE_SECONDS - elapsed_seconds) / 60))

    label_filename = None
    if container.labels:
        label_filename = container.labels.get("crocle.filename")

    return {
        "status": status,
        "code": code,
        "progress": details.get("percent") or 0,
        "speed": details.get("speed"),
        "eta": details.get("eta"),
        "filename": details.get("filename"),
        "last_progress": last_progress or "",
        "created_at": created_at,
        "started_at": started_at,
        "waiting_minutes_ago": waiting_minutes_ago,
        "waiting_minutes_remaining": waiting_minutes_remaining,
        "created_timestamp": created_timestamp,
        "label_filename": label_filename,
    }


async def cleanup_waiting_containers():
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        try:
            containers: List[Container] = await asyncio.to_thread(
                DOCKER_CLIENT.containers.list,
                filters={"label": "crocle"},
            )
        except DockerException:
            continue

        now = time.time()
        for container in containers:
            info = handle_container(container)
            if info.get("status") != "waiting":
                continue
            created_timestamp = info.get("created_timestamp")
            if created_timestamp is None:
                continue
            if now - created_timestamp < WAITING_MAX_AGE_SECONDS:
                continue
            try:
                await asyncio.to_thread(container.remove, force=True)
            except DockerException:
                continue


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/files", response_class=HTMLResponse)
async def get_files(request: Request, path: str = ""):
    current_dir = resolve_entry(FILE_ROOT, path)
    if not current_dir or not current_dir.is_dir():
        files = []
        current_path = ""
    else:
        files = list_files(FILE_ROOT, current_dir)
        current_path = current_dir.resolve().relative_to(FILE_ROOT.resolve()).as_posix()
    breadcrumbs = []
    if current_path:
        segments = current_path.split("/")
        for index in range(len(segments)):
            crumb_path = "/".join(segments[: index + 1])
            breadcrumbs.append({"name": segments[index], "path": crumb_path})
    return templates.TemplateResponse(
        request=request,
        name="files.html",
        context={
            "files": files,
            "file_root": str(FILE_ROOT),
            "current_path": current_path,
            "breadcrumbs": breadcrumbs,
        }
    )


@app.get("/acknowledgements", response_class=HTMLResponse)
async def acknowledgements(request: Request):
    return templates.TemplateResponse(request=request, name="acknowledgements.html")

@app.post("/transfer", response_class=JSONResponse)
async def start_transfer(request: Request):
    form = await request.form()
    name = form.get("filename", "")
    hash_value = form.get("hash", "imohash")
    hash_algo = hash_value if isinstance(hash_value, str) else "imohash"
    if hash_algo not in ALLOWED_HASHES:
        hash_algo = "imohash"

    if not isinstance(name, str) or not name:
        return JSONResponse({"error": "No file selected."}, status_code=400)

    file_path = resolve_entry(FILE_ROOT, name)
    if not file_path or not (file_path.is_file() or file_path.is_dir()):
        return JSONResponse({"error": "Invalid file selection."}, status_code=400)

    container_file = f"/files/{file_path.name}"
    try:
        container = DOCKER_CLIENT.containers.run(
            DOCKER_IMAGE,
            command=["send", "--hash", hash_algo, container_file],
            detach=True,
            stdout=True,
            stderr=True,
            remove=True,
            tty=True,
            stdin_open=True,
            mem_limit="100m",
            labels={"crocle": "true", "crocle.filename": name},
            environment={"HOME": "/tmp", "XDG_CONFIG_HOME": "/tmp/.config"},
            volumes={resolve_host_files_path(): {"bind": "/files", "mode": "ro"}},
        )
    except RuntimeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)
    except DockerException as exc:
        print("Docker error while starting transfer:", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            {
                "error": "Docker is not available or image failed to start.",
                "detail": str(exc),
            },
            status_code=500,
        )

    return JSONResponse({ "hello": "123" })

@app.get("/transfers", response_class=JSONResponse)
async def current_transfers(request: Request):

    containers: List[Container] = DOCKER_CLIENT.containers.list(filters={"label": "crocle"})

    return templates.TemplateResponse(
          request=request,
          name="transfers.html",
          context={ "transfers": [handle_container(container) for container in containers] }
      )
