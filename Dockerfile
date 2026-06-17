# Figshare Bulk Uploader — container image
FROM node:20-alpine

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
EXPOSE 4000

# Drop to the built-in non-root user
USER node

CMD ["node", "server.js"]
