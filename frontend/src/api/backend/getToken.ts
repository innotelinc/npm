import * as api from "./base";
import type { TokenResponse, TwoFactorChallengeResponse } from "./responseTypes";

export type LoginResponse = TokenResponse | TwoFactorChallengeResponse;

export function isTwoFactorChallenge(response: LoginResponse): response is TwoFactorChallengeResponse {
	return "requires2fa" in response && response.requires2fa === true;
}

export async function getToken(identity: string, secret: string): Promise<LoginResponse> {
	return await api.post({
		url: "/tokens",
		data: { identity, secret },
	});
}

/**
 * Sign in with the identity the edge already authenticated (Authentik forward
 * auth). No credentials are sent: the gateway's session is the credential, and
 * the backend refuses this call unless the request really came through the edge.
 */
export async function getSSOToken(): Promise<TokenResponse> {
	return await api.post({
		url: "/tokens/sso",
		noAuth: true,
	});
}

export async function verify2FA(challengeToken: string, code: string): Promise<TokenResponse> {
	return await api.post({
		url: "/tokens/2fa",
		data: { challengeToken, code },
	});
}
