
from datetime import datetime, timezone
from pathlib import Path
import os
import random
import time
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, generate_latest
from starlette.responses import Response


# ==================================================
# CONFIGURATION
# ==================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]
METRICS_FILE = PROJECT_ROOT / "ml" / "metrics_data.csv"

RECOVERY_ENABLED = (
    os.getenv("ENABLE_AUTOMATED_RECOVERY", "false").lower() == "true"
)

API_CONTAINER_NAME = os.getenv(
    "API_CONTAINER_NAME",
    "api-service-container",
)


# ==================================================
# FASTAPI APPLICATION
# ==================================================

app = FastAPI(
    title="AI Cloud Monitoring API",
    version="2.2.0",
    description=(
        "Cloud monitoring, anomaly diagnosis, incident management, "
        "simulation, and guarded recovery APIs."
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


# ==================================================
# PROMETHEUS METRICS
# ==================================================

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


# ==================================================
# INCIDENT AND RECOVERY HISTORY
# ==================================================

INCIDENTS: list[dict[str, Any]] = []
RECOVERY_HISTORY: list[dict[str, Any]] = []


# ==================================================
# SIMULATION STATE
# ==================================================

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


# ==================================================
# SIMULATION SCENARIOS
# ==================================================

SCENARIOS = [
    {
        "id": "high_latency",
        "name": "High API latency",
        "latency": 1.8,
        "requests": 1600,
        "errors": 18,
        "status": "critical",
        "cause": "Severely elevated API latency",
        "recommendation": (
            "Inspect slow handlers and downstream dependencies."
        ),
    },
    {
        "id": "traffic_spike",
        "name": "Traffic spike",
        "latency": 0.32,
        "requests": 4500,
        "errors": 40,
        "status": "warning",
        "cause": "Traffic spike causing service degradation",
        "recommendation": (
            "Inspect request volume, concurrency, and capacity."
        ),
    },
    {
        "id": "error_spike",
        "name": "API error spike",
        "latency": 0.45,
        "requests": 1800,
        "errors": 260,
        "status": "critical",
        "cause": "Elevated API error rate",
        "recommendation": (
            "Inspect application exceptions and dependency failures."
        ),
    },
    {
        "id": "service_failure",
        "name": "Service failure",
        "latency": 2.5,
        "requests": 900,
        "errors": 350,
        "status": "critical",
        "cause": "Service failure or unavailable dependency",
        "recommendation": (
            "Inspect service health, logs, and dependency connectivity."
        ),
    },
    {
        "id": "memory_pressure",
        "name": "Resource pressure",
        "latency": 0.75,
        "requests": 2200,
        "errors": 70,
        "status": "warning",
        "cause": "Resource pressure affecting API response time",
        "recommendation": (
            "Inspect memory utilization and active workload."
        ),
    },
]


# ==================================================
# REQUEST MONITORING MIDDLEWARE
# ==================================================

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


# ==================================================
# LOAD MONITORING DATA
# ==================================================

def load_metrics_frame():
    """Load, clean, and sort monitoring data from the CSV file."""

    columns = [
        "timestamp",
        "request_count",
        "latency_count",
        "average_latency",
    ]

    if not METRICS_FILE.exists():
        raise FileNotFoundError(
            f"Metrics CSV file not found: {METRICS_FILE}"
        )

    df = pd.read_csv(
        METRICS_FILE,
        header=None,
        names=columns,
    )

    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        format="mixed",
        errors="coerce",
        utc=True,
    )

    for column in [
        "request_count",
        "latency_count",
        "average_latency",
    ]:
        df[column] = pd.to_numeric(
            df[column],
            errors="coerce",
        )

    df = df.dropna(
        subset=[
            "timestamp",
            "request_count",
            "latency_count",
            "average_latency",
        ]
    )

    df = df[
        (df["latency_count"] > 0)
        & (df["average_latency"] >= 0)
    ]

    df = df.sort_values(
        "timestamp"
    ).reset_index(drop=True)

    if df.empty:
        raise ValueError(
            "No valid metrics records found in the CSV file."
        )

    return df


# ==================================================
# AUTOMATED ROOT CAUSE ANALYSIS
# ==================================================

def analyze_rca():
    """Analyze latency telemetry and recommend an action."""

    frame = load_metrics_frame()

    current = float(
        frame["average_latency"].iloc[-1]
    )

    historical_values = (
        frame["average_latency"].iloc[:-1]
    )

    if historical_values.empty:
        baseline = current
    else:
        baseline = float(
            historical_values.median()
        )

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

    if current >= 0.5 or (
        ratio is not None and ratio >= 4
    ):
        status = "critical"
        cause = "Severely elevated API latency"
        confidence = 0.90

        action = (
            "Inspect API processing, downstream dependencies, "
            "application logs, and container resource usage. "
            "Verify active requests before considering a controlled restart."
        )

    elif current >= 0.05 or (
        ratio is not None and ratio >= 2
    ):
        status = "warning"
        cause = "Elevated API latency"
        confidence = 0.75

        action = (
            "Inspect recent request patterns, application logs, "
            "error rates, and downstream service latency."
        )

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
        "summary": (
            "Rule-based diagnosis from recorded latency telemetry."
        ),
        "probable_cause": cause,
        "confidence": confidence,
        "evidence": evidence,
        "recommended_action": action,
        "current_latency": current,
        "baseline_latency": baseline,
        "latency_ratio": ratio,
        "samples_analyzed": int(len(frame)),
        "analyzed_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ==================================================
# ROOT ENDPOINT
# ==================================================

@app.get("/")
def root():
    return {
        "service": "api-service",
        "status": "running",
        "version": app.version,
    }


# ==================================================
# HEALTH CHECK
# ==================================================

@app.get("/health")
def health():
    return {
        "service": "api-service",
        "status": "healthy",
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ==================================================
# MONITORING DATA ENDPOINT
# ==================================================

@app.get("/api/data")
def get_data():

    frame = None

    try:
        frame = load_metrics_frame()
    except (FileNotFoundError, ValueError):
        pass

    if SIMULATION["active"]:
        return {
            "service": "api-service",
            "data": {
                "users": 120,
                "requests": SIMULATION["requests"],
                "errors": SIMULATION["errors"],
            },
            "telemetry": {
                "samples": (
                    int(len(frame))
                    if frame is not None
                    else 0
                ),
                "latest_average_latency": SIMULATION["latency"],
            },
            "simulation": SIMULATION.copy(),
            "data_source": "simulation",
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        }

    return {
        "service": "api-service",
        "data": {
            "users": 120,
            "requests": 1540,
            "errors": 12,
        },
        "telemetry": {
            "samples": (
                int(len(frame))
                if frame is not None
                else 0
            ),
            "latest_average_latency": (
                float(frame["average_latency"].iloc[-1])
                if frame is not None
                else None
            ),
        },
        "simulation": SIMULATION.copy(),
        "data_source": "metrics_dataset",
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
    }


# ==================================================
# TEST SLOW API ENDPOINT
# ==================================================

@app.get("/api/slow")
def slow_endpoint():
    time.sleep(2)

    return {
        "service": "api-service",
        "status": "slow",
        "response_time": "2 seconds",
    }


# ==================================================
# ROOT CAUSE ANALYSIS ENDPOINT
# ==================================================

@app.get("/api/rca")
def get_rca():

    if SIMULATION["active"]:

        scenario = next(
            (
                item for item in SCENARIOS
                if item["id"] == SIMULATION["scenario"]
            ),
            None,
        )

        if scenario:

            return {
                "status": scenario["status"],
                "probable_cause": scenario["cause"],
                "summary": (
                    f"Simulated incident: {scenario['name']}. "
                    "The diagnosis is based on controlled scenario "
                    "values, not a real production failure."
                ),
                "confidence": 0.92,
                "current_latency": SIMULATION["latency"],
                "baseline_latency": 0.05,
                "latency_ratio": round(
                    SIMULATION["latency"] / 0.05,
                    2,
                ),
                "samples_analyzed": 1,
                "evidence": [
                    f"Scenario: {scenario['name']}",
                    f"Simulated latency: {SIMULATION['latency']} seconds",
                    f"Simulated requests: {SIMULATION['requests']}",
                    f"Simulated errors: {SIMULATION['errors']}",
                ],
                "recommended_action": scenario["recommendation"],
                "simulated": True,
            }

    try:
        result = analyze_rca()
    except (FileNotFoundError, ValueError) as exc:
        return {
            "status": "insufficient_data",
            "summary": "Unable to analyze monitoring telemetry.",
            "probable_cause": "Insufficient telemetry",
            "confidence": None,
            "evidence": [str(exc)],
            "recommended_action": (
                "Check the metrics CSV file and collect valid "
                "monitoring samples."
            ),
            "current_latency": None,
            "baseline_latency": None,
            "latency_ratio": None,
            "samples_analyzed": 0,
            "analyzed_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "simulated": False,
        }

    if result["status"] in ("critical", "warning"):

        last_incident = (
            INCIDENTS[-1]
            if INCIDENTS
            else None
        )

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
                "service": "api-service",
                "title": result.get(
                    "summary",
                    "Monitoring anomaly detected",
                ),
                "probable_cause": result["probable_cause"],
                "summary": result["summary"],
                "recommended_action": result["recommended_action"],
                "simulated": False,
            })

    return result


# ==================================================
# INCIDENT LIST
# ==================================================

@app.get("/api/incidents")
def get_incidents():
    return {
        "incidents": list(
            reversed(INCIDENTS)
        ),
        "count": len(INCIDENTS),
    }


# ==================================================
# RESOLVE INCIDENT
# ==================================================

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


# ==================================================
# RECOVERY STATUS
# ==================================================

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
        "history": list(
            reversed(RECOVERY_HISTORY[-20:])
        ),
        "note": (
            "Real container restart is disabled. "
            "Recovery currently operates on the demonstration simulation."
        ),
    }


# ==================================================
# GUARDED AUTOMATED RECOVERY
# ==================================================

@app.post("/api/recovery/run")
def run_recovery():
    """
    Recover a simulated incident and return a detailed
    execution timeline, before/after comparison, and audit record.

    This endpoint never restarts a real Docker container.
    """

    started_at = datetime.now(timezone.utc)

    was_active = SIMULATION.get("active", False)
    scenario_id = SIMULATION.get("scenario", "normal")

    scenario = next(
        (
            item for item in SCENARIOS
            if item["id"] == scenario_id
        ),
        None,
    )

    # Capture state before recovery.
    before = {
        "status": SIMULATION["status"],
        "scenario": SIMULATION["scenario"],
        "latency": SIMULATION["latency"],
        "requests": SIMULATION["requests"],
        "errors": SIMULATION["errors"],
        "active": SIMULATION["active"],
    }

    steps = [
        {
            "step": 1,
            "title": "Incident captured",
            "status": "completed",
            "description": (
                f"Detected {scenario['name']}."
                if was_active and scenario
                else "Recovery request received."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        },
        {
            "step": 2,
            "title": "Recovery plan selected",
            "status": "completed",
            "description": (
                "Selected safe simulation restoration."
                if was_active
                else "No active simulation; preview mode selected."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        },
    ]

    changes = []
    resolved_count = 0

    if was_active:

        # Restore normal simulation values.
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

        changes = [
            {
                "field": "Service status",
                "before": before["status"],
                "after": "healthy",
                "description": (
                    "Restored the simulated healthy state."
                ),
            },
            {
                "field": "API latency",
                "before": before["latency"],
                "after": "Normal baseline",
                "description": (
                    "Cleared simulated abnormal latency."
                ),
            },
            {
                "field": "Request count",
                "before": before["requests"],
                "after": 1540,
                "description": (
                    "Restored the normal demonstration value."
                ),
            },
            {
                "field": "Error count",
                "before": before["errors"],
                "after": 12,
                "description": (
                    "Restored the normal demonstration value."
                ),
            },
        ]

        steps.append({
            "step": 3,
            "title": "Simulation state restored",
            "status": "completed",
            "description": (
                "Restored normal service status, latency, "
                "request count, and error count."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        })

        # Resolve matching simulated incident.
        scenario_name = (
            scenario["name"]
            if scenario
            else None
        )

        for incident in INCIDENTS:

            if (
                incident.get("simulated") is True
                and incident.get("status") == "open"
                and scenario_name
                and incident.get("title") == scenario_name
            ):

                incident["status"] = "resolved"

                incident["resolved_at"] = datetime.now(
                    timezone.utc
                ).isoformat()

                incident["resolution"] = (
                    "Resolved by verified simulated automated recovery."
                )

                resolved_count += 1

        steps.append({
            "step": 4,
            "title": "Incident record updated",
            "status": "completed",
            "description": (
                f"{resolved_count} matching simulated incident(s) resolved."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        })

        # Verify restored state.
        verified = (
            SIMULATION["active"] is False
            and SIMULATION["status"] == "healthy"
            and SIMULATION["scenario"] == "normal"
        )

        steps.append({
            "step": 5,
            "title": "Health verification",
            "status": (
                "completed"
                if verified
                else "failed"
            ),
            "description": (
                "Verification passed. The simulated service is healthy."
                if verified
                else "Verification failed."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        })

        recovery_status_value = (
            "executed"
            if verified
            else "failed"
        )

        message = (
            "Simulated recovery completed successfully."
            if verified
            else "Simulation recovery verification failed."
        )

    else:

        verified = False
        recovery_status_value = "preview"

        steps.append({
            "step": 3,
            "title": "Recovery preview",
            "status": "skipped",
            "description": (
                "No active simulation was available to restore."
            ),
            "timestamp": datetime.now(
                timezone.utc
            ).isoformat(),
        })

        message = (
            "No active simulation was found. "
            "No changes were made."
        )

    # Capture state after recovery.
    after = {
        "status": SIMULATION["status"],
        "scenario": SIMULATION["scenario"],
        "latency": SIMULATION["latency"],
        "requests": SIMULATION["requests"],
        "errors": SIMULATION["errors"],
        "active": SIMULATION["active"],
    }

    completed_at = datetime.now(timezone.utc)

    entry = {
        "id": (
            f"REC-{completed_at.strftime('%Y%m%d%H%M%S%f')}"
        ),
        "created_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "action": (
            "restore_simulation"
            if was_active
            else "preview_only"
        ),
        "trigger": (
            scenario["cause"]
            if scenario
            else "Manual recovery request"
        ),
        "status": recovery_status_value,
        "message": message,
        "verified": verified,
        "before": before,
        "after": after,
        "steps": steps,
        "changes": changes,
        "resolved_incidents": resolved_count,
        "duration_seconds": round(
            (
                completed_at - started_at
            ).total_seconds(),
            4,
        ),
        "simulation_only": True,
    }

    RECOVERY_HISTORY.append(entry)

    return {
        **entry,
        "automation_enabled": False,
        "safety_note": (
            "Demo safety mode: recovery operates only on in-memory "
            "simulation values. No real Docker container or production "
            "service is restarted."
        ),
    }


# ==================================================
# SIMULATION SCENARIO LIST
# ==================================================

@app.get("/api/simulation/scenarios")
def get_simulation_scenarios():

    return {
        "scenarios": [
            {
                "id": item["id"],
                "name": item["name"],
                "severity": item["status"],
                "description": item["cause"],
                "recommendation": item["recommendation"],
            }
            for item in SCENARIOS
        ]
    }


# ==================================================
# TRIGGER SIMULATION
# ==================================================

@app.post("/api/simulation/trigger")
def trigger_simulation():

    available = [
        item for item in SCENARIOS
        if item["id"] != SIMULATION["scenario"]
    ]

    scenario = random.choice(
        available or SCENARIOS
    )

    SIMULATION.update({
        "active": True,
        "scenario": scenario["id"],
        "status": scenario["status"],
        "latency": scenario["latency"],
        "requests": scenario["requests"],
        "errors": scenario["errors"],
        "message": scenario["name"],
        "started_at": datetime.now(
            timezone.utc
        ).isoformat(),
    })

    incident = {
        "id": (
            f"SIM-{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
        ),
        "created_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "status": "open",
        "severity": scenario["status"],
        "service": "api-service",
        "title": scenario["name"],
        "probable_cause": scenario["cause"],
        "summary": (
            "Demonstration abnormality generated by the simulator."
        ),
        "recommended_action": scenario["recommendation"],
        "simulated": True,
    }

    INCIDENTS.append(incident)

    rca = {
        "status": scenario["status"],
        "probable_cause": scenario["cause"],
        "summary": (
            f"Simulated incident: {scenario['name']}."
        ),
        "confidence": 0.92,
        "current_latency": scenario["latency"],
        "baseline_latency": 0.05,
        "latency_ratio": round(
            scenario["latency"] / 0.05,
            2,
        ),
        "samples_analyzed": 1,
        "evidence": [
            f"Scenario: {scenario['name']}",
            f"Simulated latency: {scenario['latency']} seconds",
            f"Simulated requests: {scenario['requests']}",
            f"Simulated errors: {scenario['errors']}",
        ],
        "recommended_action": scenario["recommendation"],
        "simulated": True,
    }

    return {
        "simulation": SIMULATION.copy(),
        "incident": incident,
        "rca": rca,
    }


# ==================================================
# RESET SIMULATION
# ==================================================

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

    resolved_count = 0

    for incident in INCIDENTS:

        if (
            incident.get("simulated") is True
            and incident.get("status") == "open"
        ):

            incident["status"] = "resolved"

            incident["resolved_at"] = datetime.now(
                timezone.utc
            ).isoformat()

            incident["resolution"] = (
                "Resolved by simulation reset."
            )

            resolved_count += 1

    return {
        "message": (
            "Simulation reset. Normal values restored and "
            f"{resolved_count} simulated incident(s) resolved."
        ),
        "simulation": SIMULATION.copy(),
        "resolved_incidents": resolved_count,
    }


# ==================================================
# PROMETHEUS METRICS ENDPOINT
# ==================================================

@app.get("/metrics")
def metrics():

    return Response(
        content=generate_latest(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


# ==================================================
# RECOVERY HISTORY ENDPOINT
# ==================================================

@app.get("/api/recovery/history")
def get_recovery_history():

    return {
        "history": list(
            reversed(RECOVERY_HISTORY)
        ),
        "count": len(RECOVERY_HISTORY),
    }


# ==================================================
# APPLICATION INFORMATION
# ==================================================

@app.get("/api/system/info")
def system_info():

    return {
        "application": "AI Cloud Monitoring",
        "service": "api-service",
        "version": app.version,
        "monitoring": "Prometheus",
        "diagnosis": "Rule-based RCA",
        "recovery_mode": "Simulation-only",
        "recovery_enabled": False,
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat(),
    }
