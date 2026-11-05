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
    deadline = args.deadline_min * 60 if args.deadline_min else None
    results = build_share(Path(args.plan), args.shard, args.of, out, deadline_s=deadline)
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
    import json

    meta: dict = {}
    for m in args.plan_meta or []:
        meta.update(json.loads(Path(m).read_text()))
    run = record_run(
        out,
        [Path(p) for p in args.reports],
        run_id=args.run_id or build_run_id(),
        started_utc=args.started or now,
        finished_utc=now,
        workflow_url=workflow_url_from_env(),
        plan_meta=meta,
    )
    print(
        f"{run.run_id}: {run.n_tiles_processed} tiles searched, {run.n_tiles_with_movers} with "
        f"moving objects, {run.n_tiles_empty} empty, {run.n_tiles_failed} failed; "
        f"{run.n_new_objects} new objects"
    )
    return 0


def _triage(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT
    from .triage import summary_line, triage

    out = Path(args.out) if args.out else DEFAULT_OUT
    rep = triage(out, limit=args.limit, workers=args.workers, recheck_unmatched=args.recheck)
    line = summary_line(rep)
    print(line)
    if args.summary:
        with open(args.summary, "a") as fh:
            fh.write(line + "\n")
    return 0


def _injection_study(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT, publish, write_json
    from .injection import build_examples, merge_shards, run_shard, run_study

    out = Path(args.out) if args.out else DEFAULT_OUT
    where = dict(field_ids=args.fields or None, survey=args.survey, max_fields=args.max_fields)
    if args.shard is not None:
        ckpt = run_shard(
            args.study_id,
            args.shard,
            args.of,
            Path(args.shard_out),
            trials_per_cell=args.trials,
            workers=args.workers,
            out_dir=out,
            **where,
        )
        print(f"shard {args.shard}/{args.of}: runs in {ckpt}")
        return 0
    if args.merge:
        study = merge_shards(args.study_id, [Path(f) for f in args.merge], out_dir=out, **where)
    else:
        study = run_study(
            args.study_id, trials_per_cell=args.trials, workers=args.workers, out_dir=out, **where
        )
    if args.examples_field:
        ids = build_examples(args.study_id, args.examples_field, out)
        study.example_candidate_ids = ids
        write_json(out / "injection" / f"{args.study_id}.json", study)
    publish(out)
    print(
        f"{study.study_id}: {study.n_recovered}/{study.n_injected} recovered; "
        f"m50 by rate {[(m.rate_arcsec_per_hr, m.m50_ab) for m in study.m50_by_rate]}; "
        f"false positives {study.false_positives.n_candidates} in {study.false_positives.area_deg2} deg2"
    )
    return 0


def _orbit_validation(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT
    from .orbit_validation import run

    doc = run(Path(args.out) if args.out else DEFAULT_OUT, args.candidates, args.per_population)
    for r in doc.rows:
        print(
            f"{r.population:15s} n={r.n:3d} distance in 5-95%: {r.distance_in_5_95_interval:.2f}  "
            f"class named: {r.distance_class_named:.2f} right: {r.distance_class_correct}  "
            "30-day inside 3 sigma: "
            f"{r.prediction_30d_inside_3sigma:.2f}"
        )
    return 0


def _planet_nine(args: argparse.Namespace) -> int:
    import json
    from pathlib import Path

    from .build import DEFAULT_OUT
    from .planet_nine import OUT, POPULATION_FILE, describe, fetch, load_population, region

    meta, paths = fetch(Path(args.cache))
    if args.describe:
        describe(meta, paths)
    pop = next(p for p in paths if p.name == POPULATION_FILE)
    doc = region(load_population(pop), args.cell_deg)
    out = (Path(args.out) if args.out else DEFAULT_OUT) / OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n")
    print(
        f"{doc['n_remaining']} of {doc['n_population']} still open; {len(doc['cells'])} cells -> {out}"
    )
    return 0


def _exclusion(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .build import DEFAULT_OUT
    from .exclusion import write

    pop = None
    if args.population:
        from .planet_nine import load_population

        pop = load_population(Path(args.population))
    doc = write(Path(args.out) if args.out else DEFAULT_OUT, pop)
    s, r = doc.survey, doc.reach_summary
    p9 = doc.planet_nine
    print(
        f"{s.n_patches_searched} patches ({s.area_deg2_searched} deg2), {s.n_patches_measured} "
        f"measured; >=50% complete to {r.d_max_50_au} AU, linker limit {r.d_linker_limit_au} AU; "
        + (
            f"Planet Nine region in searched patches {p9.region_fraction_in_searched:.4f}"
            + (f", excluded {p9.population.fraction_excluded}" if p9 and p9.population else "")
            if p9
            else "no Planet Nine region"
        )
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
    inj = sub.add_parser("injection-study", help="injection-recovery study on built fields")
    inj.add_argument("study_id")
    inj.add_argument("--fields", nargs="*", help="field ids (default: every showcase field)")
    inj.add_argument("--survey", action="store_true", help="inject into the published survey tiles")
    inj.add_argument("--max-fields", type=int, help="with --survey: at most this many tiles")
    inj.add_argument("--shard", type=int, help="run only this shard (0-based) of the fields")
    inj.add_argument("--of", type=int, default=1, help="number of shards")
    inj.add_argument("--shard-out", default="var/injection-shard", help="where a shard writes")
    inj.add_argument("--merge", nargs="+", help="shard files to merge into the study")
    inj.add_argument("--trials", type=int, default=200, help="injections per grid cell")
    inj.add_argument("--workers", type=int, default=4)
    inj.add_argument(
        "--examples-field", help="also write example SIMULATED candidates for this field"
    )
    inj.add_argument("--out")
    inj.set_defaults(func=_injection_study)
    ix = sub.add_parser("index", help="index exposure headers for week segments")
    ix.add_argument("segments", nargs="+", help='e.g. "qr2/2025W23_1C"')
    ix.set_defaults(func=_index)
    sp = sub.add_parser("survey-plan", help="pick ecliptic tiles SPHEREx imaged often enough")
    sp.add_argument(
        "segments",
        nargs="+",
        help='"qr2/2025W23_1C", "auto:N" (N spread segments) or "next:N" (N not yet finished)',
    )
    sp.add_argument("--out", default="var/survey-plan.json")
    sp.add_argument("--max-tiles", type=int, default=None)
    sp.set_defaults(func=_survey_plan)
    sb = sub.add_parser("survey-build", help="build one shard of a survey plan")
    sb.add_argument("--plan", default="var/survey-plan.json")
    sb.add_argument("--shard", type=int, default=0)
    sb.add_argument("--of", type=int, default=1)
    sb.add_argument("--out")
    sb.add_argument(
        "--deadline-min",
        type=float,
        help="start no new block after this many minutes (unreached tiles stay unsearched)",
    )
    sb.set_defaults(func=_survey_build)
    tr = sub.add_parser(
        "triage",
        help="check unchecked candidates against JPL SBIdent/Horizons; known objects get a "
        "minimal record, unexplained ones keep everything",
    )
    tr.add_argument("--out")
    tr.add_argument("--limit", type=int, help="check at most this many candidates")
    tr.add_argument("--workers", type=int, default=2)
    tr.add_argument("--recheck", action="store_true", help="also re-check unmatched candidates")
    tr.add_argument("--summary", help="append a one-line summary to this file")
    tr.set_defaults(func=_triage)
    sl = sub.add_parser(
        "survey-ledger", help="record a survey run: footprint of searched tiles and run ledger"
    )
    sl.add_argument("reports", nargs="+", help="survey-shard-N.json reports from survey-build")
    sl.add_argument("--run-id", help="default: this build's run id (gh-<run>-<attempt> in Actions)")
    sl.add_argument("--started", help="UTC time the run started (ISO 8601)")
    sl.add_argument("--out")
    sl.add_argument("--plan-meta", nargs="*", help="survey-plan-meta.json files (segment ledger)")
    sl.set_defaults(func=_survey_ledger)
    ov = sub.add_parser(
        "orbit-validation", help="test orbit fitting on simulated asteroids (SPHEREx geometry)"
    )
    ov.add_argument(
        "--candidates",
        nargs="+",
        default=["aquarius-a-c01", "aquarius-b-c01"],
        help="candidates whose observing times and positions are reused",
    )
    ov.add_argument("--per-population", type=int, default=12)
    ov.add_argument("--out")
    ov.set_defaults(func=_orbit_validation)
    p9 = sub.add_parser(
        "planet-nine", help="download Brown & Batygin's Planet Nine population (CaltechDATA)"
    )
    p9.add_argument("--cache", default="var/planet-nine")
    p9.add_argument("--cell-deg", type=float, default=5.0)
    p9.add_argument("--describe", action="store_true", help="also log the record's contents")
    p9.add_argument("--out")
    p9.set_defaults(func=_planet_nine)
    ex = sub.add_parser(
        "exclusion", help="what the survey has ruled out for a hypothetical distant planet"
    )
    ex.add_argument(
        "--population", help="Brown & Batygin reference_population.csv (member-level numbers)"
    )
    ex.add_argument("--out")
    ex.set_defaults(func=_exclusion)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
