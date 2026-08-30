# Build da imagem — quem roda o "npm install" aqui é o serviço de build do
# Fly.io (ou de qualquer outro host Docker), não sua máquina local.
FROM node:20-slim

WORKDIR /app

# Copia só o package.json primeiro para aproveitar cache de camadas do Docker
# (só reinstala dependências quando package.json muda, não a cada deploy).
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
EXPOSE 3000

# Processo padrão da imagem: a API web.
# O processo do worker é definido separadamente no fly.toml (ver [processes]).
CMD ["node", "backend/src/server.js"]
