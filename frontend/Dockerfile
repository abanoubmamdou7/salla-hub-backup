FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=https://sallahub.kounstack.com
ARG VITE_ADMIN_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ADMIN_API_KEY=$VITE_ADMIN_API_KEY
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Unprivileged nginx image — runs as non-root uid 101
FROM nginxinc/nginx-unprivileged:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4012
CMD ["nginx", "-g", "daemon off;"]
