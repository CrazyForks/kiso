import { describe, expect, it, afterEach } from "vitest";
import { knownContextWindow, contextWindowTokens } from "../src/chat.js";
import { resolveContextWindow } from "../src/config.js";
import { setConfiguredWindow } from "../src/state.js";

/**
 * CAPACITY is not POLICY, and the two had been the same function.
 *
 * `contextWindowTokens()` falls back to 200,000 so the compaction threshold
 * always HAS a value — a policy needs a number. The status row asking "how
 * much is left" is a different kind of question: it is a claim about the
 * model, and with no stated window it has no answer. Dividing by the
 * fallback printed a confident percentage of a figure nobody measured.
 */
afterEach(() => setConfiguredWindow(undefined));

describe("knownContextWindow: a stated window, or null", () => {
	it("a registered model states one", () => {
		expect(knownContextWindow({ model: "claude-sonnet-5" })).toBe(1_000_000);
	});

	// SUPERSEDED (REG-1, 2026-09-17). This read "DeepSeek states none — the
	// vendor publishes no window and the registry says so". The premise was
	// false when it was written: the vendor's pricing table has stated
	// "CONTEXT LENGTH 1M" throughout, on the same page the reasoning block
	// already cited. What the registry said was not what the vendor states.
	it("DeepSeek states 1M, and the registry says so", () => {
		expect(knownContextWindow({ model: "deepseek-flash", baseUrl: "https://api.deepseek.com" })).toBe(1_000_000);
		expect(knownContextWindow({ model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com" })).toBe(1_000_000);
	});

	it("a model nobody registered states none either", () => {
		expect(knownContextWindow({ model: "no-such-model" })).toBeNull();
	});

	it("but the POLICY value still has a number, because a policy needs one", () => {
		// The same unstated window that makes the display refuse to divide
		// must not leave the compaction threshold undefined.
		expect(contextWindowTokens()).toBeGreaterThan(0);
	});

	it("a configured window answers for every model, including the unstated ones", () => {
		setConfiguredWindow(128_000);
		expect(knownContextWindow({ model: "deepseek-flash", baseUrl: "https://api.deepseek.com" })).toBe(128_000);
	});
});

describe("resolveContextWindow: env beats the profile beats the global", () => {
	const merged = { contextWindow: 111 } as never;
	const profile = { kind: "openai-compat", model: "deepseek-flash", contextWindow: 222 } as never;

	it("the profile's window beats the global default", () => {
		expect(resolveContextWindow(merged, profile)).toBe(222);
	});

	it("the global default is used when the profile states nothing", () => {
		expect(resolveContextWindow(merged, { kind: "openai-compat", model: "x" } as never)).toBe(111);
	});

	it("an env value beats both — someone who set it meant it", () => {
		process.env.KISO_CONTEXT_WINDOW = "333";
		try {
			expect(resolveContextWindow(merged, profile)).toBe(333);
		} finally {
			delete process.env.KISO_CONTEXT_WINDOW;
		}
	});

	it("a non-positive profile window is ignored rather than believed", () => {
		expect(resolveContextWindow(merged, { kind: "openai-compat", model: "x", contextWindow: 0 } as never)).toBe(111);
	});
});
