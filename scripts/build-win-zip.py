#!/usr/bin/env python3
"""Build dist/RoboFables-win64.zip — Windows zip edition, no install for the kid.

Run this on a build machine that has network. It downloads the official
Windows embeddable CPython 3.12 zip from python.org and a pyserial wheel
from PyPI, then packs them with bridge_server.py and the web files.

The kid's PC does not download or install anything. They unzip and
double-click Start-RoboFables.bat, which runs the bundled python.exe
and opens http://127.0.0.1:8765/ .
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
STAGING = DIST / "_winzip_staging" / "RoboFables-win64"
OUT_ZIP = DIST / "RoboFables-win64.zip"

# Newest 3.12.x that actually publishes a Windows amd64 embeddable zip.
# Some security releases on python.org are source-only, so the script walks
# 3.12.20 down to 3.12.10 and takes the first embed-amd64.zip it finds.

COPY_NAMES = [
    "bridge_server.py",
    "requirements.txt",
    "index.html",
    "LICENSE",
    "README.md",
    "THIRD_PARTY.md",
    "css",
    "js",
    "vendor",
    "src",
]

BAT = """\
@echo off
REM RoboFables zip edition. No Python install. Do not close this window until you are done.
cd /d "%~dp0"
echo Starting RoboFables...
start "RoboFables" "%~dp0python\\python.exe" "%~dp0bridge_server.py"
ping 127.0.0.1 -n 3 >nul
start "" "http://127.0.0.1:8765/"
"""

def notice_text(version: str, url: str) -> str:
    return f"""\
RoboFables Windows zip edition

The python\\ folder is the official Windows embeddable CPython {version}
(64-bit), downloaded by scripts/build-win-zip.py from python.org:

  {url}

License: PSF License — https://docs.python.org/3/license.html

pyserial is unpacked from its PyPI wheel into python\\Lib\\site-packages.
License: BSD 3-Clause — https://github.com/pyserial/pyserial

The rest of this folder is RoboFables (MIT). See LICENSE and THIRD_PARTY.md.
"""


def download(url: str, dest: Path) -> None:
    print(f"download {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "RoboFables-build-win-zip"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())


def find_embed_release() -> tuple[str, str]:
    """Return (version, url) for the newest official 3.12 Windows embeddable amd64 zip."""
    for minor in range(20, 9, -1):
        version = f"3.12.{minor}"
        page = f"https://www.python.org/ftp/python/{version}/"
        try:
            req = urllib.request.Request(page, headers={"User-Agent": "RoboFables-build-win-zip"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                if resp.status != 200:
                    continue
                html = resp.read().decode("utf-8", "replace")
        except Exception:
            continue
        names = re.findall(
            r'href="(python-' + re.escape(version) + r'-embed(?:dable)?-amd64\.zip)"',
            html,
        )
        if not names:
            continue
        classic = [n for n in names if n.endswith("-embed-amd64.zip")]
        name = classic[0] if classic else names[0]
        return version, page + name
    raise SystemExit(
        "No official Windows embeddable CPython 3.12 zip found under "
        "https://www.python.org/ftp/python/ (looked for python-3.12.*-embed-amd64.zip)."
    )


def pyserial_wheel_url() -> str:
    req = urllib.request.Request(
        "https://pypi.org/pypi/pyserial/json",
        headers={"User-Agent": "RoboFables-build-win-zip"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        meta = json.loads(resp.read().decode("utf-8"))
    urls = meta.get("urls") or []
    for item in urls:
        name = item.get("filename") or ""
        if name.endswith("-py3-none-any.whl") or name.endswith("-py2.py3-none-any.whl"):
            return item["url"]
    raise SystemExit("PyPI did not list a pure-Python pyserial wheel")


def enable_site(python_dir: Path) -> None:
    pths = sorted(python_dir.glob("python*._pth"))
    if len(pths) != 1:
        raise SystemExit(f"expected one python*._pth in the embeddable zip, found {pths}")
    raw = pths[0].read_text(encoding="utf-8")
    lines = [ln.rstrip("\r") for ln in raw.splitlines() if ln.strip() != ""]
    rewritten: list[str] = []
    for ln in lines:
        if ln.strip().lstrip("#").strip() == "import site" and ln.strip().startswith("#"):
            continue
        rewritten.append(ln)
    if not any(ln.replace("/", "\\").lower() == "lib\\site-packages" for ln in rewritten):
        rewritten.append(r"Lib\site-packages")
    if not any(ln.strip() == "import site" for ln in rewritten):
        rewritten.append("import site")
    pths[0].write_bytes(("\r\n".join(rewritten) + "\r\n").encode("utf-8"))
    print(f"updated {pths[0].name}")


def unpack_wheel(wheel: Path, site_packages: Path) -> None:
    site_packages.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(wheel) as zf:
        for info in zf.infolist():
            name = info.filename
            if name.startswith("__pycache__/") or "/__pycache__/" in name:
                continue
            # Keep the serial package and dist-info. Skip nothing else; the wheel is pure Python.
            target = site_packages / name
            if info.is_dir() or name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(info))
    if not (site_packages / "serial" / "__init__.py").is_file():
        raise SystemExit("pyserial wheel did not contain serial/__init__.py")


def copy_app(dest: Path) -> None:
    for name in COPY_NAMES:
        src = ROOT / name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        target = dest / name
        if src.is_dir():
            shutil.copytree(
                src,
                target,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
            )
        else:
            shutil.copy2(src, target)


def make_zip(folder: Path, out_zip: Path) -> None:
    if out_zip.exists():
        out_zip.unlink()
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(folder.rglob("*")):
            if not path.is_file():
                continue
            if "__pycache__" in path.parts:
                continue
            arc = Path("RoboFables-win64") / path.relative_to(folder)
            zf.write(path, arc.as_posix())


def main() -> None:
    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)
    cache = DIST / "_cache"
    cache.mkdir(parents=True, exist_ok=True)

    version, embed_url = find_embed_release()
    print(f"embeddable CPython {version}")
    embed_zip = cache / f"python-{version}-embed-amd64.zip"
    if not embed_zip.is_file() or embed_zip.stat().st_size < 1_000_000:
        download(embed_url, embed_zip)
    else:
        print(f"reuse {embed_zip}")

    python_dir = STAGING / "python"
    python_dir.mkdir()
    with zipfile.ZipFile(embed_zip) as zf:
        zf.extractall(python_dir)
    if not (python_dir / "python.exe").is_file():
        raise SystemExit("embeddable zip has no python.exe — not the Windows amd64 embeddable package")
    enable_site(python_dir)

    wheel = cache / "pyserial.whl"
    if not wheel.is_file():
        download(pyserial_wheel_url(), wheel)
    else:
        print(f"reuse {wheel}")
    unpack_wheel(wheel, python_dir / "Lib" / "site-packages")

    copy_app(STAGING)
    (STAGING / "Start-RoboFables.bat").write_bytes(BAT.replace("\n", "\r\n").encode("ascii"))
    (STAGING / "BUNDLED-PYTHON.txt").write_bytes(notice_text(version, embed_url).replace("\n", "\r\n").encode("utf-8"))

    make_zip(STAGING, OUT_ZIP)
    print(f"wrote {OUT_ZIP} ({OUT_ZIP.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
