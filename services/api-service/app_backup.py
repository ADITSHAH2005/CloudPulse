
from datetime import datetime, timezone
from pathlib import Path
import os
import subprocess
import time
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, generate_latest
from starlette.responses import Response


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[2]
METRICS_FILE = PROJECT_ROOT / "ml" / "metrics_data.csv"

RECOVERY_ENABLED = (
    os.getenv("ENABLE_AUTOMATED_RECOVERY", "false").lower() == "true"
)

API_CONTAINER_NAME = os.getenv(
    "API_CONTAINER_NAME",
    "api-service-container",
)


# --------------------------------------------------
# FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="AI Cloud Monitoring API",
    version="2.1.0",
    description=(
        "Cloud monitoring, anomaly diagnosis, "
        "incident management, and guarded recovery APIs."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# PROMETHEUS METRICS
# --------------------------------------------------

REQUEST_COUNT = Counter(
    "api_requests_total",
    "Total number of API requests",
    ["method", "endpoint", "status"],
)

REQUEST_LATENCY = Histogram(
    "api_request_latency_seconds",
    "API request latency in seconds",
    ["method", "endpoint"],
)


# --------------------------------------------------
# IN-MEMORY INCIDENT AND RECOVERY HISTORY
# --------------------------------------------------
INCIDENTS: list[dict[str, Any]] = []
RECOVERY_HISTORY: list[dict[str, Any]] = []

# Demonstration-only simulation state
SIMULATION = {
    "active": False,
    "scenario": "normal",
    "status": "healthy",
    "latency": None,
    "requests": 1540,
    "errors": 12,
    "message": "Normal monitoring state.",
    "started_at": None,
}

# Abnormality scenarios for the project demonstration
SCENARIOS = [
    {
        "id": "high_latency",
        "name": "High API latency",
        "latency": 1.8,
        "requests": 1600,
        "errors": 18,
        "status": "critical",
        "cause": "Severely elevated API latency",
        "recommendation": "Inspect slow handlers and downstream dependencies.",
    },
    {
        "id": "traffic_spike",
        "name": "Traffic spike",
        "latency": 0.32,
        "requests": 4500,
        "errors": 40,
        "status": "warning",
        "cause": "Traffic spike causing service degradation",
        "recommendation": "Inspect request volume, concurrency, and capacity.",
    },
    {
        "id": "error_spike",
        "name": "API error spike",
        "latency": 0.45,
        "requests": 1800,
        "errors": 260,
        "status": "critical",
        "cause": "Elevated API error rate",
        "recommendation": "Inspect application exceptions and dependency failures.",
    },
    {
        "id": "service_failure",
        "name": "Service failure",
        "latency": 2.5,
        "requests": 900,
        "errors": 350,
        "status": "critical",
        "cause": "Service failure or unavailable dependency",
        "recommendation": "Inspect service health, logs, and dependency connectivity.",
    },
    {
        "id": "memory_pressure",
        "name": "Resource pressure",
        "latency": 0.75,
        "requests": 2200,
        "errors": 70,
        "status": "warning",
        "cause": "Resource pressure affecting API response time",
        "recommendation": "Inspect memory utilization and active workload.",
    },
]


# --------------------------------------------------
# REQUEST MONITORING MIDDLEWARE
# --------------------------------------------------

@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    started = time.perf_counter()

    response = await call_next(request)

    elapsed = time.perf_counter() - started

    REQUEST_COUNT.labels(
        request.method,
        request.url.path,
        str(response.status_code),
    ).inc()

    REQUEST_LATENCY.labels(
        request.method,
        request.url.path,
    ).observe(elapsed)

    return response


# --------------------------------------------------
# LOAD MONITORING DATA
# --------------------------------------------------

def load_metrics_frame():
    """Load and clean metrics data, supporting mixed timestamp formats."""
    columns = [
        "timestamp",
        "request_count",
        "latency_count",
        "average_latency",
    ]

    # Read the CSV before accessing its columns.
    if not METRICS_FILE.exists():
        raise FileNotFoundError(
            f"Metrics CSV file not found: {METRICS_FILE}"
        )

    df = pd.read_csv(
        METRICS_FILE,
        header=None,
        names=columns,
    )

    # Handle timestamps both with and without timezone information.
    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        format="mixed",
        errors="coerce",
        utc=True,
    )

    # Convert metric values to numbers.
    for column in [
        "request_count",
        "latency_count",
        "average_latency",
    ]:
        df[column] = pd.to_numeric(
            df[column],
            errors="coerce",
        )

    # Remove invalid rows.
    df = df.dropna(
        subset=[
            "timestamp",
            "request_count",
            "latency_count",
            "average_latency",
        ]
    )

    # Keep records with valid latency observations.
    df = df[
        (df["latency_count"] > 0)
        & (df["average_latency"] >= 0)
    ]

    # Ensure the newest timestamp is the final row.
    df = df.sort_values("timestamp").reset_index(drop=True)

    if df.empty:
        raise ValueError(
            "No valid metrics records found in the CSV file."
        )

    return df


# --------------------------------------------------
# AUTOMATED ROOT CAUSE ANALYSIS
# --------------------------------------------------

def analyze_rca():
    """Classify latency and recommend a troubleshooting action."""

    frame = load_metrics_frame()

    if frame is None:
        return {
            "status": "insufficient_data",
            "summary": "No usable historical metrics were found.",
            "probable_cause": "Insufficient telemetry",
            "confidence": None,
            "evidence": [
                "No valid latency samples were found in the metrics CSV."
            ],
            "recommended_action": (
                "Start the API and Prometheus, run the metrics collector, "
                "and collect valid samples before analyzing incidents."
            ),
            "current_latency": None,
            "baseline_latency": None,
            "latency_ratio": None,
            "samples_analyzed": 0,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

    # Latest valid sample.
    current = float(frame["average_latency"].iloc[-1])

    # Historical median excludes the current sample.
    historical_values = frame["average_latency"].iloc[:-1]

    if historical_values.empty:
        baseline = current
    else:
        baseline = float(historical_values.median())

    # Compare the latest latency with the baseline.
    if baseline > 0:
        ratio = current / baseline
    elif current > 0:
        ratio = None
    else:
        ratio = 1.0

    evidence = [
        f"Latest recorded average latency: {current:.4f} seconds.",
        f"Historical median baseline: {baseline:.4f} seconds.",
    ]

    if ratio is not None:
        evidence.append(
            f"Latest latency is {ratio:.2f} times the baseline."
        )
    else:
        evidence.append(
            "The historical baseline is zero, so a latency ratio "
            "cannot be calculated."
        )

    # Critical condition.
    if current >= 0.5 or (ratio is not None and ratio >= 4):
        status = "critical"
        cause = "Severely elevated API latency"
        confidence = 0.90

        action = (
            "Inspect API processing, downstream dependencies, application "
            "logs, and container resource usage. Verify active requests "
            "before considering a controlled restart."
        )

    # Warning condition.
    elif current >= 0.05 or (ratio is not None and ratio >= 2):
        status = "warning"
        cause = "Elevated API latency"
        confidence = 0.75

        action = (
            "Inspect recent request patterns, application logs, "
            "error rates, and downstream service latency."
        )

    # Healthy condition.
    else:
        status = "healthy"
        cause = "No significant latency anomaly detected"
        confidence = 0.55

        action = (
            "Continue monitoring. Collect additional logs and resource "
            "metrics to strengthen future diagnoses."
        )

    evidence.append(
        f"Latency classification: {status}."
    )

    if len(frame) < 5:
        evidence.append(
            f"Only {len(frame)} valid sample(s) are available. "
            "The diagnosis is preliminary."
        )

    return {
        "status": status,
        "summary": "Rule-based diagnosis from recorded latency telemetry.",
        "probable_cause": cause,
        "confidence": confidence,
        "evidence": evidence,
        "recommended_action": action,
        "current_latency": current,
        "baseline_latency": baseline,
        "latency_ratio": ratio,
        "samples_analyzed": int(len(frame)),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------
# ROOT ENDPOINT
# --------------------------------------------------

@app.get("/")
def root():
    return {
        "service": "api-service",
        "status": "running",
        "version": app.version,
    }


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "service": "api-service",
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------
# MONITORING DATA ENDPOINT
# --------------------------------------------------

@app.get("/api/data")
def get_data():
    frame = load_metrics_frame()

    return {
        "service": "api-service",
        "data": {
            "users": 120,
            "requests": 1540,
            "errors": 12,
        },
        "telemetry": {
            "samples": int(len(frame)) if frame is not None else 0,
            "latest_average_latency": (
                float(frame["average_latency"].iloc[-1])
                if frame is not None
                else None
            ),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------
# TEST SLOW API ENDPOINT
# --------------------------------------------------

@app.get("/api/slow")
def slow_endpoint():
    time.sleep(2)

    return {
        "service": "api-service",
        "status": "slow",
        "response_time": "2 seconds",
    }


# --------------------------------------------------
# RCA ENDPOINT AND INCIDENT CREATION
# --------------------------------------------------

@app.get("/api/rca")
def get_rca():
    result = analyze_rca()

    if result["status"] in ("critical", "warning"):

        # Avoid creating a duplicate incident on every dashboard poll.
        last_incident = INCIDENTS[-1] if INCIDENTS else None

        should_create = (
            last_incident is None
            or last_incident.get("probable_cause")
            != result["probable_cause"]
            or last_incident.get("status") == "resolved"
        )

        if should_create:
            INCIDENTS.append({
                "id": (
                    f"INC-{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
                ),
                "created_at": datetime.now(
                    timezone.utc
                ).isoformat(),
                "status": "open",
                "severity": result["status"],
                "probable_cause": result["probable_cause"],
                "summary": result["summary"],
                "recommended_action": result["recommended_action"],
            })

    return result


# --------------------------------------------------
# INCIDENT LIST
# --------------------------------------------------

@app.get("/api/incidents")
def get_incidents():
    return {
        "incidents": list(reversed(INCIDENTS)),
        "count": len(INCIDENTS),
    }


# --------------------------------------------------
# RESOLVE INCIDENT
# --------------------------------------------------

@app.post("/api/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: str):
    for incident in INCIDENTS:
        if incident["id"] == incident_id:
            incident["status"] = "resolved"
            incident["resolved_at"] = datetime.now(
                timezone.utc
            ).isoformat()

            return incident

    raise HTTPException(
        status_code=404,
        detail="Incident not found",
    )


# --------------------------------------------------
# RECOVERY STATUS
# --------------------------------------------------

@app.get("/api/recovery/status")
def recovery_status():
    return {
        "enabled": RECOVERY_ENABLED,
        "mode": (
            "docker_restart"
            if RECOVERY_ENABLED
            else "safe_preview"
        ),
        "target_container": API_CONTAINER_NAME,
        "history": list(reversed(RECOVERY_HISTORY[-20:])),
        "note": (
            "Real container restart is disabled by default. "
            "Use a disposable test container when testing recovery."
        ),
    }


# --------------------------------------------------
# GUARDED RECOVERY
# --------------------------------------------------

@app.post("/api/recovery/run")
def run_recovery():
    diagnosis = analyze_rca()

    entry = {
        "id": f"REC-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "action": "restart_api_container",
        "trigger": diagnosis["probable_cause"],
        "status": "preview",
        "message": "Preview only: no system changes were made.",
        "verified": False,
    }

    if RECOVERY_ENABLED:
        try:
            completed = subprocess.run(
                [
                    "docker",
                    "restart",
                    API_CONTAINER_NAME,
                ],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )

            if completed.returncode == 0:
                entry["status"] = "executed"
                entry["message"] = (
                    f"Restart command completed for "
                    f"{API_CONTAINER_NAME}."
                )

                time.sleep(2)

                try:
                    import requests

                    check = requests.get(
                        "http://127.0.0.1:8000/health",
                        timeout=3,
                    )

                    entry["verified"] = bool(check.ok)

                    entry["message"] += (
                        " Local health check: "
                        + ("passed." if check.ok else "failed.")
                    )

                except Exception:
                    entry["message"] += (
                        " Post-action health check could not reach "
                        "localhost:8000."
                    )

            else:
                entry["status"] = "failed"
                entry["message"] = (
                    completed.stderr
                    or completed.stdout
                    or "Docker restart failed."
                )[:500]

        except Exception as exc:
            entry["status"] = "failed"
            entry["message"] = str(exc)[:500]

    RECOVERY_HISTORY.append(entry)

    return {
        **entry,
        "automation_enabled": RECOVERY_ENABLED,
        "safety_note": (
            "Preview mode is the default. Real recovery requires "
            "ENABLE_AUTOMATED_RECOVERY=true and an explicitly configured "
            "disposable test container."
        ),
    }


# --------------------------------------------------
# PROMETHEUS METRICS ENDPOINT
# --------------------------------------------------
# --------------------------------------------------
# SIMULATION ENDPOINTS
# --------------------------------------------------

import random


@app.get("/api/simulation/scenarios")
def get_simulation_scenarios():
    return {
        "scenarios": [
            {
                "id": item["id"],
                "name": item["name"],
                "severity": item["status"],
            }
            for item in SCENARIOS
        ]
    }


@app.post("/api/simulation/trigger")
def trigger_simulation():
    available = [
        item for item in SCENARIOS
        if item["id"] != SIMULATION["scenario"]
    ]

    scenario = random.choice(available or SCENARIOS)

    SIMULATION.update({
        "active": True,
        "scenario": scenario["id"],
        "status": scenario["status"],
        "latency": scenario["latency"],
        "requests": scenario["requests"],
        "errors": scenario["errors"],
        "message": scenario["name"],
        "started_at": datetime.now(timezone.utc).isoformat(),
    })

    incident = {
        "id": f"SIM-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
        "severity": scenario["status"],
        "service": "api-service",
        "title": scenario["name"],
        "probable_cause": scenario["cause"],
        "summary": "Demonstration abnormality generated by the simulator.",
        "recommended_action": scenario["recommendation"],
        "simulated": True,
    }

    INCIDENTS.append(incident)

    return {
        "simulation": SIMULATION.copy(),
        "incident": incident,
        "rca": {
            "status": scenario["status"],
            "probable_cause": scenario["cause"],
            "confidence": 0.92,
            "current_latency": scenario["latency"],
            "baseline_latency": 0.05,
            "latency_ratio": round(scenario["latency"] / 0.05, 2),
            "samples_analyzed": 1,
            "evidence": [
                f"Scenario: {scenario['name']}",
                f"Simulated latency: {scenario['latency']} seconds",
                f"Simulated requests: {scenario['requests']}",
                f"Simulated errors: {scenario['errors']}",
            ],
            "recommended_action": scenario["recommendation"],
            "simulated": True,
        },
    }


@app.post("/api/simulation/reset")
def reset_simulation():
    SIMULATION.update({
        "active": False,
        "scenario": "normal",
        "status": "healthy",
        "latency": None,
        "requests": 1540,
        "errors": 12,
        "message": "Normal monitoring state.",
        "started_at": None,
    })

    return {
        "message": "Simulation reset. Normal demonstration values restored.",
        "simulation": SIMULATION.copy(),
    }
@app.get("/metrics")
def metrics():
    return Response(
        content=generate_latest(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
