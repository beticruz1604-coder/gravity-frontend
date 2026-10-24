# Compilación del front (Vite) y servicio estático con nginx, que además reenvía /backstage/ al backend de Backstage.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# nginx sustituye las variables de las plantillas al arrancar (solo las que están definidas como entorno).
ENV BACKSTAGE_URL="" \
    BACKSTAGE_HOST="" \
    BACKSTAGE_TOKEN="" \
    NGINX_ENVSUBST_FILTER="^(BACKSTAGE_URL|BACKSTAGE_HOST|BACKSTAGE_TOKEN)$"
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Se ejecuta antes que el envsubst de las plantillas (20-): prepara la verificación TLS hacia Backstage.
COPY --chmod=0755 deploy/15-backstage-tls.sh /docker-entrypoint.d/15-backstage-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
