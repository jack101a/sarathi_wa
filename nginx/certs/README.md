Place your SSL certificates here:

- fullchain.pem   — Full certificate chain (cert + intermediates)
- privkey.pem     — Private key

These are mounted into the nginx container at /etc/nginx/certs/

To obtain certificates with Let's Encrypt (recommended):
  certbot certonly --webroot -w ./certbot/www -d yourdomain.com

Then symlink or copy:
  cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/fullchain.pem
  cp /etc/letsencrypt/live/yourdomain.com/privkey.pem  nginx/certs/privkey.pem

Or update nginx.conf to point directly to the Let's Encrypt path:
  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

NOTE: This directory is intentionally empty in the repo (.gitignore'd) — never commit private keys.
