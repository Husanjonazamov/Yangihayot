# Base image
FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install && pnpm install --lockfile-only

COPY . .

CMD ["node", "bot.js"]
