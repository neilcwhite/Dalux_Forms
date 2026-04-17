# Build stage: compile React + TypeScript
FROM node:24-slim AS frontend-build

WORKDIR /app/frontend

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage: serve with nginx + proxy to backend
FROM nginx:alpine

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built React assets to web root
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
