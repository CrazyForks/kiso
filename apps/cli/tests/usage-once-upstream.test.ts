import { describe, expect, it } from "vitest";
import { callUsageMeter, usageFromEvent } from "../src/chat.js";
import { parseConfig } from "../src/config.js";
import { profileProviderLabel, providerLabel } from "../src/provider-label.js";

/**
 * Two fixes the owner's session 2026-09-23T03-00-01-230c asked for.
 *
 * 1. `fresh 3k · miss 3k` on a FIRST turn: one request, two usage reports
 *    from the op gateway (3,041 in / 69 out, cacheRead null then 0). The
 *    recap's sum was already right — a call's latest report replaces its
 *    earlier one — but the miss compared the second report with the first,
 *    and the running cost added each report.
 * 2. `/model` named the op profile `@127.0.0.1:47821` — where the bytes go,
 *    not who is billed. A profile's `upstream` names it.
 */

const report = { type: "usage" as const, inputTokens: 3041, outputTokens: 69, cacheRead: 0, cacheWrite: null, known: true };

describe("a call that reports its usage twice counts once", () => {
	it("the duplicate is no cache miss (0.40.2 read it as `miss 3k`)", () => {
		// the old carrier: the previous EVENT's total
		const first = usageFromEvent("openai-compat", { ...report, cacheRead: null } as never, null);
		const oldSecond = usageFromEvent("openai-compat", report as never, first.total);
		expect(oldSecond.missed, "the defect, reproduced").toBe(3041);
		// the meter: the previous CALL's total
		const meter = callUsageMeter();
		const a = usageFromEvent("openai-compat", { ...report, cacheRead: null } as never, meter.carrier());
		meter.report(a.total, a.costUsd);
		const b = usageFromEvent("openai-compat", report as never, meter.carrier());
		meter.report(b.total, b.costUsd);
		expect(a.missed).toBeNull();
		expect(b.missed).toBeNull();
	});

	it("the next CALL is measured against the previous call — a real miss still shows", () => {
		const meter = callUsageMeter();
		meter.report(3041, null);
		meter.report(3041, null); // the duplicate
		meter.endCall();
		expect(meter.carrier()).toBe(3041);
		// the next request re-sends the 3,041-token prefix and none of it is cached
		const next = usageFromEvent("openai-compat", { ...report, inputTokens: 3200 } as never, meter.carrier());
		expect(next.missed).toBe(3041);
	});

	it("a call's cost is added once, however many reports it sends", () => {
		const meter = callUsageMeter();
		expect(meter.report(3041, 0.0012)).toBeCloseTo(0.0012, 10);
		expect(meter.report(3041, 0.0012)).toBe(0);
		meter.endCall();
		expect(meter.report(5000, 0.002)).toBeCloseTo(0.002, 10);
		expect(meter.report(5000, null), "an unpriced report adds nothing").toBeNull();
	});
});

describe("a profile behind a local forwarder names who is billed", () => {
	it("upstream first, the forwarder second", () => {
		expect(providerLabel("http://127.0.0.1:47821/v1", "https://gateway.example/v1")).toBe("@gateway.example via 127.0.0.1:47821");
		expect(profileProviderLabel("openai-compat", "http://127.0.0.1:47821/v1", "https://gateway.example/v1")).toBe("@gateway.example via 127.0.0.1:47821");
	});

	it("a name that is not a URL is shown as written; the same host is not repeated; no upstream changes nothing", () => {
		expect(providerLabel("http://127.0.0.1:47821/v1", "my gateway")).toBe("@my gateway via 127.0.0.1:47821");
		expect(providerLabel("https://api.deepseek.com", "https://api.deepseek.com/v1")).toBe("@api.deepseek.com");
		expect(providerLabel("http://127.0.0.1:47821/v1")).toBe("@127.0.0.1:47821");
		expect(profileProviderLabel("openai-compat", "https://api.commandcode.ai/provider/v1")).toBe("@api.commandcode.ai");
	});

	it("the config carries `upstream` (trimmed) and refuses a non-string", () => {
		const ok = parseConfig(JSON.stringify({ models: { op: { kind: "openai-compat", model: "m", apiKeyEnv: "K", baseUrl: "http://127.0.0.1:47821/v1", upstream: " https://gateway.example/v1 " } } }), "test");
		expect(ok.models?.op?.upstream).toBe("https://gateway.example/v1");
		expect(() => parseConfig(JSON.stringify({ models: { op: { kind: "openai-compat", model: "m", apiKeyEnv: "K", upstream: 7 } } }), "test")).toThrow(/upstream/);
	});
});
