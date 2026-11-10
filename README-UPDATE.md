# AI Cloud Monitoring — UI + RCA + Recovery update

This is an updated copy of the project. It does not overwrite your original files.

## What changed
- Redesigned React dashboard with overview, service health, live metrics, incidents, RCA, and self-healing pages.
- FastAPI endpoints: `/api/rca`, `/api/incidents`, `/api/incidents/{id}/resolve`, `/api/recovery/status`, and `/api/recovery/run`.
- RCA reads the existing `ml/metrics_data.csv` using a project-relative path.
- Recovery is **safe preview mode by default**. It records a recovery request without changing infrastructure.
- Actual Docker restart is guarded by `ENABLE_AUTOMATED_RECOVERY=true` and uses only the configured container name. Do not enable it on production.
- Dockerfile includes pandas and requests for the extended API.

## Run locally on Windows

Terminal 1 — backend:
```powershell
cd C:\Users\shaha\AI-Cloud-Monitoring\services\api-service
& "C:\Users\shaha\AI-Cloud-Monitoring\.venv\Scripts\Activate.ps1
uvicorn app:app --reload --port 8000
```

Terminal 2 — frontend:
```powershell
cd C:\Users\shaha\AI-Cloud-Monitoring\frontend
npm install
npm run dev
```
Open the Vite URL printed by the terminal (normally http://localhost:5173).

## Test endpoints
- `http://localhost:8000/health`
- `http://localhost:8000/docs`
- `http://localhost:8000/api/rca`
- `http://localhost:8000/api/incidents`
- `http://localhost:8000/api/recovery/status`
- `http://localhost:8000/metrics`

## Important limitations
- RCA is a transparent threshold-based diagnostic using historical latency; it does not prove a causal root cause.
- Incidents and recovery history are stored in process memory and will reset when FastAPI restarts. Persistent database storage is a future improvement.
- The default recovery request is a preview only. To test real recovery, use a disposable test container and deliberately configure the target. Enable `ENABLE_AUTOMATED_RECOVERY=true` only after confirming the target container name and environment.
- The `api-service-container` default may not match your actual Docker container name.
- Prometheus and the metrics collection script must be running and collecting samples for historical analysis to be useful.
