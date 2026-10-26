FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.22.0 --ignore-scripts \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && npm cache clean --force
COPY src ./src
RUN mkdir -p /credentials /run/odk-gmail \
    && chmod 700 /credentials /run/odk-gmail \
    && chown 1000:1000 /credentials /run/odk-gmail
USER 1000:1000
ENV NODE_ENV=production
ENV ODK_GMAIL_SERVICE_SOCKET=/run/odk-gmail/query.sock
ENV ODK_MCP_GMAIL_CREDENTIALS_FILE=/credentials/credentials.json
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "/app/src/healthcheck.mjs"]
ENTRYPOINT ["node", "/app/src/daemon.mjs"]
