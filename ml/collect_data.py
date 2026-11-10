
import requests
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path

PROMETHEUS_URL = "http://127.0.0.1:9090"

# Always save the CSV in the ml folder
METRICS_FILE = Path(__file__).resolve().parent / "metrics_data.csv"


def query_prometheus(query):
    """Execute a Prometheus query and return its results."""
    response = requests.get(
        f"{PROMETHEUS_URL}/api/v1/query",
        params={"query": query},
        timeout=10,
    )

    response.raise_for_status()

    result = response.json()

    if result.get("status") != "success":
        raise RuntimeError(f"Prometheus query failed: {result}")

    return result["data"]["result"]


def collect_current_metrics():
    """Collect and aggregate application metrics."""

    latency = query_prometheus(
        'sum(api_request_latency_seconds_sum{job="api-service"})'
    )

    request_count = query_prometheus(
        'sum(api_requests_total{job="api-service"})'
    )

    latency_count = query_prometheus(
        'sum(api_request_latency_seconds_count{job="api-service"})'
    )

    # Do not silently record zero if Prometheus has no data.
    if not latency or not request_count or not latency_count:
        raise RuntimeError(
            "Prometheus returned an empty result. "
            "Check the API service and Prometheus targets."
        )

    latency_value = float(latency[0]["value"][1])
    request_value = float(request_count[0]["value"][1])
    latency_count_value = float(latency_count[0]["value"][1])

    if latency_count_value <= 0:
        raise RuntimeError(
            "No latency observations have been recorded yet."
        )

    average_latency = latency_value / latency_count_value

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "request_count": request_value,
        "latency_count": latency_count_value,
        "average_latency": average_latency,
    }


def main():
    print("=" * 60)
    print("PROMETHEUS METRIC DATA COLLECTION")
    print("=" * 60)

    data = collect_current_metrics()

    print(f"\nTimestamp        : {data['timestamp']}")
    print(f"Request count    : {data['request_count']}")
    print(f"Latency count    : {data['latency_count']}")
    print(f"Average latency  : {data['average_latency']:.4f} seconds")

    # Keep the column order consistent with the RCA CSV reader.
    columns = [
        "timestamp",
        "request_count",
        "latency_count",
        "average_latency",
    ]

    df = pd.DataFrame([data], columns=columns)

    # Write the header only when creating a new or empty CSV.
    write_header = (
        not METRICS_FILE.exists() or METRICS_FILE.stat().st_size == 0
    )

    df.to_csv(
        METRICS_FILE,
        mode="a",
        header=write_header,
        index=False,
    )

    print(f"\nData saved to: {METRICS_FILE}")


if __name__ == "__main__":
    main()
