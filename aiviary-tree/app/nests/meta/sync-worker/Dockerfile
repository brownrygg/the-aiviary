FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Set ownership to node user
RUN chown -R node:node /app

# Set environment
ENV NODE_ENV=production

# Run as non-root user
USER node

# Start the sync worker
CMD ["node", "server.js"]
