#!/usr/bin/env python3
"""The capturing proxy's rules, against a local fake upstream.

No network, no model, no money. Run directly — `python3
tests/test_capture_proxy.py` from bench/ — which is how the chain's
check-bench-tests gate runs every file here.

THE FIRST VERSION WAS A SCRIPT with a main(), and the gate rejected it:
it counts `def test_*` so an emptied or undiscoverable file cannot pass
silently. My own suite was green and the chain was red, which is the whole
reason that gate exists.

Each rule is a method, and each rule's RED PROOF is its own method beside
it: a rule asserted only in its passing direction is a rule nobody has
watched fail.
"""
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.path.join(HERE, "..", "capture-proxy.py")
SECRET = "sk-THIS-MUST-NEVER-BE-ARCHIVED-0001"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class _Upstream(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    received = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        _Upstream.received.append(
            {"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        payload = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def archived_blob(out):
    """Every archived byte, as one string — what a leak check must search."""
    blob = ""
    for f in sorted(os.listdir(out)):
        with open(os.path.join(out, f)) as fh:
            blob += fh.read()
    return blob


class CaptureProxy(unittest.TestCase):
    """One fake upstream and one proxy for the class; each rule its own test."""

    @classmethod
    def setUpClass(cls):
        _Upstream.received = []
        cls.up_port, cls.px_port = free_port(), free_port()
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", cls.up_port), _Upstream)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.out = tempfile.mkdtemp(prefix="capture-test-")
        cls.proc = subprocess.Popen(
            [sys.executable, PROXY, "--port", str(cls.px_port),
             "--upstream", "127.0.0.1:%d" % cls.up_port, "--scheme", "http",
             "--out", cls.out, "--label", "t"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                cls.post("/warm", {"warm": 1})
                return
            except Exception:
                time.sleep(0.05)
        raise RuntimeError("the proxy never came up")

    @classmethod
    def tearDownClass(cls):
        # REAP, do not merely signal. terminate() alone left the proxy
        # running and its socket open — ResourceWarnings on every run, and a
        # process per invocation accumulating on a machine that also runs
        # paid legs.
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
            cls.proc.wait(timeout=5)
        cls.srv.shutdown()
        cls.srv.server_close()

    @classmethod
    def post(cls, path, obj):
        req = urllib.request.Request(
            "http://127.0.0.1:%d%s" % (cls.px_port, path),
            data=json.dumps(obj).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer %s" % SECRET},
            method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read()

    # ---- rule 3: it does not modify the request -----------------------

    def test_response_reaches_the_caller_unchanged(self):
        body = self.post("/v1/unchanged-response", {"a": 1})
        self.assertEqual(json.loads(body), {"ok": True})

    def test_request_reaches_the_upstream_unchanged_credential_included(self):
        sent = {"model": "m", "messages": [{"role": "user", "content": "hello"}]}
        self.post("/v1/unchanged-request", sent)
        got = [r for r in _Upstream.received if r["path"] == "/v1/unchanged-request"]
        self.assertTrue(got, "the request never reached the upstream")
        self.assertEqual(json.loads(got[0]["body"]), sent)
        # the credential must reach the UPSTREAM — it is the archive it must
        # never reach, and a proxy that stripped it would break the arm
        self.assertEqual(got[0]["auth"], "Bearer %s" % SECRET)

    # ---- the archive --------------------------------------------------

    def test_body_is_archived_with_a_digest(self):
        sent = {"model": "m", "messages": [{"role": "user", "content": "archive me"}]}
        self.post("/v1/archived", sent)
        recs = [json.load(open(os.path.join(self.out, f)))
                for f in os.listdir(self.out) if f.startswith("req-")]
        target = [r for r in recs if r["path"] == "/v1/archived"]
        self.assertTrue(target, "the request was not archived")
        self.assertEqual(target[0].get("body"), sent)
        self.assertTrue(target[0].get("bodySha256"), "no digest on the record")

    # ---- rule 1: credentials are never archived ------------------------

    def test_credential_appears_in_no_archived_byte(self):
        self.post("/v1/with-credential", {"x": 1})
        blob = archived_blob(self.out)
        self.assertNotIn(SECRET, blob, "THE CREDENTIAL WAS ARCHIVED")
        self.assertNotIn("authorization", blob.lower(),
                         "an authorization header name appears in the archive")

    def test_red_the_leak_check_detects_a_leak(self):
        """The check above asserts an ABSENCE; an absence proves nothing
        unless the check can see a presence. Same search, over a record
        that does carry the credential."""
        leaky = json.dumps({"headers": {"authorization": "Bearer %s" % SECRET}})
        self.assertIn(SECRET, leaky)
        self.assertIn("authorization", leaky.lower())

    # ---- rule 2: it fails open ----------------------------------------

    def test_a_broken_archive_does_not_lose_the_request(self):
        before = len(_Upstream.received)
        os.chmod(self.out, 0o500)          # unwritable
        try:
            self.post("/v1/after-break", {"x": 1})
        finally:
            os.chmod(self.out, 0o700)
        self.assertGreater(len(_Upstream.received), before,
                           "the request did not reach the upstream once archiving failed")

    def test_red_a_lost_request_is_observable(self):
        """The fail-open check asserts the upstream count GREW. If a lost
        request were invisible to that count, the check could not fail."""
        before = len(_Upstream.received)
        _Upstream.received.append({"path": "/synthetic", "body": b"", "auth": None})
        self.assertGreater(len(_Upstream.received), before)
        _Upstream.received.pop()
        self.assertEqual(len(_Upstream.received), before,
                         "the counter the fail-open check reads is not observable")


if __name__ == "__main__":
    unittest.main(verbosity=2)
