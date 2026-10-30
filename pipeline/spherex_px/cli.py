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


def _rank_pairs(args: argparse.Namespace) -> int:
    """Recompute blink pairs for already-built fields from their epochs and movers."""
    from pathlib import Path

    from . import schemas as S
    from .build import DEFAULT_OUT, blink_pairs_for

    out = Path(args.out) if args.out else DEFAULT_OUT
    for path in sorted((out / "fields").glob("*.json")):
        detail = S.FieldDetail.model_validate_json(path.read_text())
        detail.blink_pairs = blink_pairs_for(
            detail.epochs,
            detail.movers,
            detail.wcs.width_px,
            detail.wcs.height_px,
            detail.wcs.cdelt_arcsec,
        )
        path.write_text(detail.model_dump_json(indent=2) + "\n")
        best = detail.blink_pairs[0]
        print(
            f"{detail.field_id}: {len(detail.blink_pairs)} pairs; default {best.epoch_id_a}->"
            f"{best.epoch_id_b} {best.time_separation_hours:.1f} h, shift {best.displacement_arcsec}"
        )
    return 0


def _index(args: argparse.Namespace) -> int:
    from .data.index import CoverageIndex

    idx = CoverageIndex()
    for seg in args.segments:
        release, segment = seg.split("/")
        idx.index_segment(release, segment)
    print(idx.stats())
    return 0


def _survey_plan(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .survey import plan

    tiles = plan(args.segments, Path(args.out), max_tiles=args.max_tiles)
    print(f"planned {len(tiles)} tiles -> {args.out}")
    return 0


def _survey_build(args: argparse.Namespace) -> int:
    import json
    from dataclasses import asdict
    from pathlib import Path

    from .build import DEFAULT_OUT
    from .survey import build_share

    out = Path(args.out) if args.out else DEFAULT_OUT
    results = build_share(Path(args.plan), args.shard, args.of, out)
    report = out / f"survey-shard-{args.shard}.json"
    report.write_text(json.dumps([asdict(r) for r in results], indent=1) + "\n")
    kept = sum(r.status == "kept" for r in results)
    print(f"shard {args.shard}/{args.of}: {len(results)} tiles, {kept} kept")
    return 0


def _survey_ledger(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT, utc_now
    from .ledger import record_run, workflow_url_from_env
    from .version import build_run_id

    out = Path(args.out) if args.out else DEFAULT_OUT
    now = utc_now()
    run = record_run(
        out,
        [Path(p) for p in args.reports],
        run_id=args.run_id or build_run_id(),
        started_utc=args.started or now,
        finished_utc=now,
        workflow_url=workflow_url_from_env(),
    )
    print(
        f"{run.run_id}: {run.n_tiles_processed} tiles searched, {run.n_tiles_with_movers} with "
        f"moving objects, {run.n_tiles_empty} empty, {run.n_tiles_failed} failed; "
        f"{run.n_new_objects} new objects"
    )
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
    rp = sub.add_parser("rank-pairs", help="recompute blink pairs for built fields")
    rp.add_argument("--out")
    rp.set_defaults(func=_rank_pairs)
    ix = sub.add_parser("index", help="index exposure headers for week segments")
    ix.add_argument("segments", nargs="+", help='e.g. "qr2/2025W23_1C"')
    ix.set_defaults(func=_index)
    sp = sub.add_parser("survey-plan", help="pick ecliptic tiles SPHEREx imaged often enough")
    sp.add_argument("segments", nargs="+", help='e.g. "qr2/2025W23_1C"')
    sp.add_argument("--out", default="var/survey-plan.json")
    sp.add_argument("--max-tiles", type=int, default=None)
    sp.set_defaults(func=_survey_plan)
    sb = sub.add_parser("survey-build", help="build one shard of a survey plan")
    sb.add_argument("--plan", default="var/survey-plan.json")
    sb.add_argument("--shard", type=int, default=0)
    sb.add_argument("--of", type=int, default=1)
    sb.add_argument("--out")
    sb.set_defaults(func=_survey_build)
    sl = sub.add_parser(
        "survey-ledger", help="record a survey run: footprint of searched tiles and run ledger"
    )
    sl.add_argument("reports", nargs="+", help="survey-shard-N.json reports from survey-build")
    sl.add_argument("--run-id", help="default: this build's run id (gh-<run>-<attempt> in Actions)")
    sl.add_argument("--started", help="UTC time the run started (ISO 8601)")
    sl.add_argument("--out")
    sl.set_defaults(func=_survey_ledger)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
