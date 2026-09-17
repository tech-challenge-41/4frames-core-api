#!/bin/sh
# Fila de uploads (eventos S3 ObjectCreated) e sua DLQ.
# - long polling de 20 s
# - visibility timeout maior que o processamento de um vídeo (o worker renova durante o job)
# - após SQS_MAX_RECEIVE_COUNT recebimentos sem DeleteMessage, a mensagem vai para a DLQ
set -e

QUEUE_NAME="${SQS_QUEUE_NAME:-4frames-video-uploads}"
DLQ_NAME="${SQS_DLQ_NAME:-4frames-video-uploads-dlq}"
VISIBILITY_TIMEOUT="${SQS_VISIBILITY_TIMEOUT_SECONDS:-600}"
MAX_RECEIVE_COUNT="${SQS_MAX_RECEIVE_COUNT:-3}"

# create-queue é idempotente para o mesmo nome; os atributos são (re)aplicados com set-queue-attributes.
DLQ_URL=$(awslocal sqs create-queue --queue-name "${DLQ_NAME}" --query QueueUrl --output text)
awslocal sqs set-queue-attributes --queue-url "${DLQ_URL}" --attributes MessageRetentionPeriod=1209600
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "${DLQ_URL}" --attribute-names QueueArn --query Attributes.QueueArn --output text)

QUEUE_URL=$(awslocal sqs create-queue --queue-name "${QUEUE_NAME}" --query QueueUrl --output text)

cat > /tmp/4frames-queue-attributes.json <<EOF
{
  "VisibilityTimeout": "${VISIBILITY_TIMEOUT}",
  "ReceiveMessageWaitTimeSeconds": "20",
  "MessageRetentionPeriod": "345600",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"${MAX_RECEIVE_COUNT}\"}"
}
EOF

awslocal sqs set-queue-attributes --queue-url "${QUEUE_URL}" --attributes file:///tmp/4frames-queue-attributes.json

echo "[init] fila ${QUEUE_NAME} pronta (visibility ${VISIBILITY_TIMEOUT}s, DLQ ${DLQ_NAME} após ${MAX_RECEIVE_COUNT} recebimentos)"
