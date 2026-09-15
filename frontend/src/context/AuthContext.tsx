import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useIntervalWhen } from "rooks";
import {
	getSSOToken,
	getToken,
	isTwoFactorChallenge,
	loginAsUser,
	refreshToken,
	type TokenResponse,
	verify2FA,
} from "src/api/backend";
import { useHealth } from "src/hooks/useHealth";
import AuthStore from "src/modules/AuthStore";

// 2FA challenge state
export interface TwoFactorChallenge {
	challengeToken: string;
}

// Where the automatic forward-auth sign-in got to.
export type SSOState = "pending" | "succeeded" | "failed";

// Context
export interface AuthContextType {
	authenticated: boolean;
	twoFactorChallenge: TwoFactorChallenge | null;
	ssoState: SSOState | null;
	ssoLogin: () => Promise<void>;
	login: (username: string, password: string) => Promise<void>;
	verifyTwoFactor: (code: string) => Promise<void>;
	cancelTwoFactor: () => void;
	loginAs: (id: number) => Promise<void>;
	logout: () => void;
	token?: string;
}

const initalValue = null;
const AuthContext = createContext<AuthContextType | null>(initalValue);

// Provider
interface Props {
	children?: ReactNode;
	tokenRefreshInterval?: number;
}
function AuthProvider({ children, tokenRefreshInterval = 5 * 60 * 1000 }: Props) {
	const queryClient = useQueryClient();
	const [authenticated, setAuthenticated] = useState(AuthStore.hasActiveToken());
	const [twoFactorChallenge, setTwoFactorChallenge] = useState<TwoFactorChallenge | null>(null);
	const [ssoState, setSsoState] = useState<SSOState | null>(null);

	const handleTokenUpdate = useCallback((response: TokenResponse) => {
		AuthStore.set(response);
		setAuthenticated(true);
		setTwoFactorChallenge(null);
	}, []);

	/**
	 * Sign in with the identity the edge already authenticated. Identity lives in
	 * Authentik, so when the stack runs SSO there is no password to type: the
	 * outpost gated this request before it ever reached the UI, and the backend
	 * exchanges that identity for an NPM token. A refusal (this is not an
	 * SSO-configured instance, or the identity is not in the required group)
	 * simply leaves the login form in place.
	 */
	const ssoAttempted = useRef(false);
	const ssoLogin = useCallback(async () => {
		setSsoState("pending");
		try {
			const response = await getSSOToken();
			handleTokenUpdate(response);
			setSsoState("succeeded");
		} catch (e) {
			// Not an SSO request (a direct LAN call, or the gate is not in front of
			// this host): fall back to whatever the login page offers.
			console.debug("Forward-auth SSO unavailable", e);
			setSsoState("failed");
		}
	}, [handleTokenUpdate]);

	// SSO is the exception, not the rule: only attempt it when the backend
	// reports it enabled. (unknown = older backend that predates the health
	// contract, where the attempt is harmless.) An attempt that the backend
	// would refuse anyway just burns a 403 and a spinner flash.
	const { data: health } = useHealth();
	const ssoEnabled = health?.auth?.sso?.enabled;
	useEffect(() => {
		if (ssoAttempted.current || AuthStore.hasActiveToken() || ssoEnabled === false) {
			return;
		}
		if (ssoEnabled === undefined) {
			// Health has not answered yet — wait for it rather than guessing.
			return;
		}
		ssoAttempted.current = true;
		ssoLogin();
	}, [ssoLogin, ssoEnabled]);

	const login = async (identity: string, secret: string) => {
		const response = await getToken(identity, secret);
		if (isTwoFactorChallenge(response)) {
			setTwoFactorChallenge({ challengeToken: response.challengeToken });
			return;
		}
		handleTokenUpdate(response);
	};

	const verifyTwoFactor = async (code: string) => {
		if (!twoFactorChallenge) {
			throw new Error("No 2FA challenge pending");
		}
		const response = await verify2FA(twoFactorChallenge.challengeToken, code);
		handleTokenUpdate(response);
	};

	const cancelTwoFactor = () => {
		setTwoFactorChallenge(null);
	};

	const loginAs = async (id: number) => {
		const response = await loginAsUser(id);
		AuthStore.add(response);
		queryClient.clear();
		window.location.reload();
	};

	const logout = () => {
		if (AuthStore.count() >= 2) {
			AuthStore.drop();
			queryClient.clear();
			window.location.reload();
			return;
		}
		AuthStore.clear();
		setAuthenticated(false);
		queryClient.clear();
	};

	const refresh = async () => {
		const response = await refreshToken();
		handleTokenUpdate(response);
	};

	useIntervalWhen(
		() => {
			if (authenticated) {
				refresh();
			}
		},
		tokenRefreshInterval,
		true,
	);

	const value = {
		authenticated,
		twoFactorChallenge,
		ssoState,
		ssoLogin,
		login,
		verifyTwoFactor,
		cancelTwoFactor,
		loginAs,
		logout,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthState() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuthState must be used within a AuthProvider");
	}
	return context;
}

export { AuthProvider, useAuthState };
export default AuthContext;
