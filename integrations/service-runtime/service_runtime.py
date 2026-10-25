#!/usr/bin/env python3
"""Stable stdlib-only entry point for operator and user-service commands."""

import sys

if sys.version_info < (3, 10):
    sys.stderr.write("The external service runtime requires Python 3.10 or later. Select a compatible operator Python interpreter.\n")
    raise SystemExit(1)

from odk_service_runtime.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
