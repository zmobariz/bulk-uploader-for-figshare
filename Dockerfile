# Bulk Uploader for Figshare — container image
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

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
