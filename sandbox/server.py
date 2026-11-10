"""STEP Learn の sandbox。受け取った Python のコードを、実行ごとに切り離した UID で動かして結果を返す。

    server.py serve   要求を待ち受ける（POST /run、GET /health）
    server.py health  待ち受けているかを確かめる（コンテナのヘルスチェック）
"""

import json
import os
import queue
import selectors
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from jail import MAX_SLOTS, UID_BASE, WORK_DIR, home

JAIL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jail.py")

LISTEN = os.environ.get("SANDBOX_LISTEN", "unix:/run/sandbox/sandbox.sock")
APP_GID = 1000

WALL_SECONDS = 10

MAX_BODY_BYTES = 256 * 1024
MAX_CODE_BYTES = 64 * 1024
# パイプの容量（64KB）より小さくするのは、プログラムが読まなくても 1 回の書き込みで渡し切るため
MAX_STDIN_BYTES = 32 * 1024
MAX_OUTPUT_BYTES = 64 * 1024

MAX_PENDING = 32
QUEUE_SECONDS = 20
STOP_SECONDS = 15


def fatal(message):
    # 動かし続けないのは、前の実行のプロセスやファイルが残った場所で、次の人のコードを動かすことになるため。
    # 終了すれば Docker が再起動し、作業用の tmpfs ごと作り直される
    print(f"sandbox: {message}", flush=True)
    os._exit(1)


# このプロセスの中で権限を落とさないのは、スレッドが動いているプロセスを fork して Python のコードを続けると、ほかのスレッドが持っていたロックで止まることがあるため
def jail(command, *args):
    return [sys.executable, "-I", "-S", JAIL, command, *map(str, args)]


def helper(command, slot):
    return subprocess.run(jail(command, slot), stdin=subprocess.DEVNULL).returncode


def processes_of(uid):
    found = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            # /proc/<pid> の所有者で見分けないのは、プロセスが自分を dumpable でなくすと所有者が root に見えるため
            with open(f"/proc/{name}/status") as f:
                fields = dict(line.split(":\t", 1) for line in f.read().splitlines() if ":\t" in line)
        except OSError:
            continue
        if str(uid) in fields.get("Uid", "").split() and not fields.get("State", "").startswith("Z"):
            found.append(int(name))
    return found


def stop_processes(slot):
    deadline = time.monotonic() + STOP_SECONDS
    while True:
        helper("kill", slot)
        retry_at = time.monotonic() + 1
        # すぐに kill をやり直さないのは、止めたプロセスが消えるまでに少しかかるだけで、やり直すたびに起動するプロセスがその邪魔をするため
        while processes_of(UID_BASE + slot):
            if time.monotonic() > deadline:
                fatal(f"slot {slot} のプロセスを止められません")
            if time.monotonic() > retry_at:
                break
            time.sleep(0.01)
        else:
            return


def clean(slot):
    if helper("wipe", slot) != 0:
        fatal(f"slot {slot} のファイルを消せません")


def read_available(file, buffer):
    """読めるだけ読む。終端まで読み切ったら True"""
    while True:
        try:
            chunk = os.read(file.fileno(), 65_536)
        except BlockingIOError:
            return False
        if not chunk:
            return True
        if len(buffer) <= MAX_OUTPUT_BYTES:
            buffer += chunk


def run_code(slot, code, stdin):
    code_r, code_w = os.pipe()
    status_r, status_w = os.pipe()
    started = time.monotonic()
    deadline = started + WALL_SECONDS
    # バッファを挟まないのは、相手が読まずに終了したときに、閉じるときの書き出しでもう一度失敗するため
    with os.fdopen(code_w, "wb", buffering=0) as code_file, os.fdopen(status_r, "rb") as status_file:
        try:
            proc = subprocess.Popen(
                jail("exec", slot, code_r, status_w),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=(code_r, status_w),
            )
        finally:
            os.close(code_r)
            os.close(status_w)
        output = {proc.stdout: bytearray(), proc.stderr: bytearray()}
        status = "exited"
        try:
            try:
                code_file.write(code)
                code_file.close()
                os.set_blocking(proc.stdin.fileno(), False)
                os.write(proc.stdin.fileno(), stdin)
            except (BrokenPipeError, BlockingIOError):
                pass
            proc.stdin.close()
            failure = status_file.read()
            if failure:
                raise RuntimeError(f"起動に失敗しました: {failure.decode(errors='replace')}")

            selector = selectors.DefaultSelector()
            for file in output:
                os.set_blocking(file.fileno(), False)
                selector.register(file, selectors.EVENT_READ)
            while selector.get_map() and proc.poll() is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    status = "timeout"
                    break
                # 出力の終端だけを待たないのは、プログラムが残した子プロセスがパイプを開いたままにすると、終了しても終端が来ないため
                for key, _ in selector.select(min(remaining, 0.1)):
                    if read_available(key.fileobj, output[key.fileobj]):
                        selector.unregister(key.fileobj)
                if any(len(buffer) > MAX_OUTPUT_BYTES for buffer in output.values()):
                    status = "output_limit"
                    break
            if status == "exited":
                try:
                    proc.wait(max(deadline - time.monotonic(), 0))
                except subprocess.TimeoutExpired:
                    status = "timeout"
        finally:
            try:
                proc.kill()
            except (PermissionError, ProcessLookupError):
                pass
            stop_processes(slot)
            returncode = proc.wait()
            for file, buffer in output.items():
                read_available(file, buffer)
                file.close()

    if status == "exited" and any(len(buffer) > MAX_OUTPUT_BYTES for buffer in output.values()):
        status = "output_limit"
    if status == "exited" and returncode < 0:
        status = "timeout" if returncode == -signal.SIGXCPU else "killed"
    return {
        "status": status,
        "exitCode": returncode if status == "exited" else None,
        "stdout": bytes(output[proc.stdout][:MAX_OUTPUT_BYTES]).decode(errors="replace"),
        # stdout では置き換えないのは、プログラムが出した結果そのものを変えてしまうため。traceback のファイル名だけを main.py に戻す
        "stderr": bytes(output[proc.stderr][:MAX_OUTPUT_BYTES]).decode(errors="replace").replace(f"{home(slot)}/", ""),
        "durationMs": round((time.monotonic() - started) * 1000),
    }


free_slots = queue.Queue()
pending = threading.BoundedSemaphore(MAX_PENDING)


class Handler(BaseHTTPRequestHandler):
    timeout = 30

    def log_message(self, format, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ok": True})
        else:
            self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/run":
            return self.reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self.reply(400, {"error": "invalid"})
        if not 0 < length <= MAX_BODY_BYTES:
            return self.reply(413, {"error": "too_large"})
        try:
            body = json.loads(self.rfile.read(length))
            if body["language"] != "python":
                raise ValueError
            code = body["code"].encode()
            stdin = body.get("stdin", "").encode()
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.reply(400, {"error": "invalid"})
        if len(code) > MAX_CODE_BYTES or len(stdin) > MAX_STDIN_BYTES:
            return self.reply(413, {"error": "too_large"})

        if not pending.acquire(blocking=False):
            return self.reply(503, {"error": "busy"})
        try:
            try:
                slot = free_slots.get(timeout=QUEUE_SECONDS)
            except queue.Empty:
                return self.reply(503, {"error": "busy"})
            try:
                result = run_code(slot, code, stdin)
            except Exception as e:
                print(f"sandbox: slot {slot}: {e}", flush=True)
                result = None
            finally:
                clean(slot)
                free_slots.put(slot)
        finally:
            pending.release()
        if result is None:
            return self.reply(500, {"error": "failed"})
        print(f"run slot={slot} status={result['status']} ms={result['durationMs']}", flush=True)
        self.reply(200, result)


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 64


def listen():
    if not LISTEN.startswith("unix:"):
        return ThreadingHTTPServer(("", int(LISTEN.removeprefix("tcp:"))), Handler)
    path = LISTEN.removeprefix("unix:")
    directory = os.path.dirname(path)
    # ソケットを誰でもつなげる権限にしないのは、実行中のコードからもこのサーバーを呼べてしまうため。
    # アプリのコンテナのユーザー（node）のグループにだけ開け、実行用の UID はディレクトリに入れないようにする
    os.setgid(APP_GID)
    os.chown(directory, -1, APP_GID)
    os.chmod(directory, 0o750)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    os.umask(0o117)
    server = UnixServer(path, Handler)
    os.umask(0o077)
    return server


def serve():
    os.umask(0o077)
    slots = [slot for slot in range(MAX_SLOTS) if os.path.ismount(home(slot))]
    if not slots:
        sys.exit(f"sandbox: {WORK_DIR}/<番号>/home に tmpfs がマウントされていません")
    for slot in slots:
        stat = os.stat(home(slot))
        if stat.st_uid != UID_BASE + slot or stat.st_mode & 0o777 != 0o700:
            sys.exit(f"sandbox: {home(slot)} は uid={UID_BASE + slot},mode=0700 でマウントしてください")
        stop_processes(slot)
        clean(slot)
        free_slots.put(slot)
    server = listen()
    print(f"sandbox listening on {LISTEN} ({len(slots)} slots)", flush=True)
    server.serve_forever()


def health():
    if LISTEN.startswith("unix:"):
        connection = socket.socket(socket.AF_UNIX)
        connection.settimeout(3)
        connection.connect(LISTEN.removeprefix("unix:"))
    else:
        connection = socket.create_connection(("127.0.0.1", int(LISTEN.removeprefix("tcp:"))), timeout=3)
    connection.sendall(b"GET /health HTTP/1.0\r\n\r\n")
    response = b""
    # 先頭だけ読んで切らないのは、サーバーが書き終える前に閉じると、サーバーのログに接続エラーが出続けるため
    while chunk := connection.recv(4096):
        response += chunk
    sys.exit(0 if response.startswith(b"HTTP/1.0 200") else 1)


if __name__ == "__main__":
    {"serve": serve, "health": health}[sys.argv[1]]()
