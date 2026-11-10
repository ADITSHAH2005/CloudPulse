import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression

DATA_FILE = "metrics_data.csv"


def load_data():
    df = pd.read_csv(
        DATA_FILE,
        names=[
            "timestamp",
            "request_count",
            "latency_count",
            "average_latency"
        ]
    )

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    return df


def calculate_risk(df):

    current_latency = df["average_latency"].iloc[-1]

    normal_latency = df["average_latency"].iloc[:-1].median()

    if normal_latency == 0:
        return 0, "LOW"

    latency_ratio = current_latency / normal_latency

    if latency_ratio >= 4:
        risk_score = min(100, latency_ratio * 20)
        risk_level = "HIGH"

    elif latency_ratio >= 2:
        risk_score = min(100, latency_ratio * 15)
        risk_level = "MEDIUM"

    else:
        risk_score = min(100, latency_ratio * 10)
        risk_level = "LOW"

    return risk_score, risk_level


def predict_latency_trend(df):

    if len(df) < 5:
        return None

    X = np.arange(len(df)).reshape(-1, 1)

    y = df["average_latency"].values

    model = LinearRegression()

    model.fit(X, y)

    future_index = np.array([[len(df) + 2]])

    predicted_latency = model.predict(future_index)[0]

    return predicted_latency


if __name__ == "__main__":

    print("=" * 60)
    print("AI CLOUD MONITORING - FAILURE PREDICTION")
    print("=" * 60)

    print("\nLoading monitoring data...")

    df = load_data()

    print(f"Samples available : {len(df)}")

    current_latency = df["average_latency"].iloc[-1]

    print(f"\nCurrent latency   : {current_latency:.4f} seconds")

    risk_score, risk_level = calculate_risk(df)

    print(f"Failure risk score: {risk_score:.2f}")

    print(f"Failure risk level: {risk_level}")

    predicted_latency = predict_latency_trend(df)

    if predicted_latency is not None:

        print(
            f"Predicted future latency: "
            f"{predicted_latency:.4f} seconds"
        )

    print("\n" + "=" * 60)