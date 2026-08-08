# Bulk Uploader for Figshare — container image
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

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
