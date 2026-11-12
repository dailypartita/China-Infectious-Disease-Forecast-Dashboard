#!/usr/bin/env python3
"""Unit tests for scripts/patch_predtimechart_as_ofs.py. No network."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import patch_predtimechart_as_ofs as patch


def _series(dates, values):
    return {"date": list(dates), "y": list(values)}


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=4))


def _options(**as_ofs):
    targets = list(as_ofs)
    return {
        "target_variables": [{"value": target, "text": target, "plot_text": target} for target in targets],
        "task_ids": {target: {"location": [{"value": "CN", "text": "China"}]} for target in targets},
        "available_as_ofs": {target: list(dates) for target, dates in as_ofs.items()},
        "initial_as_of": "2026-11-02",
        "current_date": "2026-11-02",
        "disclaimer": "keep me",
    }


class PatchAsOfTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.targets = self.root / "targets"
        self.forecasts = self.root / "forecasts"
        self.targets.mkdir()
        self.forecasts.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def _save_options(self, options):
        (self.root / "predtimechart-options.json").write_text(json.dumps(options, indent=4))

    def test_file_prefix_ignores_flu_hosp_template(self):
        prefixes = patch.file_prefixes(
            "wk inc flu prop ili",
            {"location": [{"value": "CN", "text": "China"}]},
        )
        self.assertEqual(prefixes, ["wk-inc-flu-prop-ili_CN_"])
        hosp = self.targets / "wk-inc-flu-hosp_01_2025-05-31.json"
        _write(hosp, _series(["2024-11-11"], [3.7]))
        found = patch.dates_for_prefix(self.targets, prefixes[0])
        self.assertEqual(found, {})
        self.assertTrue(hosp.exists())

    def test_flu_drops_fallback_and_stale_cdc_file(self):
        hub = {
            "2009-09-07": 31.6,
            "2024-11-11": 4.5,
            "2026-10-19": 12.0,
            "2026-10-26": 12.4,
        }
        options = _options(**{"wk inc flu prop ili": ["2009-09-07"]})
        self._save_options(options)
        stale = self.targets / "wk-inc-flu-prop-ili_CN_2026-10-19.json"
        current = self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json"
        _write(stale, _series(["2024-11-11", "2026-10-19"], [3.7, 14.7]))
        _write(current, _series(sorted(hub), [hub[d] for d in sorted(hub)]))
        hosp = self.targets / "wk-inc-flu-hosp_01_2025-05-31.json"
        _write(hosp, _series(["2024-11-11"], [3.7]))

        result = patch.patch_ptc_data(self.root, {"wk inc flu prop ili": hub})

        self.assertEqual(result.available_as_ofs["wk inc flu prop ili"], ["2026-11-02"])
        self.assertFalse(stale.exists())
        self.assertIn("wk-inc-flu-prop-ili_CN_2026-10-19.json", result.removed)
        self.assertTrue(current.exists())
        self.assertEqual(result.wrote, [])
        saved = json.loads(current.read_text())
        self.assertEqual(saved["y"][saved["date"].index("2024-11-11")], 4.5)
        self.assertEqual(saved["y"][0], 31.6)
        self.assertEqual(saved["date"][-1], "2026-10-26")
        self.assertTrue(hosp.exists())
        reloaded = json.loads((self.root / "predtimechart-options.json").read_text())
        self.assertEqual(reloaded["disclaimer"], "keep me")
        self.assertEqual(reloaded["current_date"], "2026-11-02")

    def test_flu_writes_missing_current_snapshot_from_hub(self):
        hub = {"2009-09-07": 31.6, "2024-11-11": 4.5, "2026-10-26": 12.4}
        options = _options(**{"wk inc flu prop ili": ["2009-09-07"]})
        self._save_options(options)
        stale = self.targets / "wk-inc-flu-prop-ili_CN_2026-10-19.json"
        _write(stale, _series(["2024-11-11"], [3.7]))

        result = patch.patch_ptc_data(self.root, {"wk inc flu prop ili": hub})

        current = self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json"
        self.assertTrue(current.exists())
        self.assertFalse(stale.exists())
        saved = json.loads(current.read_text())
        self.assertEqual(saved["date"], sorted(hub))
        self.assertEqual(saved["y"][saved["date"].index("2024-11-11")], 4.5)
        self.assertEqual(result.available_as_ofs["wk inc flu prop ili"], ["2026-11-02"])
        self.assertIn(current.name, result.wrote)

    def test_flu_keeps_matching_historical_prefix(self):
        hub = {"2009-09-07": 31.6, "2024-11-11": 4.5, "2026-10-26": 12.4}
        options = _options(**{"wk inc flu prop ili": ["2009-09-07"]})
        self._save_options(options)
        _write(
            self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json",
            _series(sorted(hub), [hub[d] for d in sorted(hub)]),
        )
        vintage = self.targets / "wk-inc-flu-prop-ili_CN_2024-11-18.json"
        _write(vintage, _series(["2009-09-07", "2024-11-11"], [31.6, 4.5]))

        result = patch.patch_ptc_data(self.root, {"wk inc flu prop ili": hub})

        self.assertEqual(
            result.available_as_ofs["wk inc flu prop ili"],
            ["2024-11-18", "2026-11-02"],
        )
        self.assertTrue(vintage.exists())

    def test_dengue_lists_real_files_through_current_date_only(self):
        target = "mo inc dengue cases"
        options = _options(**{target: ["2009-09-07"]})
        self._save_options(options)
        for date, last in (
            ("2009-09-07", "2009-09-01"),
            ("2026-11-02", "2026-09-01"),
            ("2027-01-04", "2026-09-01"),
        ):
            _write(
                self.targets / f"mo-inc-dengue-cases_CN_{date}.json",
                _series(["2004-01-01", last], [1, 2]),
            )

        result = patch.patch_ptc_data(self.root, {})

        self.assertEqual(result.available_as_ofs[target], ["2009-09-07", "2026-11-02"])
        self.assertTrue((self.targets / "mo-inc-dengue-cases_CN_2027-01-04.json").exists())
        self.assertEqual(result.removed, [])

    def test_covid_keeps_forecast_weeks_and_backfills_missing_truth(self):
        target = "wk inc covid prop ili"
        hub = {
            "2022-12-05": 9.7,
            "2025-10-06": 2.3,
            "2025-10-13": 2.1,
            "2025-10-20": 2.0,
            "2026-10-26": 1.3,
        }
        # current_date 2026-11-02 is the reference date, after the latest
        # observation week. A missing current snapshot still includes every
        # observation <= that date.
        listed = ["2025-10-06", "2025-10-13", "2025-10-20", "2026-11-02"]
        options = _options(**{target: listed})
        self._save_options(options)
        for date in listed:
            (self.forecasts / f"wk-inc-covid-prop-ili_CN_{date}.json").write_text("{}\n")
        # Retired-model forecast that the generator correctly omitted.
        (self.forecasts / "wk-inc-covid-prop-ili_CN_2025-08-21.json").write_text("{}\n")
        existing = self.targets / "wk-inc-covid-prop-ili_CN_2025-10-06.json"
        original = _series(["2022-12-05", "2025-10-06"], [9.7, 2.3])
        _write(existing, original)
        extra = self.targets / "wk-inc-covid-prop-ili_CN_2025-08-21.json"
        _write(extra, _series(["2022-12-05"], [9.7]))
        hosp = self.targets / "wk-inc-flu-hosp_US_2025-05-31.json"
        _write(hosp, _series(["2024-01-06"], [10]))

        result = patch.patch_ptc_data(self.root, {target: hub})

        self.assertEqual(result.available_as_ofs[target], listed)
        self.assertEqual(json.loads(existing.read_text()), original)
        self.assertNotIn(existing.name, result.wrote)
        filled = json.loads((self.targets / "wk-inc-covid-prop-ili_CN_2025-10-20.json").read_text())
        self.assertEqual(filled["date"][-1], "2025-10-20")
        self.assertNotIn("2026-11-02", filled["date"])
        self.assertEqual(filled["y"][filled["date"].index("2025-10-20")], 2.0)
        current = json.loads((self.targets / "wk-inc-covid-prop-ili_CN_2026-11-02.json").read_text())
        self.assertEqual(current["date"][-1], "2026-10-26")
        self.assertEqual(current["y"][-1], 1.3)
        self.assertNotIn("2026-11-02", current["date"])
        self.assertTrue(extra.exists())
        self.assertTrue(hosp.exists())
        self.assertNotIn("2025-08-21", result.available_as_ofs[target])

    def test_second_run_is_a_no_op(self):
        hub = {"2009-09-07": 31.6, "2026-10-26": 12.4}
        flu = "wk inc flu prop ili"
        dengue = "mo inc dengue cases"
        options = _options(**{flu: ["2009-09-07"], dengue: ["2009-09-07"]})
        self._save_options(options)
        _write(
            self.targets / "mo-inc-dengue-cases_CN_2009-09-07.json",
            _series(["2004-01-01"], [3]),
        )
        _write(
            self.targets / "mo-inc-dengue-cases_CN_2026-11-02.json",
            _series(["2004-01-01", "2026-09-01"], [3, 9]),
        )
        first = patch.patch_ptc_data(self.root, {flu: hub})
        self.assertTrue(first.options_changed)
        options_bytes = (self.root / "predtimechart-options.json").read_bytes()
        flu_bytes = (self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json").read_bytes()

        second = patch.patch_ptc_data(self.root, {flu: hub})

        self.assertFalse(second.options_changed)
        self.assertEqual(second.removed, [])
        self.assertEqual(second.wrote, [])
        self.assertEqual((self.root / "predtimechart-options.json").read_bytes(), options_bytes)
        self.assertEqual((self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json").read_bytes(), flu_bytes)
        self.assertEqual(second.available_as_ofs[flu], ["2026-11-02"])
        self.assertEqual(second.available_as_ofs[dengue], ["2009-09-07", "2026-11-02"])


if __name__ == "__main__":
    unittest.main()
