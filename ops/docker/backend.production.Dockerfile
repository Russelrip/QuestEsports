# Immutable production images for the Quest Express API.
#
# The build context is backend/. The dependency stage deliberately generates
# Prisma for the image platform because src/generated is excluded from the
# context. The runtime target contains only production dependencies; the
# migrator target retains Prisma CLI, migrations, and operational scripts for
# one-shot release commands.

FROM node:24-bookworm-slim AS dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

# npm ci installs the complete dependency graph, including Prisma CLI. The
# explicit generate keeps the image-platform client generation contract clear
# even though package.json also runs it from postinstall.
RUN npm ci \
  && npx prisma generate

FROM dependencies AS production-dependencies

# Pruning the already-generated full install keeps production dependencies
# while avoiding a second install whose postinstall would lack Prisma CLI.
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 quest \
  && useradd --system --uid 1001 --gid 1001 quest

WORKDIR /app

ENV NODE_ENV=production

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=1001:1001 src ./src
COPY --from=dependencies --chown=1001:1001 /app/src/generated ./src/generated

USER 1001:1001

EXPOSE 5001

CMD ["node", "src/server.js"]

FROM dependencies AS migrator

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 quest \
  && useradd --system --uid 1001 --gid 1001 quest

COPY --chown=1001:1001 src ./src
COPY --from=dependencies --chown=1001:1001 /app/src/generated ./src/generated
COPY --chown=1001:1001 scripts ./scripts
COPY --chown=1001:1001 prisma ./prisma

USER 1001:1001
