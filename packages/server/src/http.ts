import type { IncomingMessage, ServerResponse } from "node:http";
import type { Event } from "@vincemakes/kiso-core";
import type { AbortReply, SessionState, WireError, WireErrorCode, WireFrame, WireInput, WireSource } from "@vincemakes/kiso-protocol";
import { DrainingError, InFlightError, OpenRunError } from "./errors.js";
import type { SessionService } from "./service.js";
import { type ProjectionOptions, toWireEvent } from "./wire.js";

/**
 * The HTTP + SSE transport over the hosted-session service.
 *
 * A host mounts `handle` in front of its own routes: it answers the agent
 * routes under `prefix` and returns false for everything else. Status codes
 * and framing are decided here, once — the two hosting products had each
 * chosen their own (409 for in-flight in one, an exception in the other;
 * `event:` on every frame in one, none in the other; a keepalive in one).
 *
 *   GET  {prefix}/:id/events     the stream, from ?after or Last-Event-ID
 *   GET  {prefix}/:id            the session snapshot (also /state)
 *   GET  {prefix}/:id/replay     every wire event on the log + the snapshot
 *   POST {prefix}/:id/run        202 { runId } — or the run's own stream with ?stream=1
 *   POST {prefix}/:id/resume     202 { runId } — or the stream with ?stream=1
 *   POST {prefix}/:id/abort      200 idle | stopped — 409 parked (who is waited for)
 *   POST {prefix}/:id/approve    200 { needsResume }
 *   POST {prefix}/:id/uncertain  200 { remaining }
 *
 * What the host supplies: `authorize` (REQUIRED — session ownership; there
 * is no default that allows), and optionally `augment` (frames beside a
 * wire event: billing, estimates), `prepareInput` (the product's turn
 * preparation), the projection options and the keepalive period.
 */

export interface HttpHandlerOptions {
	/** The mount point; the session id and the action follow it. Default `/v1/sessions`. */
	readonly prefix?: string;
	/** Session ownership, per request. False → 403, and nothing is opened. */
	readonly authorize: (req: IncomingMessage, sessionId: string) => Promise<boolean> | boolean;
	/** Frames a product adds beside a wire event on the same connection. */
	readonly augment?: (event: Event, sessionId: string) => readonly WireFrame[] | Promise<readonly WireFrame[]>;
	/** The product's turn preparation; default: `body.input` as given. */
	readonly prepareInput?: (body: Readonly<Record<string, unknown>>, req: IncomingMessage, sessionId: string) => WireInput | Promise<WireInput>;
	readonly projection?: ProjectionOptions;
	/** `: keepalive` comments on an idle stream. Default 15 s; 0 disables. */
	readonly keepaliveMs?: number;
	/** Request-body cap in bytes. Default 1 MiB. */
	readonly bodyLimit?: number;
}

export interface HttpHandler {
	/** True when the request was an agent route and has been answered. */
	readonly handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACTIONS = new Set(["", "state", "events", "replay", "run", "resume", "abort", "approve", "uncertain"]);

export function createHttpHandler(service: SessionService, options: HttpHandlerOptions): HttpHandler {
	const prefix = (options.prefix ?? "/v1/sessions").replace(/\/+$/, "");
	const keepaliveMs = options.keepaliveMs ?? 15_000;
	const bodyLimit = options.bodyLimit ?? 1024 * 1024;
	const projection = options.projection ?? {};

	const json = (res: ServerResponse, status: number, body: unknown): void => {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(body));
	};
	const fail = (res: ServerResponse, status: number, code: WireErrorCode, message: string, runId?: string): void => {
		const error: WireError = { code, message, ...(runId !== undefined ? { runId } : {}) };
		json(res, status, error);
	};
	/** The service's refusals → the wire's codes. */
	const refuse = (res: ServerResponse, err: unknown): void => {
		if (err instanceof InFlightError) return fail(res, 409, "in_flight", err.message, err.runId);
		if (err instanceof OpenRunError) return fail(res, 409, "open_run", err.message, err.runId);
		if (err instanceof DrainingError) return fail(res, 503, "draining", err.message);
		if (err instanceof BadRequest) return fail(res, 400, "bad_request", err.message);
		fail(res, 500, "internal", err instanceof Error ? err.message : String(err));
	};

	const readBody = async (req: IncomingMessage): Promise<Readonly<Record<string, unknown>>> => {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			const buf = chunk as Buffer;
			size += buf.length;
			if (size > bodyLimit) throw new BadRequest(`body exceeds ${bodyLimit} bytes`);
			chunks.push(buf);
		}
		if (chunks.length === 0) return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new BadRequest("body is not JSON");
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new BadRequest("body must be a JSON object");
		return parsed as Record<string, unknown>;
	};

	const inputOf = async (body: Readonly<Record<string, unknown>>, req: IncomingMessage, sessionId: string): Promise<WireInput> => {
		if (options.prepareInput !== undefined) return options.prepareInput(body, req, sessionId);
		const input = body["input"];
		if (typeof input === "string") {
			if (input.trim() === "") throw new BadRequest("input must be a non-empty string");
			return input;
		}
		if (Array.isArray(input) && input.length > 0) return input as WireInput;
		throw new BadRequest("input must be a non-empty string or a non-empty array of content blocks");
	};

	const state = async (sessionId: string): Promise<SessionState> => {
		const events = service.events(sessionId);
		return {
			sessionId,
			running: service.isRunning(sessionId),
			highWater: events.at(-1)?.seq ?? -1,
			openRun: service.openRun(sessionId),
			pendingApprovals: await service.pendingApprovals(sessionId),
			uncertain: (await service.uncertainExecutions(sessionId)).map((u) => ({ executionId: u.executionId, callId: u.callId, name: u.name })),
		};
	};

	/** One durable event → its frames: the wire event (if any) under its seq, then the product's. */
	const framesOf = async (event: Event, sessionId: string): Promise<string> => {
		let out = "";
		const wire = toWireEvent(event, projection);
		if (wire !== null) out += `id: ${wire.seq}\nevent: ${wire.type}\ndata: ${JSON.stringify(wire)}\n\n`;
		if (options.augment !== undefined) {
			for (const frame of await options.augment(event, sessionId)) out += `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
		}
		return out;
	};

	/** Open an SSE response and pump the session's events after `after`
	 *  into it until the client leaves or `until` settles. */
	const stream = async (res: ServerResponse, req: IncomingMessage, sessionId: string, after: number, until?: Promise<unknown>): Promise<void> => {
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		});
		res.write(": open\n\n");
		// frames are written in event order even though augment is async:
		// a chain serialises them
		let chain: Promise<void> = Promise.resolve();
		let closed = false;
		const unsubscribe = await service.subscribe(sessionId, after, (event) => {
			chain = chain.then(async () => {
				if (closed) return;
				const text = await framesOf(event, sessionId);
				if (!closed && text !== "") res.write(text);
			});
		});
		const keepalive = keepaliveMs > 0 ? setInterval(() => res.write(": keepalive\n\n"), keepaliveMs) : undefined;
		keepalive?.unref();
		const end = (): void => {
			if (closed) return;
			closed = true;
			if (keepalive !== undefined) clearInterval(keepalive);
			unsubscribe();
		};
		req.on("close", end);
		res.on("close", end);
		if (until !== undefined) {
			await until.catch(() => {});
			await chain; // every frame of the run has been written
			end();
			res.end();
		}
	};

	const afterOf = (req: IncomingMessage, url: URL, body?: Readonly<Record<string, unknown>>): number => {
		const header = req.headers["last-event-id"];
		const fromHeader = typeof header === "string" ? Number(header) : NaN;
		if (Number.isFinite(fromHeader)) return fromHeader;
		const fromBody = body !== undefined && typeof body["after"] === "number" ? (body["after"] as number) : NaN;
		if (Number.isFinite(fromBody)) return fromBody;
		const fromQuery = Number(url.searchParams.get("after") ?? NaN);
		return Number.isFinite(fromQuery) ? fromQuery : -1;
	};

	const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false;
		const rest = url.pathname.slice(prefix.length + 1);
		const slash = rest.indexOf("/");
		const rawId = slash === -1 ? rest : rest.slice(0, slash);
		const action = slash === -1 ? "" : rest.slice(slash + 1);
		let sessionId: string;
		try {
			sessionId = decodeURIComponent(rawId);
		} catch {
			fail(res, 400, "bad_request", "malformed session id");
			return true;
		}
		if (!SESSION_ID.test(sessionId) || !ACTIONS.has(action)) {
			fail(res, 404, "not_found", "no such route");
			return true;
		}
		try {
			if (!(await options.authorize(req, sessionId))) {
				fail(res, 403, "forbidden", "this session is not yours");
				return true;
			}
			const method = req.method ?? "GET";
			if (method === "GET" && action === "events") {
				await stream(res, req, sessionId, afterOf(req, url));
				return true;
			}
			if (method === "GET" && (action === "" || action === "state")) {
				json(res, 200, await state(sessionId));
				return true;
			}
			if (method === "GET" && action === "replay") {
				const events = service.events(sessionId).map((e) => toWireEvent(e, projection)).filter((w) => w !== null);
				json(res, 200, { sessionId, events, state: await state(sessionId) });
				return true;
			}
			if (method !== "POST") {
				fail(res, 405, "bad_request", `${method} is not allowed on ${action || "the session"}`);
				return true;
			}
			const body = await readBody(req);
			const wantsStream = url.searchParams.get("stream") === "1";
			if (action === "run" || action === "resume") {
				let handle: { runId: string; done: Promise<void> };
				if (action === "run") {
					const input = await inputOf(body, req, sessionId);
					const source = body["source"];
					handle = await service.run(sessionId, input, {
						...(source === "user" || source === "suggestion" || source === "tool_result" ? { source: source as WireSource } : {}),
						...(body["resumeFirst"] === true ? { resumeFirst: true } : {}),
					});
				} else {
					handle = await service.resume(sessionId);
				}
				if (wantsStream) await stream(res, req, sessionId, afterOf(req, url, body), handle.done);
				else json(res, 202, { runId: handle.runId });
				return true;
			}
			if (action === "abort") {
				const outcome = await service.abort(sessionId, body["force"] === true ? { force: true } : {});
				const reply: AbortReply = outcome.kind === "stopped" ? { kind: "stopped", runId: outcome.runId } : outcome;
				json(res, outcome.kind === "parked" ? 409 : 200, reply);
				return true;
			}
			if (action === "approve") {
				const decisionId = body["decisionId"];
				const allow = body["allow"];
				if (typeof decisionId !== "string" || decisionId === "" || typeof allow !== "boolean") throw new BadRequest("decisionId (string) and allow (boolean) are required");
				const reason = body["reason"];
				json(res, 200, await service.approve(sessionId, decisionId, allow, typeof reason === "string" ? reason : undefined));
				return true;
			}
			if (action === "uncertain") {
				const executionId = body["executionId"];
				const resolution = body["resolution"];
				if (typeof executionId !== "string" || executionId === "" || (resolution !== "rerun" && resolution !== "abandoned")) {
					throw new BadRequest('executionId (string) and resolution ("rerun" | "abandoned") are required');
				}
				json(res, 200, await service.resolveUncertain(sessionId, executionId, resolution));
				return true;
			}
			fail(res, 404, "not_found", "no such route");
			return true;
		} catch (err) {
			if (res.headersSent) {
				res.end();
				return true;
			}
			refuse(res, err);
			return true;
		}
	};

	return { handle };
}

class BadRequest extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BadRequest";
	}
}
