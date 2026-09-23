/**
 * An incremental Server-Sent Events parser over a byte stream.
 *
 * Standards-shaped and small: frames are separated by a blank line; `id:`,
 * `event:` and `data:` lines are read (multi-line data joins with "\n");
 * comment lines (`:`) are reported as keepalives so a consumer can tell a
 * quiet stream from a dead one. No EventSource: a fetch-based reader can
 * send `Last-Event-ID` as a header, which the browser API cannot.
 */

export interface SseFrame {
	readonly id?: string;
	readonly event?: string;
	readonly data?: string;
	/** A comment line — the transport's `: open` / `: keepalive`. */
	readonly comment?: string;
}

export function parseSseBlock(block: string): SseFrame | null {
	let id: string | undefined;
	let event: string | undefined;
	const data: string[] = [];
	let comment: string | undefined;
	for (const raw of block.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (line === "") continue;
		if (line.startsWith(":")) {
			comment = line.slice(1).trim();
			continue;
		}
		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "id") id = value;
		else if (field === "event") event = value;
		else if (field === "data") data.push(value);
	}
	if (id === undefined && event === undefined && data.length === 0 && comment === undefined) return null;
	return {
		...(id !== undefined ? { id } : {}),
		...(event !== undefined ? { event } : {}),
		...(data.length > 0 ? { data: data.join("\n") } : {}),
		...(comment !== undefined ? { comment } : {}),
	};
}

/** Read a body as SSE frames, as they complete. Ends when the body ends. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame, void, undefined> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			// CRLF is normalised on the whole buffer so a "\r" that ends one
			// chunk meets its "\n" from the next before the split
			buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const block = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const frame = parseSseBlock(block);
				if (frame !== null) yield frame;
				boundary = buffer.indexOf("\n\n");
			}
		}
		const last = parseSseBlock(buffer);
		if (last !== null) yield last;
	} finally {
		await reader.cancel().catch(() => {});
	}
}
