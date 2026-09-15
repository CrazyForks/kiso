import { describe, expect, it } from "vitest";
import { lookupModelMetadata, resolveReasoning } from "../src/provider/metadata.js";

/**
 * The DeepSeek effort levels: what is NATIVE, and what is an alias.
 *
 * The endpoint's enum accepts seven values and names them when it refuses an
 * eighth — `expected one of \`none\`, \`minimal\`, \`low\`, \`medium\`,
 * \`high\`, \`xhigh\`, \`max\``. Three of those are the vendor's own
 * mapping: minimal collapses onto low, medium and xhigh onto high. This
 * registry's standing rule is that an alias is never shown as native,
 * because offering `medium` would promise a level the model does not have.
 *
 * So the row's three natives were right. The one thing missing was `none`,
 * which is NOT an alias: it turns thinking off outright.
 *
 * Measured, 12 runs per level on one task (median reasoning tokens):
 *   minimal 191, low 186 | medium 212, high 199, xhigh 195 | max 229
 * The grouping and the ordering are the vendor's mapping. The unset default
 * sat at 219, which that sample cannot separate from high or from max — so
 * `default` stays what the vendor documents, not what one task suggests.
 */
const DS = "https://api.deepseek.com";

function effortOf(model: string) {
	const row = lookupModelMetadata(model, DS);
	if (row === null) throw new Error(`${model} is not in the registry`);
	const reasoning = row.capabilities.reasoning;
	if (reasoning === null) throw new Error(`${model} records no reasoning capabilities`);
	const effort = reasoning.effort;
	if (effort === null) throw new Error(`${model} has no effort spec`);
	return effort;
}

describe("DeepSeek effort: the natives, and `none` among them", () => {
	it.each(["deepseek-v4-flash", "deepseek-flash", "deepseek-v4-pro"])(
		"%s lists the natives plus none, and no alias",
		(model) => {
			expect(effortOf(model).levels).toEqual(["none", "low", "high", "max"]);
		},
	);

	it("`none` is reachable — it was the only distinct behaviour the row lacked", () => {
		expect(resolveReasoning("deepseek-flash", { thinking: "default", effort: "none" }, DS).ok).toBe(true);
	});

	it("an ALIAS is still refused, because it is not a level this model has", () => {
		// minimal/medium/xhigh are accepted by the endpoint and silently
		// become low/high/high. Passing one through would tell a user they
		// had chosen something they did not.
		for (const alias of ["minimal", "medium", "xhigh"] as const) {
			const r = resolveReasoning("deepseek-flash", { thinking: "default", effort: alias }, DS);
			expect(r.ok, alias).toBe(false);
			if (!r.ok) expect(r.reason).toContain("low");
		}
	});

	it("and a value NO endpoint claims is refused too", () => {
		const r = resolveReasoning("deepseek-flash", { thinking: "default", effort: "colossal" as never }, DS);
		expect(r.ok).toBe(false);
	});

	it("the default is the vendor's documented high, not a number from one task", () => {
		expect(effortOf("deepseek-flash").default).toBe("high");
	});
});
