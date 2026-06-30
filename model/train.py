"""
train.py — Fetch historical stock data, engineer features,
train a Random Forest model, and save it.
"""

import os
import warnings
import yfinance as yf
import pandas as pd
import numpy as np
from ta import add_all_ta_features
from ta.momentum import RSIIndicator
from ta.trend import MACD, SMAIndicator, EMAIndicator
from ta.volatility import BollingerBands
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, accuracy_score
import joblib

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)


def fetch_data(ticker: str, period: str = "5y") -> pd.DataFrame:
    """Download OHLCV data from Yahoo Finance."""
    print(f"[INFO] Fetching data for {ticker} ({period})...")
    df = yf.download(ticker, period=period, auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError(f"No data found for ticker '{ticker}'")
    df.dropna(inplace=True)
    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    csv_path = os.path.join(DATA_DIR, f"{ticker}_raw.csv")
    df.to_csv(csv_path)
    print(f"[INFO] Saved raw data to {csv_path}  ({len(df)} rows)")
    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create technical indicator features from OHLCV data."""
    df = df.copy()

    # ── Price-derived features ───────────────────────────────────────────────
    df["daily_return"]   = df["Close"].pct_change()
    df["log_return"]     = np.log(df["Close"] / df["Close"].shift(1))
    df["high_low_range"] = (df["High"] - df["Low"]) / df["Close"]
    df["open_close"]     = (df["Close"] - df["Open"]) / df["Open"]

    # ── Moving Averages ──────────────────────────────────────────────────────
    for w in [5, 10, 20, 50]:
        df[f"sma_{w}"] = SMAIndicator(df["Close"], window=w).sma_indicator()
        df[f"ema_{w}"] = EMAIndicator(df["Close"], window=w).ema_indicator()

    # Price relative to MAs
    for w in [5, 10, 20, 50]:
        df[f"price_sma_{w}_ratio"] = df["Close"] / df[f"sma_{w}"]

    # ── RSI ──────────────────────────────────────────────────────────────────
    for w in [7, 14, 21]:
        df[f"rsi_{w}"] = RSIIndicator(df["Close"], window=w).rsi()

    # ── MACD ─────────────────────────────────────────────────────────────────
    macd_obj = MACD(df["Close"])
    df["macd"]        = macd_obj.macd()
    df["macd_signal"] = macd_obj.macd_signal()
    df["macd_diff"]   = macd_obj.macd_diff()

    # ── Bollinger Bands ───────────────────────────────────────────────────────
    bb = BollingerBands(df["Close"], window=20, window_dev=2)
    df["bb_high"]   = bb.bollinger_hband()
    df["bb_low"]    = bb.bollinger_lband()
    df["bb_middle"] = bb.bollinger_mavg()
    df["bb_width"]  = (df["bb_high"] - df["bb_low"]) / df["bb_middle"]
    df["bb_pct"]    = bb.bollinger_pband()

    # ── Volume features ───────────────────────────────────────────────────────
    df["volume_change"] = df["Volume"].pct_change()
    df["volume_sma_10"] = df["Volume"].rolling(10).mean()
    df["volume_ratio"]  = df["Volume"] / df["volume_sma_10"]

    # ── Lag features ─────────────────────────────────────────────────────────
    for lag in [1, 2, 3, 5]:
        df[f"return_lag_{lag}"] = df["daily_return"].shift(lag)
        df[f"volume_lag_{lag}"] = df["volume_change"].shift(lag)

    df["target"] = (df["Close"].shift(-1) > df["Close"]).astype(int)

    # Note: We do NOT dropna here so charting can use the full date range!
    # Training pipelines should call df.dropna() before training.
    return df


def get_feature_columns(df: pd.DataFrame) -> list:
    """Return all feature column names (exclude OHLCV + target)."""
    exclude = {"Open", "High", "Low", "Close", "Volume", "target"}
    return [c for c in df.columns if c not in exclude]


def clean_features(df: pd.DataFrame, feature_cols: list) -> pd.DataFrame:
    """
    Replace inf / -inf with NaN, then fill NaN using:
      1. forward-fill  (use last known value)
      2. backward-fill (handle leading NaNs)
      3. zero-fill     (last resort)
    This prevents 'Input X contains infinity' errors from the scaler/RF.
    """
    df = df.copy()
    # Replace inf values
    df[feature_cols] = df[feature_cols].replace([np.inf, -np.inf], np.nan)
    # Fill NaN: ffill → bfill → 0
    df[feature_cols] = (
        df[feature_cols]
        .ffill()
        .bfill()
        .fillna(0)
    )
    # Final safety: clip extreme values to avoid overflow in scaler
    for col in feature_cols:
        col_std = df[col].std()
        if col_std > 0:
            col_mean = df[col].mean()
            df[col] = df[col].clip(
                lower=col_mean - 10 * col_std,
                upper=col_mean + 10 * col_std
            )
    return df


def train_model(ticker: str = "AAPL", period: str = "5y", tune: bool = False) -> dict:
    """
    Full pipeline: fetch → feature engineering → train RF → save model.
    Returns a dict with metrics.
    """
    df_raw = fetch_data(ticker, period)
    df     = engineer_features(df_raw)
    df.dropna(inplace=True)  # Drop early dates with NaN indicators

    features = get_feature_columns(df)

    # ── Clean: remove inf / fill NaN before feeding to sklearn ──────────────
    df = clean_features(df, features)

    X = df[features].values
    y = df["target"].values

    # Final guard — drop any remaining bad rows
    valid_mask = np.isfinite(X).all(axis=1)
    X = X[valid_mask]
    y = y[valid_mask]
    print(f"[INFO] Clean samples after inf/NaN removal: {len(X)}")

    if len(X) < 50:
        raise ValueError(
            f"Not enough clean data rows ({len(X)}) to train. "
            "Try a longer period or a different ticker."
        )

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False  # time-series: no shuffle
    )

    scaler  = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test  = scaler.transform(X_test)

    if tune:
        print("[INFO] Running GridSearchCV (this may take a few minutes)...")
        param_grid = {
            "n_estimators":  [100, 200],
            "max_depth":     [None, 10, 20],
            "min_samples_split": [2, 5],
        }
        rf = GridSearchCV(
            RandomForestClassifier(random_state=42, n_jobs=-1),
            param_grid, cv=3, scoring="accuracy", n_jobs=-1
        )
        rf.fit(X_train, y_train)
        best_rf = rf.best_estimator_
        print(f"[INFO] Best params: {rf.best_params_}")
    else:
        best_rf = RandomForestClassifier(
            n_estimators=200,
            max_depth=15,
            min_samples_split=5,
            min_samples_leaf=2,
            max_features="sqrt",
            random_state=42,
            n_jobs=-1,
        )
        best_rf.fit(X_train, y_train)

    y_pred = best_rf.predict(X_test)
    acc    = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred, output_dict=True)

    print(f"\n[RESULT] Accuracy: {acc:.4f}")
    print(classification_report(y_test, y_pred))

    # Feature importance
    importances = pd.Series(best_rf.feature_importances_, index=features)
    importances = importances.sort_values(ascending=False)

    # ── Save artefacts ────────────────────────────────────────────────────────
    joblib.dump(best_rf, os.path.join(MODEL_DIR, f"{ticker}_rf_model.pkl"))
    joblib.dump(scaler,  os.path.join(MODEL_DIR, f"{ticker}_scaler.pkl"))
    importances.to_csv(os.path.join(MODEL_DIR, f"{ticker}_feature_importance.csv"))
    df[features + ["target"]].to_csv(
        os.path.join(DATA_DIR, f"{ticker}_features.csv")
    )

    print(f"[INFO] Model saved to saved_models/{ticker}_rf_model.pkl")

    return {
        "ticker":   ticker,
        "accuracy": round(acc, 4),
        "report":   report,
        "feature_importances": importances.head(15).to_dict(),
        "train_size": len(X_train),
        "test_size":  len(X_test),
    }


if __name__ == "__main__":
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    result = train_model(ticker)
    print(f"\nTop 10 Features:\n{list(result['feature_importances'].keys())[:10]}")
