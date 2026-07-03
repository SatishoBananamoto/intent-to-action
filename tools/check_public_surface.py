"""Guard public-facing repo claims against stale paths and metadata drift."""

from __future__ import annotations

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"public-surface check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_file(path: str) -> pathlib.Path:
    file_path = ROOT / path
    if not file_path.is_file():
        fail(f"missing required file: {path}")
    return file_path


def main() -> None:
    readme = require_file("README.md").read_text(encoding="utf-8")
    tracking = require_file("TRACKING.md").read_text(encoding="utf-8")
    license_text = require_file("LICENSE").read_text(encoding="utf-8")

    if "MIT License" not in license_text:
        fail("LICENSE is not MIT text")

    stale_claims = [
        "380 Python tests",
        "M1-M4 complete",
        "M1–M4 complete",
        "relay_discussion/harness_adapter.py",
        "cd ~/relay/workspace",
    ]
    public_text = readme + "\n" + tracking
    for claim in stale_claims:
        if claim in public_text:
            fail(f"stale claim still present: {claim}")

    if "162 passed" not in readme:
        fail("README does not record the current local Python test count")

    package_json = json.loads(require_file("ts_prototype/package.json").read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})
    if "../ts_prototype_tests/*.test.ts" not in scripts.get("test", ""):
        fail("TypeScript test script does not point at ts_prototype_tests")
    if "cli.ts" not in scripts.get("demo", ""):
        fail("TypeScript demo script does not point at the current cli.ts")

    tsconfig = require_file("ts_prototype/tsconfig.json").read_text(encoding="utf-8")
    if "../ts_prototype_tests/*.ts" not in tsconfig:
        fail("tsconfig does not include prototype tests")

    print("public-surface check passed")


if __name__ == "__main__":
    main()
