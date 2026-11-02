#!/usr/bin/env python3
"""Generate dengue truth JSON files for the predtimechart forecast app.

Upstream hub-dashboard-predtimechart only writes target (truth) JSONs at the
*global* max as_of across targets. Dengue uses monthly reference dates
(month starts), which never coincide with the weekly global max, so the
upstream build never produces dengue truth files. This script fills the gap:

- targets/mo-inc-dengue-cases_CN_<as_of>.json for every monthly as_of from
  the hub's tasks.json, each truncated to observations <= as_of
- the same file named with the current global max as_of (taken from the
  latest covid truth file), so the app's default view shows dengue truth

Runs against a local checkout of the ptc/data branch. Idempotent.
"""

import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

HUB = "dailypartita/China-Infectious-Disease-Forecast-Hub"
TS_URL = f"https://raw.githubusercontent.com/{HUB}/main/target-data/time-series.csv"
TASKS_URL = f"https://raw.githubusercontent.com/{HUB}/main/hub-config/tasks.json"
TARGET = "mo inc dengue cases"
TARGET_PREFIX = "mo-inc-dengue-cases_CN_"
COVID_PREFIX = "wk-inc-covid-prop-ili_CN_"


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read().decode("utf-8")


def load_dengue_rows() -> list[tuple[str, float]]:
    rows = []
    for row in csv.DictReader(fetch(TS_URL).splitlines()):
        if row["target"] == TARGET:
            rows.append((row["target_end_date"], float(row["observation"])))
    rows.sort()
    if not rows:
        sys.exit("no dengue rows in hub time-series.csv")
    return rows


def monthly_as_ofs() -> list[str]:
    tasks = json.loads(fetch(TASKS_URL))
    for model_task in tasks["rounds"][0]["model_tasks"]:
        targets = model_task["task_ids"]["target"]["optional"] or []
        if TARGET in targets:
            return model_task["task_ids"]["reference_date"]["optional"]
    sys.exit("dengue model_task not found in round 0 of tasks.json")


def global_max_as_of(targets_dir: Path) -> str | None:
    dates = []
    for path in targets_dir.glob(f"{COVID_PREFIX}*.json"):
        m = re.search(r"(\d{4}-\d{2}-\d{2})\.json$", path.name)
        if m:
            dates.append(m.group(1))
    return max(dates) if dates else None


def main() -> None:
    ptc_data = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    targets_dir = ptc_data / "targets"
    targets_dir.mkdir(exist_ok=True)

    rows = load_dengue_rows()
    as_ofs = set(monthly_as_ofs())
    gmax = global_max_as_of(targets_dir)
    if gmax:
        as_ofs.add(gmax)

    written = 0
    for as_of in sorted(as_ofs):
        series = [(d, v) for d, v in rows if d <= as_of]
        if not series:
            continue
        payload = {
            "date": [d for d, _ in series],
            "y": [int(v) if v == int(v) else v for _, v in series],
        }
        text = json.dumps(payload, indent=4) + "\n"
        path = targets_dir / f"{TARGET_PREFIX}{as_of}.json"
        if not path.exists() or path.read_text() != text:
            path.write_text(text)
            written += 1
            print(f"wrote {path.name} ({len(series)} obs)")

    print(f"done: {written} file(s) written, {len(as_ofs)} as_ofs considered")


if __name__ == "__main__":
    main()
