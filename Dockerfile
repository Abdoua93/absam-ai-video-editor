FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src

RUN npm run build


FROM node:22-alpine

RUN apk add --no-cache bash ffmpeg tzdata \
 && (apk add --no-cache font-noto-arabic || apk add --no-cache font-noto)

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY LICENSE README.md ./

COPY --from=builder /app/public/studio ./public/studio

RUN mkdir -p /app/data /app/assets/fonts

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    FONTS_DIR=/usr/share/fonts/noto

EXPOSE 8080
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
