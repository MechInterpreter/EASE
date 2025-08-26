#!/usr/bin/env python3
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_CWD = ROOT / "backend"
FRONTEND_CWD = ROOT / "frontend"

PROCS = []

def run(cmd, cwd):
    return subprocess.Popen(
        cmd,
        cwd=str(cwd),
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def stream(name, proc):
    try:
        for line in proc.stdout:
            sys.stdout.write(f"[{name}] {line}")
    except Exception:
        pass


def main():
    try:
        # Prefer backend virtualenv's uvicorn if present; fallback to system uvicorn
        venv = BACKEND_CWD / ".venv"
        if os.name == "nt":
            uvicorn_bin = venv / "Scripts" / "uvicorn.exe"
        else:
            uvicorn_bin = venv / "bin" / "uvicorn"
        if uvicorn_bin.exists():
            backend_cmd = f'"{uvicorn_bin}" app.main:app --reload --port 8000'
        else:
            backend_cmd = "uvicorn app.main:app --reload --port 8000"
        frontend_cmd = "npm run dev"

        print("Starting backend...")
        pb = run(backend_cmd, BACKEND_CWD)
        PROCS.append(pb)
        print("Starting frontend...")
        pf = run(frontend_cmd, FRONTEND_CWD)
        PROCS.append(pf)

        # Stream outputs
        while True:
            alive = False
            for name, p in (("backend", pb), ("frontend", pf)):
                if p.poll() is None:
                    alive = True
                    # non-blocking read: rely on iter to print when available
                    while True:
                        line = p.stdout.readline()
                        if not line:
                            break
                        sys.stdout.write(f"[{name}] {line}")
            if not alive:
                break
    except KeyboardInterrupt:
        pass
    finally:
        for p in PROCS:
            if p and p.poll() is None:
                try:
                    if os.name == "nt":
                        p.send_signal(signal.CTRL_BREAK_EVENT)
                    else:
                        p.terminate()
                except Exception:
                    pass
        for p in PROCS:
            try:
                p.wait(timeout=5)
            except Exception:
                pass


if __name__ == "__main__":
    main()
