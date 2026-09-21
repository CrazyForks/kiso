/**
 * The provider's NAME on screen (the owner, 2026-09-21).
 *
 * Two profiles can name one model id and reach two accounts; the model id
 * alone cannot say whose tokens the next turn spends. The fact is the base
 * URL the binding already carries — this gate pins what is printed from it,
 * including the cases where there is nothing honest to print.
 */

import { describe, expect, it } from "vitest";
import { profileProviderLabel, providerHost, providerLabel } from "../src/provider-label.js";

describe("providerHost — the one label worth spending columns on", () => {
	it("reads the host out of a real endpoint, dropping scheme and path", () => {
		expect(providerHost("https://api.commandcode.ai/provider/v1")).toBe("api.commandcode.ai");
		expect(providerHost("http://localhost:11434/v1")).toBe("localhost");
		expect(providerHost("https://api.deepseek.com")).toBe("api.deepseek.com");
	});

	it("no URL is no label — never a guess", () => {
		expect(providerHost(undefined)).toBeNull();
		expect(providerHost("")).toBeNull();
		expect(providerHost("   ")).toBeNull();
	});

	it("a URL that does not parse is not invented either", () => {
		expect(providerHost("not a url")).toBeNull();
		expect(providerHost("/just/a/path")).toBeNull();
	});
});

describe("providerLabel / profileProviderLabel — what a row prints", () => {
	it("the model's label is `@host`, and an endpoint-less binding prints nothing", () => {
		expect(providerLabel("https://api.commandcode.ai/provider/v1")).toBe("@api.commandcode.ai");
		expect(providerLabel(undefined), "the provider's own default origin has no host to name").toBe("");
	});

	it("a PROFILE can always name itself: the provider id is the fallback", () => {
		expect(profileProviderLabel("openai-compat", "https://api.commandcode.ai/provider/v1")).toBe("@api.commandcode.ai");
		// no baseUrl: the kind decides, so two rows never collapse into one
		expect(profileProviderLabel("anthropic", undefined)).toBe("@anthropic");
		expect(profileProviderLabel("openai-compat", undefined)).toBe("@openai");
	});

	it("the two cases the whole change exists for read DIFFERENTLY", () => {
		const a = profileProviderLabel("openai-compat", "https://api.commandcode.ai/provider/v1");
		const b = profileProviderLabel("openai-compat", "https://api.deepseek.com");
		expect(a).not.toBe(b);
		expect(a).toBe("@api.commandcode.ai");
		expect(b).toBe("@api.deepseek.com");
	});
});
