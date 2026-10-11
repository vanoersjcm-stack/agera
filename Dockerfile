# Production image for the NestJS backend (used by docker-compose.prod.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# A fresh named volume mounted here inherits this ownership, so the app can write uploads.
RUN mkdir -p /uploads && chown node:node /uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
