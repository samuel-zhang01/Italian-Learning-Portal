# Dependency-only preparation: exact package/lock, no application or owner data.
FROM node:22.22.2-bookworm@sha256:03746f6aafd73f2da621094d5e27426225820e93bc202daea0cf1fa388c1ce09
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
ENV NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/tmp/npm-global-empty NPM_CONFIG_REGISTRY=https://registry.npmjs.org NPM_CONFIG_STRICT_SSL=true NPM_CONFIG_IGNORE_SCRIPTS=true
WORKDIR /opt/ci-node
COPY --chmod=0644 package.json package-lock.json ./
RUN umask 022 && touch /tmp/npm-global-empty \
    && npm ci --ignore-scripts --include=dev --no-audit --no-fund \
    && mkdir -m 0755 node_modules/.vite-temp
WORKDIR /tmp
USER 10001:10001
