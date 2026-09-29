# StarNet Remote relay. Build from the REPO ROOT so the phone app and font come from their real homes:
#   fly deploy --config relay/fly.toml --dockerfile relay/Dockerfile .
FROM node:22-bookworm-slim
WORKDIR /srv
COPY relay/server.js relay/ws-lite.js ./
COPY relay/app/ ./app/
COPY frontend/assets/fonts/vt323.woff2 ./app/vt323.woff2
ENV NODE_ENV=production APP_DIR=/srv/app PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.js"]
