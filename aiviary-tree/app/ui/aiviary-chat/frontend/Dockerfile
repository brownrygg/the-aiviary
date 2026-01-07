FROM node:18-slim

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy the rest of the application
COPY . .

# Expose the Vite dev server port
EXPOSE 3000

# Command to run the dev server
CMD ["npm", "run", "dev", "--", "--host"]
