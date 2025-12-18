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
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Production should start fast and be stateless. Schema changes should be applied
# via a separate deploy/release step (e.g. prisma migrate deploy), not on every boot.
CMD ["npm", "run", "start"]
