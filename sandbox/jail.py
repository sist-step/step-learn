"""権限を落として動く処理。server.py が、実行のたびに別のプロセスとして起動する。

    jail.py exec <slot> <code_fd> <status_fd>  コードを実行する
    jail.py kill <slot>                        実行が残したプロセスをすべて止める
    jail.py wipe <slot>                        作業ディレクトリを空にする
"""

# 起動が実行のたびに 3 回あるので、読み込みの重いモジュール（subprocess など）は使わない
import os
import resource
import signal
import sys

WORK_DIR = "/work"
MAX_SLOTS = 8
UID_BASE = 20_000
KILLER_UID_BASE = 21_000

CPU_SECONDS = 5
MEMORY_BYTES = 256 * 1024 * 1024
FILE_BYTES = 8 * 1024 * 1024
MAX_PROCESSES = 16
MAX_OPEN_FILES = 64

LIMITS = [
    (resource.RLIMIT_CPU, CPU_SECONDS, CPU_SECONDS + 1),
    (resource.RLIMIT_AS, MEMORY_BYTES, MEMORY_BYTES),
    (resource.RLIMIT_FSIZE, FILE_BYTES, FILE_BYTES),
    (resource.RLIMIT_NPROC, MAX_PROCESSES, MAX_PROCESSES),
    (resource.RLIMIT_NOFILE, MAX_OPEN_FILES, MAX_OPEN_FILES),
    (resource.RLIMIT_CORE, 0, 0),
    (resource.RLIMIT_MSGQUEUE, 0, 0),
]


def home(slot):
    return f"{WORK_DIR}/{slot}/home"


def drop_to(uid):
    os.setgroups([])
    os.setresgid(uid, uid, uid)
    os.setresuid(uid, uid, uid)


def exec_code(slot, code_fd, status_fd):
    os.set_inheritable(status_fd, False)
    try:
        with os.fdopen(code_fd, "rb") as f:
            code = f.read()
        for limit, soft, hard in LIMITS:
            resource.setrlimit(limit, (soft, hard))
        # 優先度をそのままにしないのは、fork で増えたプロセスに CPU を取られて、それを止める側の処理が進まなくなるため
        os.nice(19)
        # 権限を落としたあとに書かないのは、UID を変えたプロセスの /proc は root のものになり、自分では書けなくなるため
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("1000")
        drop_to(UID_BASE + slot)
        os.umask(0o077)
        os.chdir(home(slot))
        with open("main.py", "wb") as f:
            f.write(code)
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": home(slot),
            "TMPDIR": home(slot),
            "LANG": "C.UTF-8",
            "PYTHONUTF8": "1",
        }
        # -u を付けないと、時間切れで止めたときに、それまでの出力がバッファに残ったまま失われる
        os.execve(sys.executable, ["python3", "-u", "-B", "main.py"], env)
    except BaseException as e:
        os.write(status_fd, repr(e).encode())
        os._exit(1)


def kill_all(slot):
    uid = UID_BASE + slot
    killer = KILLER_UID_BASE + slot
    os.setgroups([])
    os.setresgid(killer, killer, killer)
    # 実 UID まで実行用の UID にしないのは、止める相手のプロセスから先に kill されないようにするため。
    # 実 UID を root のままにもしないのは、kill(-1) がサーバーやほかの実行の後始末まで止めてしまうため
    os.setresuid(killer, uid, killer)
    try:
        # プロセスを 1 つずつ探して止めないのは、止めている間に fork で増え続けるプロセスに追いつけないため
        os.kill(-1, signal.SIGKILL)
    except ProcessLookupError:
        pass


def wipe(slot):
    drop_to(UID_BASE + slot)
    path = home(slot)
    os.chmod(path, 0o700)
    os.spawnvp(os.P_WAIT, "chmod", ["chmod", "-R", "u+rwx", "--", path])
    os.spawnvp(os.P_WAIT, "find", ["find", path, "-mindepth", "1", "-delete"])
    if os.listdir(path):
        sys.exit(1)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"exec": exec_code, "kill": kill_all, "wipe": wipe}[command](*map(int, args))
