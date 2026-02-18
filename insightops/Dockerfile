FROM node:20-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Install ALL dependencies (need devDeps for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Generate Prisma client and build
RUN npx prisma generate
RUN NODE_OPTIONS="--max-old-space-size=512" npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Run migrations and start server
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
