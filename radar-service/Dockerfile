FROM node:22-alpine
WORKDIR /app
COPY assets/futures-engine.js ./assets/futures-engine.js
COPY radar-service/ ./radar-service/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "radar-service/run.mjs"]
