# Use the base Apify Node.js image (no browser)
FROM apify/actor-node:18

# Switch to root to install system packages and manage users
USER root

# 1. Install system dependencies for PDF processing
# We use -y to auto-confirm and clean up to keep the image small
RUN apt-get update && apt-get install -y \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# 2. Ensure the 'apify' user exists
# Standard Apify images usually have this, but this line prevents "passwd file" errors
RUN id -u apify >/dev/null 2>&1 || useradd --create-home apify

# 3. Set up the working directory with correct permissions
WORKDIR /usr/src/app
RUN chown -R apify:apify /usr/src/app

# 4. Copy package files first for better layer caching
COPY package*.json ./

# 5. Switch back to the non-privileged user
USER apify

# 6. Install production dependencies
RUN npm install --production --quiet

# 7. Copy the rest of the source code
COPY --chown=apify:apify . ./

# Set environment variables
ENV NODE_ENV=production
ENV APIFY_DISABLE_OUTDATED_WARNING=1

# Run the application
CMD ["node", "src/main.js"]
