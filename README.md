<div align="center">

# 🛡️ NPM Edge — Nginx Proxy Manager

**Self-hosted edge routing, TLS termination, and recoverable proxy configuration.**

NPM Edge packages Nginx Proxy Manager with its MariaDB state store and the
`backup-ui` companion into one reproducible Docker Compose stack.

[![CI](https://github.com/innotelinc/npm/actions/workflows/ci.yml/badge.svg)](https://github.com/innotelinc/npm/actions/workflows/ci.yml)
[![Pages](https://github.com/innotelinc/npm/actions/workflows/pages.yml/badge.svg)](https://github.com/innotelinc/npm/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> **About NPM Edge** — the Innotel edge component for forwarding public hostnames
to private services, terminating HTTP/TLS, managing Let's Encrypt certificates,
controlling access lists, and keeping the complete NPM state recoverable. The
stack includes Nginx Proxy Manager, MariaDB, and a protected backup/import
companion that snapshots the database, NPM configuration, and certificate
material. **Landing page:** [innotelinc.github.io/npm](https://innotelinc.github.io/npm)

**Non-negotiables:** self-hosted · Docker Compose · certificates and edge state
remain under operator control · backups are logical and restorable · secrets live
in `.env` or Infisical, never in Git · the backup UI is opt-in protected with
HTTP Basic Authentication.

---

## ✨ What it does

NPM Edge is the **EdgeOps** layer of the Innotel Platform Stack. It is the
front door for services that need public HTTP/S access; it does not own identity,
billing, DNS authority, or application data.

| Capability | Component | Purpose |
|---|---|---|
| 🌐 **Reverse proxy** | Nginx Proxy Manager | Proxy hosts, redirects, streams, and custom Nginx configuration |
| 🔐 **TLS termination** | NPM + Let's Encrypt | Issue, renew, and attach certificates to public hosts |
| 👥 **Access control** | NPM Access Lists | Optional HTTP authentication and allow/deny policies |
| 🗃️ **State store** | MariaDB | Persistent NPM users, hosts, certificates, and settings |
| 💾 **Recovery** | `backup-ui` | Database + `/data` + Let's Encrypt backup and restore |
| 🧭 **Automation surface** | NPM API | Idempotent provisioning from Cerulean and platform setup scripts |

## 🧱 Stack boundary

NPM Edge owns the public edge and its recoverability. Other platform services own
their domains of responsibility:

| System | Relationship |
|---|---|
| **Cerulean** | TrustOps owner: DNS automation and certificate lifecycle; exports/attaches material to NPM |
| **Authentik** | IdentityOps owner: SSO and user identity for consuming applications; NPM remains the edge, not the identity source |
| **Infisical** | SecretOps owner: stores NPM, database, DNS, and certificate integration secrets |
| **ONYX** | StorageOps owner: optional destination for copied backup archives |
| **Monarch / Zeus / Signara / Oasis** | Business platforms behind NPM proxy hosts |

NPM must not become a second user directory, billing system, DNS authority, or
application backup system. The `backup-ui` snapshot is specifically for NPM
configuration and TLS state; it is not a backup of proxied applications.

## 🚀 Quick start

```bash
git clone https://github.com/innotelinc/npm.git
cd npm
cp .env.example .env
# Set DB_MYSQL_PASSWORD and DB_ROOT_PASSWORD in .env.
# Set BACKUP_UI_USER and BACKUP_UI_PASSWORD before exposing port 82.
docker compose up -d --build
```

The default endpoints are:

| Endpoint | Default | Purpose |
|---|---:|---|
| HTTP | `http://127.0.0.1:80` | Public HTTP edge |
| HTTPS | `https://127.0.0.1:443` | Public HTTPS edge |
| NPM admin | `http://127.0.0.1:81` | NPM administration |
| Backup UI | `http://127.0.0.1:82` | Settings backup/import companion |

Do not publish the admin or backup UI directly to the Internet without an
additional network policy, VPN, or authenticated reverse-proxy route.

## ⚙️ Configuration

Copy `.env.example` to `.env`. The Compose defaults preserve the established
NPM ports while allowing a host with occupied ports to choose alternatives.

```dotenv
DB_MYSQL_PASSWORD=replace-with-a-long-random-password
DB_ROOT_PASSWORD=replace-with-a-different-long-random-password
BACKUP_UI_USER=npmbackup
BACKUP_UI_PASSWORD=replace-with-another-long-random-password
NPM_HTTP_PORT=80
NPM_HTTPS_PORT=443
NPM_ADMIN_PORT=81
BACKUP_UI_PORT=82
CRON_SCHEDULE=0 2 * * *
BACKUP_RETENTION=7
```

For production, use Infisical or another secret manager to render `.env`; do
not commit real values. `BACKUP_UI_USER` and `BACKUP_UI_PASSWORD` must both be
set to enable Basic Authentication. A blank pair leaves the backup UI
unauthenticated and is suitable only for a private management network.

## 🔌 Cerulean integration policy

This repository is the canonical NPM Edge component used by Cerulean when
**`BIND_MODE=local` and `NPM_MODE=local`**. Cerulean imports
`compose.cerulean.yml`, which starts all three services — NPM, MariaDB, and
`backup-ui` — and persists their state in this repository's runtime directories.

A Cerulean deployment using **`BIND_MODE=remote` must use `NPM_MODE=remote`**
and point `NPM_API_URL` at an already-managed external NPM instance. The
bundled NPM profile is intentionally rejected in that mode so a remote DNS
installation cannot accidentally start a second public edge or replace the
existing one.

To use this stack with local BIND, configure the sibling Cerulean checkout and
run:

```bash
BIND_MODE=local NPM_MODE=local \
  docker compose --profile bind --profile npm up -d
```

The NPM admin API is available to Cerulean at `http://cerulean-npm:81` inside
the Compose network; `backup-ui` is exposed on the configured management port.

---

## 💾 Backup and restore

`backup-ui` is part of the root stack, not a separate deployment. It provides:

- one-click full settings backups;
- nightly backups with rolling retention;
- archive download and deletion;
- upload validation that rejects malformed or path-traversal archives;
- an explicit confirmation step before destructive restore;
- restore of the NPM database, `/data`, and Let's Encrypt material, followed by
  an NPM restart.

Backups are written to `./backups` and include:

```text
npm-db.sql.gz
 data/
 letsencrypt/
```

Runtime NPM logs are excluded from the archive. Restore is intentionally
high-impact: it replaces the current NPM database, generated configuration, and
certificate directory. Keep an independent copy of important archives and
restrict access to the backup UI. The mounted Docker socket is required so the
companion can stop and restart NPM during restore.

## 🗺️ Operating model

```text
Internet
   │ 80 / 443
   ▼
┌──────────────────────────────┐
│ NPM Edge                     │
│ proxy hosts · TLS · ACLs     │
└──────────────┬───────────────┘
               │ private upstreams
       ┌───────┼────────┬─────────────┐
       ▼       ▼        ▼             ▼
   Monarch   Zeus    Cerulean      other apps

┌──────────────┐       ┌─────────────────────────┐
│ MariaDB      │◄──────►│ backup-ui               │
│ NPM metadata │       │ snapshot / restore UI   │
└──────────────┘       └─────────────────────────┘
```

A normal deployment sequence is:

1. Create the `.env` from the template and set unique secrets.
2. Start MariaDB and NPM with `docker compose up -d --build`.
3. Configure the NPM admin account and initial proxy hosts.
4. Issue or import certificates through NPM/Cerulean.
5. Enable Basic Authentication for `backup-ui` before exposing it beyond localhost.
6. Create and download a first backup; verify its archive contents.
7. Add monitoring for ports 80/443, the NPM API, and backup freshness.

## 🧪 Validation

Run the repository checks without starting a production stack:

```bash
# Compose interpolation with safe test-only values
env DB_MYSQL_PASSWORD=test-db-password DB_ROOT_PASSWORD=test-root-password \
  docker compose config --quiet

# Backup companion syntax
python3 -m py_compile backup-ui/server.py

# Shell syntax
sh -n backup-ui/backup.sh backup-ui/restore.sh backup-ui/start.sh
```

The GitHub Actions CI checks the same boundaries, builds the backup companion,
and verifies that tracked web files and environment templates do not leak
localhost-only or Docker-bridge addresses.

## 📚 Documentation

| Guide | What it covers |
|---|---|
| [ABOUT.md](ABOUT.md) | Ownership, boundaries, threat model, and integrations |
| [NPM docs](docs/src/guide/index.md) | Upstream NPM administration and operation |
| [Setup instructions](docs/src/setup/index.md) | NPM database and deployment options |
| [Security policy](SECURITY.md) | Vulnerability reporting and supported versions |
| [Landing page](web/landing/index.html) | Public product overview |

## 🧱 Repository layout

```text
docker-compose.yml       # standalone NPM + MariaDB + backup-ui stack
compose.cerulean.yml     # local-BIND Cerulean integration definition
.env.example             # safe configuration template
backup-ui/               # backup/restore HTTP companion
backend/                 # NPM API and configuration engine
frontend/                # NPM admin interface
docs/                    # VitePress operational documentation
web/landing/             # Innotel portfolio landing page
.github/workflows/        # CI, Pages, dependency automation
```

## 🔒 Security notes

- Never commit `.env`, database directories, `/data`, `/letsencrypt`, or
  `/backups`; they are ignored by Git.
- Use different random secrets for the NPM database user, MariaDB root, and
  backup UI Basic Authentication.
- Keep ports 81 and 82 on a management network. If they must be proxied, put
  them behind a separate access policy and TLS.
- Treat a restore as a privileged operation. It replaces live edge state and
  controls the Docker daemon through the mounted socket.
- Prefer Cerulean for DNS and certificate lifecycle automation and Infisical
  for secret storage; do not duplicate those control planes here.
- Review generated Nginx configuration after importing an archive and keep a
  known-good rollback archive.

## 🏛️ Platform stack

NPM Edge is the ecosystem's **EdgeOps** component in the
[**Innotel Platform Stack**](https://github.com/innotelinc/innotel-platform-stack):
the public routing and TLS termination layer consumed by every platform that
needs an HTTP/S edge. Cerulean owns DNS and trust lifecycle, Authentik owns
identity, Infisical owns secrets, ONYX owns storage, and NPM owns forwarding,
edge policy, and recoverable proxy configuration.

---

*NPM Edge — route safely, terminate TLS, recover quickly.*
