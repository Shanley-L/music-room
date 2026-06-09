FROM node:20-bullseye-slim

WORKDIR /usr/src/app

COPY package*.json .

RUN npm ci --no-audit --prefer-offline

COPY . .

EXPOSE 3000

CMD ["npm", "run dev"]