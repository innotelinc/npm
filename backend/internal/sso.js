import gravatar from "gravatar";
import _ from "lodash";
import errs from "../lib/error.js";
import * as sso from "../lib/sso.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";
import internalAuditLog from "./audit-log.js";
import internalToken from "./token.js";

/**
 * NPM Edge — the Authentik identity, projected into NPM.
 *
 * The admin UI's user table is kept, because NPM's own access layer needs a row
 * to mint a token for and to hang permissions off. What is *not* kept is a
 * credential: an SSO user is created with no `auth` row at all, so there is no
 * password to steal and `POST /tokens` can never succeed for them — the only
 * way in is the identity the edge already authenticated.
 *
 * Rows are created on first sign-in from the Authentik identity
 * (`AUTH_SSO_AUTO_CREATE`, default on) and their roles follow the group
 * mapping, so removing someone from the Authentik group demotes them on their
 * next sign-in and disabling them in Authentik ends their session.
 */

const isAdminRole = (roles) => roles.includes("admin");

/**
 * @param   {String} email
 * @returns {Promise<Object|undefined>}
 */
const findUserByEmail = async (email) => {
	return await userModel.query().where("email", email).andWhere("is_deleted", 0).first();
};

/**
 * Create the NPM user for an Authentik identity. Mirrors `internalUser.create`
 * (avatar, permissions row, audit entry) and deliberately writes no `auth` row.
 *
 * @param   {Object}        identity
 * @param   {Array<String>} roles
 * @returns {Promise<Object>}
 */
const provisionUser = async (identity, roles) => {
	const name = identity.name || identity.username || identity.email;
	const user = await userModel.query().insertAndFetch({
		email: identity.email,
		name: name,
		nickname: identity.username || name,
		avatar: gravatar.url(identity.email, { default: "mm" }),
		roles: roles,
		is_disabled: 0,
	});

	await userPermissionModel.query().insert({
		user_id: user.id,
		visibility: isAdminRole(roles) ? "all" : "user",
		proxy_hosts: "manage",
		redirection_hosts: "manage",
		dead_hosts: "manage",
		streams: "manage",
		access_lists: "manage",
		certificates: "manage",
	});

	// access is not needed: passing user_id keeps audit-log.add from reaching
	// through a token, and an SSO login has no NPM token to reach through.
	await internalAuditLog.add(null, {
		user_id: user.id,
		action: "created",
		object_type: "user",
		object_id: user.id,
		meta: { email: user.email, roles: roles, source: "authentik-sso-gateway", subject: identity.uid },
	});

	return user;
};

const internalSso = {
	/**
	 * Sign an edge-authenticated request in: resolve the identity the gateway
	 * vouches for into an NPM token.
	 *
	 * @param   {Object} req  express request (loopback check + identity headers)
	 * @returns {Promise<Object>} {token, expires, user}
	 */
	login: async (req) => {
		const cfg = sso.config();

		if (!cfg.enabled) {
			throw new errs.PermissionError();
		}

		const identity = sso.identityFromRequest(req, cfg);
		if (!identity) {
			throw new errs.PermissionError();
		}
		if (!sso.identityAllowed(identity, cfg)) {
			throw new errs.PermissionError();
		}

		let user = await findUserByEmail(identity.email);
		const roles = sso.rolesForIdentity(identity, cfg);

		if (!user) {
			if (!cfg.autoCreate) {
				throw new errs.PermissionError();
			}
			user = await provisionUser(identity, roles);
		} else {
			if (user.is_disabled) {
				throw new errs.PermissionError();
			}
			if (!_.isEqual(user.roles || [], roles)) {
				user = await userModel.query().patchAndFetchById(user.id, { roles: roles });
			}
		}

		return internalToken.getTokenFromUser(user);
	},
};

export default internalSso;
