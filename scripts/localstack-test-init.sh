#!/bin/bash
# ---------------------------------------------------------------------------
# LocalStack initialization script — TEST environment
# Creates SQS queues and S3 buckets for the integration test suite.
# ---------------------------------------------------------------------------
set -e

echo "[localstack-test-init] Creating test SQS queues..."

awslocal sqs create-queue \
  --queue-name saas-backend-heavy-jobs \
  --attributes '{
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "3600",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

awslocal sqs create-queue \
  --queue-name saas-backend-billing-events.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false",
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "3600",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

echo "[localstack-test-init] Test SQS queues created."

echo "[localstack-test-init] Creating test S3 buckets..."

awslocal s3 mb s3://saas-backend-storage

echo "[localstack-test-init] Test S3 buckets created."

