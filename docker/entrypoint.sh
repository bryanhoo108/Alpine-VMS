#!/bin/sh
# Start the VMS: make a session key on first run, apply database migrations,
# load demo data only when demo PIN and password are given, then serve.
set -e
mkdir -p /data/files

if [ -z "$SESSION_SECRET" ]; then
  if [ ! -s /data/session-secret ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > /data/session-secret
    chmod 600 /data/session-secret
  fi
  SESSION_SECRET=$(cat /data/session-secret)
  export SESSION_SECRET
fi

cd /app/apps/server
if [ -n "$SEED_DEMO_PIN" ] && [ -n "$SEED_DEMO_PASSWORD" ]; then
  npx tsx src/db/seed.ts
elif [ -n "$SITE_NAME" ]; then
  # Real site: create it on first start (safe to repeat). Users and cards are
  # added with the admin tool, see docs/INSTALL.md.
  npx tsx src/cli/admin.ts init-site --code "${SITE_CODE:-APM}" --name "$SITE_NAME"
else
  npx tsx src/db/migrate.ts
fi
# One Node process (not npx → tsx → node): about 150 MB less memory, which
# matters on small servers (the Render demo has 512 MB).
exec node --import tsx src/main.ts
