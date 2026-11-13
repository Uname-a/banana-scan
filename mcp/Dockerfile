# SPDX-License-Identifier: AGPL-3.0-only
# banana-scan-mcp in a container, for an agent to start without Node installed:
# the agent runs `docker run -i` in place of `npx`, talks MCP over stdin and
# stdout, and the Banana Scan tab connects to the published port. See
# docs/docker.md, "The agent connection".
#
#   docker build -t banana-scan-mcp mcp

FROM node:22-alpine
WORKDIR /opt/banana-scan-mcp
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin ./bin
COPY src ./src

# Every port inside the container, published to the host's 127.0.0.1 only
# (`-p 127.0.0.1:7317:7317`). The image is the version: no self-update. The
# pairing token is kept in /config — mount a volume there so it outlasts the
# container.
ENV BANANA_SCAN_MCP_HOST=0.0.0.0 \
    BANANA_SCAN_MCP_NO_UPDATE=1 \
    BANANA_SCAN_MCP_CONFIG_DIR=/config
RUN mkdir -p /config && chown node:node /config
USER node
EXPOSE 7317
ENTRYPOINT ["node", "/opt/banana-scan-mcp/bin/banana-scan-mcp.js"]
