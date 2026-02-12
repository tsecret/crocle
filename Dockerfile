FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

ARG CROC_VERSION=10.0.4
RUN set -eux; \
  arch="$(uname -m)"; \
  case "$arch" in \
    x86_64) croc_arch="64bit" ;; \
    aarch64|arm64) croc_arch="ARM64" ;; \
    *) echo "Unsupported architecture: $arch"; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/croc.tar.gz \
    "https://github.com/schollz/croc/releases/download/v${CROC_VERSION}/croc_v${CROC_VERSION}_Linux-${croc_arch}.tar.gz"; \
  tar -xzf /tmp/croc.tar.gz -C /usr/local/bin croc; \
  rm -f /tmp/croc.tar.gz; \
  croc --version

COPY main.py /app/main.py
COPY templates /app/templates

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
