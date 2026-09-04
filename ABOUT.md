# NPM Edge — ABOUT

## Identity

**NPM Edge** is Innotel's self-hosted **EdgeOps** component. It packages Nginx
Proxy Manager with its MariaDB state store and the `backup-ui` recovery
companion.

- **Repository:** `innotelinc/npm`
- **Classification:** EdgeOps
- **Primary function:** public HTTP/S routing, TLS termination, access lists,
and recoverable NPM configuration
- **License:** MIT
- **Landing page:** https://innotelinc.github.io/npm
- **Default admin surface:** `http://127.0.0.1:81`
- **Default recovery surface:** `http://127.0.0.1:82`

## Ownership boundary

NPM Edge owns:

- Nginx Proxy Manager deployment and runtime configuration;
- proxy hosts, redirections, streams, access lists, and edge policy;
- TLS termination and NPM-managed certificate attachments;
- NPM users, permissions, audit records, and generated Nginx configuration;
- recoverable snapshots of the NPM database, `/data`, and Let's Encrypt state.

NPM Edge does not own:

- authoritative DNS zones or DNS records — **Cerulean / TrustOps**;
- user identity, SSO, MFA, or organizations — **Authentik / IdentityOps**;
- secrets and private-key custody — **Infisical / SecretOps**;
- application data behind a proxy host — the consuming platform;
- long-term object/file storage — **ONYX / StorageOps**;
- billing, subscriptions, or entitlements — **Magnate / RevenueOps**.

The boundary is deliberate: NPM is the edge, not a replacement for the
platform that owns the service being proxied.

## Stack components

| Component | Role | Persistent state |
|---|---|---|
| `app` | Nginx Proxy Manager UI/API and Nginx edge | `./data`, `./letsencrypt` |
| `db` | MariaDB backend for NPM | `./mysql` |
| `backup-ui` | Backup/download/import companion | `./backups` |

The repository contains two Compose entry points:

- `docker-compose.yml` is the standalone NPM Edge deployment;
- `compose.cerulean.yml` is the profile-gated local-BIND integration imported by
  Cerulean.

Both entry points use the same NPM, MariaDB, and `backup-ui` topology.

NPM Edge is bundled by Cerulean only for a fully local deployment:

```text
BIND_MODE=local + NPM_MODE=local
        │
        ├── cerulean-bind
        └── NPM Edge: NPM + MariaDB + backup-ui
```

Cerulean imports `compose.cerulean.yml` from this repository instead of
maintaining a second NPM definition. The imported services are profile-gated
and use this repository's `data/`, `mysql/`, `letsencrypt/`, and `backups/`
directories for persistence.

When `BIND_MODE=remote`, Cerulean requires `NPM_MODE=remote` and talks to an
external NPM API through `NPM_API_URL`. The local profile is rejected in that
mode to prevent duplicate edge ownership and accidental public cutover.



### Cerulean — TrustOps

Cerulean provisions proxy hosts through the NPM API, manages authoritative DNS,
and issues/distributes certificates. NPM stores the resulting edge attachment
and terminates TLS. Certificate files must remain synchronized with the NPM
state database; restoring one without the other can make Nginx fail to load.

### Authentik — IdentityOps

Applications behind NPM may use Authentik OIDC, LDAP, or another identity
integration. NPM's own admin accounts are separate operational credentials;
NPM should not be used as the identity source for the platform ecosystem.

### Infisical — SecretOps

Database passwords, NPM API credentials, backup UI credentials, DNS tokens, and
certificate integration secrets should be rendered from Infisical into the
runtime environment. `.env.example` contains placeholders only.

### ONYX — StorageOps

The local `./backups` directory is the first recovery tier. Operators may copy
archives to ONYX or another independent storage target. `backup-ui` does not
implicitly upload backups to a remote storage provider.

### Consuming platforms

Monarch, Zeus, Signara, Oasis, Capstone, Cerulean, Magnate, and other services
may sit behind NPM. Their application configuration, databases, media, and
identity remain outside the NPM backup boundary.

## Backup and restore threat model

The `backup-ui` service is intentionally powerful:

- it can dump the NPM database;
- it can read NPM configuration and certificate material;
- it can stop and restart NPM through the Docker socket;
- it can replace the live database, `/data`, and Let's Encrypt directories.

Therefore:

1. Set `BACKUP_UI_USER` and `BACKUP_UI_PASSWORD` in every non-local deployment.
2. Keep port 82 on a management network or behind a protected VPN.
3. Treat downloaded archives as secrets: they may contain private keys and API
   configuration.
4. Keep at least one backup outside the host being protected.
5. Review an archive before confirming a restore.
6. Test restoration on a disposable environment before relying on it for
   disaster recovery.

Archive validation rejects malformed archives and path traversal, but it cannot
make a trusted backup harmless. Restore always requires an explicit UI
confirmation and is destructive to the current NPM state.

## Deployment contract

```text
Internet :80/:443
       │
       ▼
NPM Edge : proxy hosts, TLS, ACLs
       │
       ├── MariaDB : NPM metadata
       └── backup-ui :82 : backup/restore control plane
```

Required deployment invariants:

- NPM and MariaDB use the same `DB_MYSQL_PASSWORD`;
- backup-ui uses the same database connection and root credentials;
- `./data`, `./letsencrypt`, `./mysql`, and `./backups` are persistent and
  independently protected;
- the backup UI can reach the Docker socket when restore is enabled;
- ports 81 and 82 are not accidentally published as public application routes;
- DNS and certificate automation are delegated to the owning platform.

## Change policy

Changes to proxy host schemas, certificate handling, generated Nginx files,
restore behavior, or database migrations are operationally sensitive. Every
such change should include:

- a migration/rollback note;
- a Compose validation;
- a syntax or unit test for the changed helper;
- a direct health check for NPM and backup-ui;
- confirmation that no real secrets or runtime data are tracked.

---

*NPM Edge is the Innotel edge: route safely, terminate TLS, recover quickly.*
