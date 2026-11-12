// PredTimeChart v3 keeps one global options.models list and rejects extra
// properties on predtimechart-options.json (additionalProperties: false).
// The site builder also overwrites resources/predtimechart.js, so the
// per-target picker lives here and reads models-by-target.json from ptc/data.
// That file is the Hub-registered models that occur in each target's
// forecast JSON. Models for another pathogen are left out of the picker.
// Historical forecast JSON is not deleted.

var TARGET_MODELS_URL = "https://raw.githubusercontent.com/dailypartita/China-Infectious-Disease-Forecast-Dashboard/refs/heads/ptc/data/models-by-target.json";
var targetModelsByTarget = null;

function applyTargetModelList(state, byTarget) {
    if (!state._hubModels) {
        state._hubModels = (state.models || []).slice();
    }
    var target = state.selected_target_var;
    var allowed = null;
    if (byTarget && target && Object.prototype.hasOwnProperty.call(byTarget, target) && Array.isArray(byTarget[target])) {
        allowed = byTarget[target];
    }
    if (allowed) {
        var allow = Object.create(null);
        for (var i = 0; i < allowed.length; i++) {
            allow[allowed[i]] = true;
        }
        state.models = state._hubModels.filter(function (model) {
            return allow[model] === true;
        });
    } else {
        state.models = state._hubModels.slice();
    }
    return state.models.slice();
}

function installTargetModelFilter(App) {
    if (App.__targetModelsInstalled) {
        return;
    }
    App.__targetModelsInstalled = true;
    var origUpdate = App.updateModelsList.bind(App);
    var origInit = App.initialize.bind(App);
    App.updateModelsList = function () {
        applyTargetModelList(App.state, targetModelsByTarget);
        return origUpdate();
    };
    App.initialize = function () {
        App.state._hubModels = null;
        return origInit.apply(App, arguments);
    };
    document.addEventListener("change", function (event) {
        if (event.target && event.target.id === "target_variable") {
            App.updateModelsList();
        }
    });
    // initialize() may already have drawn the full list if the options
    // fetch beat this wrapper. selected_target_var is empty until then.
    if (App.state.selected_target_var) {
        App.state._hubModels = null;
        App.updateModelsList();
    }
}

function bootTargetModelFilter() {
    if (!document.getElementById("forecastViz_row")) {
        return;
    }
    var url = window.PREDTIMECHART_MODELS_BY_TARGET_URL || TARGET_MODELS_URL;
    window.targetModelsReady = fetch(url)
        .then(function (response) {
            if (!response.ok) {
                throw new Error("models-by-target HTTP " + response.status);
            }
            return response.json();
        })
        .then(function (data) {
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error("models-by-target is not an object");
            }
            targetModelsByTarget = data;
            if (document.predtimechart && document.predtimechart.__targetModelsInstalled) {
                document.predtimechart.updateModelsList();
            }
        })
        .catch(function (error) {
            console.warn("target model filter unavailable:", error);
            targetModelsByTarget = null;
        });

    function tryInstall() {
        var App = document.predtimechart;
        if (App && App.updateModelsList && !App.__targetModelsInstalled) {
            installTargetModelFilter(App);
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
    bootTargetModelFilter();
}
