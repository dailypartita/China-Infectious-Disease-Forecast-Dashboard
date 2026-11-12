#!/usr/bin/env python3
"""Rewrite predtimechart available_as_ofs and the model list on ptc/data.

Upstream ``ptc_generate_json_files`` sets ``available_as_ofs`` from forecast
reference dates. When a target has no forecast file, it falls back to
``min(reference_date)`` (currently 2009-09-07). Flu and dengue then point the
as-of picker at a date that is either missing (flu 404) or an ancient vintage,
so "As of data" and "Current data" load different files. Once those targets
do have a forecast file, the same generator keeps only that file's reference
date and drops the rest of the truth snapshots.

It also puts a model in ``models`` only when metadata says ``designated_model``
or the id is in ``initial_checked_models``. ``model_urls`` are omitted for
everyone else, because a url whose model is not in ``models`` fails
predtimechart validation. A flu-only or dengue-only model that is not
designated and not checked by default (GZNL-FluLGBMCQR, GZNL-DengueLGBMCQR)
is in the forecast JSON and missing from the picker.

This Hub does not revise historical observations, so the latest as-of snapshot
and Current data are the same series. After dengue truth files are written,
this script:

- drops flu target JSON whose values disagree with the current Hub CNIC series
  (the stale 2026-10-19 CDC sentinel file) and rewrites the ``current_date``
  flu snapshot from Hub truth when that file is missing or incomplete
- writes a Hub snapshot for any forecast as-of the generator already published
  that does not yet have a target JSON (COVID weeks upstream never
  materialized), truncated to ``target_end_date <= as_of``
- sets each target's ``available_as_ofs`` to dates that have a real target
  JSON and are not after ``current_date``. Forecast weeks the generator
  published are kept. Forecast JSON it did not publish (retired or test
  models) is not added. Leftover ``wk-inc-flu-hosp_*`` template files are
  never treated as ``wk inc flu prop ili``.
- keeps a model in ``models`` only when ``model-metadata/<model>.yaml``
  still exists on the Hub. Ids found only in historical forecast JSON
  (deleted test models) are dropped. ``model_urls`` are added only for
  models that have that metadata. ``initial_checked_models`` is not
  changed, so a newly added model shows up unchecked.
- writes ``models-by-target.json`` beside the options file. predtimechart
  v3's options schema sets ``additionalProperties`` to false, so this
  mapping cannot live inside ``predtimechart-options.json``. Each target
  lists Hub-registered models that appear in that target's forecast JSON.
  The forecast page uses the file to hide models that only forecast a
  different pathogen. Historical forecast JSON is left on disk.

Runs against a local checkout of the ptc/data branch. Idempotent.
"""

from __future__ import annotations

import csv
import itertools
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HUB = "dailypartita/China-Infectious-Disease-Forecast-Hub"
TS_URL = f"https://raw.githubusercontent.com/{HUB}/main/target-data/time-series.csv"
FLU_TARGET = "wk inc flu prop ili"
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$")
VALUE_TOLERANCE = 1e-6
MODELS_BY_TARGET = "models-by-target.json"


@dataclass
class PatchResult:
    available_as_ofs: dict[str, list[str]] = field(default_factory=dict)
    models: list[str] = field(default_factory=list)
    models_added: list[str] = field(default_factory=list)
    models_removed: list[str] = field(default_factory=list)
    models_by_target: dict[str, list[str]] = field(default_factory=dict)
    removed: list[str] = field(default_factory=list)
    wrote: list[str] = field(default_factory=list)
    options_changed: bool = False
    models_by_target_changed: bool = False


def replace_chars(value: str) -> str:
    """Match hub_predtimechart ``json_file_name`` character cleanup."""
    return re.sub(r"[^a-zA-Z0-9-_]", "-", value)


def file_prefixes(target: str, task_ids: dict) -> list[str]:
    """Filename prefixes for one target, one per task-id combination.

    ``wk inc flu prop ili`` + location ``CN`` becomes ``wk-inc-flu-prop-ili_CN_``.
    That does not match leftover ``wk-inc-flu-hosp_*`` files.
    """
    keys = sorted(task_ids)
    value_lists: list[list[str]] = []
    for key in keys:
        vals = task_ids[key] or []
        value_lists.append([item["value"] if isinstance(item, dict) else str(item) for item in vals])
    if not value_lists:
        return [f"{replace_chars(target)}__"]
    prefixes = []
    for combo in itertools.product(*value_lists):
        prefixes.append(f"{replace_chars(target)}_{replace_chars('_'.join(combo))}_")
    return prefixes


def dates_for_prefix(directory: Path, prefix: str) -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not directory.is_dir():
        return found
    for path in directory.glob(prefix + "*.json"):
        match = DATE_RE.match(path.name[len(prefix):])
        if match:
            found[match.group(1)] = path
    return found


def read_series(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    dates = payload.get("date") if isinstance(payload, dict) else None
    values = payload.get("y") if isinstance(payload, dict) else None
    if not isinstance(dates, list) or not isinstance(values, list):
        return None
    if not dates or len(dates) != len(values):
        return None
    if not all(isinstance(date, str) and ISO_DATE.match(date) for date in dates):
        return None
    return payload


def json_number(value: float) -> int | float:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def snapshot_payload(hub: dict[str, float], as_of: str | None, *, full: bool) -> dict:
    dates = sorted(date for date in hub if full or (as_of is not None and date <= as_of))
    return {"date": dates, "y": [json_number(hub[date]) for date in dates]}


def matches_hub(payload: dict, hub: dict[str, float]) -> bool:
    for date, value in zip(payload["date"], payload["y"]):
        if date not in hub:
            return False
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return False
        if abs(numeric - hub[date]) > VALUE_TOLERANCE:
            return False
    return True


def is_complete(payload: dict, hub: dict[str, float], as_of: str | None, *, full: bool) -> bool:
    if not matches_hub(payload, hub):
        return False
    expected = set(hub) if full else {date for date in hub if as_of is not None and date <= as_of}
    return set(payload["date"]) == expected and len(payload["date"]) == len(expected)


def write_json(path: Path, payload: dict) -> bool:
    text = json.dumps(payload, indent=4)
    if path.exists() and path.read_text() == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return True


def fetch_hub_series(url: str = TS_URL) -> dict[str, dict[str, float]]:
    """CN observations from Hub time-series.csv, keyed by target then date."""
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    series: dict[str, dict[str, float]] = {}
    for row in csv.DictReader(text.splitlines()):
        if row.get("location") not in (None, "", "CN"):
            continue
        target = row.get("target") or ""
        date = row.get("target_end_date") or ""
        raw = row.get("observation")
        if not target or not ISO_DATE.match(date) or raw in (None, "", "NA"):
            continue
        series.setdefault(target, {})[date] = float(raw)
    if not series:
        raise RuntimeError(f"no CN observations in {url}")
    return series


def _acceptable(path: Path, hub: dict[str, float] | None) -> bool:
    payload = read_series(path)
    if payload is None:
        return False
    if hub is None:
        return True
    return matches_hub(payload, hub)


def _ensure_file(
    path: Path,
    hub: dict[str, float] | None,
    as_of: str,
    *,
    full: bool,
    result: PatchResult,
) -> bool:
    """Return True when ``path`` is a usable snapshot, writing it from ``hub`` if needed."""
    payload = read_series(path) if path.exists() else None
    if payload is not None and (hub is None or matches_hub(payload, hub)):
        if not full or hub is None or is_complete(payload, hub, as_of, full=True):
            return True
    if not hub:
        if path.exists() and payload is None:
            return False
        return False
    body = snapshot_payload(hub, as_of, full=full)
    if not body["date"]:
        return False
    if write_json(path, body):
        result.wrote.append(path.name)
    return True


def reconcile_target(
    target: str,
    task_ids: dict,
    existing: list[str],
    *,
    targets_dir: Path,
    forecasts_dir: Path,
    current_date: str | None,
    hub: dict[str, float] | None,
    result: PatchResult,
) -> list[str]:
    prefixes = file_prefixes(target, task_ids)
    is_flu = target == FLU_TARGET
    if is_flu and not hub:
        raise RuntimeError(f"Hub time-series has no CN observations for {FLU_TARGET!r}")

    for prefix in prefixes:
        for date, path in list(dates_for_prefix(targets_dir, prefix).items()):
            if not is_flu:
                continue
            payload = read_series(path)
            stale = payload is None or hub is None or not matches_hub(payload, hub)
            incomplete_current = (
                date == current_date
                and payload is not None
                and hub is not None
                and not is_complete(payload, hub, current_date, full=True)
            )
            if stale or incomplete_current:
                # The current snapshot is rewritten below; other stale vintages
                # (the old CDC sentinel file) are removed and not relisted.
                if date != current_date or payload is None or hub is None:
                    path.unlink(missing_ok=True)
                    result.removed.append(path.name)

    if is_flu and current_date and hub:
        for prefix in prefixes:
            _ensure_file(
                targets_dir / f"{prefix}{current_date}.json",
                hub,
                current_date,
                full=True,
                result=result,
            )

    forecast_sets = [set(dates_for_prefix(forecasts_dir, prefix)) for prefix in prefixes]
    forecast_dates = set.intersection(*forecast_sets) if forecast_sets else set()
    # Dates the generator published that also have forecast JSON. Those weeks
    # are kept even when the target file has to be backfilled (COVID).
    forecast_backed = [date for date in existing if date in forecast_dates]

    kept_forecast: list[str] = []
    for date in forecast_backed:
        ok = True
        for prefix in prefixes:
            if not _ensure_file(
                targets_dir / f"{prefix}{date}.json",
                hub,
                date,
                full=False,
                result=result,
            ):
                ok = False
        if ok:
            kept_forecast.append(date)

    # Dengue snapshots come from gen_dengue_truth and are not re-checked
    # against Hub truth. Flu and COVID snapshots must match Hub values when
    # that series was supplied, so a stale CDC flu file cannot re-enter.
    scan_hub = None if target.startswith("mo ") else hub
    per_prefix: list[set[str]] = []
    for prefix in prefixes:
        good: set[str] = set()
        for date, path in dates_for_prefix(targets_dir, prefix).items():
            if _acceptable(path, scan_hub):
                good.add(date)
        per_prefix.append(good)
    from_targets = set.intersection(*per_prefix) if per_prefix else set()

    # Forecast JSON the generator did not publish (retired or test models)
    # stays on disk but is not added, even if a target snapshot exists.
    retired = forecast_dates - set(existing)
    selected = (from_targets - retired) | set(kept_forecast)

    if current_date:
        selected = {date for date in selected if date <= current_date}
    return sorted(selected)


def metadata_url(model: str) -> str:
    return f"https://github.com/{HUB}/blob/main/model-metadata/{model}.yaml"


def remote_metadata_exists(model: str) -> bool:
    """True when Hub model-metadata/<model>.yaml exists. 404 is absence."""
    url = f"https://raw.githubusercontent.com/{HUB}/main/model-metadata/{model}.yaml"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def _model_ids(payload: object) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    return {key for key in payload if isinstance(key, str) and MODEL_ID.fullmatch(key)}


def forecast_model_names_by_target(
    forecasts_dir: Path,
    options: dict,
    targets: list[str],
) -> dict[str, set[str]]:
    """Model ids in each target's forecast JSON.

    ``wk-inc-flu-hosp_*`` template files do not match a configured target
    prefix, so FluSight model ids in those files are ignored. The JSON
    files themselves are not deleted.
    """
    task_ids_all = options.get("task_ids", {})
    found: dict[str, set[str]] = {}
    for target in targets:
        names: set[str] = set()
        if forecasts_dir.is_dir():
            for prefix in file_prefixes(target, task_ids_all.get(target) or {}):
                for path in forecasts_dir.glob(prefix + "*.json"):
                    try:
                        payload = json.loads(path.read_text())
                    except (OSError, json.JSONDecodeError, UnicodeError):
                        continue
                    names.update(_model_ids(payload))
        found[target] = names
    return found


def forecast_model_names(forecasts_dir: Path, options: dict) -> list[str]:
    """Model ids in forecast JSON for this hub's targets, in sorted order."""
    targets = list(options.get("task_ids", {}))
    names: set[str] = set()
    for group in forecast_model_names_by_target(forecasts_dir, options, targets).values():
        names.update(group)
    return sorted(names)


def union_models(existing: list[str], discovered: list[str]) -> list[str]:
    """Keep ``existing`` order and append newly discovered ids, sorted."""
    seen = set(existing)
    merged = list(existing)
    for name in discovered:
        if name not in seen:
            merged.append(name)
            seen.add(name)
    return merged


def patch_ptc_data(
    ptc_data: Path,
    hub_series: dict[str, dict[str, float]],
    metadata_exists=None,
) -> PatchResult:
    options_path = ptc_data / "predtimechart-options.json"
    if not options_path.is_file():
        raise FileNotFoundError(f"missing {options_path}")
    options = json.loads(options_path.read_text())
    targets_dir = ptc_data / "targets"
    forecasts_dir = ptc_data / "forecasts"
    current_date = options.get("current_date")
    if current_date is not None and not (isinstance(current_date, str) and ISO_DATE.match(current_date)):
        raise RuntimeError(f"invalid current_date: {current_date!r}")

    result = PatchResult()
    order = list(options.get("available_as_ofs", {}))
    for target in options.get("task_ids", {}):
        if target not in order:
            order.append(target)

    new_as_ofs: dict[str, list[str]] = {}
    for target in order:
        task_ids = options.get("task_ids", {}).get(target, {})
        existing = list(options.get("available_as_ofs", {}).get(target, []))
        new_as_ofs[target] = reconcile_target(
            target,
            task_ids,
            existing,
            targets_dir=targets_dir,
            forecasts_dir=forecasts_dir,
            current_date=current_date,
            hub=hub_series.get(target),
            result=result,
        )
        if not new_as_ofs[target]:
            raise RuntimeError(f"no target snapshots left for {target!r}; refusing to write an empty as-of list")

    if metadata_exists is None:
        metadata_exists = remote_metadata_exists
    metadata_cache: dict[str, bool] = {}

    def has_metadata(model: str) -> bool:
        if model not in metadata_cache:
            metadata_cache[model] = bool(metadata_exists(model))
        return metadata_cache[model]

    existing_models = list(options.get("models") or [])
    by_target_names = forecast_model_names_by_target(forecasts_dir, options, order)
    discovered_names: set[str] = set()
    for names in by_target_names.values():
        discovered_names.update(names)
    discovered = sorted(discovered_names)
    # Existing order first, then newly discovered ids. Metadata is required
    # either way, so a deleted test model that only remains in old forecast
    # JSON is not kept.
    candidates = union_models(existing_models, discovered)
    kept_models = [model for model in candidates if has_metadata(model)]
    checked = {
        model
        for model in (options.get("initial_checked_models") or [])
        if isinstance(model, str)
    }
    dropped_checked = [model for model in existing_models if model in checked and model not in set(kept_models)]
    if dropped_checked:
        raise RuntimeError(
            "refusing to drop initial_checked_models with no Hub metadata: "
            + ", ".join(dropped_checked)
        )
    if "models" in options and not kept_models:
        raise RuntimeError("no models with Hub metadata left; refusing to write an empty models list")

    existing_urls = options.get("model_urls")
    urls: dict[str, str] = {}
    for model in kept_models:
        if isinstance(existing_urls, dict) and model in existing_urls:
            urls[model] = existing_urls[model]
        else:
            urls[model] = metadata_url(model)

    models_by_target = {
        target: [model for model in kept_models if model in by_target_names.get(target, set())]
        for target in order
    }

    if "models" in options:
        models_changed = kept_models != existing_models
    else:
        models_changed = bool(kept_models)
    if existing_urls is None:
        urls_changed = bool(urls)
    else:
        urls_changed = urls != existing_urls

    result.available_as_ofs = new_as_ofs
    result.models = kept_models
    result.models_added = [model for model in kept_models if model not in existing_models]
    result.models_removed = [model for model in existing_models if model not in set(kept_models)]
    result.models_by_target = models_by_target
    result.options_changed = (
        new_as_ofs != options.get("available_as_ofs") or models_changed or urls_changed
    )
    if result.options_changed:
        options["available_as_ofs"] = new_as_ofs
        if "models" in options or kept_models:
            options["models"] = kept_models
        if existing_urls is not None or urls:
            options["model_urls"] = urls
        # Match upstream json.dump(..., indent=4): no trailing newline after "}".
        options_path.write_text(json.dumps(options, indent=4))

    side_path = ptc_data / MODELS_BY_TARGET
    side_text = json.dumps(models_by_target, indent=4) + "\n"
    result.models_by_target_changed = (not side_path.exists()) or side_path.read_text() != side_text
    if result.models_by_target_changed:
        side_path.write_text(side_text)
    return result


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    ptc_data = Path(args[0] if args else ".")
    try:
        hub_series = fetch_hub_series()
        result = patch_ptc_data(ptc_data, hub_series)
    except Exception as exc:
        sys.exit(f"patch_predtimechart_as_ofs: {exc}")

    for target, dates in result.available_as_ofs.items():
        print(f"{target}: {len(dates)} as_ofs, latest {dates[-1]}")
    if result.removed:
        print("removed: " + ", ".join(result.removed))
    if result.wrote:
        print(f"wrote {len(result.wrote)} target file(s)")
    if result.models_added:
        print("models added: " + ", ".join(result.models_added))
    if result.models_removed:
        print("models removed: " + ", ".join(result.models_removed))
    if result.models_by_target_changed:
        print(f"updated {MODELS_BY_TARGET}")
    if (
        not result.options_changed
        and not result.removed
        and not result.wrote
        and not result.models_by_target_changed
    ):
        print("no changes")


if __name__ == "__main__":
    main()
