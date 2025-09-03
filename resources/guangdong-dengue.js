(function () {
  const chartEl = document.getElementById("gd-dengue-chart");
  if (!chartEl) {
    return;
  }

  const csvUrl = new URL("resources/guangdong_dengue_monthly.csv", document.baseURI).href;

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    if (lines.length < 2) {
      return [];
    }
    const header = lines.shift().split(",");
    const idx = {};
    header.forEach(function (name, i) {
      idx[name] = i;
    });
    return lines.map(function (line) {
      const cols = line.split(",");
      const raw = cols[idx.cases] === undefined ? "" : cols[idx.cases];
      const parsed = raw === "" ? null : Number(raw);
      return {
        date: cols[idx.date],
        year_month: cols[idx.year_month],
        cases: parsed === null || !Number.isFinite(parsed) ? null : parsed,
        source: cols[idx.source] || "",
        source_url: cols.slice(idx.source_url).join(",")
      };
    });
  }

  fetch(csvUrl)
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load Guangdong dengue CSV (" + response.status + ")");
      }
      return response.text();
    })
    .then(function (text) {
      const rows = parseCsv(text);
      const observed = rows.filter(function (row) { return row.cases !== null; });
      Plotly.newPlot(
        chartEl,
        [{
          type: "scatter",
          mode: "lines",
          name: "Reported cases",
          x: rows.map(function (row) { return row.date; }),
          y: rows.map(function (row) { return row.cases; }),
          customdata: rows.map(function (row) {
            return [row.year_month, row.source];
          }),
          connectgaps: false,
          line: { color: "#c0392b", width: 1.6 },
          hovertemplate: "%{customdata[0]}<br>Cases: %{y:,}<br>%{customdata[1]}<extra></extra>"
        }],
        {
          margin: { t: 16, r: 24, b: 48, l: 64 },
          xaxis: { title: "Month", showgrid: false },
          yaxis: { title: "Reported cases", rangemode: "tozero", separatethousands: true, gridcolor: "#eee" },
          hovermode: "closest",
          showlegend: false,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)"
        },
        { responsive: true, displaylogo: false }
      );

      const caption = document.getElementById("gd-dengue-caption");
      if (caption && observed.length) {
        const first = observed[0].year_month;
        const last = observed[observed.length - 1].year_month;
        const missing = rows.length - observed.length;
        caption.textContent =
          observed.length + " months with reported counts (" + first + " to " + last +
          "); " + missing + " months left blank and shown as breaks.";
      }
    })
    .catch(function (err) {
      chartEl.textContent = "Unable to load the Guangdong dengue series.";
      console.error(err);
    });
})();
