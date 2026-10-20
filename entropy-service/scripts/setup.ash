#!/bin/ash
# shellcheck shell=dash
# Sourced by shared/run.ash from /app, after config.env is loaded.
echo "Fetching JWT token secret from S3"
JWT_TOKEN_PUBLIC_FILE=jwt_token_public.pem
aws s3 cp "s3://$S3_SECRETS_BUCKET/$JWT_TOKEN_PUBLIC_FILE" "./$JWT_TOKEN_PUBLIC_FILE" --region "$S3_SECRETS_REGION"
if [ ! -f "./$JWT_TOKEN_PUBLIC_FILE" ]; then
  echo "Couldn't download $JWT_TOKEN_PUBLIC_FILE from S3..."
  exit 1
fi
