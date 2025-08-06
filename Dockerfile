FROM node:18-alpine

# Install SQLite and Puppeteer dependencies
RUN apk add --no-cache \
    sqlite \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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