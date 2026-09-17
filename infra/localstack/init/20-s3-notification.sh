#!/bin/sh
# Notificação S3 -> SQS: cada objeto criado em videos/ vira uma mensagem na fila de uploads.
# O filtro por prefixo evita laço: o worker grava em frames/ e zips/, que não geram eventos.
set -e

BUCKET_NAME="${S3_BUCKET_NAME:-4frames-videos}"
QUEUE_NAME="${SQS_QUEUE_NAME:-4frames-video-uploads}"

QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "${QUEUE_NAME}" --query QueueUrl --output text)
QUEUE_ARN=$(awslocal sqs get-queue-attributes --queue-url "${QUEUE_URL}" --attribute-names QueueArn --query Attributes.QueueArn --output text)

# Na AWS o S3 só publica na fila se a política permitir; o LocalStack não exige, mas o script fica igual ao real.
cat > /tmp/4frames-queue-policy.json <<EOF
{
  "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"AllowS3VideoUploads\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"s3.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"${QUEUE_ARN}\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"arn:aws:s3:::${BUCKET_NAME}\"}}}]}"
}
EOF

awslocal sqs set-queue-attributes --queue-url "${QUEUE_URL}" --attributes file:///tmp/4frames-queue-policy.json

cat > /tmp/4frames-bucket-notification.json <<EOF
{
  "QueueConfigurations": [
    {
      "Id": "video-uploaded",
      "QueueArn": "${QUEUE_ARN}",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [{ "Name": "prefix", "Value": "videos/" }]
        }
      }
    }
  ]
}
EOF

awslocal s3api put-bucket-notification-configuration \
  --bucket "${BUCKET_NAME}" \
  --notification-configuration file:///tmp/4frames-bucket-notification.json

echo "[init] notificação ${BUCKET_NAME}/videos/* -> ${QUEUE_NAME} pronta"
