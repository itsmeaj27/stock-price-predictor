"""
predict.py — Load saved RF model and generate a prediction for
             a given ticker using the latest available data.
"""

import os
import warnings
import yfinance as yf
import pandas as pd
import numpy as np
import joblib

from model.train import engineer_features, get_feature_columns, clean_features

warnings.filterwarnings("ignore")

BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")


def load_model(ticker: str):
    """Load the Random Forest model and scaler for a given ticker."""
    model_path  = os.path.join(MODEL_DIR, f"{ticker}_rf_model.pkl")
    scaler_path = os.path.join(MODEL_DIR, f"{ticker}_scaler.pkl")

    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"No trained model found for '{ticker}'. "
            "Please train the model first via /api/train."
        )

    model  = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    return model, scaler


def predict(ticker: str) -> dict:
    """
    Fetch the latest data for `ticker`, engineer features,
    and return a prediction dict.
    """
    model, scaler = load_model(ticker)

    # Fetch last 200 trading days for indicator calculation
    df_raw = yf.download(ticker, period="200d", auto_adjust=True, progress=False)
    if df_raw.empty:
        raise ValueError(f"Could not fetch data for ticker '{ticker}'")

    # Flatten MultiIndex columns if present
    if isinstance(df_raw.columns, pd.MultiIndex):
        df_raw.columns = df_raw.columns.get_level_values(0)

    df = engineer_features(df_raw)

    features = get_feature_columns(df)

    # Clean inf/NaN before predicting
    df = clean_features(df, features)

    # Use only the last row (most recent trading day)
    X_latest = df[features].iloc[[-1]].values

    # Safety check
    if not np.isfinite(X_latest).all():
        X_latest = np.nan_to_num(X_latest, nan=0.0, posinf=0.0, neginf=0.0)

    X_scaled = scaler.transform(X_latest)

    pred_label = int(model.predict(X_scaled)[0])
    pred_proba = model.predict_proba(X_scaled)[0]

    direction   = "UP 📈" if pred_label == 1 else "DOWN 📉"
    confidence  = float(pred_proba[pred_label]) * 100

    latest_row      = df.iloc[-1]
    current_price   = float(latest_row["Close"])
    rsi_14          = float(latest_row.get("rsi_14", 0))
    macd_val        = float(latest_row.get("macd", 0))
    macd_sig        = float(latest_row.get("macd_signal", 0))
    bb_pct          = float(latest_row.get("bb_pct", 0))

    # Load feature importance
    fi_path = os.path.join(MODEL_DIR, f"{ticker}_feature_importance.csv")
    feature_importances = {}
    if os.path.exists(fi_path):
        fi_df = pd.read_csv(fi_path, index_col=0)
        fi_df.columns = ["importance"]
        feature_importances = fi_df.head(15)["importance"].to_dict()

    return {
        "ticker":        ticker,
        "prediction":    pred_label,
        "direction":     direction,
        "confidence":    round(confidence, 2),
        "current_price": round(current_price, 2),
        "date":          str(df.index[-1].date()),
        "indicators": {
            "rsi_14":       round(rsi_14, 2),
            "macd":         round(macd_val, 4),
            "macd_signal":  round(macd_sig, 4),
            "bb_pct":       round(bb_pct, 4),
        },
        "feature_importances": feature_importances,
    }


if __name__ == "__main__":
    import sys, json
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    result = predict(ticker)
    print(json.dumps(result, indent=2))
