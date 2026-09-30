FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --ignore-scripts
COPY packages/domain packages/domain
COPY apps/api apps/api
COPY apps/web apps/web
COPY apps/mobile apps/mobile
ARG PUBLIC_URL=https://demo.kamraw.com
ENV VITE_API_URL=$PUBLIC_URL VITE_APP_MODE=demo EXPO_PUBLIC_API_URL=$PUBLIC_URL EXPO_PUBLIC_WEB_URL=$PUBLIC_URL EXPO_PUBLIC_APP_MODE=demo
RUN npm run build && cd apps/mobile && npx expo export --platform web
FROM build AS production-deps
RUN rm -rf node_modules && npm ci --omit=dev --ignore-scripts --workspace=@kamraw/api --workspace=@kamraw/domain --include-workspace-root=false
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /usr/local/share/ca-certificates/rds-bundle.pem && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 MEDIA_ROOT=/data/media WEB_ROOT=/app/web MOBILE_WEB_ROOT=/app/mobile-web NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.pem
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/apps/mobile/dist ./mobile-web
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/api/dist/server.js"]
