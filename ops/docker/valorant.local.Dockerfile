# valorant-platform-backend — LOCAL DEVELOPMENT ONLY.
#
# Built from the sibling repository so the two services can talk over a private
# compose network instead of a localhost assumption. The sibling repo owns its
# own deployment; this image exists purely for local parity.

# pyproject.toml requires >=3.11.
FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# uv is the project's documented toolchain (`uv sync`, `uv run`).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

ENV APP_ENV=local
EXPOSE 8000

# Binds to 0.0.0.0 so compose can reach it. It is published only to the host
# loopback (see the compose file); it must never be exposed beyond that.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
