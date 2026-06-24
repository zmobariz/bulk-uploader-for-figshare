# Bulk Uploader for Figshare — container image
FROM node:26-alpine@sha256:a2dc166a387cc6ca1e62d0c8e265e49ca985d6e60abc9fe6e6c3d6ce8e63f606

WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App source
COPY server.js cli.js ./
COPY lib ./lib
COPY public ./public
COPY samples ./samples

ENV PORT=4000
# Bind all interfaces *inside the container* so `docker run -p` can reach it.
ENV HOST=0.0.0.0
EXPOSE 4000

# Drop to the built-in non-root user
USER node

CMD ["node", "server.js"]
