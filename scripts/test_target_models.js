"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
    path.join(__dirname, "../pages/resources/target-models.js"),
    "utf8"
);
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

const apply = context.applyTargetModelList;
if (typeof apply !== "function") {
    throw new Error("applyTargetModelList was not defined");
}

function assertEqual(actual, expected, label) {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right) {
        throw new Error(label + "\n  actual   " + left + "\n  expected " + right);
    }
}

const hub = [
    "CNCovidHub-ensemble",
    "GZNL-NextWave",
    "LZU-Sentinel",
    "MUST-SEIRS",
    "XMU_CTModelling-FNN",
    "GZNL-VincentAvg",
    "GZNL-DengueLGBMCQR",
    "GZNL-FluLGBMCQR",
    "LZU-ASVENKF",
    "LZU-LES",
    "LZU-SetPredict",
    "LZU-SinglePoint",
];
const deleted = [
    "GZNL-ExponentialSmoothing",
    "GZNL-SimpleTrend",
    "GZNL-test_001",
    "GZNL-test_002",
    "GZNL-test_003",
    "GZNL-test_004",
];
const byTarget = {
    "wk inc covid prop ili": hub.filter(function (model) {
        return model !== "GZNL-DengueLGBMCQR" && model !== "GZNL-FluLGBMCQR";
    }),
    "wk inc flu prop ili": ["GZNL-FluLGBMCQR"],
    "mo inc dengue cases": ["GZNL-DengueLGBMCQR"],
};

const state = {
    models: hub.concat(deleted),
    selected_target_var: "wk inc covid prop ili",
    selected_models: ["GZNL-NextWave", "GZNL-FluLGBMCQR"],
};

assertEqual(
    apply(state, byTarget),
    byTarget["wk inc covid prop ili"],
    "covid picker"
);
assertEqual(state._hubModels, hub.concat(deleted), "full list kept");
assertEqual(
    state.selected_models,
    ["GZNL-NextWave", "GZNL-FluLGBMCQR"],
    "checks survive a target filter"
);
deleted.forEach(function (model) {
    if (state.models.indexOf(model) !== -1) {
        throw new Error("deleted model still in covid picker: " + model);
    }
});
if (state.models.indexOf("GZNL-DengueLGBMCQR") !== -1) {
    throw new Error("dengue model listed for covid");
}
if (state.models.indexOf("GZNL-FluLGBMCQR") !== -1) {
    throw new Error("flu model listed for covid");
}

state.selected_target_var = "mo inc dengue cases";
assertEqual(apply(state, byTarget), ["GZNL-DengueLGBMCQR"], "dengue picker");
if (state.models.indexOf("CNCovidHub-ensemble") !== -1) {
    throw new Error("covid model listed for dengue");
}

state.selected_target_var = "wk inc flu prop ili";
assertEqual(apply(state, byTarget), ["GZNL-FluLGBMCQR"], "flu picker");

state.selected_target_var = "wk inc covid prop ili";
assertEqual(apply(state, null), hub.concat(deleted), "missing file shows the global list");

console.log("target model filter tests passed");
