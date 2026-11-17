"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
    path.join(__dirname, "../pages/resources/forecast-window.js"),
    "utf8"
);
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

function assertEqual(actual, expected, label) {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) {
        throw new Error(label + "\n  actual   " + left + "\n  expected " + right);
    }
}

function assert(cond, label) {
    if (!cond) {
        throw new Error(label);
    }
}

assertEqual(context.ymd("2026-11-09 18:17:12.8268"), "2026-11-09", "ymd trims time");
assertEqual(context.addDays("2026-12-21", 7), "2026-12-28", "add one week");
assertEqual(context.addMonths("2027-02-01", 1), "2027-03-01", "add one month");
assertEqual(context.addMonths("2024-11-01", 24), "2026-11-01", "add 24 months");
assertEqual(context.addMonths("2026-11-01", -24), "2024-11-01", "subtract 24 months");
assertEqual(context.addMonths("2026-03-31", -1), "2026-02-28", "clamp month-end");
assert(context.isMonthlyTarget("mo inc dengue cases"), "dengue is monthly");
assert(!context.isMonthlyTarget("wk inc covid prop ili"), "covid is weekly");
assert(!context.isMonthlyTarget("wk inc flu prop ili"), "flu is weekly");
assert(context.isDengueTarget("mo inc dengue cases"), "dengue target is recognized");
assert(!context.isDengueTarget("wk inc covid prop ili"), "covid is not dengue");
assertEqual(context.DENGUE_YAXIS_RANGE, [0, 30000], "dengue default y-axis is 0-30k");
assertEqual(
    context.computeYaxisRelayout("mo inc dengue cases")["yaxis.range"],
    [0, 30000],
    "dengue y-axis relayout uses 0-30k"
);
assertEqual(
    context.computeYaxisRelayout("mo inc dengue cases")["yaxis.autorange"],
    false,
    "dengue y-axis is not autoranged"
);
assertEqual(
    context.computeYaxisRelayout("wk inc covid prop ili")["yaxis.autorange"],
    true,
    "covid y-axis autoranges"
);
assertEqual(
    context.computeYaxisRelayout("wk inc flu prop ili")["yaxis.autorange"],
    true,
    "flu y-axis autoranges"
);
assert(
    !Object.prototype.hasOwnProperty.call(
        context.computeYaxisRelayout("wk inc covid prop ili"),
        "yaxis.range"
    ),
    "covid y-axis does not keep a fixed range"
);

const covidLabels = context.chartLabelsFor("wk inc covid prop ili");
const fluLabels = context.chartLabelsFor("wk inc flu prop ili");
const dengueLabels = context.chartLabelsFor("mo inc dengue cases");
assert(covidLabels && fluLabels && dengueLabels, "each Outcome has labels");
assert(covidLabels.title !== fluLabels.title, "covid and flu titles differ");
assert(covidLabels.title !== dengueLabels.title, "covid and dengue titles differ");
assert(fluLabels.title !== dengueLabels.title, "flu and dengue titles differ");
assert(covidLabels.disclaimer !== fluLabels.disclaimer, "covid and flu disclaimers differ");
assert(covidLabels.disclaimer !== dengueLabels.disclaimer, "covid and dengue disclaimers differ");
assert(fluLabels.disclaimer !== dengueLabels.disclaimer, "flu and dengue disclaimers differ");
assertEqual(dengueLabels.yaxis, "报告病例数", "dengue y-axis title is case counts");
assertEqual(
    context.plotTitleFor({
        selected_target_var: "mo inc dengue cases",
        selected_as_of_date: "2026-11-01"
    }),
    "中国登革热报告病例数预测（法定传染病月报）<br>截至 2026-11-01",
    "dengue plot title includes as-of date"
);
assertEqual(
    context.plotTitleFor({
        selected_target_var: "wk inc covid prop ili",
        selected_as_of_date: "2026-11-09"
    }),
    "中国新冠 ILI 阳性率预测（疾控哨点监测）<br>截至 2026-11-09",
    "covid plot title is distinct"
);
assertEqual(
    context.plotTitleFor({
        selected_target_var: "wk inc flu prop ili",
        selected_as_of_date: "2026-11-09"
    }),
    "中国流感 ILI 标本阳性率预测（国家流感中心）<br>截至 2026-11-09",
    "flu plot title is distinct"
);

const covidState = {
    selected_target_var: "wk inc covid prop ili",
    selected_as_of_date: "2026-11-09",
    forecasts: {
        "GZNL-NextWave": {
            target_end_date: [
                "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23",
                "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"
            ]
        }
    },
    as_of_truth: {
        date: ["2022-12-05", "2025-11-10", "2026-11-02"]
    }
};
assertEqual(
    context.computeXaxisRange(covidState),
    ["2025-11-10", "2026-12-28"],
    "covid: 52 weeks of history, forecasts plus one week"
);

const shortTruth = {
    selected_target_var: "wk inc covid prop ili",
    selected_as_of_date: "2026-11-09",
    forecasts: { m: { target_end_date: ["2026-11-16", "2026-12-21"] } },
    as_of_truth: { date: ["2026-06-01", "2026-11-02"] }
};
assertEqual(
    context.computeXaxisRange(shortTruth),
    ["2026-06-01", "2026-12-28"],
    "left clamps to first truth when the series is shorter than 52 weeks"
);

const fluState = {
    selected_target_var: "wk inc flu prop ili",
    selected_as_of_date: "2026-11-09",
    forecasts: {
        "GZNL-FluLGBMCQR": {
            target_end_date: [
                "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23",
                "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"
            ]
        }
    },
    as_of_truth: { date: ["2009-09-07", "2026-10-26"] }
};
assertEqual(
    context.computeXaxisRange(fluState),
    ["2025-11-10", "2026-12-28"],
    "flu: crop 2009- history, keep latest forecasts"
);

const dengueState = {
    selected_target_var: "mo inc dengue cases",
    selected_as_of_date: "2026-11-01",
    forecasts: {
        "GZNL-DengueLGBMCQR": {
            target_end_date: [
                "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"
            ]
        }
    },
    as_of_truth: { date: ["2004-01-01", "2026-10-01"] }
};
assertEqual(
    context.computeXaxisRange(dengueState),
    ["2024-11-01", "2027-03-01"],
    "dengue: 24 months of history, forecasts through Feb 2027 plus one month"
);

const dengueNoForecast = {
    selected_target_var: "mo inc dengue cases",
    selected_as_of_date: "2026-11-09",
    forecasts: {},
    as_of_truth: { date: ["2004-01-01", "2026-10-01"] }
};
assertEqual(
    context.computeXaxisRange(dengueNoForecast),
    ["2024-11-09", "2026-12-09"],
    "no forecasts: window still centers on as-of with monthly padding"
);

assert(!context.hasForecasts({}), "empty object has no forecasts");
assert(!context.hasForecasts([]), "empty array has no forecasts");
assert(context.hasForecasts({ m: { target_end_date: ["2026-11-01"] } }), "has forecasts");

const asOfState = {
    selected_target_var: "mo inc dengue cases",
    selected_as_of_date: "2026-11-09",
    available_as_ofs: {
        "mo inc dengue cases": [
            "2026-10-01", "2026-10-26", "2026-11-01", "2026-11-02", "2026-11-09"
        ]
    }
};
assertEqual(
    context.asOfsToProbe(asOfState, 24),
    ["2026-11-02", "2026-11-01", "2026-10-26", "2026-10-01"],
    "probe as-ofs newer-first, excluding the current date"
);

const fluAsOfState = {
    selected_target_var: "wk inc flu prop ili",
    selected_as_of_date: "2026-11-02",
    available_as_ofs: {
        "wk inc flu prop ili": ["2026-11-02", "2026-11-09"]
    }
};
assertEqual(
    context.asOfsToProbe(fluAsOfState, 24),
    ["2026-11-09"],
    "flu at 2026-11-02 also probes the later forecast as-of"
);
const fluFromDengueAsOf = {
    selected_target_var: "wk inc flu prop ili",
    selected_as_of_date: "2026-11-01",
    available_as_ofs: fluAsOfState.available_as_ofs
};
assertEqual(
    context.asOfsToProbe(fluFromDengueAsOf, 24),
    ["2026-11-09", "2026-11-02"],
    "after dengue as-of, flu probes later dates first"
);

const context2 = {
    console,
    URLSearchParams,
    document: {
        getElementById: function () { return { id: "ploty_div" }; }
    },
    Plotly: {
        relayout: function (plot, update) { this.calls.push({ plot: plot.id, update: update }); },
        calls: []
    },
    window: { location: { search: "" } }
};
vm.createContext(context2);
vm.runInContext(source, context2);

const app = {
    state: JSON.parse(JSON.stringify(dengueState)),
    initializeDateRangePicker: function () { this.pickerInited = true; }
};
const applied = context2.applyFocusRange(app);
assertEqual(applied, ["2024-11-01", "2027-03-01"], "applyFocusRange returns dengue window");
const dengueUpdate = context2.Plotly.calls[0].update;
assertEqual(dengueUpdate["xaxis.range"], ["2024-11-01", "2027-03-01"], "relayout uses the window");
assertEqual(dengueUpdate["yaxis.range"], [0, 30000], "dengue relayout sets 0-30k y-axis");
assertEqual(dengueUpdate["yaxis.autorange"], false, "dengue y-axis is fixed");
assertEqual(
    dengueUpdate.title && dengueUpdate.title.text,
    "中国登革热报告病例数预测（法定传染病月报）<br>截至 2026-11-01",
    "dengue relayout sets the dengue title"
);
assertEqual(dengueUpdate.title.xanchor, "center", "dengue title is a full Plotly title object");
assertEqual(dengueUpdate["yaxis.title.text"], "报告病例数", "dengue y-axis title is case counts");
assert(app.pickerInited, "date range picker is re-bound");
assert(app.state._focusRangeApplied, "marks first apply");

const covidApp = {
    state: JSON.parse(JSON.stringify(covidState)),
    initializeDateRangePicker: function () { this.pickerInited = true; }
};
context2.applyFocusRange(covidApp);
const covidUpdate = context2.Plotly.calls[1].update;
assertEqual(covidUpdate["yaxis.autorange"], true, "switching to covid autoranges y-axis");
assert(
    !Object.prototype.hasOwnProperty.call(covidUpdate, "yaxis.range"),
    "covid relayout does not keep the dengue y-axis"
);
assert(
    covidUpdate.title.text.indexOf("新冠") !== -1 &&
        covidUpdate.title.text.indexOf("登革") === -1,
    "covid relayout uses the covid title"
);

// If the plot already shows the intended title and window, do not relayout
// again (avoids a plotly_afterplot loop).
const alreadyAppliedPlot = {
    id: "ploty_div",
    layout: {
        title: covidUpdate.title,
        xaxis: { range: covidUpdate["xaxis.range"] || ["2025-11-10", "2026-12-28"] },
        yaxis: {
            title: { text: covidUpdate["yaxis.title.text"] },
            autorange: true
        }
    }
};
assert(
    context2.focusUpdateIsCurrent(alreadyAppliedPlot, covidUpdate),
    "skips relayout when the flu/covid title and window are already on the plot"
);
const staleCovidPlot = {
    id: "ploty_div",
    layout: {
        title: { text: "中国新冠 ILI 阳性率预测（疾控哨点监测）<br>截至 2026-11-09" },
        xaxis: { range: ["2025-11-10", "2026-12-28"] },
        yaxis: { title: { text: "阳性率（%）" }, autorange: true }
    }
};
assert(
    !context2.focusUpdateIsCurrent(staleCovidPlot, dengueUpdate),
    "does not skip relayout when the plot still has the previous Outcome title"
);

// scheduleApplyFocusRange waits for plot idle (afterplot or a short timeout)
// so Plotly.react cannot overwrite the new Outcome title.
const scheduled = [];
const fakePlot = {
    id: "ploty_div",
    layout: { title: { text: "stale covid title" } },
    once: function (event, handler) {
        this.event = event;
        this.handler = handler;
    },
    removeListener: function (event, handler) {
        if (this.event === event && this.handler === handler) {
            this.event = null;
            this.handler = null;
        }
    }
};
const schedContext = {
    console,
    URLSearchParams,
    document: { getElementById: function () { return fakePlot; } },
    Plotly: {
        relayout: function (plot, update) { this.calls.push(update); },
        calls: []
    },
    window: { location: { search: "" } },
    setTimeout: function (fn, ms) { scheduled.push({ fn: fn, ms: ms }); return scheduled.length; },
    clearTimeout: function (id) { scheduled.cleared = id; }
};
vm.createContext(schedContext);
vm.runInContext(source, schedContext);
const schedApp = { state: JSON.parse(JSON.stringify(dengueState)) };
schedContext.scheduleApplyFocusRange(schedApp);
assertEqual(schedContext.Plotly.calls.length, 0, "does not relayout until the plot is idle");
assertEqual(fakePlot.event, "plotly_afterplot", "listens for plotly_afterplot");
assert(scheduled.length === 1 && scheduled[0].ms === 50, "also sets a short fallback timer");
fakePlot.handler();
assertEqual(schedContext.Plotly.calls.length, 1, "afterplot applies the new Outcome title once");
assertEqual(
    schedContext.Plotly.calls[0].title.text,
    "中国登革热报告病例数预测（法定传染病月报）<br>截至 2026-11-01",
    "idle hook writes the dengue title, not the leftover covid title"
);
assertEqual(schedContext.Plotly.calls[0]["yaxis.title.text"], "报告病例数", "idle hook also sets the dengue y-axis title");
scheduled[0].fn();
assertEqual(schedContext.Plotly.calls.length, 1, "fallback timer does not apply a second time after afterplot");

const urlContext = {
    console,
    URLSearchParams,
    document: { getElementById: function () { return { id: "ploty_div" }; } },
    Plotly: {
        relayout: function (plot, update) { this.called = true; this.lastUpdate = update; },
        called: false,
        lastUpdate: null
    },
    window: { location: { search: "?xaxis_range=2020-01-01&xaxis_range=2021-01-01" } }
};
vm.createContext(urlContext);
vm.runInContext(source, urlContext);
assert(urlContext.urlSpecifiesXaxis(), "URL xaxis_range is detected");
const urlApp = { state: JSON.parse(JSON.stringify(covidState)) };
assertEqual(urlContext.applyFocusRange(urlApp), false, "first load honors ?xaxis_range=");
assert(urlContext.Plotly.called, "still applies y-axis and titles on first load");
assert(
    !Object.prototype.hasOwnProperty.call(urlContext.Plotly.lastUpdate, "xaxis.range"),
    "does not overwrite a share-link x zoom"
);
assertEqual(urlContext.Plotly.lastUpdate["yaxis.autorange"], true, "first load still autoranges covid y-axis");
assert(urlApp.state._focusRangeApplied, "share-link zoom counts as first apply");
urlApp.state.selected_target_var = "mo inc dengue cases";
urlApp.state.selected_as_of_date = "2026-11-01";
urlApp.state.forecasts = dengueState.forecasts;
urlApp.state.as_of_truth = dengueState.as_of_truth;
const afterSwitch = urlContext.applyFocusRange(urlApp);
assertEqual(afterSwitch, ["2024-11-01", "2027-03-01"], "later Outcome switch still refocuses");
assertEqual(urlContext.Plotly.lastUpdate["xaxis.range"], ["2024-11-01", "2027-03-01"], "later switch sets x window");
assertEqual(urlContext.Plotly.lastUpdate["yaxis.range"], [0, 30000], "later switch sets dengue y-axis");

const yUrlContext = {
    console,
    URLSearchParams,
    document: { getElementById: function () { return { id: "ploty_div" }; } },
    Plotly: {
        relayout: function (plot, update) { this.lastUpdate = update; this.called = true; },
        called: false,
        lastUpdate: null
    },
    window: { location: { search: "?yaxis_range=0&yaxis_range=80" } }
};
vm.createContext(yUrlContext);
vm.runInContext(source, yUrlContext);
assert(yUrlContext.urlSpecifiesYaxis(), "URL yaxis_range is detected");
const yUrlApp = { state: JSON.parse(JSON.stringify(dengueState)) };
assertEqual(yUrlContext.applyFocusRange(yUrlApp), ["2024-11-01", "2027-03-01"], "first load still sets x window");
assert(
    !Object.prototype.hasOwnProperty.call(yUrlContext.Plotly.lastUpdate, "yaxis.range") &&
        !Object.prototype.hasOwnProperty.call(yUrlContext.Plotly.lastUpdate, "yaxis.autorange"),
    "does not overwrite a share-link y zoom"
);
assertEqual(yUrlContext.Plotly.lastUpdate["xaxis.range"], ["2024-11-01", "2027-03-01"], "honoring y zoom still focuses x");

// snapToLatestForecastAsOf probes and moves to the newest as-of with a file
const probeOk = { "2026-11-01": true };
const snapApp = {
    state: {
        selected_target_var: "mo inc dengue cases",
        selected_as_of_date: "2026-11-09",
        forecasts: {},
        available_as_ofs: asOfState.available_as_ofs
    },
    selectedTaskIDValues: function () { return { location: "CN" }; },
    _fetchData: function (isForecast, target, taskIds, asOf) {
        this.probed = (this.probed || []).concat([asOf]);
        return Promise.resolve({ ok: !!probeOk[asOf] });
    },
    fetchForecasts: function () {
        this.state.forecasts = { "GZNL-DengueLGBMCQR": { target_end_date: ["2027-02-01"] } };
        return Promise.resolve();
    },
    fetchAsOfTruth: function () {
        this.truthDate = this.state.selected_as_of_date;
        return Promise.resolve();
    },
    updateTruthCheckboxLabels: function () { this.labelsUpdated = true; },
    updateSeasonNavState: function () { this.navUpdated = true; },
    showOptionsInURL: function () { this.urlUpdated = true; }
};
context2.snapToLatestForecastAsOf(snapApp).then(function (snapped) {
    assert(snapped === true, "snap returns true when a forecast as-of is found");
    assertEqual(snapApp.state.selected_as_of_date, "2026-11-01", "snaps to latest dengue forecast as-of");
    assertEqual(snapApp.truthDate, "2026-11-01", "as-of truth is refetched");
    assert(snapApp.labelsUpdated && snapApp.navUpdated && snapApp.urlUpdated, "as-of UI is synced");
    assert(context2.hasForecasts(snapApp.state.forecasts), "forecasts loaded after snap");

    const alreadyHas = {
        state: { selected_as_of_date: "2026-11-09", forecasts: { m: { target_end_date: ["2026-12-21"] } } }
    };
    return context2.snapToLatestForecastAsOf(alreadyHas).then(function (noSnap) {
        assert(noSnap === false, "does not snap when forecasts already loaded");
        assertEqual(alreadyHas.state.selected_as_of_date, "2026-11-09", "keeps as-of when forecasts exist");

        const fluProbeOk = { "2026-11-09": true };
        const fluSnapApp = {
            state: {
                selected_target_var: "wk inc flu prop ili",
                selected_as_of_date: "2026-11-02",
                forecasts: {},
                available_as_ofs: {
                    "wk inc flu prop ili": ["2026-11-02", "2026-11-09"]
                }
            },
            selectedTaskIDValues: function () { return { location: "CN" }; },
            _fetchData: function (isForecast, target, taskIds, asOf) {
                return Promise.resolve({ ok: !!fluProbeOk[asOf] });
            },
            fetchForecasts: function () {
                this.state.forecasts = { "GZNL-FluLGBMCQR": { target_end_date: ["2026-12-21"] } };
                return Promise.resolve();
            },
            fetchAsOfTruth: function () { return Promise.resolve(); },
            updateTruthCheckboxLabels: function () {},
            updateSeasonNavState: function () {},
            showOptionsInURL: function () {}
        };
        return context2.snapToLatestForecastAsOf(fluSnapApp).then(function (fluSnapped) {
            assert(fluSnapped === true, "flu snap returns true when a later forecast as-of exists");
            assertEqual(fluSnapApp.state.selected_as_of_date, "2026-11-09", "snaps flu forward to the latest forecast as-of");
            assert(context2.hasForecasts(fluSnapApp.state.forecasts), "flu forecasts loaded after snap");
            console.log("forecast window tests passed");
        });
    });
}).catch(function (error) {
    console.error(error);
    process.exit(1);
});
