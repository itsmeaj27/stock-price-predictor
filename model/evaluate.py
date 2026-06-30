"""
evaluate.py — Compute model evaluation metrics for a given ticker
              and return them in a JSON-serialisable dict.
"""

import os
import warnings
import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, roc_auc_score,
)
from sklearn.model_selection import cross_val_score

from model.train import fetch_data, engineer_features, get_feature_columns, clean_features

warnings.filterwarnings("ignore")

BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, "saved_models")


def evaluate(ticker: str = "AAPL") -> dict:
    """Load the saved model and evaluate on a held-out test set."""
    model_path  = os.path.join(MODEL_DIR, f"{ticker}_rf_model.pkl")
    scaler_path = os.path.join(MODEL_DIR, f"{ticker}_scaler.pkl")

    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Model for '{ticker}' not found. Train first."
        )

    model  = joblib.load(model_path)
    scaler = joblib.load(scaler_path)

    df_raw = fetch_data(ticker, period="5y")
    df     = engineer_features(df_raw)

    features = get_feature_columns(df)

    # Clean inf/NaN — must match training pipeline exactly
    df = clean_features(df, features)

    X = df[features].values
    y = df["target"].values

    # Drop any remaining bad rows
    valid_mask = np.isfinite(X).all(axis=1)
    X = X[valid_mask]
    y = y[valid_mask]

    # Same 80/20 time-series split used during training
    split  = int(len(X) * 0.8)
    X_test = scaler.transform(X[split:])
    y_test = y[split:]

    y_pred   = model.predict(X_test)
    y_proba  = model.predict_proba(X_test)[:, 1]

    acc       = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall    = recall_score(y_test, y_pred, zero_division=0)
    f1        = f1_score(y_test, y_pred, zero_division=0)
    roc_auc   = roc_auc_score(y_test, y_proba)
    cm        = confusion_matrix(y_test, y_pred).tolist()

    # Feature importance
    fi_path = os.path.join(MODEL_DIR, f"{ticker}_feature_importance.csv")
    feature_importances = {}
    if os.path.exists(fi_path):
        fi_df = pd.read_csv(fi_path, index_col=0)
        fi_df.columns = ["importance"]
        feature_importances = fi_df.head(15)["importance"].round(5).to_dict()

    return {
        "ticker":              ticker,
        "accuracy":            round(acc, 4),
        "precision":           round(precision, 4),
        "recall":              round(recall, 4),
        "f1_score":            round(f1, 4),
        "roc_auc":             round(roc_auc, 4),
        "confusion_matrix":    cm,
        "test_samples":        len(y_test),
        "feature_importances": feature_importances,
    }


if __name__ == "__main__":
    import sys, json
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    result = evaluate(ticker)
    print(json.dumps(result, indent=2))
