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
| Secrets | Cerulean Vault (SecretOps) | NPM, database, DNS, and certificate integration secrets |
| Identity | Authentik (IdentityOps) | SSO for proxied applications; NPM is the edge, not the identity source |
| Storage (optional) | ONYX (StorageOps) | Optional destination for copied backup archives |

## Explicitly does NOT own

NPM Edge must not become a second user directory, billing system, DNS
authority, or application backup system. The `backup-ui` snapshot is
specifically NPM configuration and TLS state — not a backup of proxied
applications.

## Sign-in the admin UI

Upstream Nginx Proxy Manager ships one login — an email and password in its own
`user` table — and has no OIDC. That login is a second identity store, so this
fork's `backend/lib/sso.js` turns a real Authentik OIDC sign-in into the admin
UI's login: **the admin UI signs in with the identity the platform's SSO gateway
already established**, and the password grant is refused on every gated door.

The gateway is `oauth2-proxy` (`cerulean-npm-sso` in `compose.cerulean.yml`), an
OIDC relying party registered in Authentik as the `npm-edge` application. It runs
in this container's network namespace, so it listens on the container's loopback
and the proxy host that fronts the admin UI forwards to
`127.0.0.1:<NPM_SSO_GATEWAY_PORT>`, not to `:81`. The browser completes a real
code flow against Authentik — **no outpost and no `auth_request` anywhere in the
path** — and the gateway then proxies the authenticated request to
`127.0.0.1:<NPM_ADMIN_PORT>`, setting `X-Forwarded-Email`, `X-Forwarded-User` and
`X-Forwarded-Groups`.

Two facts have to hold before those identity headers are believed, and the app
checks both (`backend/lib/sso.js`):

- The request carries `X-NPM-Edge: yes`, set by this image's own admin vhost
  (`docker/rootfs/etc/nginx/conf.d/production.conf.template`). That vhost is the
  only thing that can reach the API (nginx listens on the admin port and proxies
  `/api/` to the app), and it sets the header on every one of those requests from
  the peer address it actually saw — so a caller that sends its own
  `X-NPM-Edge` is overwritten, and the header is a verdict rather than a claim.
  It says `yes` only when the peer was the container's own loopback.
- The connection to the backend is loopback. The app binds `0.0.0.0`, so the
  vhost above is not the only way in — a container on the same Docker network
  could reach the API directly and set any header it likes. Only the vhost's hop
  is loopback.

Together that means: **every proxy host that fronts this UI must forward to the
gateway's loopback address** (`127.0.0.1:<NPM_SSO_GATEWAY_PORT>`), not to this
host's LAN IP — the gateway is the only thing that can reach the admin port over
loopback, and the vhost then vouches for its request. A host pointing at the LAN
IP, and a client reaching the published admin port directly, fail both checks:
forging the identity headers (or `X-NPM-Edge` itself) gets 403. A host that
forwards to the LAN IP simply gets no SSO, and its login page says so.

Once the caller is trusted:
- The identity must be in `AUTH_SSO_REQUIRED_GROUP` (default
  `cerulean-platform`), mirroring the gateway's own `--allowed-group`, so the
  gateway and this check agree. Members of `AUTH_SSO_ADMIN_GROUP` get NPM's
  `admin` role; everyone else gets `user`.
- The NPM user is created on first sign-in (`AUTH_SSO_AUTO_CREATE`) with **no
  `auth` row at all** — there is no password to steal, and `POST /tokens` can
  never succeed for it. Roles follow the group mapping, so removing someone from
  the Authentik group demotes them on their next sign-in, and disabling them in
  Authentik ends their access.

What is left of the password grant (`POST /api/tokens`):

| Caller | Allowed |
|---|---|
| Any request that arrived from the edge | **never** — the doors are SSO-only |
| A service account in `AUTH_SERVICE_ACCOUNTS`, off-edge (e.g. Cerulean's `NPM_EMAIL` provisioning hosts over the LAN) | yes |
| Anyone off-edge with `BREAKGLASS_LOGIN=1` | yes — recovery only |
| Anyone else | no |

`BREAKGLASS_LOGIN=1` is the platform-wide convention: set it on the host,
restart this one service, sign in through the LAN port, then unset it and
restart again. A broken Authentik can therefore never lock the operator out of
the proxy's own recovery UI. (Unlike the other platforms, break-glass here only
ever unbolts the *off-edge* door: an edge door is SSO-only by construction, so
the way back in is the admin port on the LAN, not a public host.)

With `AUTH_SSO_ENABLED` unset the module is inert: the image behaves exactly
like upstream NPM and `POST /tokens` is not touched. Enabling it requires the
first-party image (`docker/Dockerfile.sso`, the `innotel/npm-edge` tag) — the
upstream `jc21/nginx-proxy-manager` image has none of this.

`backup-ui` is deliberately out of scope: it is a management-plane tool, not a
user surface. It stays off the edge (LAN only) and its optional Basic
Authentication stays as the private-network guard it documents itself as.

## Integration rules

- Cerulean automation talks to the NPM API (see `NPM_API_URL` in
  `.env.example`) to provision hosts and attach certificates idempotently. It
  runs off-edge as a service account, which is why it keeps working once the
  password grant is closed to everyone else.
- Proxy hosts that front the admin UI forward to the SSO gateway's loopback
  (`127.0.0.1:<NPM_SSO_GATEWAY_PORT>`), not to the host's LAN IP or `:81`. See
  [Sign-in the admin UI](#sign-in-the-admin-ui).
- Backup archives may be copied to ONYX; restore is a privileged operation
  that replaces live edge state.
- Secrets stay in `.env` or Cerulean Vault, never in Git.

See also the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack)
for the canonical architecture definition and the
[conformity standard](https://github.com/innotelinc/innotel-platform-stack/blob/main/docs/standard.md).