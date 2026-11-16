// PredTimeChart v3 keeps the current xaxis and yaxis ranges across updates,
// so switching Outcome leaves the previous pathogen's window in place.
// Forecasts that sit past that right edge (dengue months beyond a weekly
// COVID window) are clipped, and long truth series (flu from 2009, dengue
// from 2004) would squeeze the latest forecasts if the axis autoranged.
// After each fetch we set a tight window: a short recent history on the
// left, and the full latest forecast horizon plus one interval of padding
// on the right. Dengue case counts use a default y-axis of 0-30,000 so a
// quiet recent season is not auto-zoomed to a few dozen cases. COVID and
// flu positivity autorange, including after leaving the dengue scale.
// Chart titles and the disclaimer above the plot are set per Outcome so
// the three pathogen views are distinct. If the current as-of has no
// forecast file, we probe recent as-of dates for that Outcome in both
// directions (not only earlier ones) and jump to the latest date that
// has forecasts. This matters after leaving dengue's 2026-11-01 as-of
// for flu, whose only forecast file is 2026-11-09. A first-load ?xaxis_range= or
// ?yaxis_range= share link is honored once on that axis; later Outcome or
// as-of changes still refocus. Manual zoom is kept until then. Season
// mode is left to PredTimeChart. The site builder overwrites
// predtimechart.js, so this hook lives here.

var FORECAST_WINDOW_WEEKLY_HISTORY_DAYS = 364; // 52 weeks
var FORECAST_WINDOW_MONTHLY_HISTORY_MONTHS = 24;
var FORECAST_ASOF_PROBE_LIMIT = 24;
var DENGUE_TARGET = "mo inc dengue cases";
var DENGUE_YAXIS_RANGE = [0, 30000];
var CHART_LABELS = {
    "wk inc covid prop ili": {
        title: "中国新冠 ILI 阳性率预测（疾控哨点监测）",
        yaxis: "阳性率（%）",
        disclaimer: "本图展示中国疾控中心哨点监测的全国 ILI 病例中 SARS-CoV-2 阳性率的多模型周预测。"
    },
    "wk inc flu prop ili": {
        title: "中国流感 ILI 标本阳性率预测（国家流感中心）",
        yaxis: "阳性率（%）",
        disclaimer: "本图展示中国国家流感中心（CNIC）全国 ILI 标本实验室阳性率的多模型周预测。"
    },
    "mo inc dengue cases": {
        title: "中国登革热报告病例数预测（法定传染病月报）",
        yaxis: "报告病例数",
        disclaimer: "本图展示中国疾控中心法定传染病月报的全国登革热报告病例数的多模型月预测。纵轴为病例数，默认范围为 0–30,000。"
    }
};

function ymd(value) {
    if (value == null) {
        return null;
    }
    var text = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return null;
    }
    return text;
}

function parseYmd(value) {
    var text = ymd(value);
    if (!text) {
        return null;
    }
    var parts = text.split("-");
    return Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
}

function formatYmd(ms) {
    var date = new Date(ms);
    var month = date.getUTCMonth() + 1;
    var day = date.getUTCDate();
    return date.getUTCFullYear() + "-" +
        String(month).padStart(2, "0") + "-" +
        String(day).padStart(2, "0");
}

function addDays(value, days) {
    var ms = parseYmd(value);
    if (ms == null) {
        return null;
    }
    return formatYmd(ms + days * 86400000);
}

function addMonths(value, months) {
    var text = ymd(value);
    if (!text) {
        return null;
    }
    var parts = text.split("-");
    var year = +parts[0];
    var monthIndex = +parts[1] - 1 + months;
    var day = +parts[2];
    year += Math.floor(monthIndex / 12);
    monthIndex = ((monthIndex % 12) + 12) % 12;
    var lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    if (day > lastDay) {
        day = lastDay;
    }
    return formatYmd(Date.UTC(year, monthIndex, day));
}

function isMonthlyTarget(target) {
    return typeof target === "string" && /^\s*mo\b/i.test(target);
}

function isDengueTarget(target) {
    return target === DENGUE_TARGET || isMonthlyTarget(target);
}

function chartLabelsFor(target) {
    return CHART_LABELS[target] || null;
}

function plotTitleFor(state) {
    if (!state) {
        return null;
    }
    var labels = chartLabelsFor(state.selected_target_var);
    if (!labels) {
        return null;
    }
    var asOf = ymd(state.selected_as_of_date);
    return labels.title + (asOf ? "<br>截至 " + asOf : "");
}

function computeYaxisRelayout(target) {
    if (isDengueTarget(target)) {
        return {
            "yaxis.range": DENGUE_YAXIS_RANGE.slice(),
            "yaxis.autorange": false,
            "yaxis.rangemode": "tozero"
        };
    }
    return {
        "yaxis.autorange": true,
        "yaxis.rangemode": "tozero"
    };
}

function applyChartLabels(App) {
    if (!App || !App.state) {
        return null;
    }
    var labels = chartLabelsFor(App.state.selected_target_var);
    if (!labels) {
        return null;
    }
    var title = plotTitleFor(App.state);
    var disclaimer = typeof document !== "undefined" ? document.getElementById("disclaimer") : null;
    if (disclaimer) {
        disclaimer.textContent = labels.disclaimer;
    }
    return {
        "title.text": title,
        "yaxis.title.text": labels.yaxis
    };
}

function minDate(dates) {
    var best = null;
    for (var i = 0; i < dates.length; i++) {
        var text = ymd(dates[i]);
        if (text && (best === null || text < best)) {
            best = text;
        }
    }
    return best;
}

function maxDate(dates) {
    var best = null;
    for (var i = 0; i < dates.length; i++) {
        var text = ymd(dates[i]);
        if (text && (best === null || text > best)) {
            best = text;
        }
    }
    return best;
}

function collectForecastDates(forecasts) {
    var dates = [];
    if (!forecasts || typeof forecasts !== "object" || Array.isArray(forecasts)) {
        return dates;
    }
    var models = Object.keys(forecasts);
    for (var i = 0; i < models.length; i++) {
        var entry = forecasts[models[i]];
        var list = entry && entry.target_end_date;
        if (!Array.isArray(list)) {
            continue;
        }
        for (var j = 0; j < list.length; j++) {
            var text = ymd(list[j]);
            if (text) {
                dates.push(text);
            }
        }
    }
    return dates;
}

function collectTruthDates(truth) {
    var dates = [];
    if (!truth || typeof truth !== "object") {
        return dates;
    }
    var list = Array.isArray(truth.date) ? truth.date : [];
    for (var i = 0; i < list.length; i++) {
        var text = ymd(list[i]);
        if (text) {
            dates.push(text);
        }
    }
    return dates;
}

function hasForecasts(forecasts) {
    return collectForecastDates(forecasts).length > 0;
}

function computeXaxisRange(state) {
    if (!state) {
        return null;
    }
    var monthly = isMonthlyTarget(state.selected_target_var);
    var asOf = ymd(state.selected_as_of_date);
    var forecastDates = collectForecastDates(state.forecasts);
    var truthDates = collectTruthDates(state.as_of_truth).concat(
        collectTruthDates(state.current_truth)
    );
    var rightCore = maxDate(forecastDates.concat(asOf ? [asOf] : []));
    if (!rightCore) {
        rightCore = maxDate(truthDates);
    }
    if (!rightCore) {
        return null;
    }
    var right = monthly ? addMonths(rightCore, 1) : addDays(rightCore, 7);
    var leftAnchor = asOf || maxDate(truthDates) || rightCore;
    var left = monthly ? addMonths(leftAnchor, -FORECAST_WINDOW_MONTHLY_HISTORY_MONTHS)
        : addDays(leftAnchor, -FORECAST_WINDOW_WEEKLY_HISTORY_DAYS);
    if (forecastDates.length) {
        var minForecast = minDate(forecastDates);
        var forecastPad = monthly ? addMonths(minForecast, -1) : addDays(minForecast, -7);
        if (forecastPad && (!left || forecastPad < left)) {
            left = forecastPad;
        }
    }
    var firstTruth = minDate(truthDates);
    if (firstTruth && left && firstTruth > left) {
        left = firstTruth;
    }
    if (!left || !right || left >= right) {
        left = monthly ? addMonths(right, -FORECAST_WINDOW_MONTHLY_HISTORY_MONTHS)
            : addDays(right, -FORECAST_WINDOW_WEEKLY_HISTORY_DAYS);
    }
    if (!left || !right || left >= right) {
        return null;
    }
    return [left, right];
}

function asOfsToProbe(state, limit) {
    limit = limit == null ? FORECAST_ASOF_PROBE_LIMIT : limit;
    var target = state && state.selected_target_var;
    var list = state && state.available_as_ofs && target
        ? state.available_as_ofs[target]
        : null;
    if (!Array.isArray(list)) {
        return [];
    }
    var current = ymd(state.selected_as_of_date);
    var seen = Object.create(null);
    var candidates = [];
    for (var i = 0; i < list.length; i++) {
        var text = ymd(list[i]);
        if (text && text !== current && !seen[text]) {
            seen[text] = true;
            candidates.push(text);
        }
    }
    candidates.sort();
    candidates.reverse();
    return candidates.slice(0, limit);
}

// Kept as a name used in earlier tests; same as asOfsToProbe.
function asOfsBeforeCurrent(state, limit) {
    return asOfsToProbe(state, limit);
}

function urlSpecifiesParam(name) {
    try {
        return typeof window !== "undefined" && window.location &&
            new URLSearchParams(window.location.search).has(name);
    } catch (e) {
        return false;
    }
}

function urlSpecifiesXaxis() {
    return urlSpecifiesParam("xaxis_range");
}

function urlSpecifiesYaxis() {
    return urlSpecifiesParam("yaxis_range");
}

function applyFocusRange(App, options) {
    options = options || {};
    if (!App || !App.state || App.state.is_season_mode) {
        return false;
    }
    var firstApply = !App.state._focusRangeApplied && !options.force;
    var skipX = firstApply && urlSpecifiesXaxis();
    var skipY = firstApply && urlSpecifiesYaxis();
    var range = computeXaxisRange(App.state);
    var update = applyChartLabels(App) || {};
    if (!skipX && range) {
        update["xaxis.range"] = range;
    }
    if (!skipY) {
        var yUpdate = computeYaxisRelayout(App.state.selected_target_var);
        var key;
        for (key in yUpdate) {
            if (Object.prototype.hasOwnProperty.call(yUpdate, key)) {
                update[key] = yUpdate[key];
            }
        }
    }
    var plot = typeof document !== "undefined" ? document.getElementById("ploty_div") : null;
    var hasUpdate = false;
    for (key in update) {
        if (Object.prototype.hasOwnProperty.call(update, key)) {
            hasUpdate = true;
            break;
        }
    }
    if (plot && hasUpdate && typeof Plotly !== "undefined" && typeof Plotly.relayout === "function") {
        Plotly.relayout(plot, update);
        if (update["xaxis.range"] && typeof App.initializeDateRangePicker === "function") {
            App.initializeDateRangePicker();
        }
    }
    App.state._focusRangeApplied = true;
    App.state._focusRange = range;
    if (skipX || !range) {
        return false;
    }
    return range;
}

function probeForecastAsOf(App, asOf) {
    if (!App || typeof App._fetchData !== "function") {
        return Promise.resolve(false);
    }
    return App._fetchData(
        true,
        App.state.selected_target_var,
        App.selectedTaskIDValues(),
        asOf
    ).then(function (response) {
        return !!(response && response.ok);
    }).catch(function () {
        return false;
    });
}

function snapToLatestForecastAsOf(App) {
    if (!App || !App.state || hasForecasts(App.state.forecasts)) {
        return Promise.resolve(false);
    }
    var original = ymd(App.state.selected_as_of_date);
    var candidates = asOfsToProbe(App.state, FORECAST_ASOF_PROBE_LIMIT);
    if (!candidates.length || typeof App._fetchData !== "function") {
        return Promise.resolve(false);
    }
    return Promise.all(candidates.map(function (asOf) {
        return probeForecastAsOf(App, asOf).then(function (ok) {
            return ok ? asOf : null;
        });
    })).then(function (found) {
        var hit = maxDate(found.filter(Boolean));
        if (!hit || hit === original) {
            return false;
        }
        App.state.selected_as_of_date = hit;
        var refetch = [App.fetchForecasts()];
        if (typeof App.fetchAsOfTruth === "function") {
            refetch.push(App.fetchAsOfTruth());
        }
        return Promise.all(refetch).then(function () {
            if (typeof App.updateTruthCheckboxLabels === "function") {
                App.updateTruthCheckboxLabels();
            }
            if (typeof App.updateSeasonNavState === "function") {
                App.updateSeasonNavState();
            }
            if (typeof App.showOptionsInURL === "function") {
                App.showOptionsInURL();
            }
            return true;
        });
    });
}

function fadePlot(App, opacity) {
    var plot = typeof document !== "undefined" ? document.getElementById("ploty_div") : null;
    if (!App.isIndicateRedraw || !plot) {
        return;
    }
    if (typeof window !== "undefined" && window.jQuery) {
        window.jQuery(plot).fadeTo(0, opacity);
    } else if (plot.style) {
        plot.style.opacity = String(opacity);
    }
}

function installForecastWindow(App) {
    if (!App || App.__forecastWindowInstalled) {
        return;
    }
    App.__forecastWindowInstalled = true;
    var origFetch = App.fetchDataUpdatePlot.bind(App);
    var fetchGen = 0;
    App.fetchDataUpdatePlot = function (isFetchFirst, isFetchCurrentTruth) {
        if (!isFetchFirst) {
            return origFetch(false, false);
        }
        var gen = ++fetchGen;
        var isResetYLimit = isFetchCurrentTruth;
        var promises = [App.fetchAsOfTruth(), App.fetchForecasts()];
        if (isFetchCurrentTruth) {
            promises.push(App.fetchCurrentTruth());
        }
        fadePlot(App, 0.25);
        return Promise.all(promises).then(function () {
            if (gen !== fetchGen) {
                return;
            }
            return snapToLatestForecastAsOf(App).then(function () {
                if (gen !== fetchGen) {
                    return;
                }
                if (typeof App.updateModelsList === "function") {
                    App.updateModelsList();
                }
                App.updatePlot(isResetYLimit);
                applyFocusRange(App);
                fadePlot(App, 1.0);
            });
        }).catch(function (error) {
            console.error("forecast window fetch:", error);
            fadePlot(App, 1.0);
        });
    };
    // initialize() may already have started the original fetch before this
    // wrapper was installed. Apply the window once the first plot appears.
    applyWhenPlotReady(App);
}

function applyWhenPlotReady(App) {
    if (!App || !App.state || App.state._focusRangeApplied) {
        return true;
    }
    var plot = typeof document !== "undefined" ? document.getElementById("ploty_div") : null;
    if (plot && plot.data && plot.data.length) {
        applyFocusRange(App);
        return true;
    }
    var tries = 0;
    var timer = setInterval(function () {
        if (!App.state || App.state._focusRangeApplied || applyFocusRangeIfPlotted(App) || ++tries > 500) {
            clearInterval(timer);
        }
    }, 10);
    return false;
}

function applyFocusRangeIfPlotted(App) {
    var plot = typeof document !== "undefined" ? document.getElementById("ploty_div") : null;
    if (plot && plot.data && plot.data.length) {
        applyFocusRange(App);
        return true;
    }
    return false;
}

function bootForecastWindow() {
    if (typeof document === "undefined" || !document.getElementById("forecastViz_row")) {
        return;
    }
    function tryInstall() {
        var App = document.predtimechart;
        if (App && App.fetchDataUpdatePlot && !App.__forecastWindowInstalled) {
            installForecastWindow(App);
            return true;
        }
        return false;
    }
    if (tryInstall()) {
        return;
    }
    var tries = 0;
    var timer = setInterval(function () {
        if (tryInstall() || ++tries > 500) {
            clearInterval(timer);
        }
    }, 10);
}

if (typeof window !== "undefined" && window.document) {
    bootForecastWindow();
}
