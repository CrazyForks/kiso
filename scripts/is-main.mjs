/**
 * "Was this module run as the script?" — resolved on BOTH sides.
 *
 * The idiom `import.meta.url === \`file://${process.argv[1]}\`` compares a
 * RESOLVED url against a GIVEN path. On macOS `/tmp` is a symlink to
 * `/private/tmp`, so invoking a script through the alias makes the two
 * disagree, the body never runs, and the process exits 0 — SILENCE AND
 * SUCCESS, which for a gate or a verdict tool is the worst failure there is.
 *
 * Found by Astra on PR #32 in `check-packed-closure.mjs`, where a gate
 * skipped its own execution and reported success while a package was
 * deliberately missing. Asking the same question of its siblings found it in
 * `bench/paired-compare.mjs` and `bench/band-compare.mjs` — the two scripts
 * that produce the paired-bench verdict, which is a release blocker. A
 * verdict tool that silently produces no verdict and exits 0 is how a release
 * passes a gate that never ran.
 *
 * Both sides are realpath'd. A path that cannot be resolved is NOT main:
 * being unable to answer the question is not the same as answering yes.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(metaUrl) {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	try {
		return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entry);
	} catch {
		return false;
	}
}
