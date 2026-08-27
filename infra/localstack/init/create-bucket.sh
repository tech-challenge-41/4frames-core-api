#!/bin/sh
set -e

BUCKET_NAME="${S3_BUCKET_NAME:-4frames-videos}"

awslocal s3 mb "s3://${BUCKET_NAME}" || true

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
