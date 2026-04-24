# Use the correct Apify image name
FROM apify/actor-node-puppeteer-chrome:18

# Switch to root to install system packages
USER root

# Install system dependencies for PDF processing
RUN apt-get update && apt-get install -y \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Switch back to the non-privileged apify user
USER apify

# Set working directory
WORKDIR /usr/src/app

# Copy package files first (layer caching optimization)
COPY package*.json ./

# Install production dependencies
# Note: npm install is run by user 'apify' now
RUN npm install --production --quiet

# Copy source code
COPY . ./

# Set environment
ENV NODE_ENV=production
ENV APIFY_DISABLE_OUTDATED_WARNING=1

# Run the actor
CMD ["node", "src/main.js"]
