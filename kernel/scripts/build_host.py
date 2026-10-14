"""Read-only measurements for native Chromium build host selection."""
import argparse
import datetime
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess


def command(args):
    try:
        value = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return {"exitCode": value.returncode, "stdout": value.stdout.strip(),
                "stderr": value.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"error": str(error)}


def measure():
    report = {"measuredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "system": platform.system(), "machine": platform.machine(),
              "cpus": os.cpu_count(), "volumes": [], "nativeBuildPerformed": False}
    paths = [Path.cwd(), Path(os.environ.get("RUNNER_TEMP", "/tmp"))]
    if platform.system() == "Windows":
        paths.extend(Path(letter + ":/") for letter in "CDE" if Path(letter + ":/").exists())
        vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
        report["visualStudio"] = command([str(vswhere), "-latest", "-products", "*", "-format", "json"])
        report["memory"] = command(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"])
    elif platform.system() == "Darwin":
        report["memory"] = command(["sysctl", "-n", "hw.memsize"])
        report["xcode"] = command(["xcodebuild", "-version"])
        report["sdk"] = command(["xcrun", "--sdk", "macosx", "--show-sdk-path"])
        report["developerDirectory"] = command(["xcode-select", "-p"])
        report["applications"] = command(["du", "-sk", *map(str, sorted(Path("/Applications").glob("Xcode*.app")))])
        report["disk"] = command(["df", "-h"])
    for path in paths:
        usage = shutil.disk_usage(path)
        report["volumes"].append({"path": str(path), "totalBytes": usage.total, "freeBytes": usage.free})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    value = measure()
    args.output.write_text(json.dumps(value, indent=2) + "\n")
    print(json.dumps(value, indent=2))
