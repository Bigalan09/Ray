FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

FROM oven/bun:1.2 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -f bunfig.toml && bun run build.ts

FROM oven/bun:1.2 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY src/index.tsx ./src/
COPY package.json .

EXPOSE 3000
CMD ["bun", "run", "src/index.tsx"]
