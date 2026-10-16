FROM node:22-alpine AS base
WORKDIR /app

# Install production dependencies only (excludes xlsx and other devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Generate Prisma client
RUN ./node_modules/.bin/prisma generate

# Create and switch to non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nodejs && \
    chown -R nodejs:nodejs /app
USER nodejs

ENV PORT=4011
EXPOSE 4011
CMD ["node", "index.js"]
