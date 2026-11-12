# Debian (glibc), not Alpine: ONNX Runtime ships no musl build, and the face
# engine needs it.

# ── build ─────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
# The CPU build is all this service uses; skip the CUDA download.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev
# The face models, checked against their pinned SHA-256.
RUN node scripts/fetch-face-models.mjs
# ONNX Runtime ships every platform's binaries; keep the one this image runs.
RUN cd node_modules/onnxruntime-node/bin/napi-v6 \
  && arch="$(node -p process.arch)" \
  && rm -rf darwin win32 && find linux -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +

# ── run ───────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/models ./models
COPY package.json ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main"]
