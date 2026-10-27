# Installing Alpine VMS on site

The VMS runs on Alpine's own server on the factory LAN, next to CWIS. It needs no internet: guard and checker tablets, office PCs and the plate cameras talk to it over the LAN. SAP and CWIS are reached by background jobs; when either is down, the gate keeps working and the jobs catch up.

> **Status:** SAP, CWIS and the cameras still run as **mocks** (sample data). The real adapters come once the SAP partner and CWIS vendor answer the open items in `docs/SPEC.md`. Everything below works today for a trial with mocks and is the same for go-live.

Two ways to install. Pick one.

|          | Docker                                                             | Native                                                       |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Needs    | Docker (Linux), or Docker Desktop / Docker Engine (Windows Server) | Node.js 22, PostgreSQL 16, Git                               |
| Database | In a container (data in a Docker volume)                           | PostgreSQL installed on the server                           |
| Updates  | `git pull` + `docker compose up -d --build`                        | `git pull` + `pnpm install` + `pnpm build` + restart service |
| Best for | Trial, or a server only used for the VMS                           | A server IT already runs PostgreSQL on                       |

---

## A. Docker

```sh
git clone https://github.com/bryanhoo108/Alpine-VMS.git
cd Alpine-VMS
cp .env.example .env
```

Edit `.env`:

- **Trial with sample data:** set `SEED_DEMO_PIN` (4–8 digits) and `SEED_DEMO_PASSWORD` (10+ characters). Demo users, 60 sample cards and sample SDOs are created.
- **Real site:** leave the two `SEED_DEMO_*` empty and set `SITE_NAME=Alpine Pipe Manufacturing, Shah Alam`. Then add users and cards (step 3 below).
- Always set `POSTGRES_PASSWORD` to something only IT knows.

```sh
docker compose up -d --build
```

Open `http://SERVER-IP:8080`. `http://SERVER-IP:8080/api/health` should say `"ok": true`.

Admin tool inside the container (real site):

```sh
docker compose exec app sh -c 'cd /app/apps/server && npx tsx src/cli/admin.ts add-user --username guard.entry --name "Entry Guard" --role guard'
```

---

## B. Native install

### 1. Software

**Linux (Ubuntu 22.04/24.04):**

```sh
# Node.js 22 (NodeSource) and PostgreSQL 16
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs git postgresql-16
sudo corepack enable
```

**Windows Server 2019/2022:** install [Node.js 22 LTS](https://nodejs.org) (tick "Add to PATH"), [PostgreSQL 16](https://www.postgresql.org/download/windows/) and [Git](https://git-scm.com). In an Administrator PowerShell: `corepack enable`.

### 2. Database and code

Create a database user and database (Linux: `sudo -u postgres psql`; Windows: SQL Shell (psql)):

```sql
CREATE USER vms WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE vms OWNER vms;
```

```sh
git clone https://github.com/bryanhoo108/Alpine-VMS.git /opt/alpine-vms     # Windows: C:\alpine-vms
cd /opt/alpine-vms
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgres://vms:choose-a-strong-password@localhost:5432/vms
SESSION_SECRET=<64 random characters, e.g. from: openssl rand -hex 32>
WEB_DIR=/opt/alpine-vms/apps/web/dist          # Windows: C:\alpine-vms\apps\web\dist
FILES_DIR=/var/lib/alpine-vms/files            # Windows: C:\alpine-vms-data\files
```

Use absolute paths for `WEB_DIR` and `FILES_DIR`. Back up `FILES_DIR` (photos) with the database.

### 3. Site, users and cards

```sh
pnpm --filter @vms/server admin init-site --code APM --name "Alpine Pipe Manufacturing, Shah Alam"

# One line per person. Guards and checkers get a PIN; clerks, supervisors and admins a password.
pnpm --filter @vms/server admin add-user --username guard.entry --name "Entry Guard" --role guard
pnpm --filter @vms/server admin add-user --username guard.exit  --name "Exit Guard"  --role guard
pnpm --filter @vms/server admin add-user --username checker1    --name "Checker 1"   --role checker
pnpm --filter @vms/server admin add-user --username clerk       --name "Logistics Clerk" --role clerk
pnpm --filter @vms/server admin add-user --username supervisor  --name "Supervisor"  --role supervisor

# RFID card pool: a text file with one card number per line, as the reader shows it
pnpm --filter @vms/server admin add-cards --file cards.txt
pnpm --filter @vms/server admin list-users
```

The tool asks for each PIN or password; it is never typed on the command line. Other commands: `set-secret --username NAME` (forgotten PIN), `deactivate-user --username NAME` (person left).

To get card numbers: open a text editor on a PC with the USB card reader plugged in and tap each card; the reader types one number per line. Save that as `cards.txt`.

### 4. Run as a service

**Linux (systemd)**: create `/etc/systemd/system/alpine-vms.service`:

```ini
[Unit]
Description=Alpine VMS
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/alpine-vms/apps/server
ExecStart=/usr/bin/npx tsx --env-file=/opt/alpine-vms/.env src/main.ts
Restart=always
User=alpinevms

[Install]
WantedBy=multi-user.target
```

```sh
sudo useradd --system alpinevms && sudo chown -R alpinevms /opt/alpine-vms /var/lib/alpine-vms
sudo systemctl enable --now alpine-vms
journalctl -u alpine-vms -f      # logs
```

**Windows (NSSM)**: download [NSSM](https://nssm.cc), then in Administrator PowerShell:

```powershell
nssm install AlpineVMS "C:\Program Files\nodejs\npx.cmd" "tsx --env-file=C:\alpine-vms\.env src\main.ts"
nssm set AlpineVMS AppDirectory C:\alpine-vms\apps\server
nssm set AlpineVMS AppStdout C:\alpine-vms-data\vms.log
nssm set AlpineVMS AppStderr C:\alpine-vms-data\vms.log
nssm start AlpineVMS
```

Open port 8080 (or 443) in the server firewall for the LAN only.

---

## HTTPS for the tablets (required)

Android Chrome only allows the **live camera** and **NFC card reading** on HTTPS pages. Over plain HTTP the Photo button falls back to the tablet's camera app and NFC does not work (a USB keyboard-style reader still does).

1. Pick a name for the server, e.g. `vms.apm.local`, and add it to the factory DNS (or use the server's fixed IP).
2. Make a certificate for that name. With the company's own certificate authority if IT has one; otherwise a local one, e.g. with [mkcert](https://github.com/FiloSottile/mkcert):

   ```sh
   mkcert -install
   mkcert vms.apm.local 192.168.1.20      # your name and fixed IP
   ```

3. Point the VMS at the files in `.env` (Docker: copy them into `./certs` as `cert.pem` and `key.pem`):

   ```
   HTTPS_CERT_FILE=/opt/alpine-vms/certs/cert.pem     # Docker: /certs/cert.pem
   HTTPS_KEY_FILE=/opt/alpine-vms/certs/key.pem       # Docker: /certs/key.pem
   ```

4. Install the certificate authority on every tablet: copy `rootCA.pem` (mkcert: `mkcert -CAROOT`) to the tablet, then **Settings → Security → Encryption & credentials → Install a certificate → CA certificate**.
5. Restart the VMS and open `https://vms.apm.local:8080`. No browser warning should appear.

---

## Tablets and PCs

| Device               | Open                         | Setup                                                                                                                                                                                     |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry guard tablet   | `https://vms.apm.local:8080` | Sign in as the entry guard, tap **In**. Chrome menu → **Add to Home screen** (opens full screen). Turn on NFC. Allow the camera. Pin the app (Android screen pinning) or use a kiosk app. |
| Exit guard tablet    | same                         | As above, tap **Out**. Each tablet remembers its post.                                                                                                                                    |
| Checker tablet/phone | same                         | Sign in as the checker. NFC on, camera allowed.                                                                                                                                           |
| Office PC            | same                         | **Office login** with username and password.                                                                                                                                              |
| Supervisor           | same                         | Office login; switches between Office, In, Out and Check.                                                                                                                                 |

Landscape tablets of about 1280×800 are what the screens are designed for; phones work too.

## Plate cameras

Configure each ANPR camera to send its reads by HTTP POST to the VMS:

- Entry camera: `https://vms.apm.local:8080/api/lpr/entry`
- Exit camera: `https://vms.apm.local:8080/api/lpr/exit`
- Header `x-vms-token: <LPR_WEBHOOK_TOKEN from .env>`
- Body (mock format today): `{"plate": "WXY 1234", "confidence": 0.95}`

The real camera's own message format is handled by its LPR adapter (`packages/adapters/src/lpr`) once the camera model is chosen.

## Backups

The database and the photo folder are all there is. Nightly, for example:

```sh
pg_dump -Fc -U vms vms > /backups/vms-$(date +%F).dump        # Docker: docker compose exec db pg_dump -Fc -U vms vms > ...
tar -czf /backups/vms-files-$(date +%F).tgz /var/lib/alpine-vms/files
```

Restore: `pg_restore -c -U vms -d vms FILE.dump`, then put the files folder back. IC photos older than `IC_PHOTO_RETENTION_DAYS` are deleted automatically (PDPA); keep backups no longer than that too.

## Updating

```sh
cd /opt/alpine-vms && git pull
pnpm install --frozen-lockfile && pnpm build
sudo systemctl restart alpine-vms          # Windows: nssm restart AlpineVMS
# Docker: docker compose up -d --build
```

Database changes are applied automatically when the server starts.

## Is it healthy?

`GET /api/health` (no sign-in needed):

- `db: "up"` and `site` present
- `queues.sapWrites.pending` / `queues.cwisPushes.pending`: updates waiting for SAP / CWIS. They should drop to 0 within a minute; a growing number with an old `oldestPendingAt` means SAP or CWIS cannot be reached (the gate still works).
- `jobs[]`: each background job with `lastOkAt` and `lastError`.
- `freeCards`: cards left in the pool.
