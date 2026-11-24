FROM node:20-alpine
WORKDIR /app
# Zero dependencies: the server is plain Node (the Quarc login is verified with node:crypto).
COPY package.json ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=3009 QUARC_DATA=/app/data
EXPOSE 3009
CMD ["node", "src/index.mjs"]
