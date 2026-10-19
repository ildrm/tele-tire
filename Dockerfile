FROM node:26-alpine AS app
RUN apk add --no-cache openssl && npm install --global pnpm@12.14.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build apps/web
RUN addgroup -S teletier && adduser -S teletier -G teletier \
    && chmod a+r /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml \
    && chown -R teletier:teletier /app/apps/web/.next
USER teletier
ENV NODE_ENV=production
EXPOSE 3000 4000
CMD ["pnpm", "start:web"]
