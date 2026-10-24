#!/bin/sh
# Arranque del contenedor: prepara la verificación TLS hacia Backstage (antes de que nginx lea la plantilla).
#  - BACKSTAGE_URL con http://  -> sin TLS (desarrollo y pruebas); el fragmento queda vacío.
#  - BACKSTAGE_URL con https:// -> verifica el certificado del servidor contra la CA privada del laboratorio, que Cloud Run monta
#    como archivo desde Secret Manager (backstage-tls-ca) en /etc/backstage-ca/ca.pem. Sin esa CA el contenedor NO arranca:
#    nunca se habla con Backstage sin verificar.
set -eu
OUT=/etc/nginx/snippets/backstage-tls.conf
CA="${BACKSTAGE_CA_FILE:-/etc/backstage-ca/ca.pem}"
case "${BACKSTAGE_URL:-}" in
  https://*)
    if [ ! -s "$CA" ]; then
      echo "backstage-tls: BACKSTAGE_URL es https pero falta la CA en $CA; no se arranca sin verificar el certificado." >&2
      exit 1
    fi
    cat > "$OUT" <<CONF
proxy_ssl_verify on;
proxy_ssl_verify_depth 2;
proxy_ssl_trusted_certificate $CA;
proxy_ssl_protocols TLSv1.2 TLSv1.3;
# Nombre con el que se valida el certificado (el de la CA privada lo incluye además de la IP interna).
proxy_ssl_name ${BACKSTAGE_TLS_NAME:-backstage.internal};
CONF
    ;;
  *)
    : > "$OUT"
    ;;
esac
