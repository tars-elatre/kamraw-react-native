#!/usr/bin/env bash
set -euo pipefail
# Run by SSM as root. Arguments are validated before being used as an image tag.
RELEASE=${1:?release tag required}
[[ "$RELEASE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$ ]] || exit 2
cd /opt/kamraw
set -a
source deployment.env
set +a
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
IMAGE="$ECR_URI:$RELEASE"
docker pull "$IMAGE"
docker run --rm --network host --env-file runtime.env -e DB_ADMIN_SECRET_ARN="$DB_ADMIN_SECRET_ARN" "$IMAGE" node apps/api/dist/db/bootstrap.js
PREVIOUS=$(docker inspect --format '{{.Config.Image}}' kamraw-api 2>/dev/null || true)
start_api() {
  docker run -d --name kamraw-api --restart unless-stopped --network host --env-file runtime.env --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges --memory 768m --log-driver awslogs --log-opt awslogs-region="$AWS_REGION" --log-opt awslogs-group=/kamraw/demo --log-opt awslogs-stream=api -v /opt/kamraw/media:/data/media "$1" >/dev/null
}
docker rm -f kamraw-api 2>/dev/null || true
start_api "$IMAGE"
READY=false
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:4000/ready >/dev/null; then READY=true; break; fi
  sleep 2
done
if [ "$READY" != true ]; then
  docker rm -f kamraw-api
  if [ -n "$PREVIOUS" ]; then start_api "$PREVIOUS"; fi
  echo 'Health check failed. Previous application image restored when available.' >&2
  exit 1
fi
docker rm -f kamraw-worker 2>/dev/null || true
docker run -d --name kamraw-worker --restart unless-stopped --network host --env-file runtime.env --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges --memory 256m --log-driver awslogs --log-opt awslogs-region="$AWS_REGION" --log-opt awslogs-group=/kamraw/demo --log-opt awslogs-stream=worker "$IMAGE" node apps/api/dist/workers/run.js >/dev/null
cat > Caddyfile <<CADDY
$DOMAIN {
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000"
  header Referrer-Policy "no-referrer"
  request_body {
    max_size 9MB
  }
  reverse_proxy 127.0.0.1:4000
}
CADDY
if docker inspect kamraw-proxy >/dev/null 2>&1; then
  docker exec kamraw-proxy caddy reload --config /etc/caddy/Caddyfile
else
  docker run -d --name kamraw-proxy --restart unless-stopped --network host --memory 128m -v /opt/kamraw/Caddyfile:/etc/caddy/Caddyfile:ro -v /opt/kamraw/caddy:/data caddy:2.10-alpine >/dev/null
fi
printf '%s\n' "$IMAGE" > current-release
# The caller must also check the public HTTPS endpoint.
echo 'Deployment and local readiness check passed.'
