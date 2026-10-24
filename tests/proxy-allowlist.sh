#!/usr/bin/env bash
# Prueba del proxy de nginx: construye la imagen del front, la levanta contra un «Backstage» de mentira y comprueba que pasan
# las rutas que el front necesita y que TODO lo demás recibe 403 (incluido path traversal), más los límites y las cabeceras.
# Uso (en local o en Cloud Build): tests/proxy-allowlist.sh        Requiere docker.
set -uo pipefail
cd "$(dirname "$0")/.."
NET=${DOCKER_NETWORK:-pxtest-net}
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
cleanup() { docker rm -f pxtest-stub pxtest-front pxtest-front-token pxtest-stub-tls pxtest-front-tls pxtest-front-tls-bad pxtest-front-tls-noca >/dev/null 2>&1; docker volume rm -f pxtest-certs pxtest-certs-bad >/dev/null 2>&1; [ "$NET" = "pxtest-net" ] && docker network rm "$NET" >/dev/null 2>&1; true; }
trap cleanup EXIT

docker build -q -t pxtest-front . >/dev/null || { echo "FALLO: no se pudo construir la imagen"; exit 1; }
# El «Backstage» de mentira se construye como imagen (no se monta un archivo: en Cloud Build el demonio de Docker no ve el disco del paso).
docker build -q -t pxtest-stub - >/dev/null <<'EOS'
FROM nginx:1.27-alpine
RUN printf 'server { listen 80; location / { default_type application/json; return 200 "$http_authorization"; } }\n' > /etc/nginx/conf.d/default.conf
EOS
docker run -d --name pxtest-stub --network "$NET" pxtest-stub >/dev/null
docker run -d --name pxtest-front --network "$NET" -e BACKSTAGE_URL=http://pxtest-stub -e BACKSTAGE_HOST=pxtest-stub pxtest-front >/dev/null
sleep 4
docker exec pxtest-front nginx -t >/dev/null 2>&1 || { echo "FALLO: la configuración de nginx no es válida"; docker logs pxtest-front | tail -5; exit 1; }

code() { # code <método> <ruta> [cabecera]
  docker run --rm --network "$NET" curlimages/curl:8.10.1 -s --path-as-is -o /dev/null -w '%{http_code}' -X "$1" "http://pxtest-front:8080$2"
}
fallos=0
espera() { # espera <código> <método> <ruta>
  local got; got="$(code "$2" "$3")"
  if [ "$got" != "$1" ]; then echo "FALLO: $2 $3 -> $got (se esperaba $1)"; fallos=$((fallos + 1)); fi
}
for p in /backstage/api/catalog/entities "/backstage/api/catalog/entities?filter=kind=component" /backstage/api/catalog/entities/by-name/component/default/x \
         /backstage/api/branching/rules /backstage/api/branching/pipelines/demos /backstage/api/branching/branches/demos/x /backstage/api/homologation/items /backstage/api/homologation/requirements \
         /backstage/api/homologation/components/x /backstage/api/scaffolder/v2/tasks /backstage/api/scaffolder/v2/tasks/abc/events \
         /backstage/api/scaffolder/v2/templates/default/template/crear-rama/parameter-schema /backstage/api/kubernetes/clusters /backstage/api/scorecards/components; do
  espera 200 GET "$p"
done
for p in /backstage/api/scaffolder/v2/tasks /backstage/api/scaffolder/v2/tasks/abc/cancel /backstage/api/branching/preview /backstage/api/branching/branch-name \
         /backstage/api/branching/validate "/backstage/api/catalog/locations?dryRun=true" /backstage/api/kubernetes/services/x; do
  espera 200 POST "$p"
done
espera 200 GET /
for p in /backstage/api/auth/guest/refresh /backstage/api/catalog/refresh /backstage/api/permission/authorize /backstage/api/proxy/x /backstage/api/search/query \
         /backstage/api/notifications /backstage/.backstage/health/v1/readiness /backstage/api/mcp-actions/v1 \
         /backstage/api/catalog/entities/../../auth/x "/backstage/api/catalog/entities/%2e%2e/%2e%2e/auth/x" "/backstage/api/catalog/entities/..%2f..%2fauth/x" /backstage//api/auth/x; do
  espera 403 GET "$p"
done
espera 403 POST /backstage/api/catalog/locations
espera 403 POST "/backstage/api/catalog/locations?dryRun=false"
espera 403 DELETE /backstage/api/catalog/entities/by-uid/x
espera 403 PUT /backstage/api/scaffolder/v2/tasks
espera 403 POST /backstage/api/scaffolder/v2/tasks/abc/events

# Credencial hacia Backstage: con BACKSTAGE_TOKEN nginx envía su token y sustituye el del cliente; sin él deja pasar el del cliente.
cuerpo() { docker run --rm --network "$NET" curlimages/curl:8.10.1 -s "$@"; }
docker run -d --name pxtest-front-token --network "$NET" -e BACKSTAGE_URL=http://pxtest-stub -e BACKSTAGE_HOST=pxtest-stub -e BACKSTAGE_TOKEN=tokenservicio pxtest-front >/dev/null
sleep 3
[ "$(cuerpo http://pxtest-front-token:8080/backstage/api/branching/rules)" = "Bearer tokenservicio" ] || { echo "FALLO: con token configurado no se envía Authorization: Bearer <token>"; fallos=$((fallos + 1)); }
[ "$(cuerpo -H 'Authorization: Bearer del-cliente' http://pxtest-front-token:8080/backstage/api/branching/rules)" = "Bearer tokenservicio" ] || { echo "FALLO: el token de servicio no sustituye al del cliente"; fallos=$((fallos + 1)); }
[ "$(cuerpo -H 'Authorization: Bearer del-cliente' http://pxtest-front:8080/backstage/api/branching/rules)" = "Bearer del-cliente" ] || { echo "FALLO: sin token configurado no se deja pasar el del cliente"; fallos=$((fallos + 1)); }
docker rm -f pxtest-front-token >/dev/null 2>&1

# TLS hacia Backstage: con la CA correcta pasa; con otra CA (o sin CA) no se habla con el servidor y el contenedor ni arranca sin ella.
mkcerts() { # mkcerts <volumen>: CA propia y certificado de servidor (backstage.internal) firmado por ella
  docker volume create "$1" >/dev/null
  docker run --rm -v "$1":/c -w /c --entrypoint sh alpine/openssl -c '
    openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=pxtest-ca" 2>/dev/null &&
    openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=backstage.internal" 2>/dev/null &&
    printf "subjectAltName=DNS:backstage.internal" > ext.cnf &&
    openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 2 -extfile ext.cnf 2>/dev/null &&
    chmod 644 *.pem *.key' >/dev/null 2>&1
}
mkcerts pxtest-certs; mkcerts pxtest-certs-bad
docker run -d --name pxtest-stub-tls --network "$NET" --network-alias backstage-tls -v pxtest-certs:/c:ro --entrypoint sh nginx:1.27-alpine -c '
  printf "server { listen 443 ssl; ssl_certificate /c/server.pem; ssl_certificate_key /c/server.key; location / { default_type application/json; return 200 \"tls-ok\"; } }\n" > /etc/nginx/conf.d/default.conf && exec nginx -g "daemon off;"' >/dev/null
docker run -d --name pxtest-front-tls --network "$NET" -v pxtest-certs:/etc/backstage-ca:ro -e BACKSTAGE_URL=https://backstage-tls -e BACKSTAGE_HOST=backstage-tls pxtest-front >/dev/null
docker run -d --name pxtest-front-tls-bad --network "$NET" -v pxtest-certs-bad:/etc/backstage-ca:ro -e BACKSTAGE_URL=https://backstage-tls -e BACKSTAGE_HOST=backstage-tls pxtest-front >/dev/null
docker run -d --name pxtest-front-tls-noca --network "$NET" -e BACKSTAGE_URL=https://backstage-tls -e BACKSTAGE_HOST=backstage-tls pxtest-front >/dev/null
sleep 5
[ "$(cuerpo http://pxtest-front-tls:8080/backstage/api/branching/rules)" = "tls-ok" ] || { echo "FALLO: con la CA correcta no se llega a Backstage por TLS"; fallos=$((fallos + 1)); }
[ "$(docker run --rm --network "$NET" curlimages/curl:8.10.1 -s -o /dev/null -w '%{http_code}' http://pxtest-front-tls-bad:8080/backstage/api/branching/rules)" = "502" ] || { echo "FALLO: con una CA distinta debería dar 502"; fallos=$((fallos + 1)); }
[ "$(docker inspect -f '{{.State.Running}}' pxtest-front-tls-noca 2>/dev/null)" = "false" ] || { echo "FALLO: con https y sin CA el contenedor no debería arrancar"; fallos=$((fallos + 1)); }

# Cabeceras de seguridad en una ruta de cada tipo.
for p in / /assets/x.js /backstage/api/branching/rules /backstage/api/auth/x; do
  n="$(docker run --rm --network "$NET" curlimages/curl:8.10.1 -s -D - -o /dev/null "http://pxtest-front:8080$p" | tr -d '\r' | grep -ciE '^(x-content-type-options|x-frame-options|referrer-policy|permissions-policy|strict-transport-security|content-security-policy):')"
  [ "$n" = "6" ] || { echo "FALLO: $p devuelve $n de 6 cabeceras de seguridad"; fallos=$((fallos + 1)); }
done

# Límite de escrituras: 40 POST seguidos desde una IP deben producir algún 429.
limitadas="$(docker run --rm --network "$NET" curlimages/curl:8.10.1 -s -o /dev/null -w '%{http_code}\n' -X POST $(for i in $(seq 1 40); do printf 'http://pxtest-front:8080/backstage/api/branching/preview '; done) | grep -c 429)"
[ "$limitadas" -ge 1 ] || { echo "FALLO: el límite de escrituras no limitó nada"; fallos=$((fallos + 1)); }

if [ "$fallos" -eq 0 ]; then echo "OK: lista de rutas, límites y cabeceras del proxy"; else echo "FALLARON $fallos comprobacion(es)"; exit 1; fi
