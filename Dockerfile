FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY src ./src
COPY index.html styles.css app.mjs firebase-config.mjs ./
COPY notes/model.md ./notes/model.md
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_PATH=/data/simulation.sqlite FIREBASE_PROJECT_ID=stouras-sustainability-2026
EXPOSE 3000
CMD ["node", "server/main.mjs"]
