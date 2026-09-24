# Production image for the sibling VALORANT service boundary.
# Certificates, keys, database URLs, and all other deployment secrets are
# intentionally absent from this image and are mounted/injected at runtime.
FROM python:3.14-slim@sha256:caaf356f40667c496d405780745b9ac25771c189a51dfcc42430d531ea09f8a2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && groupadd --gid 10002 valorant-tls \
    && useradd --create-home --uid 10001 --gid app --groups valorant-tls --shell /usr/sbin/nologin app

COPY --from=ghcr.io/astral-sh/uv:0.8.14@sha256:f3660c56d5b08d6c516360981bedc439f499b9bf37f46a216018da3777a74011 /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app
COPY workers ./workers
COPY scripts ./scripts
COPY supabase ./supabase

RUN chown -R app:app /app
USER app

# Compose supplies the TLS arguments and the service-specific command.
ENTRYPOINT ["/app/.venv/bin/python", "-m", "scripts.validate_release_image"]
EXPOSE 8000
