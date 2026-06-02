#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
#  WireGuard Setup — Home Server / Mini PC (Server B)
#  Run this script on your home server as root/sudo
# ══════════════════════════════════════════════════════════════════════════════
set -e

echo "==> Installing WireGuard..."
apt-get update -qq && apt-get install -y wireguard

echo "==> Generating home server key pair..."
wg genkey | tee /etc/wireguard/home_private.key | wg pubkey > /etc/wireguard/home_public.key
chmod 600 /etc/wireguard/home_private.key

HOME_PRIVATE=$(cat /etc/wireguard/home_private.key)
HOME_PUBLIC=$(cat /etc/wireguard/home_public.key)

echo ""
echo "════════════════════════════════════════════════════════════"
echo " HOME SERVER PUBLIC KEY (paste this into setup-server-a.sh"
echo " when it asks, OR add it to /etc/wireguard/wg0.conf on VPS):"
echo " $HOME_PUBLIC"
echo "════════════════════════════════════════════════════════════"
echo ""

read -p "Paste Oracle VPS PUBLIC key here: " VPS_PUBLIC
read -p "Enter Oracle VPS public IP address: " VPS_IP

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.99.0.2/24
PrivateKey = $HOME_PRIVATE
DNS = 1.1.1.1

[Peer]
# Oracle VPS (Server A)
PublicKey = $VPS_PUBLIC
Endpoint = $VPS_IP:51820
AllowedIPs = 10.99.0.0/24
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf

echo "==> Starting WireGuard..."
systemctl enable --now wg-quick@wg0

echo ""
echo "==> Testing connection to VPS..."
sleep 3
if ping -c 2 10.99.0.1 > /dev/null 2>&1; then
  echo "✅ VPN tunnel is UP! VPS reachable at 10.99.0.1"
else
  echo "⚠  Ping failed. Check:"
  echo "   1. Port 51820/UDP open in Oracle Cloud security list"
  echo "   2. VPS WireGuard is running: sudo wg show"
  echo "   3. VPS public key correct"
fi

echo ""
echo "✅ Done! Now update your .env on this machine:"
echo "   SERVER_A_IP=10.99.0.1   ← use VPN tunnel IP, NOT public IP"
echo ""
echo "Then deploy: docker compose -f docker-compose.server-b.yml up -d"
