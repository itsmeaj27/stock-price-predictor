/* ═══════════════════════════════════════════════════════════════════
   dashboard.js — StockSense AI frontend logic
   Supports: US / India NSE / India BSE / Global markets
   ═══════════════════════════════════════════════════════════════════ */

"use strict";

// ── Market configuration ────────────────────────────────────────────
const MARKETS = {
  US: {
    suffix:      "",
    currency:    "$",
    hint:        "Enter any US stock symbol — e.g. AAPL, TSLA, NVDA",
    placeholder: "e.g. AAPL, TSLA, MSFT, NVDA",
    quickPicks: [
      { label: "AAPL",  ticker: "AAPL"  },
      { label: "TSLA",  ticker: "TSLA"  },
      { label: "MSFT",  ticker: "MSFT"  },
      { label: "GOOGL", ticker: "GOOGL" },
      { label: "AMZN",  ticker: "AMZN"  },
      { label: "NVDA",  ticker: "NVDA"  },
      { label: "META",  ticker: "META"  },
      { label: "NFLX",  ticker: "NFLX"  },
    ],
  },
  NSE: {
    suffix:      ".NS",
    currency:    "₹",
    hint:        "Enter NSE symbol only — .NS is added automatically  (e.g. type RELIANCE, not RELIANCE.NS)",
    placeholder: "e.g. RELIANCE, TCS, INFY, HDFCBANK",
    quickPicks: [
      { label: "Reliance",   ticker: "RELIANCE"   },
      { label: "TCS",        ticker: "TCS"        },
      { label: "Infosys",    ticker: "INFY"       },
      { label: "HDFC Bank",  ticker: "HDFCBANK"   },
      { label: "ICICI Bank", ticker: "ICICIBANK"  },
      { label: "Wipro",      ticker: "WIPRO"      },
      { label: "Maruti",     ticker: "MARUTI"     },
      { label: "Bajaj Fin",  ticker: "BAJFINANCE" },
      { label: "SBI",        ticker: "SBIN"       },
      { label: "Adani Ent",  ticker: "ADANIENT"   },
    ],
  },
  BSE: {
    suffix:      ".BO",
    currency:    "₹",
    hint:        "Enter BSE symbol only — .BO is added automatically  (e.g. type RELIANCE, not RELIANCE.BO)",
    placeholder: "e.g. RELIANCE, TCS, INFY, HDFCBANK",
    quickPicks: [
      { label: "Reliance",   ticker: "RELIANCE"   },
      { label: "TCS",        ticker: "TCS"        },
      { label: "Infosys",    ticker: "INFY"       },
      { label: "HDFC Bank",  ticker: "HDFCBANK"   },
      { label: "ICICI Bank", ticker: "ICICIBANK"  },
      { label: "Wipro",      ticker: "WIPRO"      },
      { label: "Maruti",     ticker: "MARUTI"     },
      { label: "Bajaj Fin",  ticker: "BAJFINANCE" },
      { label: "SBI",        ticker: "SBIN"       },
      { label: "HUL",        ticker: "HINDUNILVR" },
    ],
  },
  GLOBAL: {
    suffix:      "",
    currency:    "",   // detected per-ticker from API
    hint:        "Use Yahoo Finance format: TSM (Taiwan), BABA (NYSE), VOW.DE (Germany), 7203.T (Japan), HSBA.L (UK)",
    placeholder: "e.g. TSM, VOW.DE, 7203.T, HSBA.L, BABA",
    quickPicks: [
      { label: "TSMC (TW)",    ticker: "TSM"    },
      { label: "Toyota (JP)",  ticker: "7203.T" },
      { label: "SAP (DE)",     ticker: "SAP.DE" },
      { label: "HSBC (UK)",    ticker: "HSBA.L" },
      { label: "Alibaba",      ticker: "BABA"   },
      { label: "Samsung (KR)", ticker: "005930.KS" },
      { label: "Shell (UK)",   ticker: "SHEL.L" },
      { label: "Nestlé (CH)",  ticker: "NESN.SW"},
    ],
  },
};

// ── State ──────────────────────────────────────────────────────────
let currentTicker  = "";
let currentMarket  = "US";
let currentPeriod  = "3mo";
let priceChart     = null;
let rsiChart       = null;
let macdChart      = null;
let featChart      = null;
let trainingPoller = null;
let searchTimeout  = null;

let exchangeRateUSDINR = 83.5;
let displayCurrency    = "AUTO";
let currentHistoryData = null;
let currentPredictionData = null;

// ── Init ───────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  // Fetch exchange rate in background
  fetch("/api/exchange_rate")
    .then(res => res.json())
    .then(data => { if (data.USD_INR) exchangeRateUSDINR = data.USD_INR; })
    .catch(err => console.error("Exchange rate fetch error", err));

  // Attach Enter key listener after DOM is ready
  const inputEl = document.getElementById("tickerInput");
  
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      document.getElementById("autocompleteList").style.display = "none";
      loadTicker();
    }
  });

  // Autocomplete Input listener
  inputEl.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      document.getElementById("autocompleteList").style.display = "none";
      return;
    }
    // Debounce 300ms
    searchTimeout = setTimeout(() => {
      fetchSearchSuggestions(query);
    }, 300);
  });

  // Close autocomplete when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) {
      document.getElementById("autocompleteList").style.display = "none";
    }
  });

  // Render default quick picks (US market)
  renderQuickPicks("US");

  // Do NOT auto-load any stock — let the user choose
});

// ── Market switcher ────────────────────────────────────────────────
function switchMarket(btn, market) {
  currentMarket = market;
  document.querySelectorAll(".market-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const cfg = MARKETS[market];
  document.getElementById("tickerInput").value       = "";
  document.getElementById("tickerInput").placeholder = cfg.placeholder;

  // Per-market friendly hints
  const hints = {
    US:     "🇺🇸 Type any US stock symbol and click Analyse — e.g. AAPL, TSLA, NVDA",
    NSE:    "🇮🇳 Type the NSE symbol (without .NS) and click Analyse — e.g. RELIANCE, TCS, INFY",
    BSE:    "🇮🇳 Type the BSE symbol (without .BO) and click Analyse — e.g. RELIANCE, TCS, WIPRO",
    GLOBAL: "🌍 Use Yahoo Finance format: VOW.DE (Germany) · 7203.T (Japan) · HSBA.L (UK) · TSM (Taiwan)",
  };
  document.getElementById("marketHint").textContent = hints[market] || cfg.hint;

  // Show/hide suffix badge
  const badge = document.getElementById("suffixBadge");
  if (cfg.suffix) {
    badge.textContent   = "+ " + cfg.suffix;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }

  renderQuickPicks(market);
}

// ── Build quick-pick chips ─────────────────────────────────────────
function renderQuickPicks(market) {
  const wrap = document.getElementById("quickTickers");
  const cfg  = MARKETS[market];
  wrap.innerHTML = `<span class="ql">Quick pick:</span>` +
    cfg.quickPicks.map(p =>
      `<button class="chip" onclick="quickPick('${p.ticker}')">${p.label}</button>`
    ).join("");
}

// ── Build full ticker with suffix ──────────────────────────────────
function buildTicker(raw) {
  const suffix = MARKETS[currentMarket].suffix;
  // If user already typed the suffix themselves, don't double-add
  if (suffix && !raw.toUpperCase().endsWith(suffix.toUpperCase())) {
    return raw.toUpperCase() + suffix;
  }
  return raw.toUpperCase();
}

// ── Currency symbol helper ─────────────────────────────────────────
// Not used anymore since getCurrencyInfo replaces it, but kept for fallback
function currencySymbol(ticker) {
  const t = ticker.toUpperCase();
  if (t.endsWith(".NS") || t.endsWith(".BO")) return "₹";
  if (t.endsWith(".L")) return "£";
  if (t.endsWith(".DE") || t.endsWith(".PA")) return "€";
  return "$";
}

// ── Enter key in search ────────────────────────────────────────────
// NOTE: listener is attached inside DOMContentLoaded above

// ── Autocomplete / Search API ──────────────────────────────────────
async function fetchSearchSuggestions(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const list = document.getElementById("autocompleteList");
    
    if (!data.results || data.results.length === 0) {
      list.style.display = "none";
      return;
    }

    list.innerHTML = data.results.map(item => `
      <li class="autocomplete-item" onclick="selectSuggestion('${item.symbol}')">
        <div class="ac-left">
          <span class="ac-symbol">${item.symbol}</span>
          <span class="ac-name">${item.name}</span>
        </div>
        <span class="ac-exch">${item.exchange}</span>
      </li>
    `).join("");
    
    list.style.display = "block";
  } catch (err) {
    console.error("Search API error:", err);
  }
}

function selectSuggestion(symbol) {
  document.getElementById("tickerInput").value = symbol;
  document.getElementById("autocompleteList").style.display = "none";
  loadTicker();
}

// ── Currency Toggle ───────────────────────────────────────────────
function setCurrency(mode) {
  displayCurrency = mode;
  document.querySelectorAll(".curr-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.querySelector(`.curr-btn[data-curr="${mode}"]`);
  if (activeBtn) activeBtn.classList.add("active");
  
  if (currentTicker) {
    const currInfo = getCurrencyInfo(currentTicker);
    if (currentHistoryData) renderHistory(currInfo);
    if (currentPredictionData) renderPrediction(currentPredictionData, currInfo);
  }
}

function toggleInstantCurrency() {
  const modes = ["AUTO", "USD", "INR"];
  let nextIdx = (modes.indexOf(displayCurrency) + 1) % modes.length;
  setCurrency(modes[nextIdx]);
}

// ── Quick pick ────────────────────────────────────────────────────
function quickPick(ticker) {
  document.getElementById("tickerInput").value = ticker;
  loadTicker();
}

// ── Helpers ───────────────────────────────────────────────────────
function getCurrencyInfo(ticker) {
  const isINR = ticker.endsWith(".NS") || ticker.endsWith(".BO");
  const baseSym = isINR ? "₹" : "$";
  
  let targetSym = baseSym;
  let rate = 1.0;

  if (displayCurrency === "USD" && isINR) {
    targetSym = "$";
    rate = 1.0 / exchangeRateUSDINR;
  } else if (displayCurrency === "INR" && !isINR) {
    targetSym = "₹";
    rate = exchangeRateUSDINR;
  }
  
  return { sym: targetSym, rate: rate };
}

// ── Period tab switch ─────────────────────────────────────────────
function changePeriod(btn, period) {
  document.querySelectorAll(".period-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentPeriod = period;
  if (currentTicker) {
    const currInfo = getCurrencyInfo(currentTicker);
    loadHistory(currentTicker, period, currInfo);
  }
}

// ── Main load ─────────────────────────────────────────────────────
async function loadTicker() {
  const raw = document.getElementById("tickerInput").value.trim();
  if (!raw) { showToast("⚠️ Please enter a ticker symbol", "warn"); return; }

  const full = buildTicker(raw);
  currentTicker = full;

  const currInfo = getCurrencyInfo(full);
  const marketLabel = MARKETS[currentMarket]
    ? `${document.querySelector(".market-tab.active").textContent.trim()}`
    : "";

  showLoading(`Fetching ${full} data (${marketLabel})…`);

  try {
    await loadHistory(full, currentPeriod, currInfo);

    document.getElementById("mainContent").style.display = "flex";
    document.getElementById("cardTicker").textContent    = full;

    await tryLoadPrediction(full);
    await tryLoadMetrics(full);

  } catch (err) {
    showToast("❌ " + err.message, "error");
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ── History + charts ──────────────────────────────────────────────
async function loadHistory(ticker, period, currInfo) {
  const res  = await fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&period=${period}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load history for " + ticker);

  currentHistoryData = data.records;
  renderHistory(currInfo);
  return true;
}

function renderHistory(currInfo) {
  if (!currentHistoryData) return;
  // Convert prices
  const records = currentHistoryData.map(r => ({
    ...r,
    open: r.open !== null ? r.open * currInfo.rate : null,
    high: r.high !== null ? r.high * currInfo.rate : null,
    low: r.low !== null ? r.low * currInfo.rate : null,
    close: r.close !== null ? r.close * currInfo.rate : null,
    sma_20: r.sma_20 !== null ? r.sma_20 * currInfo.rate : null,
    ema_20: r.ema_20 !== null ? r.ema_20 * currInfo.rate : null,
    sma_50: r.sma_50 !== null ? r.sma_50 * currInfo.rate : null,
    bb_high: r.bb_high !== null ? r.bb_high * currInfo.rate : null,
    bb_low: r.bb_low !== null ? r.bb_low * currInfo.rate : null,
  }));

  renderPriceChart(records, currInfo.sym);
  renderRsiChart(records);
  renderMacdChart(records);
}

// ── Prediction ────────────────────────────────────────────────────
async function tryLoadPrediction(ticker) {
  const res  = await fetch(`/api/predict?ticker=${encodeURIComponent(ticker)}`);
  const data = await res.json();

  if (!res.ok) {
    currentPredictionData = null;
    document.getElementById("predDirection").textContent = "Train model →";
    document.getElementById("predDirection").className   = "prediction-direction";
    document.getElementById("confVal").textContent       = "—%";
    document.getElementById("confBar").style.width       = "0%";
    
    const currInfo = getCurrencyInfo(ticker);
    document.getElementById("currentPrice").textContent  = currInfo.sym + "—";
    
    document.getElementById("predDate").textContent      = "—";
    document.getElementById("trainStatus").textContent   = "No model trained yet for " + ticker;
    resetIndicators();
    return;
  }

  currentPredictionData = data;
  const currInfo = getCurrencyInfo(ticker);
  renderPrediction(data, currInfo);
}

function renderPrediction(data, currInfo) {
  const dirEl = document.getElementById("predDirection");
  dirEl.textContent = data.direction;
  dirEl.className   = "prediction-direction " + (data.prediction === 1 ? "up" : "down");

  document.getElementById("confVal").textContent = data.confidence + "%";
  setTimeout(() => {
    document.getElementById("confBar").style.width = data.confidence + "%";
  }, 100);

  const convPrice = data.current_price * currInfo.rate;
  document.getElementById("currentPrice").textContent = currInfo.sym + convPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  
  document.getElementById("predDate").textContent     = data.date;
  document.getElementById("trainStatus").textContent  = "";

  populateIndicators(data.indicators || {});

  if (data.feature_importances && Object.keys(data.feature_importances).length > 0) {
    renderFeatChart(data.feature_importances);
  }
}

// ── Metrics ───────────────────────────────────────────────────────
async function tryLoadMetrics(ticker) {
  const res  = await fetch(`/api/metrics?ticker=${encodeURIComponent(ticker)}`);
  const data = await res.json();
  if (!res.ok) return;

  setMetric("metAccuracy",  pct(data.accuracy));
  setMetric("metPrecision", pct(data.precision));
  setMetric("metRecall",    pct(data.recall));
  setMetric("metF1",        pct(data.f1_score));
  setMetric("metRoc",       pct(data.roc_auc));
  setMetric("metSamples",   data.test_samples);

  if (data.confusion_matrix) renderConfusionMatrix(data.confusion_matrix);
  if (data.feature_importances && Object.keys(data.feature_importances).length > 0) {
    renderFeatChart(data.feature_importances);
  }
}

// ── Train model ───────────────────────────────────────────────────
async function trainModel() {
  if (!currentTicker) { showToast("⚠️ Load a ticker first", "warn"); return; }

  const btn = document.getElementById("trainBtn");
  btn.disabled = true;
  document.getElementById("trainStatus").textContent = "⏳ Sending training request…";

  try {
    await fetch("/api/train", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ticker: currentTicker, period: "5y" }),
    });
    showToast(`🚀 Training started for ${currentTicker}. Takes 1–2 minutes…`, "info");
    document.getElementById("trainStatus").textContent = "⏳ Training in progress…";
    pollTrainingStatus(currentTicker);
  } catch (err) {
    document.getElementById("trainStatus").textContent = "❌ " + err.message;
    btn.disabled = false;
  }
}

function pollTrainingStatus(ticker) {
  if (trainingPoller) clearInterval(trainingPoller);
  trainingPoller = setInterval(async () => {
    const res  = await fetch(`/api/train/status?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();

    if (data.status === "done" && data.model_exists) {
      clearInterval(trainingPoller);
      document.getElementById("trainBtn").disabled = false;
      document.getElementById("trainStatus").textContent = "✅ Training complete!";
      showToast("✅ Model trained successfully for " + ticker, "success");
      await tryLoadPrediction(ticker);
      await tryLoadMetrics(ticker);
    } else if (data.status && data.status.startsWith("error:")) {
      clearInterval(trainingPoller);
      document.getElementById("trainBtn").disabled = false;
      document.getElementById("trainStatus").textContent = "❌ " + data.status;
    }
  }, 4000);
}

// ═══════════════════════  CHART RENDERERS  ════════════════════════

function renderPriceChart(records, currency) {
  const labels = records.map(r => r.date);
  const close  = records.map(r => r.close);
  const sma20  = records.map(r => r.sma_20);
  const sma50  = records.map(r => r.sma_50);

  if (priceChart) priceChart.destroy();
  const ctx  = document.getElementById("priceChart").getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "rgba(59,130,246,0.25)");
  grad.addColorStop(1, "rgba(59,130,246,0)");

  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Close", data: close, borderColor: "#3b82f6", backgroundColor: grad, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
        { label: "SMA 20", data: sma20, borderColor: "#f59e0b", borderWidth: 1.5, fill: false, tension: 0.35, pointRadius: 0, borderDash: [4, 3] },
        { label: "SMA 50", data: sma50, borderColor: "#10b981", borderWidth: 1.5, fill: false, tension: 0.35, pointRadius: 0, borderDash: [6, 4] },
      ],
    },
    options: chartOptions(`Price (${currency})`, currency),
  });
}

function renderRsiChart(records) {
  if (rsiChart) rsiChart.destroy();
  const ctx = document.getElementById("rsiChart").getContext("2d");
  rsiChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: records.map(r => r.date),
      datasets: [{ label: "RSI 14", data: records.map(r => r.rsi_14), borderColor: "#8b5cf6", backgroundColor: "rgba(139,92,246,0.08)", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0 }],
    },
    options: { ...chartOptions("RSI"), scales: { ...chartOptions().scales, y: { ...chartOptions().scales?.y, min: 0, max: 100, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#94a3b8", font: { size: 11 } } } } },
  });
}

function renderMacdChart(records) {
  if (macdChart) macdChart.destroy();
  const ctx = document.getElementById("macdChart").getContext("2d");
  macdChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: records.map(r => r.date),
      datasets: [
        { label: "MACD",   data: records.map(r => r.macd),        borderColor: "#38bdf8", fill: false, tension: 0.35, borderWidth: 2,   pointRadius: 0 },
        { label: "Signal", data: records.map(r => r.macd_signal), borderColor: "#f97316", fill: false, tension: 0.35, borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] },
      ],
    },
    options: chartOptions("MACD"),
  });
}

function renderFeatChart(importances) {
  const sorted = Object.entries(importances).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => +(v * 100).toFixed(2));
  const colors = labels.map(l => {
    if (l.includes("rsi"))               return "rgba(139,92,246,0.85)";
    if (l.includes("macd"))              return "rgba(14,165,233,0.85)";
    if (l.includes("sma") || l.includes("ema")) return "rgba(245,158,11,0.85)";
    if (l.includes("bb"))                return "rgba(239,68,68,0.85)";
    if (l.includes("volume"))            return "rgba(16,185,129,0.85)";
    return "rgba(59,130,246,0.85)";
  });

  if (featChart) featChart.destroy();
  const ctx = document.getElementById("featChart").getContext("2d");
  featChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Importance (%)", data: values, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(2)}%` } } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#94a3b8", font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, family: "'JetBrains Mono', monospace" } } },
      },
    },
  });
  document.getElementById("featChart").style.minHeight = "320px";
}

function renderConfusionMatrix(cm) {
  const wrap = document.getElementById("cmWrap");
  const grid = document.getElementById("cmGrid");
  wrap.style.display = "block";
  const [[tn, fp], [fn, tp]] = cm;
  grid.innerHTML = `
    <div class="cm-cell tn">${tn}<small>TN</small></div>
    <div class="cm-cell fp">${fp}<small>FP</small></div>
    <div class="cm-cell fn">${fn}<small>FN</small></div>
    <div class="cm-cell tp">${tp}<small>TP</small></div>
  `;
}

// ═══════════════════════  HELPERS  ════════════════════════════════

function chartOptions(yLabel = "", currency = "") {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#94a3b8", font: { size: 12 }, usePointStyle: true, pointStyleWidth: 10, padding: 20 } },
      tooltip: { 
        backgroundColor: "rgba(15,23,42,0.95)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, titleColor: "#f8fafc", bodyColor: "#cbd5e1", padding: 12, cornerRadius: 8,
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += currency + context.parsed.y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            return label;
          }
        }
      },
    },
    scales: {
      x: { type: "category", ticks: { color: "#94a3b8", font: { size: 11 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: "rgba(255,255,255,0.05)" } },
      y: { 
        ticks: { 
          color: "#94a3b8", 
          font: { size: 11 },
          callback: function(value, index, values) {
            return currency + value;
          }
        }, 
        grid: { color: "rgba(255,255,255,0.05)" }, 
        title: yLabel ? { display: true, text: yLabel, color: "#94a3b8", font: { size: 11 } } : undefined 
      },
    },
  };
}

function pct(val) { return (val !== undefined && val !== null) ? (val * 100).toFixed(1) + "%" : "—"; }
function setMetric(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function populateIndicators(ind) {
  const rsi = ind.rsi_14;
  document.getElementById("indRsi").textContent      = rsi ?? "—";
  document.getElementById("indRsiBadge").textContent = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral";
  document.getElementById("indRsiBadge").className   = "ind-badge " + (rsi > 70 ? "badge-sell" : rsi < 30 ? "badge-buy" : "badge-neutral");

  const macd = ind.macd, sig = ind.macd_signal;
  document.getElementById("indMacd").textContent     = macd ?? "—";
  document.getElementById("indMacdSig").textContent  = sig  ?? "—";
  const bull = macd > sig;
  document.getElementById("indMacdBadge").textContent = bull ? "Bullish" : "Bearish";
  document.getElementById("indMacdBadge").className   = "ind-badge " + (bull ? "badge-buy" : "badge-sell");

  const bb = ind.bb_pct;
  document.getElementById("indBb").textContent      = bb ?? "—";
  document.getElementById("indBbBadge").textContent = bb > 0.8 ? "Overbought" : bb < 0.2 ? "Oversold" : "Normal";
  document.getElementById("indBbBadge").className   = "ind-badge " + (bb > 0.8 ? "badge-sell" : bb < 0.2 ? "badge-buy" : "badge-neutral");
}

function resetIndicators() {
  ["indRsi","indMacd","indMacdSig","indBb"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "—"; });
  ["indRsiBadge","indMacdBadge","indBbBadge"].forEach(id => { const el = document.getElementById(id); if (el) { el.textContent = ""; el.className = "ind-badge"; } });
}

function showLoading(text) {
  document.getElementById("spinnerText").textContent = text || "Loading…";
  document.getElementById("loadingOverlay").classList.add("active");
}
function hideLoading() { document.getElementById("loadingOverlay").classList.remove("active"); }
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 4500);
}

// ── Keyboard shortcut: "/" focuses search ──────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== document.getElementById("tickerInput")) {
    e.preventDefault();
    document.getElementById("tickerInput").focus();
  }
});
