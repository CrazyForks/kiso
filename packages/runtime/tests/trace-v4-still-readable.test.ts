import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateTraceRecord, validateTraceLine, TRACE_SCHEMA_VERSIONS, TRACE_SCHEMA_VERSION } from "../src/trace/record.js";

/**
 * F33-R1 (Astra, 2026-09-14): SCHEMA 5 DROPPED THE DEPLOYED v4 READER.
 *
 * `TRACE_SCHEMA_VERSIONS` was written as `[1, 2, 3, TRACE_SCHEMA_VERSION]`,
 * so raising the current version from 4 to 5 silently removed 4 from the
 * accepted set. Every trace the installed 0.36.0 has ever written is v4:
 * the reader stopped accepting the product's own live output, while a v5
 * record went through.
 *
 * The whole generation-compat discipline exists to prevent exactly this,
 * and its own constant undid it — a set spelled with a MOVING member drops
 * the one it was standing on every time the version rises. The set is now
 * an explicit list of every generation ever written.
 *
 * The fixtures are REAL: a request record and its header, lifted verbatim
 * from an archived session this machine wrote under 0.36.0. A hand-authored
 * v4 record would test my idea of v4, which is what produced the defect.
 */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/trace-v4/${name}.json`, import.meta.url)), "utf8"));

describe("F33-R1: every generation ever written stays readable", () => {
	it("the accepted set names every version explicitly, and includes the current one", () => {
		expect([...TRACE_SCHEMA_VERSIONS].sort()).toEqual([1, 2, 3, 4, 5]);
		expect(TRACE_SCHEMA_VERSIONS.has(TRACE_SCHEMA_VERSION)).toBe(true);
	});

	it("a REAL archived v4 request validates", () => {
		const rec = fixture("request");
		expect((rec as { schemaVersion: number }).schemaVersion).toBe(4);
		expect(validateTraceRecord(rec), "the product's own live output was rejected").toBe(true);
		expect(validateTraceLine(rec)).toBe(true);
	});

	it("its REAL archived v4 header validates too", () => {
		const hdr = fixture("header");
		expect((hdr as { schemaVersion: number }).schemaVersion).toBe(4);
		expect(validateTraceLine(hdr)).toBe(true);
	});

	it("a v4 record carries no usageKnown, and that is not a defect in it", () => {
		// v4 could not say. The consumers read that absence as undecidable
		// and consult the plain log; what they must NOT do is reject the
		// record for lacking a field its generation had no way to write.
		expect((fixture("request") as { usageKnown?: unknown }).usageKnown).toBeUndefined();
	});

	it("a version nobody has ever written is still refused", () => {
		expect(validateTraceRecord({ ...(fixture("request") as object), schemaVersion: 99 })).toBe(false);
	});
});
