FROM node:18-alpine

# Install SQLite
RUN apk add --no-cache sqlite

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directories for SQLite database and public files
RUN mkdir -p /usr/src/app/database /usr/src/app/public

# Expose port
EXPOSE 8847

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8847/health || exit 1

# Start the application
CMD ["npm", "start"]