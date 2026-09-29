/**
 * ADR-0058 §6 — a process's identity is its pid AND the time the OS
 * started it. A pid alone is not an identity: after a runner dies, its pid
 * can be handed to an unrelated process, and a live pid would then "prove"
 * a task is running when nothing of it is. `ps -o lstart=` gives the start
 * time on macOS and Linux alike.
 */

import { execFileSync } from "node:child_process";

/** The OS start time of `pid`, or "" when no such process exists. */
export function processStartTime(pid: number): string {
	try {
		return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}
