#!/usr/bin/env python3
import os
import platform
import subprocess
import sys
import threading
import venv
from pathlib import Path
from typing import Optional, List, Dict

def check_python_version() -> None:
    """Ensure Python 3.11+ is being used."""
    if sys.version_info < (3, 11):
        print("Error: Python 3.11 or higher is required")
        sys.exit(1)

def run_command(
    command: List[str],
    cwd: Optional[Path] = None,
    shell: bool = False,
    env: Optional[Dict[str, str]] = None,
) -> subprocess.CompletedProcess:
    """Run a command and return the completed process."""
    cwd = cwd or Path.cwd()
    print(f"Running: {' '.join(command)}")

    # Use shell=True on Windows to correctly resolve executables like npm.cmd
    if platform.system() == "Windows":
        shell = True
    
    try:
        return subprocess.run(
            command,
            cwd=str(cwd),
            shell=shell,
            env=env or os.environ,
            check=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"Command failed with exit code {e.returncode}")
        raise

def setup_virtualenv(venv_dir: Path) -> None:
    """Create and set up a Python virtual environment if it doesn't exist."""
    print(f"Setting up virtual environment at {venv_dir}...")
    
    if not venv_dir.exists():
        print("Creating virtual environment...")
        venv.create(venv_dir, with_pip=True)
    
    # Get the correct executable paths based on platform
    if platform.system() == "Windows":
        python_exe = venv_dir / "Scripts" / "python.exe"
        pip_exe = venv_dir / "Scripts" / "pip.exe"
    else:
        python_exe = venv_dir / "bin" / "python"
        pip_exe = venv_dir / "bin" / "pip"
    
    # Check if dependencies are already installed
    try:
        result = subprocess.run(
            [str(python_exe), "-c", "import scipy, sklearn"],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print("Dependencies already installed, skipping...")
            return
    except:
        pass
    
    # Upgrade pip and install package in development mode
    print("Installing/updating backend dependencies...")
    run_command([str(python_exe), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run_command([str(pip_exe), "install", "-e", "."], cwd=venv_dir.parent)

def ensure_frontend_deps(frontend_dir: Path) -> None:
    """Ensure frontend dependencies are installed."""
    if not (frontend_dir / "node_modules").exists():
        print("Installing frontend dependencies...")
        run_command(["npm", "install"], cwd=frontend_dir)
    else:
        print("Frontend dependencies already installed, skipping...")

def start_backend(venv_dir: Path, backend_dir: Path) -> subprocess.Popen:
    """Start the backend server."""
    print("Starting backend server...")
    
    # Get the correct Python executable path
    if platform.system() == "Windows":
        python_exe = venv_dir / "Scripts" / "python.exe"
    else:
        python_exe = venv_dir / "bin" / "python"
    
    # Verify python executable exists
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable not found at {python_exe}")
    
    # Set up environment
    env = os.environ.copy()
    env["PYTHONPATH"] = str(backend_dir)
    
    # Start the backend process
    return subprocess.Popen(
        [str(python_exe), "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
        cwd=str(backend_dir),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

def start_frontend(frontend_dir: Path) -> subprocess.Popen:
    """Start the frontend development server."""
    print("Starting frontend server...")
    
    # Verify package.json exists
    package_json = frontend_dir / "package.json"
    if not package_json.exists():
        raise FileNotFoundError(f"Frontend package.json not found at {package_json}")
    
    # Use shell=True on Windows to correctly resolve npm.cmd
    use_shell = platform.system() == "Windows"

    return subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(frontend_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        shell=use_shell,
    )

def stream_output(process: subprocess.Popen, prefix: str) -> None:
    """Stream output from a process with a prefix."""
    try:
        if process.stdout:
            for line in process.stdout:
                print(f"[{prefix}] {line}", end="" if line.endswith("\n") else "\n")
    except Exception as e:
        print(f"[{prefix}] Error streaming output: {e}")

def main():
    print("🚀 Starting EASE development environment...")
    
    backend_process = None
    frontend_process = None
    
    try:
        # Check Python version first
        check_python_version()
        
        # Set up paths
        root_dir = Path(__file__).parent.parent
        backend_dir = root_dir / "backend"
        frontend_dir = root_dir / "frontend"
        venv_dir = backend_dir / ".venv"
        
        # Verify directories exist
        if not backend_dir.exists():
            raise FileNotFoundError(f"Backend directory not found at {backend_dir}")
        if not frontend_dir.exists():
            raise FileNotFoundError(f"Frontend directory not found at {frontend_dir}")
        
        # Set up virtual environment and install dependencies
        setup_virtualenv(venv_dir)
        ensure_frontend_deps(frontend_dir)
        
        print("\n✅ Dependencies installed successfully!")
        print("🔄 Starting servers...")
        
        # Start backend and frontend
        backend_process = start_backend(venv_dir, backend_dir)
        frontend_process = start_frontend(frontend_dir)
        
        # Stream output from both processes
        backend_thread = threading.Thread(
            target=stream_output,
            args=(backend_process, "backend"),
            daemon=True
        )
        frontend_thread = threading.Thread(
            target=stream_output,
            args=(frontend_process, "frontend"),
            daemon=True
        )
        
        backend_thread.start()
        frontend_thread.start()
        
        print("\n🌐 Servers starting...")
        print("   Backend:  http://localhost:8000")
        print("   Frontend: http://localhost:5173")
        print("   Press Ctrl+C to stop both servers")
        
        # Keep the main thread alive
        while backend_process.poll() is None and frontend_process.poll() is None:
            backend_thread.join(timeout=1)
            frontend_thread.join(timeout=1)
        
    except KeyboardInterrupt:
        print("\n🛑 Shutting down servers...")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        # Clean up processes
        if backend_process:
            try:
                backend_process.terminate()
                backend_process.wait(timeout=5)
            except:
                backend_process.kill()
        if frontend_process:
            try:
                frontend_process.terminate()
                frontend_process.wait(timeout=5)
            except:
                frontend_process.kill()
        print("✅ Cleanup complete")

if __name__ == "__main__":
    main()
