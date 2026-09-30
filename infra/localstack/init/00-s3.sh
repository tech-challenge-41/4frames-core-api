#!/bin/sh
# Bucket privado de vídeos, frames e zips.
# O CORS libera o PUT direto do navegador na URL pré-assinada; sem ele o preflight do browser falha.
set -e

BUCKET_NAME="${S3_BUCKET_NAME:-4frames-videos}"

if awslocal s3api head-bucket --bucket "${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "[init] bucket ${BUCKET_NAME} já existe"
else
  awslocal s3 mb "s3://${BUCKET_NAME}"
fi

awslocal s3api put-bucket-cors --bucket "${BUCKET_NAME}" --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}'

echo "[init] bucket ${BUCKET_NAME} pronto (CORS aplicado)"
