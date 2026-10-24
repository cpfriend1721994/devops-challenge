#!/usr/bin/env bash
set -euo pipefail

# Configuration
APP_NAME="backend-api"
BASE_DIR="/var/www/backend"
RELEASES_DIR="${BASE_DIR}/releases"
CURRENT_SYMLINK="${BASE_DIR}/current"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
NEW_RELEASE_DIR="${RELEASES_DIR}/${TIMESTAMP}"
ARTIFACT_PATH="${1:-/tmp/backend-artifact.tar.gz}"
HEALTH_CHECK_URL="http://127.0.0.1:3000/health"
MAX_HEALTH_ATTEMPTS=10
HEALTH_INTERVAL=3

echo "[DEPLOY] Starting zero-downtime deployment for ${APP_NAME}..."

# Ensure target directories exist
mkdir -p "${RELEASES_DIR}"

# Extract artifact to new release directory
mkdir -p "${NEW_RELEASE_DIR}"
echo "[DEPLOY] Unpacking artifact from ${ARTIFACT_PATH} to ${NEW_RELEASE_DIR}..."
tar -xzf "${ARTIFACT_PATH}" -C "${NEW_RELEASE_DIR}"

# Install or refresh systemd service definition if packaged
if [ -f "${NEW_RELEASE_DIR}/api.service" ]; then
  sudo cp "${NEW_RELEASE_DIR}/api.service" "/etc/systemd/system/${APP_NAME}.service"
  sudo systemctl daemon-reload
fi

# Save reference to current release for rollback
PREVIOUS_RELEASE=""
if [ -L "${CURRENT_SYMLINK}" ]; then
  PREVIOUS_RELEASE=$(readlink -f "${CURRENT_SYMLINK}")
fi

# Switch symlink atomically to new release
echo "[DEPLOY] Atomically updating symlink to ${NEW_RELEASE_DIR}..."
ln -sfn "${NEW_RELEASE_DIR}" "${CURRENT_SYMLINK}"

# Restart systemd service
echo "[DEPLOY] Restarting ${APP_NAME}.service..."
sudo systemctl restart "${APP_NAME}.service"

# Health check verification loop
echo "[DEPLOY] Verifying health check at ${HEALTH_CHECK_URL}..."
HEALTH_PASSED=false
for attempt in $(seq 1 ${MAX_HEALTH_ATTEMPTS}); do
  sleep ${HEALTH_INTERVAL}
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_CHECK_URL}" || echo "000")
  if [ "${HTTP_STATUS}" -eq 200 ]; then
    echo "[DEPLOY] Health check PASSED on attempt ${attempt} (HTTP ${HTTP_STATUS})."
    HEALTH_PASSED=true
    break
  else
    echo "[DEPLOY] Health check pending (attempt ${attempt}/${MAX_HEALTH_ATTEMPTS}, HTTP: ${HTTP_STATUS})..."
  fi
done

if [ "${HEALTH_PASSED}" = true ]; then
  echo "[DEPLOY] Deployment successfully completed for release ${TIMESTAMP}."

  # Prune old releases, keep last 5
  echo "[DEPLOY] Pruning old releases (keeping last 5)..."
  cd "${RELEASES_DIR}"
  ls -1dt 20* | tail -n +6 | xargs -r rm -rf
else
  echo "[ERROR] Health check FAILED! Initiating automatic rollback..."
  if [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
    echo "[ROLLBACK] Reverting symlink to previous release: ${PREVIOUS_RELEASE}"
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_SYMLINK}"
    sudo systemctl restart "${APP_NAME}.service"
    echo "[ROLLBACK] Successfully rolled back to ${PREVIOUS_RELEASE}."
  else
    echo "[FATAL] No previous release available to roll back to!"
  fi
  exit 1
fi
