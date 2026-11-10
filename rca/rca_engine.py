
import pandas as pd
from pathlib import Path

# Resolve the CSV path independently of the working directory.
DATA_FILE = Path(__file__).resolve().parents[1] / "ml" / "metrics_data.csv"


def load_data():
    """Load and clean metrics data, handling timestamps with or without timezones."""
    import pandas as pd

    columns = [
        "timestamp",
        "request_count",
        "latency_count",
        "average_latency",
    ]

    df = pd.read_csv(
        DATA_FILE,
        header=None,
        names=columns,
    )

    # Parse both timezone-aware and timezone-naive timestamps consistently.
    df["timestamp"] = pd.to_datetime(
    df["timestamp"],
    format="mixed",
    errors="coerce",
    utc=True,
)

    # Convert metric columns to numeric values.
    for column in ["request_count", "latency_count", "average_latency"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    # Remove invalid records.
    df = df.dropna(
        subset=[
            "timestamp",
            "request_count",
            "latency_count",
            "average_latency",
        ]
    )

    # Ignore records without valid latency observations.
    df = df[
        (df["latency_count"] > 0)
        & (df["average_latency"] >= 0)
    ]

    # Sort chronologically so the newest record is selected correctly.
    df = df.sort_values("timestamp").reset_index(drop=True)

    if df.empty:
        raise ValueError("No valid metrics records found in the CSV file.")

    return df


def calculate_root_cause(df):
    """Diagnose latency anomalies using the historical median."""

    current_latency = float(df["average_latency"].iloc[-1])

    # Use previous observations as the baseline, excluding the latest.
    historical = df["average_latency"].iloc[:-1]

    if historical.empty:
        normal_latency = current_latency
    else:
        normal_latency = float(historical.median())

    # Protect against division by zero.
    if normal_latency > 0:
        latency_ratio = current_latency / normal_latency
    elif current_latency > 0:
        latency_ratio = float("inf")
    else:
        latency_ratio = 1.0

    evidence = [
        f"Latest recorded average latency: {current_latency:.4f} seconds.",
        f"Historical median baseline: {normal_latency:.4f} seconds.",
    ]

    if latency_ratio == float("inf"):
        evidence.append(
            "Current latency is positive while the historical baseline is zero."
        )
    else:
        evidence.append(
            f"Latest latency is {latency_ratio:.2f}x the baseline."
        )

    if latency_ratio >= 4 or current_latency >= 0.5:
        root_cause = "High API Service Latency"
        score = 0.90
        status = "critical"

        evidence.append(
            "Latency is substantially above the historical baseline "
            "or exceeds 0.5 seconds."
        )

        action = (
            "Inspect API request processing, application logs, "
            "downstream dependencies, and resource utilization."
        )

    elif latency_ratio >= 2 or current_latency >= 0.05:
        root_cause = "Elevated API Service Latency"
        score = 0.75
        status = "warning"

        evidence.append(
            "API latency is elevated compared with the historical baseline "
            "or exceeds 0.05 seconds."
        )

        action = (
            "Inspect recent request patterns, application logs, "
            "and downstream service latency."
        )

    else:
        root_cause = "No significant latency anomaly detected"
        score = 0.55
        status = "healthy"

        action = (
            "Continue monitoring and collect additional logs "
            "and resource metrics."
        )

    return {
        "status": status,
        "probable_cause": root_cause,
        "confidence": score,
        "current_latency": current_latency,
        "baseline_latency": normal_latency,
        "latency_ratio": latency_ratio,
        "evidence": evidence,
        "recommended_action": action,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("AUTOMATED ROOT CAUSE ANALYSIS")
    print("=" * 60)

    try:
        df = load_data()
        result = calculate_root_cause(df)

        print(f"\nSamples analyzed : {len(df)}")
        print(f"Normal latency  : {result['baseline_latency']:.4f} seconds")
        print(f"Current latency : {result['current_latency']:.4f} seconds")
        print(f"Incident status : {result['status'].upper()}")
        print(f"Probable cause  : {result['probable_cause']}")
        print(f"Confidence      : {result['confidence']:.2f}")

        print("\nEvidence:")
        for item in result["evidence"]:
            print(f"- {item}")

        print("\nRecommended Action:")
        print(result["recommended_action"])

    except (FileNotFoundError, ValueError, pd.errors.ParserError) as exc:
        print(f"\nRCA could not complete: {exc}")

    print("\n" + "=" * 60)
