#!/usr/bin/env bash
set -euo pipefail
: "${INSTANCE_ID:?}" "${ARTIFACT_BUCKET:?}" "${GITHUB_SHA:?}" "${PUBLIC_URL:?}"
KEY="releases/$GITHUB_SHA/deploy-host.sh"
aws s3 cp scripts/deploy-host.sh "s3://$ARTIFACT_BUCKET/$KEY" --only-show-errors
COMMAND=$(jq -n --arg bucket "$ARTIFACT_BUCKET" --arg key "$KEY" --arg release "$GITHUB_SHA" '{commands:["set -eu",("aws s3 cp s3://"+$bucket+"/"+$key+" /opt/kamraw/deploy-host.sh --only-show-errors"),("bash /opt/kamraw/deploy-host.sh "+$release)],executionTimeout:["900"]}')
ID=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --parameters "$COMMAND" --query Command.CommandId --output text)
for attempt in $(seq 1 90); do
  STATUS=$(aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || true)
  case "$STATUS" in
    Success)
      curl --fail --retry 12 --retry-delay 5 --retry-all-errors "$PUBLIC_URL/ready"
      curl --fail --silent "$PUBLIC_URL/health" | jq -e --arg release "$GITHUB_SHA" '.status == "ok" and .release == $release'
      exit 0 ;;
    Failed|Cancelled|TimedOut) echo "Deployment failed: $STATUS" >&2; exit 1 ;;
  esac
  sleep 10
done
echo 'Deployment wait exceeded 15 minutes' >&2
exit 1
