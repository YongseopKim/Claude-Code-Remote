#!/bin/bash
# Install/update claude-telegram-webhook as a user-level systemd service
# Usage: ./systemd/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="claude-telegram-webhook.service"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"

# Ensure user systemd directory exists
mkdir -p "$USER_SYSTEMD_DIR"

# Stop existing system-level service if running
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "System-level $SERVICE_NAME is running."
    if sudo -n true 2>/dev/null; then
        sudo systemctl stop "$SERVICE_NAME"
        sudo systemctl disable "$SERVICE_NAME"
        echo "System-level service stopped and disabled."
    else
        echo "WARNING: Cannot stop system-level service (sudo requires password)."
        echo "Please run manually:"
        echo "  sudo systemctl stop $SERVICE_NAME"
        echo "  sudo systemctl disable $SERVICE_NAME"
        echo ""
    fi
fi

if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "Stopping user-level $SERVICE_NAME..."
    systemctl --user stop "$SERVICE_NAME"
fi

# Create symlink to repo's service file
ln -sf "$SCRIPT_DIR/$SERVICE_NAME" "$USER_SYSTEMD_DIR/$SERVICE_NAME"
echo "Symlinked: $USER_SYSTEMD_DIR/$SERVICE_NAME -> $SCRIPT_DIR/$SERVICE_NAME"

# Reload and enable
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"

echo ""
echo "Service installed and started successfully."
echo "  Status:  systemctl --user status $SERVICE_NAME"
echo "  Logs:    journalctl --user -u $SERVICE_NAME -f"
echo "  Stop:    systemctl --user stop $SERVICE_NAME"
echo "  Restart: systemctl --user restart $SERVICE_NAME"
