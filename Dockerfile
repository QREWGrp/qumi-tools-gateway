# Audited amd64 release; do not replace version or checksum independently.
FROM node:22-bookworm-slim AS depot-download
COPY scripts/extract-depot.sh /usr/local/bin/extract-depot.sh
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar && rm -rf /var/lib/apt/lists/*
ARG DEPOT_VERSION=2.103.12
ARG DEPOT_SHA256=b1b5505326b9fc603a1a315a8f6518ac5326ce9a41910c5c8d88051cb34b18c8
RUN set -eux; \
  curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
    "https://github.com/depot/cli/releases/download/v${DEPOT_VERSION}/depot_${DEPOT_VERSION}_linux_amd64.tar.gz" -o /tmp/depot.tgz; \
  echo "${DEPOT_SHA256}  /tmp/depot.tgz" | sha256sum --check --status; \
  sh /usr/local/bin/extract-depot.sh /tmp/depot.tgz /tmp/depot-release; \
  test -x /tmp/depot-release/depot
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=depot-download /tmp/depot-release/depot /usr/local/bin/depot
COPY package.json ./
COPY src/ ./src/
RUN useradd --system --uid 10001 --create-home gateway && chown -R gateway:gateway /app
USER gateway
ENV NODE_ENV=production PORT=8080 BIND_HOST=0.0.0.0 TRUST_FLY_PROXY=1
EXPOSE 8080
# Node makes the probe self-contained; no curl or shell tooling in the runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/server.js"]
