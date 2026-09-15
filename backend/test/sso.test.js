import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as sso from "../lib/sso.js";

const MANAGED_VARS = [
	"AUTH_SSO_ENABLED",
	"AUTH_SSO_EDGE_HEADER",
	"AUTH_SSO_REQUIRED_GROUP",
	"AUTH_SSO_ADMIN_GROUP",
	"AUTH_SSO_AUTO_CREATE",
	"BREAKGLASS_LOGIN",
	"AUTH_SERVICE_ACCOUNTS",
];

let saved;

beforeEach(() => {
	saved = {};
	for (const name of MANAGED_VARS) {
		saved[name] = process.env[name];
		delete process.env[name];
	}
});

afterEach(() => {
	for (const name of MANAGED_VARS) {
		if (typeof saved[name] === "undefined") {
			delete process.env[name];
		} else {
			process.env[name] = saved[name];
		}
	}
});

/**
 * A request as the edge delivers it: forwarded by this image's own admin vhost
 * (which says so), over the container's loopback, carrying the identity headers
 * the Authentik outpost injected.
 */
const edgeRequest = (overrides = {}) => ({
	socket: { remoteAddress: "127.0.0.1" },
	headers: {
		"x-npm-edge": "yes",
		"x-authentik-email": "dhunter@innotel.us",
		"x-authentik-username": "dhunter",
		"x-authentik-name": "Darnel Hunter",
		"x-authentik-uid": "abc123",
		"x-authentik-groups": "cerulean-platform,Capstone",
	},
	...overrides,
});

const withHeaders = (headers) => edgeRequest({ headers: { ...edgeRequest().headers, ...headers } });

describe("parseGroups", () => {
	it("splits the comma-separated form Authentik sends", () => {
		assert.deepEqual(sso.parseGroups("cerulean-platform, Capstone ,Zeus"), ["cerulean-platform", "Capstone", "Zeus"]);
	});

	it("accepts a JSON array", () => {
		assert.deepEqual(sso.parseGroups('["cerulean-platform","Monarch"]'), ["cerulean-platform", "Monarch"]);
	});

	it("returns nothing for empty or absent input", () => {
		assert.deepEqual(sso.parseGroups(""), []);
		assert.deepEqual(sso.parseGroups(undefined), []);
	});

	it("falls back to splitting when the JSON is malformed", () => {
		assert.deepEqual(sso.parseGroups("[cerulean-platform"), ["[cerulean-platform"]);
	});
});

describe("config", () => {
	it("is inert with nothing set — upstream behaviour", () => {
		const cfg = sso.config();
		assert.equal(cfg.enabled, false);
		assert.equal(cfg.requiredGroup, "cerulean-platform");
	});

	it("defaults the admin group to the required one", () => {
		process.env.AUTH_SSO_ENABLED = "true";
		process.env.AUTH_SSO_REQUIRED_GROUP = "Monarch";
		const cfg = sso.config();
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.adminGroup, "Monarch");
		assert.equal(cfg.autoCreate, true);
	});

	it("can be switched off explicitly", () => {
		process.env.AUTH_SSO_ENABLED = "0";
		assert.equal(sso.config().enabled, false);
	});
});

describe("cameFromEdge", () => {
	beforeEach(() => {
		process.env.AUTH_SSO_ENABLED = "1";
	});

	it("is true for the addresses the admin vhost reaches the UI from", () => {
		for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
			assert.equal(sso.cameFromEdge(edgeRequest({ socket: { remoteAddress: address } })), true, address);
		}
	});

	it("is false for every routable source — the LAN port and other containers", () => {
		for (const address of ["192.168.1.46", "10.10.1.1", "172.17.0.1", "::ffff:192.168.1.46", ""]) {
			assert.equal(sso.cameFromEdge(edgeRequest({ socket: { remoteAddress: address } })), false, address);
		}
	});

	it("is false when the vhost did not vouch for the request", () => {
		assert.equal(sso.cameFromEdge({ socket: { remoteAddress: "127.0.0.1" }, headers: {} }), false);
	});

	it("is false for any verdict other than yes", () => {
		for (const verdict of ["no", "", "YES", "1", "true"]) {
			const req = edgeRequest();
			req.headers["x-npm-edge"] = verdict;
			const expected = verdict.trim().toLowerCase() === "yes";
			assert.equal(sso.cameFromEdge(req), expected, verdict);
		}
	});

	it("is false when the verdict arrives on a direct connection to the backend", () => {
		// Another container on the Docker network reaching the backend itself
		// can set any header it likes — but its address is not loopback.
		const forged = edgeRequest({ socket: { remoteAddress: "172.18.0.5" } });
		assert.equal(sso.cameFromEdge(forged), false);
	});

	it("is false when there is no socket at all", () => {
		assert.equal(sso.cameFromEdge({ headers: { "x-npm-edge": "yes" } }), false);
	});

	it("is false when SSO is off, however the request arrived", () => {
		delete process.env.AUTH_SSO_ENABLED;
		assert.equal(sso.cameFromEdge(edgeRequest()), false);
	});

	it("honours a renamed verdict header", () => {
		process.env.AUTH_SSO_EDGE_HEADER = "X-Edge-Proof";
		const req = edgeRequest();
		delete req.headers["x-npm-edge"];
		req.headers["x-edge-proof"] = "yes";
		assert.equal(sso.cameFromEdge(req), true);
	});
});

describe("identityFromRequest", () => {
	beforeEach(() => {
		process.env.AUTH_SSO_ENABLED = "1";
	});

	it("returns null for a caller the vhost did not vouch for — a LAN client cannot forge an identity", () => {
		const forged = edgeRequest({ socket: { remoteAddress: "192.168.1.50" } });
		assert.equal(sso.identityFromRequest(forged), null);
	});

	it("returns null when a direct caller forges the vhost verdict", () => {
		const forged = edgeRequest({ socket: { remoteAddress: "172.18.0.5" } });
		assert.equal(sso.identityFromRequest(forged), null);
	});

	it("returns null when the edge vouches but sends no email", () => {
		assert.equal(sso.identityFromRequest(withHeaders({ "x-authentik-email": "" })), null);
	});

	it("normalises the identity", () => {
		const identity = sso.identityFromRequest(withHeaders({ "x-authentik-email": " DHunter@Innotel.US " }));
		assert.equal(identity.email, "dhunter@innotel.us");
		assert.equal(identity.username, "dhunter");
		assert.deepEqual(identity.groups, ["cerulean-platform", "Capstone"]);
	});
});

describe("identityAllowed", () => {
	beforeEach(() => {
		process.env.AUTH_SSO_ENABLED = "1";
	});

	it("admits a member of the required group", () => {
		assert.equal(sso.identityAllowed(sso.identityFromRequest(edgeRequest())), true);
	});

	it("refuses a non-member — the gate and this check agree", () => {
		const outsider = sso.identityFromRequest(withHeaders({ "x-authentik-groups": "Capstone" }));
		assert.equal(sso.identityAllowed(outsider), false);
	});

	it("admits anyone the gateway vouches for when the group is explicitly emptied", () => {
		process.env.AUTH_SSO_REQUIRED_GROUP = "";
		const outsider = sso.identityFromRequest(withHeaders({ "x-authentik-groups": "Capstone" }));
		assert.equal(sso.identityAllowed(outsider), true);
	});

	it("refuses an absent identity", () => {
		assert.equal(sso.identityAllowed(null), false);
	});
});

describe("rolesForIdentity", () => {
	beforeEach(() => {
		process.env.AUTH_SSO_ENABLED = "1";
	});

	it("maps the admin group to admin", () => {
		assert.deepEqual(sso.rolesForIdentity(sso.identityFromRequest(edgeRequest())), ["admin"]);
	});

	it("maps everyone else to user", () => {
		const member = sso.identityFromRequest(withHeaders({ "x-authentik-groups": "Monarch" }));
		assert.deepEqual(sso.rolesForIdentity(member), ["user"]);
	});

	it("can name a different admin group", () => {
		process.env.AUTH_SSO_ADMIN_GROUP = "Monarch";
		const member = sso.identityFromRequest(withHeaders({ "x-authentik-groups": "Monarch" }));
		assert.deepEqual(sso.rolesForIdentity(member), ["admin"]);
	});
});

describe("passwordGrantAllowed", () => {
	// A direct LAN call: the published admin port, so the vhost says "no".
	const lanRequest = { socket: { remoteAddress: "172.17.0.1" }, headers: { "x-npm-edge": "no" } };

	it("leaves the grant alone when SSO is off", () => {
		assert.equal(sso.passwordGrantAllowed(lanRequest, "anyone@innotel.us"), true);
	});

	describe("with SSO on", () => {
		beforeEach(() => {
			process.env.AUTH_SSO_ENABLED = "1";
		});

		it("refuses the grant on any request that came from the edge", () => {
			assert.equal(sso.passwordGrantAllowed(edgeRequest(), "dhunter@innotel.us"), false);
		});

		it("refuses it even with the break-glass on, because the door is SSO-only", () => {
			process.env.BREAKGLASS_LOGIN = "1";
			assert.equal(sso.passwordGrantAllowed(edgeRequest(), "dhunter@innotel.us"), false);
		});

		it("refuses an off-edge human by default", () => {
			assert.equal(sso.passwordGrantAllowed(lanRequest, "dhunter@innotel.us"), false);
		});

		it("allows an off-edge automation service account", () => {
			process.env.AUTH_SERVICE_ACCOUNTS = "automation@innotel.us, other@innotel.us";
			assert.equal(sso.passwordGrantAllowed(lanRequest, "automation@innotel.us"), true);
			assert.equal(sso.passwordGrantAllowed(lanRequest, "AUTOMATION@innotel.us"), true);
			assert.equal(sso.passwordGrantAllowed(lanRequest, "dhunter@innotel.us"), false);
		});

		it("allows the break-glass off-edge", () => {
			process.env.BREAKGLASS_LOGIN = "1";
			assert.equal(sso.passwordGrantAllowed(lanRequest, "dhunter@innotel.us"), true);
		});
	});
});

describe("authInfo", () => {
	it("reports SSO off and the form available when nothing is configured", () => {
		const info = sso.authInfo();
		assert.equal(info.sso.enabled, false);
		assert.equal(info.password.enabled, true);
	});

	it("reports the form unavailable once SSO is on and break-glass is off", () => {
		process.env.AUTH_SSO_ENABLED = "1";
		const info = sso.authInfo();
		assert.deepEqual(info.sso, { enabled: true, requiredGroup: "cerulean-platform" });
		assert.equal(info.password.enabled, false);
		assert.equal(info.password.breakglass, false);
	});

	it("does not offer the form merely because service accounts exist — they call the API", () => {
		process.env.AUTH_SSO_ENABLED = "1";
		process.env.AUTH_SERVICE_ACCOUNTS = "automation@innotel.us";
		const info = sso.authInfo();
		assert.equal(info.password.enabled, false);
	});

	it("reports the break-glass when it is switched on", () => {
		process.env.AUTH_SSO_ENABLED = "1";
		process.env.BREAKGLASS_LOGIN = "1";
		const info = sso.authInfo();
		assert.equal(info.password.enabled, true);
		assert.equal(info.password.breakglass, true);
	});
});
