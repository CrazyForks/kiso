#!/usr/bin/env python3
"""The capturing proxy's four properties, against a local fake upstream.

No network, no model, no money. Each property is proved by making its
opposite observable: the credential test asserts the key is ABSENT from
every archived byte, and the fail-open test breaks the archive on purpose
and checks the request still arrives upstream.
"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.path.join(HERE, "..", "capture-proxy.py")
SECRET = "sk-THIS-MUST-NEVER-BE-ARCHIVED-0001"
RECEIVED = []


class Upstream(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        RECEIVED.append({"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        payload = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def free_port():
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def post(port, path, obj):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(obj).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()


def main():
    fails = []
    up_port, px_port = free_port(), free_port()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", up_port), Upstream)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    out = tempfile.mkdtemp(prefix="capture-test-")
    proc = subprocess.Popen(
        [sys.executable, PROXY, "--port", str(px_port), "--upstream", f"127.0.0.1:{up_port}",
         "--scheme", "http", "--out", out, "--label", "t"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            post(px_port, "/warm", {"warm": 1})
            break
        except Exception:
            time.sleep(0.05)

    sent = {"model": "m", "messages": [{"role": "user", "content": "hello"}]}
    body = post(px_port, "/v1/chat/completions", sent)

    # 1. the response reaches the caller unchanged
    if json.loads(body) != {"ok": True}:
        fails.append("the upstream response did not reach the caller unchanged")

    # 2. the request reaches the upstream unchanged, credentials included
    got = [r for r in RECEIVED if r["path"] == "/v1/chat/completions"]
    if not got:
        fails.append("the request never reached the upstream")
    elif json.loads(got[0]["body"]) != sent:
        fails.append("the body the upstream received is not the body that was sent")
    elif got[0]["auth"] != f"Bearer {SECRET}":
        fails.append("the credential did not reach the upstream — the proxy modified the request")

    # 3. the body is archived, with a digest
    files = [f for f in os.listdir(out) if f.startswith("req-")]
    recs = [json.load(open(os.path.join(out, f))) for f in files]
    target = [r for r in recs if r["path"] == "/v1/chat/completions"]
    if not target:
        fails.append("the request was not archived")
    else:
        r = target[0]
        if r.get("body") != sent:
            fails.append("the archived body is not what was sent")
        if not r.get("bodySha256"):
            fails.append("the archived record carries no digest")

    # 4. THE CREDENTIAL IS IN NO ARCHIVED BYTE
    blob = ""
    for f in os.listdir(out):
        with open(os.path.join(out, f)) as fh:
            blob += fh.read()
    if SECRET in blob:
        fails.append("THE CREDENTIAL WAS ARCHIVED — the allowlist let it through")
    if "authorization" in blob.lower():
        fails.append("an authorization header name appears in the archive")

    # 5. IT FAILS OPEN: break the archive directory, the request still lands
    before = len(RECEIVED)
    os.chmod(out, 0o500)          # unwritable
    try:
        post(px_port, "/v1/after-break", {"x": 1})
    except Exception as e:
        fails.append(f"a request was LOST when archiving failed: {e}")
    finally:
        os.chmod(out, 0o700)
    if len(RECEIVED) <= before:
        fails.append("the request did not reach the upstream once archiving failed — it does not fail open")

    proc.terminate()
    srv.shutdown()
    for f in fails:
        print(f"  RED  {f}")
    if not fails:
        print("  ok   the response reaches the caller unchanged")
        print("  ok   the request reaches the upstream unchanged, credential included")
        print("  ok   the body is archived with a sha256")
        print("  ok   the credential appears in NO archived byte")
        print("  ok   a broken archive does not lose the request — it fails open")
    print("[capture-proxy] " + ("OK" if not fails else "RED"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
