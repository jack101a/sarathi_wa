#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
#  WireGuard Setup — Oracle VPS (Server A)
#  Run this script on your Oracle VPS as root/sudo
# ══════════════════════════════════════════════════════════════════════════════
set -e

echo "==> Installing WireGuard..."
apt-get update -qq && apt-get install -y wireguard

echo "==> Generating VPS key pair..."
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
chmod 600 /etc/wireguard/server_private.key

SERVER_PRIVATE=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)

echo ""
echo "════════════════════════════════════════════"
echo " VPS PUBLIC KEY (paste into server-b.conf):"
echo " $SERVER_PUBLIC"
echo "════════════════════════════════════════════"
echo ""
echo "==> Waiting for you to paste HOME SERVER public key..."
read -p "Paste home server PUBLIC key here: " HOME_PUBLIC

# Detect default network interface
IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
echo "==> Detected network interface: $IFACE"

# Write config
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.99.0.1/24
ListenPort = 51820
PrivateKey = $SERVER_PRIVATE
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o $IFACE -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o $IFACE -j MASQUERADE

[Peer]
# Home Server (Server B)
PublicKey = $HOME_PUBLIC
AllowedIPs = 10.99.0.2/32
EOF

chmod 600 /etc/wireguard/wg0.conf

echo "==> Enabling IP forwarding..."
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p

echo "==> Starting WireGuard..."
systemctl enable --now wg-quick@wg0

echo ""
echo "✅ WireGuard running on VPS!"
echo "   VPN tunnel IP:  10.99.0.1"
echo "   Listening port: 51820"
echo ""
echo "⚠  Now open port 51820/UDP in Oracle Cloud security list:"
echo "   OCI Console → Networking → VCN → Security List → Add Ingress Rule"
echo "   Source: 0.0.0.0/0 | Protocol: UDP | Port: 51820"
echo ""
echo "⚠  PostgreSQL and Redis will be accessible at 10.99.0.1 from home server."
echo "   Make sure they bind to 0.0.0.0 (they do by default in Docker)."
echo "   But they are NOT exposed publicly — only via VPN tunnel."
