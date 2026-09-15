/**
 * NPM Edge — Authentik SSO sign-in (gateway mode).
 *
 * The Innotel stack's rule is that identity lives in Cerulean's Authentik and
 * NPM is the edge, not a second user directory. Nginx Proxy Manager has no OIDC
 * support of its own, so the admin UI signs in with the identity the platform's
 * SSO gateway (oauth2-proxy) has already established: the gateway runs in this
 * container's network namespace (docker compose `cerulean-npm-sso`), does a real
 * OIDC code flow against Authentik for the browser, and on every authenticated
 * request sets `X-Forwarded-User/Email/Groups` headers for the upstream.
 *
 * Where does a request come from? Two facts, and it must be both:
 *
 *   - `X-NPM-Edge: yes`, set by this image's own admin vhost
 *     (`docker/rootfs/etc/nginx/conf.d/production.conf.template`). That vhost is
 *     the only thing that can reach the backend, and it sets the header on every
 *     `/api/` request from the peer address it saw — so a caller that sends its
 *     own `X-NPM-Edge` is overwritten. It says "yes" only when the peer was the
 *     container's own loopback, which is what a fronting proxy host looks like
 *     (they forward to `127.0.0.1`, never to the host's LAN IP).
 *   - A loopback connection to the backend itself. The backend listens on
 *     0.0.0.0, so the nginx layer above is not the only way in; a container on
 *     the same Docker network could reach it directly and set any header it
 *     likes. Only nginx's own hop is loopback.
 *
 * The gateway shares this container's network namespace, so the proxy host that
 * fronts it forwards to `127.0.0.1` — the gateway's own address, and a loopback
 * peer from this nginx's point of view. Its identity headers are relayed by the
 * proxy include (`conf.d/include/proxy.conf`); the gateway is the only thing on
 * loopback that a fronting host can point at, so by the time the backend sees
 * these headers the browser has completed the OIDC code flow. A client that
 * never passed the gateway fails both facts above: the fronting host refuses it
 * (redirect to Authentik), and hitting the published LAN port yields "no" from
 * the vhost — forging `X-Forwarded-*` (or `X-NPM-Edge` itself) gets nothing.
 *
 * Then:
 *
 *   1. The identity must be a member of `AUTH_SSO_REQUIRED_GROUP`, mirroring
 *      the Authentik application's own group binding so gate and check agree.
 *   2. A request that did come from the edge may never use the password grant —
 *      every door to the UI is SSO-only. The password path survives off-edge for
 *      exactly two things: automation service accounts, and break-glass.
 *
 * Break-glass follows the platform convention (`BREAKGLASS_LOGIN=1`, set on the
 * host and the one service restarted): it re-enables the local password path so
 * a broken Authentik can never lock the operator out of the proxy's own
 * recovery UI. It is off unless explicitly set.
 *
 * With `AUTH_SSO_ENABLED` unset the module is inert and the backend behaves
 * exactly like upstream NPM.
 */

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const DEFAULT_EDGE_HEADER = "x-npm-edge";
const EDGE_HEADER_VALUE = "yes";
const DEFAULT_SSO_GROUP = "cerulean-platform";
const DEFAULT_SSO_EXPIRY = "1d";

const toBool = (value) => /^(1|true|yes|on)$/i.test((value ?? "").trim());

const normalizeEmail = (value) => (value ?? "").trim().toLowerCase();

/**
 * The live configuration, read from the environment on each call. The values
 * are per-container and never change while the process runs, but reading them
 * lazily keeps this module importable (and testable) without a bootstrap.
 *
 * @returns {Object}
 */
const config = () => {
	const requiredGroup = (process.env.AUTH_SSO_REQUIRED_GROUP ?? DEFAULT_SSO_GROUP).trim();
	return {
		enabled: toBool(process.env.AUTH_SSO_ENABLED),
		edgeHeader: (process.env.AUTH_SSO_EDGE_HEADER ?? "").trim().toLowerCase() || DEFAULT_EDGE_HEADER,
		requiredGroup: requiredGroup,
		adminGroup: (process.env.AUTH_SSO_ADMIN_GROUP ?? "").trim() || requiredGroup,
		autoCreate: process.env.AUTH_SSO_AUTO_CREATE === undefined ? true : toBool(process.env.AUTH_SSO_AUTO_CREATE),
		tokenExpiry: (process.env.AUTH_SSO_TOKEN_EXPIRY ?? "").trim() || DEFAULT_SSO_EXPIRY,
	};
};

/**
 * Is the local password grant switched on for recovery?
 *
 * @returns {boolean}
 */
const breakglassLoginEnabled = () => toBool(process.env.BREAKGLASS_LOGIN);

/**
 * The machine accounts allowed to use the password grant off-edge. Cerulean's
 * `npm-proxy-hosts.py` provisions hosts through the NPM API over the LAN, and
 * that is the only credential left once the human login is gone.
 *
 * @returns {Array<String>} lowercased emails
 */
const serviceAccounts = () =>
	(process.env.AUTH_SERVICE_ACCOUNTS ?? "")
		.split(",")
		.map((email) => normalizeEmail(email))
		.filter((email) => email !== "");

/**
 * The address a request actually came from. `socket.remoteAddress` is the TCP
 * peer and cannot be set by a header, which is the whole point: `req.ip` and
 * the forwarding headers are advisory here, this is not.
 *
 * @param   {Object} req  express request (or a {socket:{remoteAddress}} stand-in)
 * @returns {String}
 */
const remoteAddress = (req) => req?.socket?.remoteAddress ?? req?.remoteAddress ?? "";

/**
 * Did this request arrive over the container's loopback? True for the hop from
 * this image's own nginx, false for the published port and for other containers.
 *
 * @param   {Object} req
 * @returns {boolean}
 */
const cameOverLoopback = (req) => LOOPBACK_ADDRESSES.has(remoteAddress(req));

/**
 * Did our own edge vhost forward this request? Both facts have to hold: the
 * vhost's verdict (which a client cannot forge, because the vhost overwrites
 * the header) and the loopback connection to the backend (so reaching the
 * backend directly from another container cannot fake the vhost's verdict).
 *
 * @param   {Object} req
 * @param   {Object} [cfg]
 * @returns {boolean}
 */
const cameFromEdge = (req, cfg = config()) => {
	if (!cfg.enabled) {
		return false;
	}
	const verdict = req?.headers?.[cfg.edgeHeader];
	const value = Array.isArray(verdict) ? verdict[0] : verdict;
	return (value ?? "").trim().toLowerCase() === EDGE_HEADER_VALUE && cameOverLoopback(req);
};

/**
 * Authentik sends the group list comma-separated. Accept a JSON array too, in
 * case a provider is configured to emit one.
 *
 * @param   {String} raw
 * @returns {Array<String>}
 */
const parseGroups = (raw) => {
	const value = (raw ?? "").trim();
	if (value === "") {
		return [];
	}
	if (value.startsWith("[")) {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) {
				return parsed.map((group) => String(group).trim()).filter((group) => group !== "");
			}
		} catch {
			// fall through to the comma-separated form
		}
	}
	return value
		.split(",")
		.map((group) => group.trim())
		.filter((group) => group !== "");
};

/**
 * The identity the edge vouches for, or null when this request is not an
 * authenticated edge request.
 *
 * @param   {Object} req
 * @param   {Object} [cfg]
 * @returns {Object|null} {email, username, name, uid, groups}
 */
const identityFromRequest = (req, cfg = config()) => {
	if (!cameFromEdge(req, cfg)) {
		return null;
	}
	const headers = req?.headers ?? {};
	// The gateway's identity headers. oauth2-proxy sets these on authenticated
	// upstream requests; a fronting host relays them via the proxy include, and
	// the include overwrites whatever the client sent — so they cannot be forged
	// from the browser side of the gate.
	const email = normalizeEmail(headers["x-forwarded-email"]);
	if (email === "") {
		return null;
	}
	return {
		email: email,
		username: (headers["x-forwarded-user"] ?? headers["x-forwarded-preferred-username"] ?? "").trim(),
		name: (headers["x-forwarded-preferred-username"] ?? "").trim(),
		uid: (headers["x-forwarded-user"] ?? "").trim(),
		groups: parseGroups(headers["x-forwarded-groups"]),
	};
};

/**
 * Is this identity allowed to use the admin UI? Membership of the required
 * group is the whole check; an empty `AUTH_SSO_REQUIRED_GROUP` means "any
 * identity the gateway vouches for", which has to be asked for explicitly.
 *
 * @param   {Object} identity
 * @param   {Object} [cfg]
 * @returns {boolean}
 */
const identityAllowed = (identity, cfg = config()) => {
	if (!identity?.email) {
		return false;
	}
	if (cfg.requiredGroup === "") {
		return true;
	}
	return identity.groups.includes(cfg.requiredGroup);
};

/**
 * The NPM roles an identity maps to. NPM has exactly two: `admin` (all hosts
 * and users) and `user` (its own permission row). The admin group is the one
 * that manages the edge.
 *
 * @param   {Object} identity
 * @param   {Object} [cfg]
 * @returns {Array<String>}
 */
const rolesForIdentity = (identity, cfg = config()) => {
	if (cfg.adminGroup !== "" && identity?.groups?.includes(cfg.adminGroup)) {
		return ["admin"];
	}
	return ["user"];
};

/**
 * May this request use `POST /tokens` (the email + password grant)?
 *
 * @param   {Object} req       express request
 * @param   {String} identity  the email being claimed
 * @param   {Object} [cfg]
 * @returns {boolean}
 */
const passwordGrantAllowed = (req, identity, cfg = config()) => {
	if (!cfg.enabled) {
		return true; // SSO off: upstream behaviour, unchanged
	}
	if (cameFromEdge(req, cfg)) {
		return false; // a door to the UI is SSO-only
	}
	if (breakglassLoginEnabled()) {
		return true;
	}
	return serviceAccounts().includes(normalizeEmail(identity));
};

/**
 * The auth surface the frontend needs to render the right thing. Purely a hint
 * for the UI — `passwordGrantAllowed()` above is the enforcement.
 *
 * @returns {Object}
 */
const authInfo = () => {
	const cfg = config();
	return {
		sso: {
			enabled: cfg.enabled,
			requiredGroup: cfg.requiredGroup,
		},
		password: {
			// Whether the form is offered at all. With SSO on, only the
			// break-glass opens it — automation accounts call the API, they do
			// not need a form, and a LAN human seeing one that always refuses is
			// worse than being pointed at the gate.
			enabled: !cfg.enabled || breakglassLoginEnabled(),
			breakglass: breakglassLoginEnabled(),
		},
	};
};

export {
	authInfo,
	breakglassLoginEnabled,
	cameFromEdge,
	cameOverLoopback,
	config,
	identityAllowed,
	identityFromRequest,
	parseGroups,
	passwordGrantAllowed,
	remoteAddress,
	rolesForIdentity,
	serviceAccounts,
};
