import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest


DATA_FILE = "metrics_data.csv"


def load_data():
    """Load historical monitoring data."""

    df = pd.read_csv(
        DATA_FILE,
        names=[
            "timestamp",
            "request_count",
            "latency_count",
            "average_latency"
        ]
    )

    return df


def train_model(df):
    """Train Isolation Forest using real Prometheus data."""

    features = df[
        [
            "request_count",
            "latency_count",
            "average_latency"
        ]
    ]

    model = IsolationForest(
        contamination=0.1,
        random_state=42
    )

    model.fit(features)

    return model


def detect_anomaly(model, df):

    latest = df[
        [
            "request_count",
            "latency_count",
            "average_latency"
        ]
    ].tail(1)

    prediction = model.predict(latest)[0]
    score = model.decision_function(latest)[0]

    if prediction == -1:
        status = "ANOMALY"
    else:
        status = "NORMAL"

    return status, score, latest


if __name__ == "__main__":

    print("=" * 60)
    print("AI CLOUD MONITORING - REAL DATA ANOMALY DETECTION")
    print("=" * 60)

    print("\nLoading Prometheus historical data...")

    df = load_data()

    print(f"Samples available : {len(df)}")

    print("\nTraining Isolation Forest...")

    model = train_model(df)

    status, score, latest = detect_anomaly(model, df)

    print("\nLatest metrics:")

    print(
        f"Request count   : "
        f"{latest['request_count'].iloc[0]}"
    )

    print(
        f"Latency count   : "
        f"{latest['latency_count'].iloc[0]}"
    )

    print(
        f"Average latency : "
        f"{latest['average_latency'].iloc[0]:.4f} seconds"
    )

    print(f"\nDetection status : {status}")
    print(f"Anomaly score    : {score:.4f}")

    print("\n" + "=" * 60)