FROM docker.io/library/node:20-bullseye-slim

WORKDIR /app

ENV PATH /app/node_modules/.bin:$PATH

# Install dependencies from package.json
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Ensure expo CLI is available for the start script
RUN npm install -g expo-cli

# Copy app source
COPY . .

# Expo dev ports
EXPOSE 19000 19001 19002 8081

CMD ["npm", "start"]
