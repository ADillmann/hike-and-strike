#!/usr/bin/env bash
# Create the unprivileged 'hike' user for running Hike&strike on a VPS.
# Run on the server as root:
#   bash server-create-hike-user.sh
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (or: sudo bash $0)" >&2
  exit 1
fi

APP_USER=hike
APP_HOME="/home/${APP_USER}"
APP_DIR="${APP_HOME}/hike-and-strike"

if id "${APP_USER}" &>/dev/null; then
  echo "User ${APP_USER} already exists."
else
  adduser --disabled-password --gecos "Hike and Strike service" "${APP_USER}"
  echo "Created user ${APP_USER}."
fi

mkdir -p "${APP_DIR}/data" "${APP_DIR}/uploads"
chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}"
chmod 755 "${APP_HOME}"
chmod 750 "${APP_DIR}"

# Optional: SSH as hike with the same key as root (uncomment if desired)
# install -d -m 700 -o hike -g hike "${APP_HOME}/.ssh"
# if [[ -f /root/.ssh/authorized_keys ]]; then
#   install -m 600 -o hike -g hike /root/.ssh/authorized_keys "${APP_HOME}/.ssh/authorized_keys"
#   echo "Copied root authorized_keys to ${APP_USER} (you can ssh hike@server)."
# fi

echo ""
echo "Done."
echo "  User:     ${APP_USER}"
echo "  App dir:  ${APP_DIR}"
echo "  Data:     ${APP_DIR}/data"
echo "  Uploads:  ${APP_DIR}/uploads"
echo ""
echo "Next: clone the repo into ${APP_DIR} as ${APP_USER}, then deploy."
echo "  sudo -u ${APP_USER} -H bash -lc 'cd ~ && git clone <repo-url> hike-and-strike'"
