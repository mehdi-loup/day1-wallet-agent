# Stage 1: install dependencies
# Isolated so the pnpm install layer is cached until the lockfile changes.
# Source files are deliberately excluded — a source change should not bust the install cache.
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/day11-rag/package.json ./packages/day11-rag/
RUN pnpm install --frozen-lockfile

# Stage 2: build
# Compiles TypeScript and produces .next/standalone/ via output: 'standalone' in next.config.ts.
# next build traces the exact node_modules needed at runtime and copies them into standalone/.
#
# NEXT_PUBLIC_* vars are baked into the client JS bundle at build time — they cannot be
# injected at docker run via -e. Pass them as build args: --build-arg NEXT_PUBLIC_PRIVY_APP_ID=xxx
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/day11-rag/node_modules ./packages/day11-rag/node_modules
COPY . .

ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: runtime
# Starts fresh — no source, no devDeps, no TypeScript compiler.
# Only the traced standalone output + static assets.
# Secrets are NOT baked in; pass them at runtime via -e or --env-file.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
