#!/usr/bin/env Rscript
# Score a hub the way create-predevals-data.R does, but do not abort when an
# eval set has forecasts and none of them overlap observations.
#
# hubPredEvalsData skips a set when model output has 0 rows. It does not skip
# when the oracle join leaves only NA rows. scoringutils then aborts with
# "no forecasts are left", and Rebuild Data never publishes any scores.
# On 2026-11-12 that was the first flu eval set ("Full season"): the only flu
# file in the Hub is GZNL-FluLGBMCQR for 2026-11-09, horizons 0-3 start on
# 2026-11-09, and the latest CNIC observation is 2026-10-26. There are no
# older wk inc flu prop ili forecasts to score. COVID sets that do overlap
# truth are still written. No scores are invented for the empty join.
#
# The installed create-predevals-data.R is sourced after the patch so oracle
# discovery and predevals-options.json stay aligned with the image.

is_empty_forecast_error <- function(e) {
  texts <- character()
  cur <- e
  for (i in seq_len(8)) {
    if (is.null(cur)) {
      break
    }
    texts <- c(texts, conditionMessage(cur))
    nxt <- cur$parent
    if (is.null(nxt)) {
      nxt <- attr(cur, "parent")
    }
    cur <- nxt
  }
  blob <- gsub("[[:space:]]+", " ", paste(texts, collapse = " "))
  grepl("no forecasts are left", blob, fixed = TRUE)
}

patch_skip_empty_oracle_join <- function() {
  ns <- asNamespace("hubPredEvalsData")
  original <- get("get_and_save_scores", envir = ns, inherits = FALSE)
  wrapped <- function(...) {
    call_args <- list(...)
    tryCatch(
      do.call(original, call_args),
      error = function(e) {
        if (!is_empty_forecast_error(e)) {
          rlang::cnd_signal(e)
        }
        target_id <- call_args[["target_id"]]
        eval_set_name <- call_args[["eval_set_name"]]
        by <- call_args[["by"]]
        out_path <- call_args[["out_path"]]
        by_note <- if (is.null(by)) "" else sprintf(" / %s", by)
        message(sprintf(
          "Skipping scores for '%s' / '%s'%s: forecasts have no overlapping observations.\n",
          target_id,
          eval_set_name,
          by_note
        ))
        # Drop a stale scores.csv from the predevals/data checkout so this
        # empty join is not republished.
        if (!is.null(out_path) && !is.null(target_id) && !is.null(eval_set_name)) {
          dir <- file.path(out_path, target_id, eval_set_name)
          if (!is.null(by)) {
            dir <- file.path(dir, by)
          }
          csv <- file.path(dir, "scores.csv")
          if (file.exists(csv)) {
            unlink(csv)
          }
        }
        invisible(NULL)
      }
    )
  }
  assignInNamespace("get_and_save_scores", wrapped, ns = ns)
}

run_create_predevals_data <- function() {
  patch_skip_empty_oracle_join()
  script <- Sys.getenv(
    "CREATE_PREDEVALS_DATA_R",
    unset = "/usr/local/bin/create-predevals-data.R"
  )
  if (!file.exists(script)) {
    stop("create-predevals-data.R not found at ", script, call. = FALSE)
  }
  sys.source(script, envir = globalenv())
}

if (sys.nframe() == 0L) {
  run_create_predevals_data()
}
