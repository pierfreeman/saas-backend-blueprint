#!/bin/bash
# ---------------------------------------------------------------------------
# LocalStack initialization script
# Runs automatically on LocalStack startup (mounted in /etc/localstack/init/ready.d/)
#
# Creates all SQS queues and S3 buckets needed for local development.
# `awslocal` is a wrapper that pre-configures the endpoint and dummy credentials
# so no extra flags are required.
# ---------------------------------------------------------------------------
set -e

echo "[localstack-init] Creating SQS queues..."

# Standard queue — heavy compute jobs (worker-a)
awslocal sqs create-queue \
  --queue-name saas-backend-heavy-jobs \
  --attributes '{
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "86400",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

# FIFO queue — billing, subscriptions, payments (strict ordering required)
awslocal sqs create-queue \
  --queue-name saas-backend-billing-events.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false",
    "VisibilityTimeout": "30",
    "MessageRetentionPeriod": "86400",
    "ReceiveMessageWaitTimeSeconds": "20"
  }'

echo "[localstack-init] SQS queues created successfully."
echo "[localstack-init] Standard : http://localhost:4566/000000000000/saas-backend-heavy-jobs"
echo "[localstack-init] FIFO     : http://localhost:4566/000000000000/saas-backend-billing-events.fifo"

echo "[localstack-init] Creating S3 buckets..."

# S3 bucket for file storage
awslocal s3 mb s3://saas-backend-storage

# CORS policy so browsers can PUT files directly via presigned URLs
awslocal s3api put-bucket-cors \
  --bucket saas-backend-storage \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'

echo "[localstack-init] S3 buckets created successfully."
echo "[localstack-init] Storage  : s3://saas-backend-storage"

