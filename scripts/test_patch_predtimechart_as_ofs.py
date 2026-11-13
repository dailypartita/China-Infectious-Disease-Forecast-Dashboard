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

    def test_flu_forecast_keeps_earlier_target_snapshot(self):
        # Rebuild Data lists only the forecast reference date. The previous
        # current snapshot is still a real CNIC file and must stay selectable.
        hub = {"2009-09-07": 31.6, "2026-10-26": 12.4}
        flu = "wk inc flu prop ili"
        options = _options(**{flu: ["2026-11-09"]})
        options["current_date"] = "2026-11-09"
        options["initial_as_of"] = "2026-11-09"
        self._save_options(options)
        series = _series(sorted(hub), [hub[d] for d in sorted(hub)])
        _write(self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json", series)
        _write(self.targets / "wk-inc-flu-prop-ili_CN_2026-11-09.json", series)
        (self.forecasts / "wk-inc-flu-prop-ili_CN_2026-11-09.json").write_text(
            '{"GZNL-FluLGBMCQR": {}}\n'
        )

        result = patch.patch_ptc_data(self.root, {flu: hub}, metadata_exists=lambda model: False)

        self.assertEqual(
            result.available_as_ofs[flu],
            ["2026-11-02", "2026-11-09"],
        )

    def test_dengue_forecast_keeps_history_through_current_date(self):
        target = "mo inc dengue cases"
        options = _options(**{target: ["2026-11-01"]})
        options["current_date"] = "2026-11-09"
        self._save_options(options)
        for date in ("2009-09-07", "2026-11-01", "2026-11-02", "2027-01-04"):
            _write(
                self.targets / f"mo-inc-dengue-cases_CN_{date}.json",
                _series(["2004-01-01"], [1]),
            )
        (self.forecasts / "mo-inc-dengue-cases_CN_2026-11-01.json").write_text(
            '{"GZNL-DengueLGBMCQR": {}}\n'
        )

        result = patch.patch_ptc_data(self.root, {}, metadata_exists=lambda model: False)

        self.assertEqual(
            result.available_as_ofs[target],
            ["2009-09-07", "2026-11-01", "2026-11-02"],
        )
        self.assertTrue((self.targets / "mo-inc-dengue-cases_CN_2027-01-04.json").exists())

    def test_models_union_keeps_existing_and_skips_hosp_templates(self):
        flu = "wk inc flu prop ili"
        dengue = "mo inc dengue cases"
        covid = "wk inc covid prop ili"
        options = _options(**{flu: ["2026-11-09"], dengue: ["2026-11-01"], covid: ["2026-11-02"]})
        options["current_date"] = "2026-11-09"
        options["models"] = ["GZNL-NextWave", "GZNL-VincentAvg"]
        options["initial_checked_models"] = ["GZNL-NextWave"]
        options["model_urls"] = {
            "GZNL-NextWave": "https://example.test/GZNL-NextWave.yaml",
        }
        self._save_options(options)
        hub = {"2026-10-26": 12.4}
        series = _series(["2026-10-26"], [12.4])
        _write(self.targets / "wk-inc-flu-prop-ili_CN_2026-11-09.json", series)
        _write(self.targets / "wk-inc-covid-prop-ili_CN_2026-11-02.json", _series(["2026-10-26"], [1.0]))
        _write(
            self.targets / "mo-inc-dengue-cases_CN_2026-11-01.json",
            _series(["2004-01-01"], [3]),
        )
        (self.forecasts / "wk-inc-covid-prop-ili_CN_2026-11-02.json").write_text(
            '{"GZNL-NextWave": {}, "NoMetaModel": {}}\n'
        )
        (self.forecasts / "wk-inc-flu-prop-ili_CN_2026-11-09.json").write_text(
            '{"GZNL-FluLGBMCQR": {}}\n'
        )
        (self.forecasts / "mo-inc-dengue-cases_CN_2026-11-01.json").write_text(
            '{"GZNL-DengueLGBMCQR": {}}\n'
        )
        hosp = self.forecasts / "wk-inc-flu-hosp_US_2025-05-31.json"
        hosp.write_text('{"FluSight-baseline": {}}\n')
        registered = [
            "GZNL-DengueLGBMCQR",
            "GZNL-FluLGBMCQR",
            "GZNL-NextWave",
            "GZNL-VincentAvg",
        ]

        result = patch.patch_ptc_data(
            self.root,
            {flu: hub, covid: {"2026-10-26": 1.0}},
            metadata_exists=lambda model: model in registered,
        )

        self.assertEqual(
            result.models,
            [
                "GZNL-NextWave",
                "GZNL-VincentAvg",
                "GZNL-DengueLGBMCQR",
                "GZNL-FluLGBMCQR",
            ],
        )
        self.assertEqual(
            result.models_added,
            ["GZNL-DengueLGBMCQR", "GZNL-FluLGBMCQR"],
        )
        self.assertEqual(result.models_removed, [])
        saved = json.loads((self.root / "predtimechart-options.json").read_text())
        self.assertEqual(saved["initial_checked_models"], ["GZNL-NextWave"])
        self.assertEqual(
            saved["model_urls"]["GZNL-NextWave"],
            "https://example.test/GZNL-NextWave.yaml",
        )
        self.assertEqual(
            saved["model_urls"]["GZNL-VincentAvg"],
            "https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub/blob/main/model-metadata/GZNL-VincentAvg.yaml",
        )
        self.assertEqual(
            saved["model_urls"]["GZNL-FluLGBMCQR"],
            "https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub/blob/main/model-metadata/GZNL-FluLGBMCQR.yaml",
        )
        self.assertEqual(
            saved["model_urls"]["GZNL-DengueLGBMCQR"],
            "https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub/blob/main/model-metadata/GZNL-DengueLGBMCQR.yaml",
        )
        self.assertNotIn("NoMetaModel", saved["models"])
        self.assertNotIn("NoMetaModel", saved["model_urls"])
        self.assertNotIn("FluSight-baseline", saved["models"])
        self.assertTrue(hosp.exists())
        # VincentAvg is registered but has no forecast for these targets, so
        # it stays in the global list and out of every target picker.
        self.assertEqual(
            result.models_by_target,
            {
                flu: ["GZNL-FluLGBMCQR"],
                dengue: ["GZNL-DengueLGBMCQR"],
                covid: ["GZNL-NextWave"],
            },
        )
        side = json.loads((self.root / "models-by-target.json").read_text())
        self.assertEqual(side, result.models_by_target)
        self.assertNotIn("models_by_target", saved)

        options_bytes = (self.root / "predtimechart-options.json").read_bytes()
        side_bytes = (self.root / "models-by-target.json").read_bytes()
        second = patch.patch_ptc_data(
            self.root,
            {flu: hub, covid: {"2026-10-26": 1.0}},
            metadata_exists=lambda model: model in registered,
        )
        self.assertFalse(second.options_changed)
        self.assertFalse(second.models_by_target_changed)
        self.assertEqual(second.models_added, [])
        self.assertEqual(second.models_removed, [])
        self.assertEqual((self.root / "predtimechart-options.json").read_bytes(), options_bytes)
        self.assertEqual((self.root / "models-by-target.json").read_bytes(), side_bytes)

    def test_refuses_to_drop_checked_model_without_metadata(self):
        flu = "wk inc flu prop ili"
        options = _options(**{flu: ["2026-11-09"]})
        options["current_date"] = "2026-11-09"
        options["initial_as_of"] = "2026-11-09"
        options["models"] = ["GZNL-NextWave"]
        options["initial_checked_models"] = ["GZNL-NextWave"]
        self._save_options(options)
        before = (self.root / "predtimechart-options.json").read_bytes()
        hub = {"2026-10-26": 12.4}
        _write(
            self.targets / "wk-inc-flu-prop-ili_CN_2026-11-09.json",
            _series(["2026-10-26"], [12.4]),
        )

        with self.assertRaises(RuntimeError) as caught:
            patch.patch_ptc_data(self.root, {flu: hub}, metadata_exists=lambda model: False)

        self.assertIn("GZNL-NextWave", str(caught.exception))
        self.assertEqual((self.root / "predtimechart-options.json").read_bytes(), before)
        self.assertFalse((self.root / "models-by-target.json").exists())

    def test_live_model_sets_drop_unregistered_and_split_by_target(self):
        """Snapshot of Hub model-metadata and ptc/data forecasts on 2026-11-12.

        Hub ``model-metadata/`` has the 16 registered yaml files and no files
        for the six deleted test models. COVID forecast JSON still contains
        those six. Flu forecast JSON contains only GZNL-FluLGBMCQR. Dengue
        forecast JSON contains only GZNL-DengueLGBMCQR. ``wk-inc-flu-hosp_*``
        is ignored. As-of dates stay on the snapshots this fixture publishes.
        """
        covid = "wk inc covid prop ili"
        flu = "wk inc flu prop ili"
        dengue = "mo inc dengue cases"
        registered = [
            "CNCovidHub-ensemble",
            "GZNL-DengueLGBMCQR",
            "GZNL-FluLGBMCQR",
            "GZNL-NextWave",
            "GZNL-VincentAvg",
            "LZU-ASVENKF",
            "LZU-LES",
            "LZU-Sentinel",
            "LZU-SetPredict",
            "LZU-SinglePoint",
            "MUST-SEIRS",
            "XMU_CTModelling-FNN",
            "XMU_CTModelling-GRU",
            "XMU_CTModelling-LSTM",
            "XMU_CTModelling-TCN",
            "XMU_CTModelling-XGBoost",
        ]
        deleted = [
            "GZNL-ExponentialSmoothing",
            "GZNL-SimpleTrend",
            "GZNL-test_001",
            "GZNL-test_002",
            "GZNL-test_003",
            "GZNL-test_004",
        ]
        # Order currently published on ptc/data.
        existing = [
            "CNCovidHub-ensemble",
            "GZNL-NextWave",
            "LZU-Sentinel",
            "MUST-SEIRS",
            "XMU_CTModelling-FNN",
            "XMU_CTModelling-GRU",
            "XMU_CTModelling-LSTM",
            "XMU_CTModelling-TCN",
            "XMU_CTModelling-XGBoost",
            "GZNL-VincentAvg",
            "GZNL-DengueLGBMCQR",
            "GZNL-ExponentialSmoothing",
            "GZNL-FluLGBMCQR",
            "GZNL-SimpleTrend",
            "GZNL-test_001",
            "GZNL-test_002",
            "GZNL-test_003",
            "GZNL-test_004",
            "LZU-ASVENKF",
            "LZU-LES",
            "LZU-SetPredict",
            "LZU-SinglePoint",
        ]
        checked = [
            "CNCovidHub-ensemble",
            "GZNL-NextWave",
            "XMU_CTModelling-FNN",
            "XMU_CTModelling-LSTM",
            "XMU_CTModelling-XGBoost",
            "XMU_CTModelling-GRU",
            "XMU_CTModelling-TCN",
            "MUST-SEIRS",
            "LZU-Sentinel",
        ]
        covid_forecast_models = [
            "CNCovidHub-ensemble",
            "GZNL-ExponentialSmoothing",
            "GZNL-NextWave",
            "GZNL-SimpleTrend",
            "GZNL-VincentAvg",
            "GZNL-test_001",
            "GZNL-test_002",
            "GZNL-test_003",
            "GZNL-test_004",
            "LZU-ASVENKF",
            "LZU-LES",
            "LZU-Sentinel",
            "LZU-SetPredict",
            "LZU-SinglePoint",
            "MUST-SEIRS",
            "XMU_CTModelling-FNN",
            "XMU_CTModelling-GRU",
            "XMU_CTModelling-LSTM",
            "XMU_CTModelling-TCN",
            "XMU_CTModelling-XGBoost",
        ]
        options = _options(**{
            covid: ["2026-11-02"],
            flu: ["2026-11-02", "2026-11-09"],
            dengue: ["2009-09-07", "2026-11-01", "2026-11-02"],
        })
        options["current_date"] = "2026-11-09"
        options["initial_as_of"] = "2026-11-09"
        options["models"] = list(existing)
        options["initial_checked_models"] = list(checked)
        options["model_urls"] = {
            model: f"https://example.test/{model}.yaml"
            for model in existing
            if model not in deleted
        }
        self._save_options(options)
        hub_flu = {"2026-10-26": 12.4}
        hub_covid = {"2026-10-26": 1.3}
        flu_series = _series(["2026-10-26"], [12.4])
        _write(self.targets / "wk-inc-covid-prop-ili_CN_2026-11-02.json", _series(["2026-10-26"], [1.3]))
        _write(self.targets / "wk-inc-flu-prop-ili_CN_2026-11-02.json", flu_series)
        _write(self.targets / "wk-inc-flu-prop-ili_CN_2026-11-09.json", flu_series)
        for date in ("2009-09-07", "2026-11-01", "2026-11-02"):
            _write(
                self.targets / f"mo-inc-dengue-cases_CN_{date}.json",
                _series(["2004-01-01"], [3]),
            )
        # A later dengue snapshot stays on disk and stays out of the as-of list.
        _write(
            self.targets / "mo-inc-dengue-cases_CN_2027-01-04.json",
            _series(["2004-01-01"], [3]),
        )
        (self.forecasts / "wk-inc-covid-prop-ili_CN_2026-11-02.json").write_text(
            json.dumps({model: {} for model in covid_forecast_models}) + "\n"
        )
        # Same deleted ids in an older COVID file, which must not bring them back.
        (self.forecasts / "wk-inc-covid-prop-ili_CN_2025-08-21.json").write_text(
            json.dumps({model: {} for model in deleted}) + "\n"
        )
        (self.forecasts / "wk-inc-flu-prop-ili_CN_2026-11-09.json").write_text(
            '{"GZNL-FluLGBMCQR": {}}\n'
        )
        (self.forecasts / "mo-inc-dengue-cases_CN_2026-11-01.json").write_text(
            '{"GZNL-DengueLGBMCQR": {}}\n'
        )
        hosp = self.forecasts / "wk-inc-flu-hosp_US_2025-05-31.json"
        hosp.write_text('{"FluSight-baseline": {}}\n')

        result = patch.patch_ptc_data(
            self.root,
            {covid: hub_covid, flu: hub_flu},
            metadata_exists=lambda model: model in registered,
        )

        self.assertEqual(
            result.available_as_ofs[covid],
            ["2026-11-02"],
        )
        self.assertEqual(
            result.available_as_ofs[flu],
            ["2026-11-02", "2026-11-09"],
        )
        self.assertEqual(
            result.available_as_ofs[dengue],
            ["2009-09-07", "2026-11-01", "2026-11-02"],
        )
        self.assertTrue((self.targets / "mo-inc-dengue-cases_CN_2027-01-04.json").exists())
        self.assertTrue((self.forecasts / "wk-inc-covid-prop-ili_CN_2025-08-21.json").exists())
        self.assertTrue(hosp.exists())
        kept = [model for model in existing if model not in deleted]
        self.assertEqual(result.models, kept)
        self.assertEqual(result.models_removed, deleted)
        self.assertEqual(result.models_added, [])
        saved = json.loads((self.root / "predtimechart-options.json").read_text())
        self.assertEqual(saved["initial_checked_models"], checked)
        self.assertEqual(saved["current_date"], "2026-11-09")
        self.assertEqual(saved["initial_as_of"], "2026-11-09")
        self.assertEqual(sorted(saved["model_urls"]), registered)
        for model in deleted:
            self.assertNotIn(model, saved["models"])
            self.assertNotIn(model, saved["model_urls"])
        self.assertEqual(
            saved["model_urls"]["GZNL-NextWave"],
            "https://example.test/GZNL-NextWave.yaml",
        )
        covid_picker = [model for model in kept if model not in ("GZNL-DengueLGBMCQR", "GZNL-FluLGBMCQR")]
        self.assertEqual(
            result.models_by_target,
            {
                covid: covid_picker,
                flu: ["GZNL-FluLGBMCQR"],
                dengue: ["GZNL-DengueLGBMCQR"],
            },
        )
        self.assertNotIn("GZNL-DengueLGBMCQR", result.models_by_target[covid])
        self.assertNotIn("GZNL-FluLGBMCQR", result.models_by_target[covid])
        self.assertNotIn("CNCovidHub-ensemble", result.models_by_target[dengue])
        self.assertNotIn("GZNL-NextWave", result.models_by_target[flu])
        for model in deleted:
            for names in result.models_by_target.values():
                self.assertNotIn(model, names)
        side = json.loads((self.root / "models-by-target.json").read_text())
        self.assertEqual(side, result.models_by_target)
        self.assertNotIn("models_by_target", saved)

        options_bytes = (self.root / "predtimechart-options.json").read_bytes()
        side_bytes = (self.root / "models-by-target.json").read_bytes()
        second = patch.patch_ptc_data(
            self.root,
            {covid: hub_covid, flu: hub_flu},
            metadata_exists=lambda model: model in registered,
        )
        self.assertFalse(second.options_changed)
        self.assertFalse(second.models_by_target_changed)
        self.assertEqual(second.models_removed, [])
        self.assertEqual((self.root / "predtimechart-options.json").read_bytes(), options_bytes)
        self.assertEqual((self.root / "models-by-target.json").read_bytes(), side_bytes)


if __name__ == "__main__":
    unittest.main()
