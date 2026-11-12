<div align="center">

# 中国传染病预测中心 Dashboard

[English](README.md) | **中文**

</div>

基于 [Hubverse](https://hubverse.io/) 框架构建的交互式预测与评估平台，用于展示和比较中国三个传染病预测目标的多模型概率预测结果：中国疾控中心哨点监测中门急诊 ILI 病例的 SARS-CoV-2 周度阳性率、国家流感中心（CNIC）每周流感监测报告中全国流感监测网络 ILI 标本的实验室阳性率，以及全国法定传染病报告中的登革热月度病例数。

**在线访问：** [dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/)

**数据来源：** [China-Infectious-Disease-Forecast-Hub](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub)

## 平台功能

### 预测可视化（Forecasts）

- **监测指标：** 中国疾控中心哨点监测中门急诊流感样病例（ILI）的 SARS-CoV-2 周度阳性率，以及国家流感中心（CNIC）每周流感监测报告中全国 ILI 标本实验室阳性率（预测页可切换）；月度登革热报告病例数（图表展示后续支持）
- **概率预测：** 23 分位数完整预测分布，支持 95% 置信区间展示
- **交互能力：** 参考日期切换、模型显隐、置信区间调整、键盘导航

### 模型评估（Evaluation）

- **评估指标：** WIS、AE median、95% 区间覆盖率（绝对分数），覆盖新冠与 CNIC 流感两个周频阳性率 target
- **对比方式：** Table 综合排名与 Plot 热力图双视图

### 数据获取

原始预测数据、目标数据及 Hub 配置可通过 [数据获取页面](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/data.html) 或 Forecast Hub 仓库直接访问。

## 参与模型

当前活跃模型（7 个）：

| 团队 | 模型 |
|------|------|
| GZNL | NextWave（新冠阳性率周期演变 / 下一波情景预测） |
| XMU_CTModelling | FNN, LSTM, XGBoost, GRU, TCN |
| MUST | SEIRS |

最新排名与详细指标请查看 Dashboard [Evaluation 页面](https://dailypartita.github.io/China-Infectious-Disease-Forecast-Dashboard/eval.html)。

## 数据更新

| 环节 | 时间 |
|------|------|
| CDC 哨点监测报告发布（新冠） | 每周（通常周三） |
| 国家流感中心流感周报 | 每周 |
| 模型预测提交截止 | 每周三 23:59（北京时间） |
| Hub 目标数据同步 | 周五 08:00 UTC / 周日 08:00 UTC（Hub `sync-target-data.yaml`） |
| Dashboard 数据更新 | 周五 14:00 UTC / 周日 14:00 UTC（自动；`regenerate` 自动判定——仅当 Hub 观测推进时全量重建；在 Hub 同步之后 + GitHub Actions 延迟缓冲） |

监测数据来源：新冠来自中国疾控中心[《全国急性呼吸道传染病哨点监测情况》](https://www.chinacdc.cn/jksj/jksj04_14275/)（门急诊 ILI 核酸阳性率），流感来自[国家流感中心每周流感监测报告](https://ivdc.chinacdc.cn/cnic/zyzx/lgzb/)（全国流感监测网络 ILI 标本实验室阳性率），登革热来自中国疾控中心[《法定传染病疫情概况》](https://www.chinacdc.cn/jksj/jksj01/)。结构化数据库：[cn_cdc_dashboard](https://github.com/dailypartita/cn_cdc_dashboard)。

**手动刷新 Target**：自 2026-11-03 起，Rebuild Data 会**自动检测观测滞后**——每次运行先比较 Hub `time-series.csv` 的最新观测周与 `ptc/data` 最新 as-of 快照，Hub 更新时自动以 `regenerate=true` 全量重建，新观测周不再需要人工干预。仅当 Hub **修订了已发布周的历史数值**（最新周没变）时，才需在 Actions → **Rebuild Data** 把 `regenerate` 选为 `true`、`data=target`（或 `both`）强制重写已有 as-of JSON（`false` 为强制跳过已存在文件；默认 `auto`）。

Rebuild Data 本身不会改正 PredTimeChart 的 `available_as_ofs`。它成功结束后，**Patch dengue truth and as-of options**（`.github/workflows/dengue-truth.yaml`）会按 `ptc/data` 上真实的 target JSON 重写每个目标的 as-of 列表。该工作流也会在 Rebuild Data 成功时自动启动，并在周五 17:00 UTC 再跑一次。若要立刻生效，在 Actions 里手动运行 **Patch dengue truth and as-of options**（workflow_dispatch）。在这次运行完成之前，流感和登革热仍可能显示 `2009-09-07` 这个回退日期。

## 技术架构

| 组件 | 说明 |
|------|------|
| 框架 | [Hubverse Dashboard](https://docs.hubverse.io/en/latest/user-guide/dashboards.html) |
| 前端 | Quarto + Bootstrap |
| 可视化 | PredTimeChart（预测）、PredEvals（评估） |
| 部署 | GitHub Actions → GitHub Pages |

### 配置文件

- [`site-config.yml`](site-config.yml) — 站点基本配置
- [`predtimechart-config.yml`](predtimechart-config.yml) — 预测图表配置
- [`predevals-config.yml`](predevals-config.yml) — 模型评估配置

### 自动化工作流

- **Rebuild Site**（`build-site.yaml`）— 构建并部署静态站点至 `gh-pages` 分支
- **Rebuild Data**（`build-data.yaml`）— 从 Hub 拉取数据，更新预测与评估数据分支

## 参与贡献

### 提交预测模型

1. 在 [Forecast Hub](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub) 注册模型元数据
2. 按 Hubverse 标准格式提交 23 分位数概率预测（CSV）
3. 每周三 23:59 前完成当周预测提交

### 自定义 Dashboard

- 修改 `predevals-config.yml` 调整评估指标与评估集
- 修改 `predtimechart-config.yml` 调整可视化默认选项
- 在 `pages/` 目录添加自定义页面

## 相关链接

- [Forecast Hub 仓库](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Hub)
- [Dashboard Issues](https://github.com/dailypartita/China-Infectious-Disease-Forecast-Dashboard/issues)
- [Hubverse 文档](https://docs.hubverse.io/)

## 许可证

详见 [LICENSE](LICENSE) 文件。
