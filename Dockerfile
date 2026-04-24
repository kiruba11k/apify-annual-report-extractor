FROM apify/actor-node:18

USER root

RUN apk add --no-cache \
    poppler-utils \
    ghostscript

RUN id -u apify >/dev/null 2>&1 || adduser -D apify

WORKDIR /usr/src/app
RUN chown -R apify:apify /usr/src/app

COPY package*.json ./

USER apify
RUN npm install --production --quiet

COPY --chown=apify:apify . ./

ENV NODE_ENV=production
ENV APIFY_DISABLE_OUTDATED_WARNING=1

CMD ["node", "src/main.js"]
