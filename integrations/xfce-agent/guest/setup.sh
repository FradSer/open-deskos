#!/usr/bin/env bash
set -euo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
export TMPDIR=/var/tmp

# This script runs only inside the disposable Debian guest.
test "$(id -u)" = 0
test -e /var/lib/cloud/instance
test "$(hostname)" = odk-xfce-fixture
rm -f /var/lib/odk/bootstrap-ready
apt-get update
apt-get install -y --no-install-recommends \
  xserver-xorg xserver-xorg-video-all xserver-xorg-input-all lightdm \
  xfce4-session xfce4-panel xfdesktop4 xfwm4 xfce4-settings thunar \
  dbus-x11 dbus-user-session x11-xserver-utils chromium chromium-sandbox fonts-dejavu-core python3

install -d -m 0755 /etc/lightdm/lightdm.conf.d /etc/ssh/sshd_config.d /etc/X11/xorg.conf.d
install -d -m 0755 /etc/chromium/policies/managed
cat > /etc/chromium/policies/managed/odk.json <<'EOF'
{
  "PasswordManagerEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "DeveloperToolsAvailability": 2,
  "URLBlocklist": ["*"],
  "URLAllowlist": ["http://127.0.0.1:8080"]
}
EOF
chmod 0644 /etc/chromium/policies/managed/odk.json
cat > /etc/lightdm/lightdm.conf.d/50-odk.conf <<'EOF'
[Seat:*]
autologin-user=desk
autologin-user-timeout=0
autologin-session=xfce
user-session=xfce
EOF
cat > /etc/ssh/sshd_config.d/00-odk-bootstrap.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers bootstrap
AllowAgentForwarding no
AllowTcpForwarding no
X11Forwarding no
EOF
cat > /etc/X11/xorg.conf.d/20-odk-display.conf <<'EOF'
Section "Device"
  Identifier "VirtioDisplay"
  Driver "modesetting"
  Option "AccelMethod" "none"
EndSection
Section "Monitor"
  Identifier "VirtualMonitor"
  Option "PreferredMode" "1280x800"
EndSection
Section "Screen"
  Identifier "VirtualScreen"
  Device "VirtioDisplay"
  Monitor "VirtualMonitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "1280x800"
  EndSubSection
EndSection
EOF
chmod 0644 /etc/X11/xorg.conf.d/20-odk-display.conf

# The desktop account has no SSH key, sudo grant, or production profile.
gpasswd -d desk sudo >/dev/null 2>&1 || true
install -d -o desk -g desk -m 0700 \
  /home/desk/.config /home/desk/.config/autostart \
  /home/desk/.local /home/desk/.local/share \
  /home/desk/.cache
cat > /home/desk/.config/autostart/odk-fixture.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Local shopping fixture
Exec=/opt/odk/session.sh
Terminal=false
EOF
chown desk:desk /home/desk/.config/autostart/odk-fixture.desktop
chmod 0600 /home/desk/.config/autostart/odk-fixture.desktop
cat > /etc/systemd/system/odk-fixture.service <<'EOF'
[Unit]
Description=Disposable local desktop test fixture
After=network.target

[Service]
Type=simple
User=fixture
Group=fixture
ExecStart=/usr/bin/python3 -B /opt/odk/fixture.py
Restart=on-failure
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
PrivateDevices=yes
RestrictAddressFamilies=AF_INET AF_INET6
StandardOutput=null
StandardError=null

[Install]
WantedBy=multi-user.target
EOF
id fixture >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin fixture
chmod 0755 /opt/odk/session.sh /opt/odk/fixture.py
systemctl daemon-reload
systemctl enable --now odk-fixture.service
systemctl enable lightdm.service
systemctl set-default graphical.target
systemctl restart lightdm.service
systemctl restart ssh.service
install -d -m 0755 /var/lib/odk
touch /var/lib/odk/bootstrap-ready
chmod 0644 /var/lib/odk/bootstrap-ready
