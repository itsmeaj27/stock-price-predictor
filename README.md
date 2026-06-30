# 📈 Stock Price Predictor

A premium, full-stack machine learning web application that predicts next-day stock price directions using a Random Forest Classifier. It supports multi-market lookup (US, Indian NSE/BSE, and Global exchanges), technical indicator feature engineering, and a sleek dark-mode interactive dashboard.

![Dashboard Preview](https://via.placeholder.com/1200x600.png?text=Stock+Price+Predictor+Dashboard)

## ✨ Features

- **🧠 Machine Learning Backend:** Utilizes a Random Forest algorithm to predict next-day price movements (Up/Down) based on technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands).
- **🌍 Global Market Support:** Instantly search and analyze stocks across the US (NYSE/NASDAQ), India (NSE/BSE), and global markets.
- **🔍 Intelligent Search & Autocomplete:** Real-time stock symbol lookup powered by the Yahoo Finance API.
- **📊 Interactive Charts:** Beautiful, responsive price and indicator charts built with Chart.js.
- **⚡ Asynchronous Training:** Models are trained on-the-fly in the background without freezing the UI.
- **🎨 Premium UI/UX:** A modern dark-mode aesthetic with glassmorphism elements, custom scrollbars, and dynamic tooltips.

## 🛠️ Tech Stack

- **Backend:** Python, Flask, Pandas, Scikit-Learn
- **Data Source:** yfinance (Yahoo Finance API)
- **Frontend:** HTML5, Vanilla CSS3, Vanilla JavaScript, Chart.js
- **Model:** `RandomForestClassifier` with dynamic feature engineering

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Python 3.10+ installed on your system.

### 2. Installation
Clone the repository and install the required dependencies:

```bash
git clone https://github.com/yourusername/stock-price-predictor.git
cd stock-price-predictor

# Install Python packages
pip install flask yfinance pandas numpy scikit-learn ta
```

### 3. Run the Application
Start the Flask development server:

```bash
python app.py
```

### 4. Open the Dashboard
Open your web browser and navigate to:
**http://127.0.0.1:5000**

## 💡 How It Works

1. **Search**: Select your market tab (US, NSE, BSE, Global) and type a company name (e.g., "Tata Motors" or "Apple"). The autocomplete will fetch the exact ticker symbol.
2. **Analyze**: The backend instantly downloads up to 5 years of historical OHLCV data and engineers multiple technical indicators.
3. **Train**: Click "Train Model". A background worker will clean the data, train a Random Forest model, and evaluate its accuracy.
4. **Predict**: Once trained, the dashboard displays the AI's prediction for the next trading day's price movement along with confidence metrics.

## 📝 License
This project is open-source and available under the MIT License.
