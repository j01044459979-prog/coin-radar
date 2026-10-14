FROM node:22-alpine
WORKDIR /app
COPY assets/futures-engine.js ./assets/futures-engine.js
# 뉴스 파서 재사용(읽기 전용). package.json은 ESM 판별용
COPY worker/package.json ./worker/package.json
COPY worker/src/intel/ ./worker/src/intel/
COPY radar-service/package.json radar-service/package-lock.json ./radar-service/
RUN npm ci --prefix radar-service --omit=dev --no-audit --no-fund
COPY radar-service/ ./radar-service/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "radar-service/run.mjs"]
