#!/bin/sh
set -e

echo "Running migrations..."
npx prisma migrate deploy

echo "Starting API..."
exec node dist/index.js
