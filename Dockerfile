FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/var/data
ENV BASE_PATH=/proof
ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
