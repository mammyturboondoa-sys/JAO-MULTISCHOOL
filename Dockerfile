# JAO — container for managed hosting. (Written but NOT yet built or tested: no Docker is available in the development environment.)
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 JAO_DATA_DIR=/data JAO_SECURE_COOKIES=1 JAO_TRUST_PROXY=1 JAO_FORCE_HTTPS=1
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
