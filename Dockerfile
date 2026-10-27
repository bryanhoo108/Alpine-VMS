# Alpine VMS: server + built screens in one image. Runs on any Linux or
# Windows Server host with Docker; see docs/INSTALL.md for a native install.
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile && pnpm --filter @vms/web build

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIR=/app/apps/web/dist \
    FILES_DIR=/data/files
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
