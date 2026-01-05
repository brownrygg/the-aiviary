FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Make scripts executable
RUN chmod +x server.js http-wrapper.js

# Expose port
EXPOSE 3007

# Start HTTP wrapper
CMD ["node", "http-wrapper.js"]
