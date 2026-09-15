#!/usr/bin/env python3
"""A capturing proxy — archives what each arm actually SENDS. stdlib only.

WHY IT EXISTS. The diagnosis of round B can say our requests carry more
fresh input — 312 / 393 / 360 tokens against a steady 251 / 239 / 235 —
and cannot say what that fresh input IS. Fresh input is ONE number per
request, and no log on either side separates a tool result from replayed
output from replayed reasoning. Only a request body does, and no arm
records one.

The forwarding half is rd1/harness/proxy.py's, which has been carrying
real legs since RD-1; this file keeps that and replaces the stream cut
with an archive. They stay separate: one injects a fault, the other must
never change what the arm receives.

THREE RULES, in the order they matter.

1. CREDENTIALS ARE NEVER ARCHIVED. The key rides in a header, the archive
   keeps a fixed allowlist of headers, and the allowlist has no
   authorization in it. A capture that leaks the key would be worse than
   no capture and would be discovered late.

2. IT FAILS OPEN. Every archive step is wrapped: if writing the body
   fails, for any reason, the request still goes upstream and the leg
   still runs. An instrument that can break the run it observes is not an
   instrument, and this one sits in the request path where breaking is
   easy.

3. IT DOES NOT MODIFY THE REQUEST. Headers and body go upstream byte for
   byte; the response streams back unchanged. A proxy that "helpfully"
   normalises anything would make the captured body a record of the proxy
   rather than of the arm.

usage: capture-proxy.py --port N --upstream host[:port] [--scheme https]
                        --out DIR [--label TEXT]
"""
import argparse
import hashlib
import http.client
import http.server
import json
import os
import ssl
import threading
import time

ARGS = None
LOCK = threading.Lock()
SEQ = [0]

# The archive keeps these and nothing else. `authorization`, `x-api-key`
# and every other credential-bearing header are absent BY CONSTRUCTION —
# an allowlist cannot leak a header nobody added to it, where a denylist
# leaks the one nobody thought of.
KEEP_HEADERS = ("content-type", "accept", "user-agent", "anthropic-version",
                "anthropic-beta", "x-stainless-lang", "x-stainless-package-version",
                "x-stainless-runtime", "openai-organization")


def _ssl_context():
    """The verifying context that works where the framework Python ships no
    linked CA store (RD1B-F). Never disable verification: a MITM-blind
    proxy would forge failures the arm never had."""
    for cafile in ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem"):
        if os.path.exists(cafile):
            return ssl.create_default_context(cafile=cafile)
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def archive(seq, method, path, headers, body):
    """Write one request. Returns the record, or None — and NEVER raises."""
    try:
        digest = hashlib.sha256(body).hexdigest() if body else None
        name = f"req-{seq:05d}.json"
        rec = {
            "seq": seq,
            "ts": time.time(),
            "label": ARGS.label,
            "method": method,
            "path": path,
            "headers": {k: v for k, v in headers.items() if k.lower() in KEEP_HEADERS},
            "bodySha256": digest,
            "bodyBytes": len(body) if body else 0,
        }
        if body:
            try:
                rec["body"] = json.loads(body.decode("utf-8"))
            except Exception:
                # not JSON, or not decodable: keep the bytes beside it rather
                # than dropping the request from the record entirely
                rec["bodyRaw"] = body.decode("utf-8", "replace")
        with open(os.path.join(ARGS.out, name), "w") as f:
            json.dump(rec, f)
        with open(os.path.join(ARGS.out, "index.jsonl"), "a") as f:
            f.write(json.dumps({k: rec[k] for k in ("seq", "ts", "method", "path", "bodySha256", "bodyBytes")}) + "\n")
        return rec
    except Exception:
        return None


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _forward(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        with LOCK:
            SEQ[0] += 1
            seq = SEQ[0]
        archive(seq, self.command, self.path, self.headers, body)   # fails open

        if ARGS.scheme == "https":
            conn = http.client.HTTPSConnection(ARGS.upstream, context=_ssl_context(), timeout=300)
        else:
            conn = http.client.HTTPConnection(ARGS.upstream, timeout=300)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length", "connection")}
        headers["Host"] = ARGS.upstream.split(":")[0]
        if body:
            headers["Content-Length"] = str(len(body))
        conn.request(self.command, self.path, body=body if body else None, headers=headers)
        resp = conn.getresponse()

        self.send_response(resp.status)
        hop = {"connection", "keep-alive", "transfer-encoding", "content-length"}
        for k, v in resp.getheaders():
            if k.lower() not in hop:
                self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(256)
                if not chunk:
                    break
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    do_POST = _forward
    do_GET = _forward
    do_PUT = _forward
    do_DELETE = _forward


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--upstream", required=True)
    ap.add_argument("--scheme", default="https", choices=("http", "https"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="")
    ARGS = ap.parse_args()
    os.makedirs(ARGS.out, exist_ok=True)
    Server(("127.0.0.1", ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
