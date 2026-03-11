#!/usr/bin/env bash
set -euo pipefail

S3_BUCKET=$1
AWS_PROFILE=$2

echo "🧹 Cleaning up S3"
aws s3 rm "s3://$S3_BUCKET/FaceTec-Server-Webservice/" --recursive --profile $AWS_PROFILE
aws s3 rm "s3://$S3_BUCKET/FaceTec-Usage-Log-Server/" --recursive --profile $AWS_PROFILE

echo "📤 Syncing FaceTec SDK to EC2 instance"
aws s3 sync ./FaceTec-Server-Webservice/ "s3://$S3_BUCKET/FaceTec-Server-Webservice/" --acl private --profile $AWS_PROFILE
aws s3 sync ./FaceTec-Usage-Log-Server/ "s3://$S3_BUCKET/FaceTec-Usage-Log-Server/" --acl private --profile $AWS_PROFILE

echo "✅ Done"
