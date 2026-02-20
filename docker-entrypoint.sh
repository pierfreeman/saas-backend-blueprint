#!/bin/sh
set -e

# Wait and retry running Prisma migrations until the database is ready.
# This prevents the app from failing at startup when Postgres isn't accepting
# connections yet.

MAX_RETRIES=30
SLEEP_SECONDS=2
COUNT=0

echo "==> Running Prisma migrations (deploy)"
until npx prisma migrate deploy; do
  COUNT=$((COUNT+1))
  if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
    echo "==> prisma migrate deploy failed after $COUNT attempts"
    exit 1
  fi
  echo "==> prisma migrate deploy failed, retrying in ${SLEEP_SECONDS}s... ($COUNT/$MAX_RETRIES)"
  sleep $SLEEP_SECONDS
done

echo "==> Migrations applied, starting app"
exec node dist/main.js
