#!/usr/bin/env python3
"""Run any smoke script against its own fresh mock: a new port and a new
server per run, because study codes are single use and the mock is in memory.
  python3 dev/smoke-with.py dev/smoke.py
Cleans up the server and the log on the way out."""
import os
import socket
import subprocess
import sys
import time
import urllib.request

if len(sys.argv) < 2:
    print("usage: python3 dev/smoke-with.py <script.py> [args]")
    sys.exit(1)
script = sys.argv[1]
if os.environ.get("PORT"):
    port = int(os.environ["PORT"])
else:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        port = candidate.getsockname()[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log = os.path.join(root, "dev", "smoke-server.log")
with open(log, "w") as output:
    server = subprocess.Popen(["node", "dev/mock-api.mjs", "--port=%d" % port], cwd=root, stdout=output, stderr=subprocess.STDOUT)
try:
    ready = False
    for _ in range(40):
        if server.poll() is not None:
            raise RuntimeError("mock API exited before becoming ready; check the requested port")
        try:
            urllib.request.urlopen("http://localhost:%d/api/v1/health" % port, timeout=0.5).read()
            ready = True
            break
        except Exception:
            time.sleep(0.15)
    if not ready:
        raise TimeoutError("mock API did not become ready")
    env = dict(os.environ, BASE="http://localhost:%d" % port, CODE="TRL-2345-6789-ABCD")
    sys.exit(subprocess.call([sys.executable, script], env=env))
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()
    if os.path.exists(log):
        os.remove(log)
