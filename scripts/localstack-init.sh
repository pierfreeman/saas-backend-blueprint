#!/bin/bash
# ---------------------------------------------------------------------------
# LocalStack initialization script
# Runs automatically on LocalStack startup (mounted in /etc/localstack/init/ready.d/)
#
# Creates all SQS queues needed for local development.
# `awslocal` is a wrapper that pre-configures the endpoint and dummy credentials
# so no extra flags are required.
# ---------------------------------------------------------------------------
set -e

echo "[localstack-init] Creating SQS queues..."

# Standard queue — heavy compute jobs (worker-a)
awslocal sqs create-queue \
  --queue-name nx-nest-heavy-jobs \
  --attributes '{
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "86400",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

# FIFO queue — billing, subscriptions, payments (strict ordering required)
awslocal sqs create-queue \
  --queue-name nx-nest-billing-events.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false",
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "86400",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

echo "[localstack-init] SQS queues created successfully."
echo "[localstack-init] Standard : http://localhost:4566/000000000000/nx-nest-heavy-jobs"
echo "[localstack-init] FIFO     : http://localhost:4566/000000000000/nx-nest-billing-events.fifo"
