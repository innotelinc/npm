import express from "express";
import internalSso from "../internal/sso.js";
import internalToken from "../internal/token.js";
import errs from "../lib/error.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import * as sso from "../lib/sso.js";
import apiValidator from "../lib/validator/api.js";
import { debug, express as logger } from "../logger.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})

	/**
	 * GET /tokens
	 *
	 * Get a new Token, given they already have a token they want to refresh
	 * We also piggy back on to this method, allowing admins to get tokens
	 * for services like Job board and Worker.
	 */
	.get(jwtdecode(), async (req, res, next) => {
		try {
			const data = await internalToken.getFreshToken(res.locals.access, {
				expiry: typeof req.query.expiry !== "undefined" ? req.query.expiry : null,
				scope: typeof req.query.scope !== "undefined" ? req.query.scope : null,
			});
			res.status(200).send(data);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * POST /tokens
	 *
	 * Create a new Token from an email + password.
	 *
	 * Identity belongs to Authentik: on any request that came from the edge this
	 * grant is refused outright, so a door to the admin UI is SSO-only. It
	 * survives off-edge for automation service accounts and for the break-glass
	 * switch (`BREAKGLASS_LOGIN=1`) — see lib/sso.js.
	 */
	.post(async (req, res, next) => {
		try {
			if (!sso.passwordGrantAllowed(req, req.body?.identity)) {
				throw new errs.PermissionError();
			}
			const data = await apiValidator(getValidationSchema("/tokens", "post"), req.body);
			const result = await internalToken.getTokenFromEmail(data);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

router
	.route("/sso")
	.options((_, res) => {
		res.sendStatus(204);
	})

	/**
	 * POST /tokens/sso
	 *
	 * Create a new Token from the identity the edge already authenticated. The
	 * request carries the `X-authentik-*` headers the Authentik forward-auth
	 * outpost injects, and it is only believed on a loopback connection — the
	 * edge's own nginx. See lib/sso.js.
	 */
	.post(async (req, res, next) => {
		try {
			const result = await internalSso.login(req);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

router
	.route("/2fa")
	.options((_, res) => {
		res.sendStatus(204);
	})

	/**
	 * POST /tokens/2fa
	 *
	 * Verify 2FA code and get full token
	 */
	.post(async (req, res, next) => {
		try {
			const { challenge_token, code } = await apiValidator(getValidationSchema("/tokens/2fa", "post"), req.body);
			const result = await internalToken.verify2FA(challenge_token, code);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;
