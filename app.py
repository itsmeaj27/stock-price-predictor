"""
app.py — Flask backend for the Stock Price Predictor dashboard.

Endpoints:
  GET  /                          → serve the dashboard HTML
  GET  /api/history?ticker=AAPL   → OHLCV + indicator data (JSON)
  POST /api/train                 → train / retrain model for a ticker
  GET  /api/predict?ticker=AAPL   → get RF prediction + confidence
  GET  /api/metrics?ticker=AAPL   → model evaluation metrics
  GET  /api/tickers               → list of tickers with trained models
"""

import os
import sys
import json
import warnings
import threading

# pyrefly: ignore [missing-import]
import yfinance as yf
import pandas as pd
# pyrefly: ignore [missing-import]
from flask import Flask, jsonify, request, render_template, abort

warnings.filterwarnings("ignore")

# Make sure the project root is on the path so `model.*` imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model.train    import train_model, fetch_data, engineer_features, get_feature_columns
from model.predict  import predict as rf_predict
from model.evaluate import evaluate as rf_evaluate

app = Flask(__name__)

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "saved_models")
os.makedirs(MODEL_DIR, exist_ok=True)

# ── In-memory training status tracker ────────────────────────────────────────
training_status: dict[str, str] = {}   # ticker → "training" | "done" | "error:<msg>"


# ─────────────────────────────────────────────────────────────────────────────
#  Helper: check whether a model exists for a ticker
# ─────────────────────────────────────────────────────────────────────────────
def model_exists(ticker: str) -> bool:
    return os.path.exists(os.path.join(MODEL_DIR, f"{ticker}_rf_model.pkl"))


# ─────────────────────────────────────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------- #
@app.route("/api/search")
def api_search():
    """Search stocks by company name or ticker via Yahoo Finance."""
    query = request.args.get("q", "").strip()
    if len(query) < 1:
        return jsonify({"results": []})

    try:
        import requests as req
        url = (
            f"https://query1.finance.yahoo.com/v1/finance/search"
            f"?q={query}&quotesCount=10&newsCount=0&enableFuzzyQuery=true"
            f"&quotesQueryId=tss_match_phrase_query"
        )
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = req.get(url, headers=headers, timeout=5)
        data = resp.json()

        results = []
        for item in data.get("quotes", []):
            qtype = item.get("quoteType", "")
            # Only include equities and ETFs
            if qtype not in ("EQUITY", "ETF"):
                continue
            symbol   = item.get("symbol", "")
            name     = item.get("longname") or item.get("shortname") or symbol
            exchange = item.get("exchDisp", item.get("exchange", ""))
            results.append({
                "symbol":   symbol,
                "name":     name,
                "exchange": exchange,
                "type":     qtype,
            })

        return jsonify({"results": results[:8]})

    except Exception as exc:
        return jsonify({"results": [], "error": str(exc)})


# --------------------------------------------------------------------------- #
@app.route("/api/history")
def api_history():
    """Return OHLCV + technical indicators as JSON for charting."""
    ticker = request.args.get("ticker", "AAPL").upper().strip()
    period = request.args.get("period", "1y")

    try:
        df_raw = yf.download(ticker, period=period, auto_adjust=True, progress=False)
        if df_raw.empty:
            return jsonify({"error": f"No data for ticker '{ticker}'"}), 404

        # Flatten MultiIndex columns if present
        if isinstance(df_raw.columns, pd.MultiIndex):
            df_raw.columns = df_raw.columns.get_level_values(0)

        df = engineer_features(df_raw)

        def safe_float(val, precision=2):
            if pd.isna(val) or val is None:
                return None
            return round(float(val), precision)

        records = []
        for date, row in df.iterrows():
            records.append({
                "date":   str(date.date()),
                "open":   safe_float(row.get("Open")),
                "high":   safe_float(row.get("High")),
                "low":    safe_float(row.get("Low")),
                "close":  safe_float(row.get("Close")),
                "volume": int(row.get("Volume", 0)) if pd.notna(row.get("Volume")) else None,
                "sma_20": safe_float(row.get("sma_20")),
                "ema_20": safe_float(row.get("ema_20")),
                "sma_50": safe_float(row.get("sma_50")),
                "rsi_14": safe_float(row.get("rsi_14")),
                "macd":         safe_float(row.get("macd"), 4),
                "macd_signal":  safe_float(row.get("macd_signal"), 4),
                "bb_high":  safe_float(row.get("bb_high")),
                "bb_low":   safe_float(row.get("bb_low")),
                "target":   int(row["target"]) if pd.notna(row.get("target")) else None,
            })

        return jsonify({
            "ticker":  ticker,
            "period":  period,
            "records": records,
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# --------------------------------------------------------------------------- #
@app.route("/api/train", methods=["POST"])
def api_train():
    """Kick off model training in a background thread."""
    data   = request.get_json(silent=True) or {}
    ticker = data.get("ticker", "AAPL").upper().strip()
    period = data.get("period", "5y")

    if training_status.get(ticker) == "training":
        return jsonify({"message": f"Already training {ticker}", "status": "training"}), 202

    def _train():
        training_status[ticker] = "training"
        try:
            result = train_model(ticker, period=period)
            training_status[ticker] = "done"
        except Exception as exc:
            training_status[ticker] = f"error:{exc}"

    thread = threading.Thread(target=_train, daemon=True)
    thread.start()

    return jsonify({
        "message": f"Training started for {ticker}",
        "status":  "training",
        "ticker":  ticker,
    }), 202


@app.route("/api/train/status")
def api_train_status():
    ticker = request.args.get("ticker", "AAPL").upper().strip()
    status = training_status.get(ticker, "not_started")
    trained = model_exists(ticker)
    return jsonify({"ticker": ticker, "status": status, "model_exists": trained})


# --------------------------------------------------------------------------- #
@app.route("/api/predict")
def api_predict():
    ticker = request.args.get("ticker", "AAPL").upper().strip()

    if not model_exists(ticker):
        return jsonify({
            "error": f"No model found for '{ticker}'. Please train first.",
            "model_exists": False,
        }), 404

    try:
        result = rf_predict(ticker)
        result["model_exists"] = True
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# --------------------------------------------------------------------------- #
@app.route("/api/metrics")
def api_metrics():
    ticker = request.args.get("ticker", "AAPL").upper().strip()

    if not model_exists(ticker):
        return jsonify({
            "error": f"No model found for '{ticker}'. Please train first.",
            "model_exists": False,
        }), 404

    try:
        result = rf_evaluate(ticker)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# --------------------------------------------------------------------------- #
@app.route("/api/tickers")
def api_tickers():
    """List all tickers that have a trained model."""
    tickers = []
    if os.path.isdir(MODEL_DIR):
        for fname in os.listdir(MODEL_DIR):
            if fname.endswith("_rf_model.pkl"):
                tickers.append(fname.replace("_rf_model.pkl", ""))
    return jsonify({"tickers": sorted(tickers)})


# --------------------------------------------------------------------------- #
@app.route("/api/exchange_rate")
def api_exchange_rate():
    """Fetch live USD-INR exchange rate (with fallback)"""
    try:
        df = yf.download("USDINR=X", period="1d", progress=False)
        rate = float(df["Close"].iloc[-1])
        return jsonify({"USD_INR": rate})
    except Exception:
        return jsonify({"USD_INR": 83.5})


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  Stock Price Predictor — Random Forest ML Dashboard")
    print("  Visit: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(debug=True, host="0.0.0.0", port=5000)
