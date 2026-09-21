/**
 * The provider's NAME on screen — the host the request will actually go to.
 *
 * The owner, 2026-09-21: switching models must say WHO is being billed. Two
 * profiles can name the same model id and reach two different accounts; the
 * model id alone leaves the person unable to tell which one they are about
 * to spend, which is exactly the mistake a picker exists to prevent.
 *
 * The fact is already in hand: `agentBaseUrl` rides with `agentModel` (one
 * `setAgentModel(model, baseUrl)` call, so the two cannot drift), and a
 * profile's `baseUrl` is what its row shows. This module turns that URL into
 * the one label worth spending columns on — the HOST — with the provider id
 * as the fallback for a binding that names no URL at all.
 *
 * Deliberately not a new rule: `providerIdOf` (auth/credentials) is the CLI's
 * copy of the runtime's origin rule (KNOWN_ORIGINS / resolveContinuationScope),
 * and this function only chooses what to PRINT from the same inputs.
 */

import { providerIdOf } from "./auth/credentials.js";

/** The host of a base URL, without scheme, credentials or any path:
 *  `https://api.commandcode.ai/provider/v1` → `commandcode.ai`.
 *
 *  `null` when there is no URL to read — never a guess. A URL that does not
 *  parse is not invented either: the caller falls back to the provider id. */
export function providerHost(baseUrl?: string): string | null {
	if (baseUrl === undefined || baseUrl.trim() === "") return null;
	try {
		const url = new URL(baseUrl);
		// REVIEW (2026-09-21): `host`, not `hostname` — the PORT is part of the
		// answer this label exists to give (`localhost:11434` and
		// `localhost:8000` are two different places to spend, and both read as
		// `@localhost` under `hostname`).
		const host = url.host;
		return host === "" ? null : host;
	} catch {
		return null;
	}
}

/** `@commandcode.ai` — the provider named beside a model. `""` when the
 *  binding names no endpoint (the provider's own default origin), so a row
 *  that has nothing to say does not print a stray `@`. */
export function providerLabel(baseUrl?: string): string {
	const host = providerHost(baseUrl);
	return host === null ? "" : `@${host}`;
}

/** The same label for a PROFILE, which knows its kind as well as its URL: a
 *  profile with no baseUrl (a first-party provider) still names itself by
 *  providerId, because a row that shows two profiles must tell them apart. */
export function profileProviderLabel(kind: string, baseUrl?: string): string {
	return providerLabel(baseUrl) || `@${providerIdOf(kind, baseUrl)}`;
}
