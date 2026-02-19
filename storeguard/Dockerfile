FROM node:20-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV SHOPIFY_APP_URL=https://storeguard-app.onrender.com

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

# Run migrations and start server
# Run migrations (with retry) and start server
CMD ["sh", "-c", "for i in 1 2 3; do npx prisma db push --skip-generate --accept-data-loss && break || echo \"DB push attempt $i failed, retrying in 5s...\" && sleep 5; done && npm run start"]
