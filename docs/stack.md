# NPM Edge — stack map

NPM Edge is the **EdgeOps** layer of the Innotel Platform Stack: the public
HTTP/S edge, TLS termination, and recoverable proxy configuration. It is the
front door for services that need public HTTP/S access.

## Owns

| Domain | What NPM Edge owns |
|---|---|
| Edge routing | Reverse proxy hosts, redirects, streams, custom Nginx configuration |
| TLS termination | Let's Encrypt certificate issuance, renewal, and attachment to hosts |
| Edge policy | NPM access lists (HTTP auth, allow/deny) for proxied apps |
| Edge state | NPM + MariaDB state store; the `backup-ui` logical backup/restore of proxy configuration and certificate material |

## Consumes

| Service | Platform | Why |
|---|---|---|
| DNS + certificate lifecycle | Cerulean (TrustOps) | Cerulean automates DNS and TLS and provisions proxy hosts through the NPM API |
| Secrets | Infisical (SecretOps) | NPM, database, DNS, and certificate integration secrets |
| Identity | Authentik (IdentityOps) | SSO for proxied applications; NPM is the edge, not the identity source |
| Storage (optional) | ONYX (StorageOps) | Optional destination for copied backup archives |

## Explicitly does NOT own

NPM Edge must not become a second user directory, billing system, DNS
authority, or application backup system. The `backup-ui` snapshot is
specifically NPM configuration and TLS state — not a backup of proxied
applications.

## Integration rules

- Cerulean automation talks to the NPM API (see `NPM_API_URL` in
  `.env.example`) to provision hosts and attach certificates idempotently.
- Backup archives may be copied to ONYX; restore is a privileged operation
  that replaces live edge state.
- Secrets stay in `.env` or Infisical, never in Git.

See also the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack)
for the canonical architecture definition and the
[conformity standard](https://github.com/innotelinc/innotel-platform-stack/blob/main/docs/standard.md).