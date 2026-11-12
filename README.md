<div align="center">

# China Infectious Disease Forecast Hub Dashboard

**English** | [中文](README.zh.md)

</div>

Interactive forecasting and evaluation platform built on the [Hubverse](https://hubverse.io/) framework. Displays and compares multi-model probabilistic forecasts of three infectious-disease targets in China: the weekly SARS-CoV-2 positivity rate among influenza-like illness (ILI) cases from China CDC sentinel surveillance, the national laboratory positivity rate of ILI specimens from the China National Influenza Center (CNIC) weekly influenza surveillance report, and monthly reported dengue cases from national notifiable disease surveillance.

**Live site:** [dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/)

**Data source:** [China-Infectious-Disease-Forecast-Hub](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub)

## Features

### Forecasts

- **Targets:** Weekly SARS-CoV-2 positivity among ILI cases from China CDC national sentinel surveillance, and the CNIC national laboratory positivity rate of ILI specimens (switchable on the forecast page); monthly reported dengue cases (chart support planned)
- **Probabilistic output:** 23-quantile distributions with 95% prediction intervals
- **Interactivity:** Reference date selection, model toggles, interval levels, keyboard navigation

### Evaluation

- **Metrics:** WIS, AE median, 95% interval coverage (absolute scores) for the weekly SARS-CoV-2 and CNIC influenza positivity targets
- **Views:** Table rankings and Plot heatmaps

### Data Access

Raw forecasts, target data, and Hub configuration are available via the [data page](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/data.html) or the Forecast Hub repository.

## Active Models

| Team | Models |
|------|--------|
| GZNL | NextWave |
| XMU_CTModelling | FNN, LSTM, XGBoost, GRU, TCN |
| MUST | SEIRS |

See the [Evaluation page](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/eval.html) for latest rankings.

## Data Updates

| Step | Schedule |
|------|----------|
| CDC sentinel report (COVID) | Weekly (typically Wednesday) |
| CNIC influenza surveillance report | Weekly |
| Forecast submission deadline | Wednesday 23:59 Beijing time |
| Hub target-data sync | Friday 08:00 UTC / Sunday 08:00 UTC (Hub `sync-target-data.yaml`) |
| Dashboard data refresh | Friday 14:00 UTC / Sunday 14:00 UTC (automated; `regenerate` auto-detected — full as-of rebuild only when Hub observations advance; after Hub sync + GitHub Actions delay buffer) |

Target data: COVID from [China CDC sentinel surveillance](https://www.chinacdc.cn/jksj/jksj04_14275/) (weekly outpatient ILI nucleic-acid positivity), influenza from the [China National Influenza Center weekly influenza surveillance report](https://ivdc.chinacdc.cn/cnic/zyzx/lgzb/) (national laboratory positivity of ILI specimens), and dengue from [China CDC notifiable disease reports](https://www.chinacdc.cn/jksj/jksj01/). Structured data source: [cn_cdc_dashboard](https://github.com/dailypartita/cn_cdc_dashboard).

**Manual target refresh**: since 2026-11-03 Rebuild Data **auto-detects stale truth** — every run compares the latest observation week in Hub `time-series.csv` against the newest as-of snapshot on `ptc/data`, and rebuilds with `regenerate=true` automatically when the Hub is newer, so new observation weeks no longer need a manual run. Only if the Hub **revised values for an already-published week** (latest week unchanged) should you run Actions → **Rebuild Data** with `regenerate=true` and `data=target` (or `both`) to force-rewrite existing as-of JSON files (`false` forces the skip-existing behavior; default is `auto`).

Rebuild Data does not itself fix PredTimeChart `available_as_ofs`. After it succeeds, **Patch dengue truth and as-of options** (`.github/workflows/dengue-truth.yaml`) rewrites each target's as-of list from the target JSON files on `ptc/data`. That workflow also starts on its own when Rebuild Data completes, and again on Friday 17:00 UTC. To apply it immediately, run Actions → **Patch dengue truth and as-of options** (workflow_dispatch). Until that run finishes, flu and dengue can still show the `2009-09-07` fallback.

## Architecture

| Component | Description |
|-----------|-------------|
| Framework | [Hubverse Dashboard](https://docs.hubverse.io/en/latest/user-guide/dashboards.html) |
| Frontend | Quarto + Bootstrap |
| Visualization | PredTimeChart, PredEvals |
| Deployment | GitHub Actions → GitHub Pages |

### Configuration

- [`site-config.yml`](site-config.yml) — site settings
- [`predtimechart-config.yml`](predtimechart-config.yml) — forecast chart config
- [`predevals-config.yml`](predevals-config.yml) — evaluation config

### Workflows

- **Rebuild Site** (`build-site.yaml`) — build and deploy to `gh-pages`
- **Rebuild Data** (`build-data.yaml`) — sync forecast and evaluation data from Hub

## Contributing

### Submit forecasts

1. Register model metadata in the [Forecast Hub](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub)
2. Submit 23-quantile probabilistic forecasts (CSV) in Hubverse format
3. Complete weekly submissions by Wednesday 23:59 Beijing time

### Customize dashboard

- Edit `predevals-config.yml` for evaluation settings
- Edit `predtimechart-config.yml` for visualization defaults
- Add pages under `pages/`

## Links

- [Forecast Hub](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub)
- [Dashboard Issues](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Dashboard/issues)
- [Hubverse docs](https://docs.hubverse.io/)

## License

See [LICENSE](LICENSE).
