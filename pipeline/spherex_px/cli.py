"""Command-line entry point: `spherex-px <command>`."""

from __future__ import annotations

import argparse
import logging
import sys


def _export_schema(args: argparse.Namespace) -> int:
    from .contract import export_json_schema

    for path in export_json_schema():
        print(path)
    return 0


def _validate_fixtures(args: argparse.Namespace) -> int:
    from .contract import validate_fixtures

    for name, status in validate_fixtures().items():
        print(f"{name}: {status}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="spherex-px")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("export-schema", help="write shared/schema/*.schema.json").set_defaults(
        func=_export_schema
    )
    sub.add_parser("validate-fixtures", help="validate shared/fixtures/*.json").set_defaults(
        func=_validate_fixtures
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
