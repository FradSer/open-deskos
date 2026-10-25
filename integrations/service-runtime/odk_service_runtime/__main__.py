"""Allow python -m odk_service_runtime without a package installation."""

from .cli import main

raise SystemExit(main())
