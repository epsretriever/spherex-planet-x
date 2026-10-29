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


def _build(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT, build_field, load_showcase, publish

    out = Path(args.out) if args.out else DEFAULT_OUT
    specs = load_showcase()
    if args.fields:
        specs = [s for s in specs if s.field_id in args.fields]
        missing = set(args.fields) - {s.field_id for s in specs}
        if missing:
            print(f"unknown field ids: {sorted(missing)}")
            return 2
    for spec in specs:
        detail, cands = build_field(spec, out)
        counts = {}
        for c in cands:
            counts[c.classification.value] = counts.get(c.classification.value, 0) + 1
        print(f"{spec.field_id}: {len(detail.epochs)} epochs, {len(cands)} candidates {counts}")
    n_fields, n_cands = publish(out)
    print(f"published {n_fields} fields, {n_cands} candidates to {out}")
    return 0


def _publish(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT, publish

    print(publish(Path(args.out) if args.out else DEFAULT_OUT))
    return 0


def _index(args: argparse.Namespace) -> int:
    from .data.index import CoverageIndex

    idx = CoverageIndex()
    for seg in args.segments:
        release, segment = seg.split("/")
        idx.index_segment(release, segment)
    print(idx.stats())
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
    b = sub.add_parser("build", help="build showcase fields into the static data directory")
    b.add_argument("fields", nargs="*", help="field ids from config/showcase.toml (default: all)")
    b.add_argument("--out", help="output directory (default: frontend/public/data)")
    b.set_defaults(func=_build)
    p = sub.add_parser("publish", help="rebuild fields.json and candidates.json")
    p.add_argument("--out")
    p.set_defaults(func=_publish)
    ix = sub.add_parser("index", help="index exposure headers for week segments")
    ix.add_argument("segments", nargs="+", help='e.g. "qr2/2025W23_1C"')
    ix.set_defaults(func=_index)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
