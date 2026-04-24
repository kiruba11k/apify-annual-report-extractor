# Use Debian-based Apify Node.js image (supports apt-get)
FROM apify/actor-node:18-debian

# Install system dependencies for PDF processing
RUN apt-get update && apt-get install -y \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files first (layer caching optimization)
COPY package*.json ./

# Install production dependencies
RUN npm install --production --quiet

# Copy source code
COPY . ./

# Set environment
ENV NODE_ENV=production
ENV APIFY_DISABLE_OUTDATED_WARNING=1

# Run the actor
CMD ["node", "src/main.js"]
