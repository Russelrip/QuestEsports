# Quest Express — LOCAL DEVELOPMENT ONLY.
#
# Production deploys from `.github/workflows/cd.yml` to PM2 on the API VPS,
# gated by MIGRATION_APPROVAL_SHA, with ops/ owning backup, restore, and secret
# recovery. This image is not part of that path and must not become part of it
# without redesigning those controls first.

# Matches backend/package.json engines ("node": "24.x") and .nvmrc.
FROM node:24-bookworm-slim

# openssl is required by Prisma's query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Dependencies are installed at build time; source is bind-mounted at run time
# so edits appear without a rebuild.
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
# `postinstall` runs `prisma generate`, which needs the schema present.
RUN npm ci

ENV NODE_ENV=development
EXPOSE 5001

# No secrets are baked in: every value arrives through compose at run time.
CMD ["npm", "run", "dev"]
