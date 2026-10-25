# Per-run container: one run = one container. The target repo and config are mounted at runtime.
# Agent CLIs (whatever the config's adapters need) are installed in a derived image, not here.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hodgepodge
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bin ./bin
COPY src ./src
COPY prompts ./prompts
ENV PATH="/opt/hodgepodge/bin:${PATH}"
WORKDIR /work
ENTRYPOINT ["hodge"]
CMD ["run", "--config", "/config/hodge.json", "--repo", "/work"]
