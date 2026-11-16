// PredTimeChart v3 keeps the current xaxis range across updates, so switching
// Outcome leaves the previous pathogen's window in place. Forecasts that sit
// past that right edge (dengue months beyond a weekly COVID window) are
// clipped, and long truth series (flu from 2009, dengue from 2004) would
// squeeze the latest forecasts if the axis autoranged. After each fetch we
// set a tight window: a short recent history on the left, and the full
// latest forecast horizon plus one interval of padding on the right.
// If the current as-of has no forecast file, we step back through recent
// as-of dates for that Outcome until one loads, then use that window.
// A first-load ?xaxis_range= share link is honored once; later Outcome or
// as-of changes still refocus. Manual zoom is kept until then. Season mode
// is left to PredTimeChart. The site builder overwrites predtimechart.js,
// so this hook lives here.

var FORECAST_WINDOW_WEEKLY_HISTORY_DAYS = 364; // 52 weeks
var FORECAST_WINDOW_MONTHLY_HISTORY_MONTHS = 24;
var FORECAST_ASOF_PROBE_LIMIT = 24;

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

function asOfsBeforeCurrent(state, limit) {
    limit = limit == null ? FORECAST_ASOF_PROBE_LIMIT : limit;
    var target = state && state.selected_target_var;
    var list = state && state.available_as_ofs && target
        ? state.available_as_ofs[target]
        : null;
    if (!Array.isArray(list)) {
        return [];
    }
    var current = ymd(state.selected_as_of_date);
    var earlier = [];
    for (var i = 0; i < list.length; i++) {
        var text = ymd(list[i]);
        if (text && (!current || text < current)) {
            earlier.push(text);
        }
    }
    earlier.sort();
    earlier.reverse();
    return earlier.slice(0, limit);
}

function urlSpecifiesXaxis() {
    try {
        return typeof window !== "undefined" && window.location &&
            new URLSearchParams(window.location.search).has("xaxis_range");
    } catch (e) {
        return false;
    }
}

function applyFocusRange(App, options) {
    options = options || {};
    if (!App || !App.state || App.state.is_season_mode) {
        return false;
    }
    if (!App.state._focusRangeApplied && !options.force && urlSpecifiesXaxis()) {
        App.state._focusRangeApplied = true;
        return false;
    }
    var range = computeXaxisRange(App.state);
    if (!range) {
        return false;
    }
    var plot = typeof document !== "undefined" ? document.getElementById("ploty_div") : null;
    if (plot && typeof Plotly !== "undefined" && typeof Plotly.relayout === "function") {
        Plotly.relayout(plot, {"xaxis.range": range});
        if (typeof App.initializeDateRangePicker === "function") {
            App.initializeDateRangePicker();
        }
    }
    App.state._focusRangeApplied = true;
    App.state._focusRange = range;
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
    var candidates = asOfsBeforeCurrent(App.state, FORECAST_ASOF_PROBE_LIMIT);
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
