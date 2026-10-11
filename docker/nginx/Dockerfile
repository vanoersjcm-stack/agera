# Reverse proxy image: nginx plus the built Agera Nexus web app (served at /).
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.28-alpine
COPY --from=frontend /app/dist /usr/share/nginx/html
