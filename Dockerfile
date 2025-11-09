# Use official Node LTS image
FROM node:18-alpine AS build

# Create app directory
WORKDIR /usr/src/app

# Install dependencies (only production for runtime image)
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production

# Copy app sources
COPY . .

# Build stage complete

FROM node:18-alpine
WORKDIR /usr/src/app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only production node_modules from build stage
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/ || exit 1

USER appuser

CMD ["node", "gemini_backend.js"]
