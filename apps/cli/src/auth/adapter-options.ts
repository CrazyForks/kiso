/**
 * Astra F1 (P0) — THE ONE PLACE THE ADAPTER'S WIRE CONFIG IS BUILT.
 *
 * The P0's mechanism is a single sentence: the CLI hands the adapter an
 * EXPLICIT endpoint, so the provider SDKs never read `ANTHROPIC_BASE_URL` /
 * `OPENAI_BASE_URL` for themselves while `authForProfile` has already
 * chosen the STORED VENDOR KEY for the vendor's own origin.
 *
 * That sentence had no home. It was a spread written out twice — at startup
 * in index.ts and on the `/model` switch in dispatch.ts — which is F1's own
 * defect class: one rule, two copies, and the copies drift. The first fix
 * for this finding edited both copies. This gives the rule somewhere to
 * live, and a test somewhere to point.
 *
 * The extraction found the two sites had ALREADY drifted:
 *
 *   - `promptCacheKey` was passed at startup whenever the session had an
 *     id, but on `/model` only for an OAuth profile. Both sites pass it
 *     identically now, which is a tidiness fix and NOT a wire change —
 *     finding IA-0360-F1 corrects the claim this comment used to make.
 *     The Responses adapter serializes it on the ChatGPT (OAuth) target
 *     ALONE; the first-party API-key target builds an empty `extraBody`
 *     (provider-openai-responses `resolveTarget`), so it never carried a
 *     cache key and still does not. Passing an internal option at two
 *     construction sites is not evidence that the adapter puts it on the
 *     wire on both authentication paths — I traced the field as far as the
 *     provider's constructor and stopped one level short of the branch
 *     that drops it.
 *   - `streamIdleMs` is set at startup and not on `/model`. It is NOT an
 *     adapter option — it is an agent-definition field the runtime reads —
 *     so it is out of this function's scope and stays where it is, noted
 *     here so the next reader does not think it was missed.
 */
import { effectiveBaseUrl } from "./credentials.js";
import { oauthTokenThunk } from "./token.js";
import type { ModelProfile } from "../config.js";

/** The credential shape both call sites can produce: `authForProfile`'s
 *  return value, and the startup path's already-narrowed `resolved`. */
export type AdapterAuth =
	| { readonly type: "oauth"; readonly providerId: string }
	| { readonly type: "api-key"; readonly apiKey: string };

/** Exactly the runtime `buildAdapter` option set. */
export interface AdapterOptions {
	readonly apiKey?: string;
	readonly baseUrl?: string;
	readonly promptCaching?: boolean;
	readonly oauth?: () => Promise<{ readonly access: string; readonly accountId: string }>;
	readonly promptCacheKey?: string;
}

export function adapterOptionsFor(profile: ModelProfile, auth: AdapterAuth, sessionId?: string): AdapterOptions {
	// OR-1: exactly one sign-in shape reaches the adapter. An OAuth profile
	// has no key to pass — it passes the thunk the adapter re-resolves per
	// request instead. PH-1c (PH-F19): a keyless profile is an
	// unauthenticated endpoint and its placeholder satisfies the SDK's ctor.
	const credential: AdapterOptions =
		auth.type === "oauth" ? { oauth: oauthTokenThunk(auth.providerId) } : { apiKey: auth.apiKey };
	// Astra F1 (P0): ALWAYS EXPLICIT. Passing nothing let the SDK read its
	// own environment variable, and a profile with no baseUrl then sent the
	// stored vendor key wherever that variable pointed.
	const url = effectiveBaseUrl(profile.kind, profile.baseUrl);
	return {
		...credential,
		...(url !== undefined ? { baseUrl: url } : {}),
		// OR-1: the ChatGPT backend's cache lane is the SESSION — one
		// conversation's requests share a key, different conversations never
		// do. The one entry point with no session id is `kiso sessions`, a
		// read-only listing that streams nothing, so its absence costs no
		// cache.
		...(sessionId !== undefined ? { promptCacheKey: sessionId } : {}),
		...(profile.promptCaching !== undefined ? { promptCaching: profile.promptCaching } : {}),
	};
}
