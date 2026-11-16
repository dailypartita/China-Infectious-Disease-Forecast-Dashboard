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
    context.asOfsBeforeCurrent(asOfState, 24),
    ["2026-11-02", "2026-11-01", "2026-10-26", "2026-10-01"],
    "probe as-ofs newer-first, excluding the current date"
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
assertEqual(context2.Plotly.calls[0].update, {"xaxis.range": ["2024-11-01", "2027-03-01"]}, "relayout uses the window");
assert(app.pickerInited, "date range picker is re-bound");
assert(app.state._focusRangeApplied, "marks first apply");

const urlContext = {
    console,
    URLSearchParams,
    document: { getElementById: function () { return { id: "ploty_div" }; } },
    Plotly: { relayout: function () { this.called = true; }, called: false },
    window: { location: { search: "?xaxis_range=2020-01-01&xaxis_range=2021-01-01" } }
};
vm.createContext(urlContext);
vm.runInContext(source, urlContext);
assert(urlContext.urlSpecifiesXaxis(), "URL xaxis_range is detected");
const urlApp = { state: JSON.parse(JSON.stringify(covidState)) };
assertEqual(urlContext.applyFocusRange(urlApp), false, "first load honors ?xaxis_range=");
assert(!urlContext.Plotly.called, "does not relayout over a share-link zoom");
assert(urlApp.state._focusRangeApplied, "share-link zoom counts as first apply");
urlApp.state.selected_target_var = "mo inc dengue cases";
urlApp.state.selected_as_of_date = "2026-11-01";
urlApp.state.forecasts = dengueState.forecasts;
urlApp.state.as_of_truth = dengueState.as_of_truth;
const afterSwitch = urlContext.applyFocusRange(urlApp);
assertEqual(afterSwitch, ["2024-11-01", "2027-03-01"], "later Outcome switch still refocuses");

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
        console.log("forecast window tests passed");
    });
}).catch(function (error) {
    console.error(error);
    process.exit(1);
});
