FROM node:20-alpine

WORKDIR /app

# 의존성 먼저 복사 (캐싱 효율)
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
