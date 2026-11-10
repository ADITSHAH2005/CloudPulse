import { createRoot } from "react-dom/client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Code2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Network,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Terminal,
  Timer,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const API = "http://localhost:8000";
const REFRESH_INTERVAL = 12000;

const NAVIGATION = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "MONITORING" },
  { id: "services", label: "Service health", icon: Server, group: "MONITORING" },
  { id: "metrics", label: "Live metrics", icon: Activity, group: "MONITORING" },
  { id: "incidents", label: "Incidents", icon: Bell, group: "OPERATIONS" },
  { id: "rca", label: "Root-cause analysis", icon: Network, group: "OPERATIONS" },
  { id: "recovery", label: "Self-healing", icon: ShieldCheck, group: "OPERATIONS" },
  {
    id: "simulation",
    label: "Simulation lab",
    icon: Zap,
    group: "OPERATIONS",
  },
];

const PAGE_DETAILS = {
  overview: {
    title: "System overview",
    description: "Your cloud infrastructure, at a glance.",
  },
  services: {
    title: "Service health",
    description: "Monitor application availability and service readiness.",
  },
  metrics: {
    title: "Live metrics",
    description: "Inspect telemetry and application performance signals.",
  },
  incidents: {
    title: "Incident center",
    description: "Track, investigate, and resolve detected incidents.",
  },
  rca: {
    title: "Root-cause analysis",
    description: "Understand anomalies through evidence-driven diagnosis.",
  },
  recovery: {
    title: "Self-healing center",
    description: "Review recovery actions and verify operational readiness.",
  },
  simulation: {
    title: "Simulation lab",
    description: "Trigger controlled abnormalities and inspect diagnosis and recovery.",
  },
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: path === "/metrics" ? "text/plain" : "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  // Prometheus /metrics returns plain text, not JSON.
  if (path === "/metrics") {
    return response.text();
  }

  return response.json();
}

function number(value, digits = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "—";
}

function seconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (parsed < 1) return `${number(parsed * 1000, 1)} ms`;
  return `${number(parsed, 3)} s`;
}

function percent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${number(parsed, 1)}%` : "—";
}

function timeAgo(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function prettyDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function severityOf(value) {
  const status = String(value || "").toLowerCase();

  if (status.includes("critical") || status.includes("error") || status.includes("failed")) {
    return "critical";
  }
  if (status.includes("warning") || status.includes("degraded") || status.includes("pending")) {
    return "warning";
  }
  if (
    status.includes("healthy") ||
    status.includes("resolved") ||
    status.includes("recovered") ||
    status.includes("success")
  ) {
    return "healthy";
  }

  return "neutral";
}

function statusLabel(value) {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value).replaceAll("_", " ");
}

function extractIncidents(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.incidents)) return payload.incidents;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractMetrics(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.metrics === "string") return payload.metrics;
  return JSON.stringify(payload ?? {}, null, 2);
}

function parsePrometheus(text) {
  const totals = {
    requests: 0,
    errors: 0,
    latency: null,
    samples: 0,
  };

  const lines = String(text || "").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+([-+0-9.eE]+)/);
    if (!match) continue;

    const metricName = match[1].split("{")[0];
    const value = Number(match[2]);

    if (!Number.isFinite(value)) continue;

    if (metricName === "api_requests_total") totals.requests += value;
    if (metricName === "api_errors_total") totals.errors += value;

    if (
      metricName === "api_request_latency_seconds" ||
      metricName === "api_request_latency_seconds_sum"
    ) {
      totals.latency = value;
    }

    totals.samples += 1;
  }

  return totals;
}

function Badge({ children, status = "neutral", dot = false }) {
  return (
    <span className={`badge badge-${severityOf(status) === "neutral" ? status : severityOf(status)}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="section-heading-action">{action}</div>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "blue",
  trend,
  trendLabel,
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span className="metric-label">{label}</span>
        <span className={`metric-icon metric-icon-${tone}`}>
          <Icon size={19} strokeWidth={1.8} />
        </span>
      </div>

      <div className="metric-value">{value}</div>

      <div className="metric-card-bottom">
        <span className="metric-detail">{detail}</span>
        {trend !== undefined && trend !== null && (
          <span className={`metric-trend ${Number(trend) > 0 ? "trend-up" : "trend-down"}`}>
            {Number(trend) > 0 ? (
              <ArrowUpRight size={13} />
            ) : (
              <ArrowDownRight size={13} />
            )}
            {Math.abs(Number(trend))}%
            {trendLabel && <span className="trend-caption">{trendLabel}</span>}
          </span>
        )}
      </div>
    </article>
  );
}

function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ icon: Icon = Activity, title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={23} /></span>
      <h4>{title}</h4>
      <p>{description}</p>
    </div>
  );
}

function HealthIndicator({ label, value, description }) {
  const severity = severityOf(value);
  const Icon = severity === "healthy" ? CheckCircle2 : severity === "critical" ? AlertCircle : CircleHelp;

  return (
    <div className="health-indicator">
      <span className={`health-indicator-icon indicator-${severity}`}>
        <Icon size={17} />
      </span>
      <div className="health-indicator-copy">
        <span className="health-indicator-label">{label}</span>
        <span className="health-indicator-description">{description}</span>
      </div>
      <Badge status={severity} dot>{statusLabel(value)}</Badge>
    </div>
  );
}

function LatencyBars({ samples = [] }) {
  const values = samples
    .map((row) => Number(row.latency ?? row.latency_seconds ?? row.response_time))
    .filter(Number.isFinite)
    .slice(-24);

  if (!values.length) {
    return <div className="chart-placeholder">Latency samples will appear here when available.</div>;
  }

  const maximum = Math.max(...values, 0.001);

  return (
    <div className="latency-chart" role="img" aria-label="Recent latency samples">
      {values.map((value, index) => (
        <div className="latency-bar-wrap" key={`${index}-${value}`} title={`Sample ${index + 1}: ${seconds(value)}`}>
          <div
            className={`latency-bar ${value > maximum * 0.8 ? "latency-bar-high" : ""}`}
            style={{ height: `${Math.max(8, (value / maximum) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function App() {
  const [page, setPage] = useState("overview");
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState("");
  const [rca, setRca] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [recovery, setRecovery] = useState(null);
  const [updated, setUpdated] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [latency, setLatency] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [simulation, setSimulation] = useState(null);
  const [simulationRca, setSimulationRca] = useState(null);
  const [lastRecovery, setLastRecovery] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);

    const results = await Promise.allSettled([
      request("/health"),
      request("/api/data"),
      request("/metrics").then(extractMetrics),
      request("/api/rca"),
      request("/api/incidents"),
      request("/api/recovery/status"),
    ]);

    const [healthResult, dataResult, metricsResult, rcaResult, incidentsResult, recoveryResult] = results;
    const failures = [];

    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else failures.push("health");

    if (dataResult.status === "fulfilled") {
      const payload = dataResult.value;
      setData(payload);

      if (payload?.simulation) {
        setSimulation(payload.simulation);

        if (!payload.simulation.active) {
          setSimulationRca(null);
        }
      }
    } else {
      failures.push("data");
    }

    if (metricsResult.status === "fulfilled") setMetrics(metricsResult.value);
    else failures.push("metrics");

    if (rcaResult.status === "fulfilled") setRca(rcaResult.value);
    else failures.push("RCA");

    if (incidentsResult.status === "fulfilled") {
      setIncidents(extractIncidents(incidentsResult.value));
    } else {
      failures.push("incidents");
    }

    if (recoveryResult.status === "fulfilled") setRecovery(recoveryResult.value);
    else failures.push("recovery");

    setUpdated(new Date());

    if (failures.length === results.length) {
      setError("The backend is not responding. Start the FastAPI service on port 8000.");
    } else if (failures.length) {
      setError(`Some data could not be loaded: ${failures.join(", ")}. Check the backend logs.`);
    } else {
      setError("");
    }

    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), REFRESH_INTERVAL);
        return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const parsedMetrics = useMemo(() => parsePrometheus(metrics), [metrics]);

  const openIncidents = useMemo(
    () => incidents.filter((item) => !["resolved", "closed", "recovered"].includes(String(item.status || "").toLowerCase())),
    [incidents]
  );

  const criticalIncidents = useMemo(
    () => openIncidents.filter((item) => severityOf(item.severity || item.status) === "critical"),
    [openIncidents]
  );

  const filteredIncidents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return incidents;

    return incidents.filter((item) =>
      [
        item.id,
        item.incident_id,
        item.title,
        item.name,
        item.service,
        item.status,
        item.severity,
        item.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [incidents, searchTerm]);

  const overallStatus = useMemo(() => {
    const status = String(health?.status || health?.state || "").toLowerCase();
    if (status.includes("healthy") || status === "ok") return "healthy";
    if (status.includes("critical") || status.includes("error") || status.includes("unhealthy")) return "critical";
    if (health && !status) return "healthy";
    return "warning";
  }, [health]);

  async function probe() {
    setBusy(true);
    setNotice("");

    const started = performance.now();
    try {
      await request("/api/slow");
      setLatency(performance.now() - started);
      setNotice("Latency probe completed successfully.");
    } catch (err) {
      setLatency(performance.now() - started);
      setNotice(`Latency probe failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id) {
    if (!id) {
      setNotice("This incident has no identifier that can be used to resolve it.");
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      await request(`/api/incidents/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
      });
      setNotice(`Incident ${id} marked as resolved.`);
      await load();
    } catch (err) {
      setNotice(`Could not resolve incident: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runRecovery() {
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const result = await request("/api/recovery/run", {
        method: "POST",
      });
      setLastRecovery(result);

      setNotice(
        result?.message ||
        (result?.status === "preview"
          ? "Recovery preview completed."
          : "Recovery action completed.")
      );

      // Refresh the backend's recovery history and other dashboard data.
      await load();
    } catch (err) {
      setError(`Recovery failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function triggerSimulation() {
    setBusy(true);
    setNotice("");

    try {
      const result = await request("/api/simulation/trigger", {
        method: "POST",
      });

      setSimulation(result.simulation || null);
      setSimulationRca(result.rca || null);

      setNotice(
        `Simulated incident generated: ${
          result.incident?.title || result.simulation?.message || "Scenario triggered"
        }`
      );

      await load();
    } catch (err) {
      setNotice(`Could not trigger simulation: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resetSimulation() {
    setBusy(true);
    setNotice("");

    try {
      const result = await request("/api/simulation/reset", {
        method: "POST",
      });

      setSimulation(result.simulation || null);
      setSimulationRca(null);

      setNotice(result.message || "Simulation reset.");

      await load();
    } catch (err) {
      setNotice(`Could not reset simulation: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function navigate(id) {
    setPage(id);
    setMobileMenuOpen(false);
    setSearchTerm("");
  }

  function downloadMetrics() {
    const blob = new Blob([metrics || "No metrics available"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prometheus-metrics.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  const pageDetails = PAGE_DETAILS[page] || PAGE_DETAILS.overview;
  const apiData = data || {};
  const rcaStatus = rca?.status || rca?.severity || "unknown";
  const recoveryHistory = Array.isArray(recovery?.history) ? recovery.history : [];
  const recoveryEnabled = recovery?.enabled === true;

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol"><Activity size={23} strokeWidth={2.4} /></div>
          <div className="brand-copy">
            <strong>CloudPulse</strong>
            <span>OBSERVABILITY PLATFORM</span>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar"><Cloud size={18} /></div>
          <div className="workspace-copy">
            <strong>Cloud infrastructure</strong>
            <span>Development workspace</span>
          </div>
          <ChevronRight size={16} className="workspace-chevron" />
        </div>

        {["MONITORING", "OPERATIONS"].map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-group-label">{group}</div>
            {NAVIGATION.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-link ${page === id ? "nav-link-active" : ""}`}
                onClick={() => navigate(id)}
              >
                <Icon size={18} strokeWidth={1.9} />
                <span>{label}</span>
                {id === "incidents" && openIncidents.length > 0 && (
                  <span className="nav-count">{openIncidents.length}</span>
                )}
                {page === id && <span className="nav-active-marker" />}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={`live-dot ${health ? "live-dot-on" : ""}`} />
            <div>
              <strong>{health ? "Monitoring active" : "Connecting to backend"}</strong>
              <span>{health ? "Auto-refresh enabled" : "Waiting for API"}</span>
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="profile-avatar">CP</div>
            <div className="profile-copy">
              <strong>Cloud operations</strong>
              <span>Administrator workspace</span>
            </div>
            <CircleHelp size={17} className="profile-help" />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumb">
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{pageDetails.title}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <div className="connection-pill">
              <span className={`live-dot ${health ? "live-dot-on" : ""}`} />
              {health ? "API connected" : "Connecting"}
            </div>
            <button
              className={`icon-button ${refreshing ? "is-refreshing" : ""}`}
              onClick={() => load(true)}
              aria-label="Refresh dashboard"
              title="Refresh data"
              disabled={refreshing}
            >
              <RefreshCw size={17} />
            </button>
            <div className="topbar-divider" />
            <div className="topbar-avatar">CO</div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-title-row">
            <div>
              <div className="page-kicker"><span className="kicker-line" /> CLOUD OBSERVABILITY</div>
              <h1>{pageDetails.title}</h1>
              <p className="page-description">{pageDetails.description}</p>
            </div>

            <div className="page-actions">
              <div className="last-updated">
                <Clock3 size={14} />
                <span>{updated ? `Updated ${updated.toLocaleTimeString()}` : "Waiting for data"}</span>
              </div>
              <button className="button button-primary" onClick={() => load(true)} disabled={refreshing}>
                {refreshing ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                Refresh data
              </button>
            </div>
          </div>

          {error && (
            <div className="alert-banner alert-banner-warning">
              <AlertTriangle size={18} />
              <div><strong>Data connection notice</strong><span>{error}</span></div>
              <button className="alert-dismiss" onClick={() => setError("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}

          {notice && (
            <div className="alert-banner alert-banner-info">
              <CheckCircle2 size={18} />
              <div><strong>Operation update</strong><span>{notice}</span></div>
              <button className="alert-dismiss" onClick={() => setNotice("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}

          {page === "overview" && (
            <OverviewPage
              health={health}
              overallStatus={overallStatus}
              data={apiData}
              metrics={parsedMetrics}
              rca={rca}
              rcaStatus={rcaStatus}
              incidents={incidents}
              openIncidents={openIncidents}
              criticalIncidents={criticalIncidents}
              recovery={recovery}
              onNavigate={navigate}
              onProbe={probe}
              latency={latency}
              busy={busy}
            />
          )}

          {page === "services" && (
            <ServicesPage health={health} overallStatus={overallStatus} data={apiData} />
          )}

          {page === "metrics" && (
            <MetricsPage
              data={apiData}
              metrics={metrics}
              parsedMetrics={parsedMetrics}
              onDownload={downloadMetrics}
              onProbe={probe}
              latency={latency}
              busy={busy}
            />
          )}

          {page === "incidents" && (
            <IncidentsPage
              incidents={filteredIncidents}
              allCount={incidents.length}
              openCount={openIncidents.length}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              onResolve={resolve}
              busy={busy}
            />
          )}

          {page === "rca" && (
            <RcaPage rca={rca} rcaStatus={rcaStatus} onRefresh={() => load(true)} />
          )}

          {page === "recovery" && (
            <RecoveryPage
              recovery={recovery}
              history={recoveryHistory}
              enabled={recoveryEnabled}
              onRun={runRecovery}
              busy={busy}
              lastRecovery={lastRecovery}
              simulation={simulation}
              simulationRca={simulationRca}
            />
          )}

          {page === "simulation" && (
            <SimulationPage
              simulation={simulation}
              rca={simulationRca}
              onTrigger={triggerSimulation}
              onReset={resetSimulation}
              busy={busy}
            />
          )}

          <footer className="page-footer">
            <span>CloudPulse <span className="footer-dot">·</span> AI Cloud Monitoring</span>
            <span><span className="live-dot live-dot-on" /> Auto-refresh every 12 seconds</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function OverviewPage({
  overallStatus,
  data,
  metrics,
  health,
  openIncidents,
  criticalIncidents,
  onNavigate,
  onProbe,
  latency,
  busy,
  rca,
  rcaStatus,
  incidents,
  recovery,
}) {
  const sampleRows = Array.isArray(data?.samples)
    ? data.samples
    : Array.isArray(data?.telemetry?.samples)
      ? data.telemetry.samples
      : Array.isArray(data?.telemetry)
        ? data.telemetry
        : [];

  const requestCount =
    data?.data?.requests ??
    data?.requests ??
    data?.total_requests ??
    metrics.requests;

  const errorCount =
    data?.data?.errors ??
    data?.errors ??
    data?.total_errors ??
    metrics.errors;

  const errorRate = Number(requestCount) > 0
    ? (Number(errorCount) / Number(requestCount)) * 100
    : null;

  return (
        <>
      <section className={`hero-banner hero-${overallStatus}`}>
        <div className="hero-grid-pattern" />
        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="hero-status-dot" />
            INFRASTRUCTURE STATUS
          </div>
          <h2>
            {overallStatus === "healthy"
              ? "Your systems are looking good."
              : overallStatus === "critical"
                ? "Your system needs attention."
                : "Your infrastructure is being monitored."}
          </h2>
          <p>
            {overallStatus === "healthy"
              ? "Your API is responding. Keep an eye on performance signals and emerging anomalies."
              : "Review service health, inspect recent signals, and investigate any outstanding incidents."}
          </p>
          <div className="hero-actions">
            <button className="button button-hero" onClick={() => onNavigate("services")}>
              Explore services <ArrowRight size={16} />
            </button>
            <button className="button button-hero-ghost" onClick={() => onNavigate("rca")}>
              View diagnosis
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="hero-core"><Activity size={39} /></div>
          <span className="orbit-node orbit-node-one"><Server size={17} /></span>
          <span className="orbit-node orbit-node-two"><Database size={17} /></span>
          <span className="orbit-node orbit-node-three"><ShieldCheck size={17} /></span>
          <span className="orbit-node orbit-node-four"><Network size={17} /></span>
        </div>
        <div className="hero-status-card">
          <span className="hero-status-card-label">API SERVICE</span>
          <span className="hero-status-card-value"><span className="live-dot live-dot-on" /> {statusLabel(health?.status || "Connected")}</span>
          <span className="hero-status-card-foot">Backend health endpoint</span>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard label="Total requests" value={number(requestCount)} detail="Recorded API requests" icon={Activity} tone="blue" />
        <MetricCard label="Error count" value={number(errorCount)} detail="Reported application errors" icon={AlertTriangle} tone="orange" />
        <MetricCard label="Error rate" value={errorRate === null ? "—" : percent(errorRate)} detail="Errors / total requests" icon={Gauge} tone="purple" />
        <MetricCard label="Open incidents" value={number(openIncidents.length)} detail={`${criticalIncidents.length} critical`} icon={Bell} tone="red" />
      </div>

      <div className="content-grid content-grid-primary">
        <Panel
          title="Service performance"
          subtitle="Recent latency telemetry"
          action={<button className="text-button" onClick={() => onNavigate("metrics")}>View metrics <ArrowRight size={14} /></button>}
          className="performance-panel"
        >
          <div className="chart-legend">
            <span><i className="legend-dot legend-blue" /> Latency samples</span>
            <span className="chart-legend-note">Most recent samples</span>
          </div>
          <LatencyBars samples={sampleRows} />
          <div className="chart-axis"><span>Earlier</span><span>Recent</span></div>
          <div className="performance-summary">
            <div><span>Latest probe</span><strong>{latency === null ? "Not run" : `${number(latency, 1)} ms`}</strong></div>
            <div><span>Telemetry samples</span><strong>{number(data?.telemetry_samples ?? sampleRows.length)}</strong></div>
            <button className="button button-secondary button-small" onClick={onProbe} disabled={busy}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
              Run probe
            </button>
          </div>
        </Panel>

        <Panel
          title="AI diagnosis"
          subtitle="Latest root-cause analysis"
          action={<button className="icon-link" onClick={() => onNavigate("rca")} aria-label="Open root-cause analysis"><ArrowRight size={17} /></button>}
          className="diagnosis-panel"
        >
          <div className={`diagnosis-status diagnosis-${severityOf(rcaStatus)}`}>
            <span className="diagnosis-status-icon">
              {severityOf(rcaStatus) === "critical" ? <AlertCircle size={19} /> : severityOf(rcaStatus) === "healthy" ? <CheckCircle2 size={19} /> : <Sparkles size={19} />}
            </span>
            <div><span>Analysis status</span><strong>{statusLabel(rcaStatus)}</strong></div>
            <Badge status={rcaStatus}>{rca?.confidence == null ? "Analyzed" : `${Math.round(Number(rca.confidence) * (Number(rca.confidence) <= 1 ? 100 : 1))}% confidence`}</Badge>
          </div>
          <div className="diagnosis-body">
            <span className="mini-label">PROBABLE CAUSE</span>
            <p>{rca?.probable_cause || rca?.cause || "Waiting for root-cause analysis data from the backend."}</p>
            <div className="diagnosis-meta">
              <div><span>Latency ratio</span><strong>{rca?.ratio == null ? "—" : `${number(rca.ratio, 2)}×`}</strong></div>
              <div><span>Baseline</span><strong>{rca?.baseline_median == null ? "—" : seconds(rca.baseline_median)}</strong></div>
            </div>
          </div>
          <button className="panel-bottom-link" onClick={() => onNavigate("rca")}>
            Explore evidence <ArrowRight size={15} />
          </button>
        </Panel>
      </div>

      <div className="content-grid content-grid-secondary">
        <Panel
          title="Recent incidents"
          subtitle="Latest operational events"
          action={<button className="text-button" onClick={() => onNavigate("incidents")}>All incidents <ArrowRight size={14} /></button>}
        >
          {incidents.length ? (
            <div className="incident-preview-list">
              {incidents.slice(0, 4).map((incident, index) => {
                const id = incident.id || incident.incident_id || `incident-${index}`;
                const level = incident.severity || incident.status || "warning";

                return (
                  <div className="incident-preview-row" key={id}>
                    <span className={`incident-marker marker-${severityOf(level)}`}>
                      {severityOf(level) === "critical" ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
                    </span>
                    <div className="incident-preview-copy">
                      <strong>{incident.title || incident.name || incident.description || "System incident"}</strong>
                      <span>{incident.service || "API service"} <i /> {timeAgo(incident.created_at || incident.timestamp)}</span>
                    </div>
                    <Badge status={level}>{statusLabel(level)}</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="No incidents to display" description="Incident records will appear here when returned by the backend." />
          )}
        </Panel>

        <Panel title="Recovery readiness" subtitle="Automated recovery control">
          <div className="recovery-readiness">
            <div className={`readiness-icon ${recovery?.enabled ? "readiness-enabled" : "readiness-preview"}`}>
              {recovery?.enabled ? <Zap size={23} /> : <Shield size={23} />}
            </div>
            <div className="readiness-copy">
              <strong>{recovery?.enabled ? "Recovery enabled" : "Safe preview mode"}</strong>
              <span>{recovery?.enabled ? "Backend reports recovery enabled." : "Preview actions do not change your system."}</span>
            </div>
            <Badge status={recovery?.enabled ? "warning" : "healthy"}>{recovery?.enabled ? "Enabled" : "Protected"}</Badge>
          </div>
          <div className="recovery-detail-row"><span>Target container</span><code>{recovery?.target_container || "api-service-container"}</code></div>
          <div className="recovery-detail-row"><span>Recorded actions</span><strong>{number(recovery?.history?.length || 0)}</strong></div>
          <button className="panel-bottom-link" onClick={() => onNavigate("recovery")}>
            Open recovery center <ArrowRight size={15} />
          </button>
        </Panel>
      </div>

      <div className="bottom-insight">
        <div className="bottom-insight-icon"><Sparkles size={19} /></div>
        <div><strong>Observability insight</strong><p>Monitor changes in latency and error rate together. A sudden increase in both can help narrow down the source of a service degradation.</p></div>
        <button className="text-button" onClick={() => onNavigate("rca")}>Review diagnosis <ArrowRight size={14} /></button>
      </div>
    </>
  );
}

function ServicesPage({ health, overallStatus, data }) {
  const services = [
    {
      name: "FastAPI application",
      role: "Application API",
      endpoint: `${API}/health`,
      status: health?.status || (health ? "healthy" : "unknown"),
      icon: Server,
      detail: "Health endpoint and application responses",
    },
    {
      name: "Telemetry endpoint",
      role: "Metrics collection",
      endpoint: `${API}/metrics`,
      status: data ? "healthy" : "unknown",
      icon: Activity,
      detail: "Prometheus-compatible metrics exposure",
    },
    {
      name: "Application data",
      role: "Monitoring data",
      endpoint: `${API}/api/data`,
      status: data ? "healthy" : "unknown",
      icon: Database,
      detail: "Aggregated application and telemetry data",
    },
  ];

  return (
    <>
      <div className="service-summary-strip">
        <div><span className="summary-strip-icon"><Server size={18} /></span><div><span>Tracked endpoints</span><strong>{services.length}</strong></div></div>
        <div><span className="summary-strip-icon summary-green"><CheckCircle2 size={18} /></span><div><span>Backend status</span><strong>{statusLabel(health?.status || (health ? "healthy" : "unknown"))}</strong></div></div>
        <div><span className="summary-strip-icon summary-blue"><Activity size={18} /></span><div><span>Monitoring mode</span><strong>Polling · 12s</strong></div></div>
      </div>

      <SectionHeading eyebrow="INFRASTRUCTURE" title="Service inventory" description="Endpoint reachability based on the most recent successful dashboard fetch." />

      <div className="service-list">
        {services.map(({ name, role, endpoint, status, icon: Icon, detail }) => (
          <article className="service-card" key={name}>
            <div className="service-card-icon"><Icon size={22} /></div>
            <div className="service-card-main">
              <div className="service-card-title"><h3>{name}</h3><Badge status={status} dot>{statusLabel(status)}</Badge></div>
              <p>{detail}</p>
              <code>{endpoint}</code>
            </div>
            <div className="service-card-role"><span>COMPONENT</span><strong>{role}</strong></div>
            <a className="service-external" href={endpoint} target="_blank" rel="noreferrer" aria-label={`Open ${name} endpoint`}><ExternalLink size={17} /></a>
          </article>
        ))}
      </div>

      <Panel title="Service dependency map" subtitle="Logical application flow represented by the current CloudPulse components">
        <div className="dependency-map">
          <div className="dependency-node dependency-node-primary">
            <Server size={20} />
            <strong>FastAPI service</strong>
            <span>Application endpoints</span>
          </div>
          <div className="dependency-connector"><ArrowRight size={18} /></div>
          <div className="dependency-node">
            <Activity size={20} />
            <strong>Prometheus metrics</strong>
            <span>Request and latency telemetry</span>
          </div>
          <div className="dependency-connector"><ArrowRight size={18} /></div>
          <div className="dependency-node">
            <Sparkles size={20} />
            <strong>RCA engine</strong>
            <span>Rule-based diagnosis</span>
          </div>
          <div className="dependency-connector"><ArrowRight size={18} /></div>
          <div className="dependency-node">
            <ShieldCheck size={20} />
            <strong>Recovery workflow</strong>
            <span>Guarded simulation recovery</span>
          </div>
        </div>
        <p className="dependency-caption">This is a documented logical flow of the project components, not an automatically discovered live dependency graph.</p>
      </Panel>

      <Panel title="Health assessment" subtitle="Current backend summary">
        <div className="health-check-list">
          <HealthIndicator label="Application API" value={overallStatus} description="Backend health response received" />
          <HealthIndicator label="Data endpoint" value={data ? "healthy" : "unknown"} description="Application data successfully loaded" />
          <HealthIndicator label="Monitoring data" value={data ? "healthy" : "unknown"} description="Dashboard received current telemetry payload" />
        </div>
      </Panel>
    </>
  );
}

function MetricsPage({ data, metrics, parsedMetrics, onDownload, onProbe, latency, busy }) {
  const [filter, setFilter] = useState("");
  const metricLines = String(metrics || "")
    .split("\n")
    .filter((line) => line.trim() && (!filter || line.toLowerCase().includes(filter.toLowerCase())));

  const requests =
    data?.data?.requests ??
    data?.requests ??
    data?.total_requests ??
    parsedMetrics.requests;

  const errors =
    data?.data?.errors ??
    data?.errors ??
    data?.total_errors ??
    parsedMetrics.errors;

  return (
    <>
      <div className="metric-grid">
        <MetricCard label="API requests" value={number(requests)} detail="Request counter" icon={Activity} tone="blue" />
        <MetricCard label="API errors" value={number(errors)} detail="Error counter" icon={AlertTriangle} tone="orange" />
        <MetricCard label="Telemetry samples" value={number(data?.telemetry_samples)} detail="Backend-reported samples" icon={BarChart3} tone="purple" />
        <MetricCard label="Latest probe" value={latency === null ? "—" : `${number(latency, 1)} ms`} detail="Browser-measured duration" icon={Timer} tone="green" />
      </div>

      <Panel
        title="Application latency probe"
        subtitle="Measure a request to the existing API slow endpoint."
        action={<button className="button button-primary button-small" onClick={onProbe} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Run probe</button>}
      >
        <div className="probe-card">
          <div className="probe-visual"><Gauge size={28} /></div>
          <div className="probe-copy"><strong>{latency === null ? "No probe recorded yet" : `${number(latency, 2)} ms`}</strong><span>{latency === null ? "Run a probe to measure browser-observed response duration." : "Elapsed time measured by the browser. This includes network and server response time."}</span></div>
          <Badge status={latency === null ? "neutral" : latency > 1000 ? "warning" : "healthy"}>{latency === null ? "Not tested" : latency > 1000 ? "Slow response" : "Completed"}</Badge>
        </div>
      </Panel>

      <Panel
        title="Prometheus metrics"
        subtitle="Raw output from the backend /metrics endpoint."
        action={<button className="button button-secondary button-small" onClick={onDownload}><Download size={14} /> Export .txt</button>}
      >
        <div className="metrics-toolbar">
          <div className="metrics-filter"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter metric names..." /></div>
          <span className="metrics-count">{metricLines.length} lines</span>
        </div>
        <div className="code-window">
          <div className="code-window-header"><span><i /><i /><i /></span><span><Terminal size={13} /> metrics output</span><span>TEXT</span></div>
          <pre>{metricLines.length ? metricLines.join("\n") : "No matching metrics available. Confirm the backend /metrics endpoint."}</pre>
        </div>
      </Panel>
    </>
  );
}
function IncidentsPage({ incidents, allCount, openCount, searchTerm, setSearchTerm, onResolve, busy }) {
  return (
    <>
      <div className="metric-grid metric-grid-three">
        <MetricCard label="All incidents" value={number(allCount)} detail="Returned by the API" icon={Bell} tone="blue" />
        <MetricCard label="Open incidents" value={number(openCount)} detail="Awaiting resolution" icon={AlertTriangle} tone="orange" />
        <MetricCard label="Resolved" value={number(Math.max(0, allCount - openCount))} detail="Closed or recovered" icon={CheckCircle2} tone="green" />
      </div>

      <Panel
        title="Incident register"
        subtitle="Search, inspect, and resolve incidents reported by the backend."
        action={<Badge status={openCount ? "warning" : "healthy"} dot>{openCount} open</Badge>}
      >
        <div className="incident-toolbar">
          <div className="search-box"><Search size={17} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search ID, title, service or status..." /></div>
          <span className="incident-total">{incidents.length} displayed</span>
        </div>

        {incidents.length ? (
          <div className="incident-table-wrap">
            <table className="incident-table">
              <thead><tr><th>INCIDENT</th><th>SERVICE</th><th>SEVERITY</th><th>CREATED</th><th>STATUS</th><th>ACTION</th></tr></thead>
              <tbody>
                {incidents.map((incident, index) => {
                  const id = incident.id || incident.incident_id;
                  const severity = incident.severity || incident.status || "warning";
                  const resolved = ["resolved", "closed", "recovered"].includes(String(incident.status || "").toLowerCase());

                  return (
                    <tr key={id || index}>
                      <td><div className="incident-table-title"><span className={`incident-table-icon severity-${severityOf(severity)}`}>{severityOf(severity) === "critical" ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}</span><div><strong>{incident.title || incident.name || "System incident"}</strong><span>{id || "ID unavailable"}</span></div></div></td>
                      <td>{incident.service || "API service"}</td>
                      <td><Badge status={severity} dot>{statusLabel(severity)}</Badge></td>
                      <td>{timeAgo(incident.created_at || incident.timestamp)}</td>
                      <td><Badge status={incident.status || "open"}>{statusLabel(incident.status || "open")}</Badge></td>
                      <td>{resolved ? <span className="resolved-label"><Check size={14} /> Complete</span> : <button className="button button-secondary button-small" disabled={busy || !id} onClick={() => onResolve(id)}>Resolve</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={searchTerm ? Search : CheckCircle2} title={searchTerm ? "No matching incidents" : "No incidents returned"} description={searchTerm ? "Try a different search term." : "The backend has not returned any incident records."} />
        )}
      </Panel>

      <Panel title="Incident lifecycle timeline" subtitle="Chronological view based on incident creation and resolution timestamps">
        {incidents.length ? (
          <div className="incident-lifecycle">
            {incidents.slice(0, 8).map((incident, index) => {
              const resolved = ["resolved", "closed", "recovered"].includes(String(incident.status || "").toLowerCase());
              const incidentId = incident.id || incident.incident_id || `incident-${index}`;
              return (
                <div className="incident-lifecycle-row" key={incidentId}>
                  <span className={`incident-lifecycle-marker ${resolved ? "lifecycle-resolved" : "lifecycle-open"}`}>
                    {resolved ? <Check size={14} /> : <AlertTriangle size={14} />}
                  </span>
                  <div className="incident-lifecycle-copy">
                    <strong>{incident.title || incident.name || "System incident"}</strong>
                    <span>{incidentId} · {incident.service || "api-service"}</span>
                    <small>Created {prettyDate(incident.created_at || incident.timestamp)}</small>
                    {incident.resolved_at && <small>Resolved {prettyDate(incident.resolved_at)}</small>}
                  </div>
                  <Badge status={resolved ? "healthy" : incident.severity || "warning"}>{resolved ? "Resolved" : statusLabel(incident.status || "Open")}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Clock3} title="No lifecycle events yet" description="Incident lifecycle entries will appear when the backend records incidents." />
        )}
      </Panel>

      <div className="bottom-insight">
        <div className="bottom-insight-icon"><ShieldCheck size={19} /></div>
        <div><strong>Incident handling</strong><p>Resolve an incident only after you have reviewed its status and verified that the underlying issue has been addressed.</p></div>
      </div>
    </>
  );
}

function RcaPage({ rca, rcaStatus, onRefresh }) {
  const severity = severityOf(rcaStatus);
  const confidence = rca?.confidence == null
    ? null
    : Number(rca.confidence) <= 1
      ? Number(rca.confidence) * 100
      : Number(rca.confidence);

  const evidence = [
    {
      label: "Latency baseline",
      value: rca?.baseline_median != null
        ? seconds(rca.baseline_median)
        : rca?.baseline_latency != null
          ? seconds(rca.baseline_latency)
          : "—",
      icon: Database,
    },
    {
      label: "Observed / baseline ratio",
      value: (rca?.ratio ?? rca?.latency_ratio) != null
        ? `${number(rca.ratio ?? rca.latency_ratio, 2)}×`
        : "—",
      icon: Activity,
    },
    {
      label: "Samples analyzed",
      value: number(rca?.samples_analyzed ?? rca?.sample_count),
      icon: BarChart3,
    },
    {
      label: "Model confidence",
      value: rca?.confidence == null
        ? "—"
        : percent(
            Number(rca.confidence) <= 1
              ? Number(rca.confidence) * 100
              : Number(rca.confidence)
          ),
      icon: Gauge,
    },
  ];

  return (
    <>
      <section className={`rca-hero rca-hero-${severity}`}>
        <div className="rca-hero-icon">{severity === "critical" ? <AlertCircle size={27} /> : severity === "healthy" ? <CheckCircle2 size={27} /> : <Sparkles size={27} />}</div>
        <div className="rca-hero-copy">
          <span className="eyebrow">AUTOMATED DIAGNOSIS</span>
          <h2>{rca?.probable_cause || rca?.cause || "Root-cause analysis is waiting for backend data."}</h2>
          <p>
            {rca?.recommended_action ||
              rca?.recommendation ||
              "Refresh the analysis after telemetry data has been collected."}
          </p>
        </div>
        <div className="rca-hero-status"><Badge status={rcaStatus} dot>{statusLabel(rcaStatus)}</Badge><button className="button button-secondary button-small" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button></div>
      </section>

      <SectionHeading eyebrow="DIAGNOSTIC EVIDENCE" title="Analysis evidence" description="Measurements returned by the current backend analysis." />

      <div className="metric-grid metric-grid-four">
        {evidence.map(({ label, value, icon: Icon }, index) => (
          <MetricCard key={label} label={label} value={value} detail={index === 1 ? "Current latency vs baseline" : index === 0 ? "Historical median" : index === 2 ? "Telemetry window" : "Backend confidence score"} icon={Icon} tone={["blue", "purple", "green", "orange"][index]} />
        ))}
      </div>

      <div className="content-grid">
        <Panel title="Probable cause" subtitle="Backend-generated diagnosis">
          <div className="rca-cause-box">
            <div className={`rca-cause-symbol cause-${severity}`}><Network size={21} /></div>
            <div><span className="mini-label">PRIMARY FINDING</span><h3>{rca?.probable_cause || rca?.cause || "No diagnosis available"}</h3><p>{rca?.description || "The backend has not supplied additional explanatory details."}</p></div>
          </div>
          {confidence !== null && (
            <div className="confidence-block">
              <div className="confidence-label"><span>Analysis confidence</span><strong>{percent(confidence)}</strong></div>
              <div className="confidence-track"><div style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }} /></div>
            </div>
          )}
        </Panel>

        <Panel title="Recommended next steps" subtitle="Operational guidance">
          <div className="recommendation-list">
            <div><span>01</span><p>Inspect API processing and application logs around the time of the latency anomaly.</p></div>
            <div><span>02</span><p>Check downstream dependencies and container resource usage for bottlenecks.</p></div>
            <div><span>03</span><p>Verify active requests and assess recovery options before any controlled restart.</p></div>
          </div>
        </Panel>
      </div>

      <Panel title="Operational risk signals" subtitle="Transparent indicators derived from the current RCA response">
        <div className="risk-signal-grid">
          <div className="risk-signal">
            <span>Current classification</span>
            <strong><Badge status={rcaStatus} dot>{statusLabel(rcaStatus)}</Badge></strong>
          </div>
          <div className="risk-signal">
            <span>Latency compared with baseline</span>
            <strong>{(rca?.latency_ratio ?? rca?.ratio) == null ? "Not available" : `${number(rca.latency_ratio ?? rca.ratio, 2)}×`}</strong>
          </div>
          <div className="risk-signal">
            <span>Evidence volume</span>
            <strong>{number(rca?.samples_analyzed ?? rca?.sample_count)} samples</strong>
          </div>
        </div>
        <p className="risk-disclaimer">These are rule-based risk indicators from the supplied RCA data. They are not a trained machine-learning failure probability.</p>
      </Panel>

      <Panel title="Raw analysis response" subtitle="Exact JSON returned by the RCA endpoint.">
        <div className="code-window">
          <div className="code-window-header"><span><i /><i /><i /></span><span><Code2 size={13} /> /api/rca</span><span>JSON</span></div>
          <pre>{JSON.stringify(rca || { message: "No RCA response available" }, null, 2)}</pre>
        </div>
      </Panel>
    </>
  );
}
function RecoveryPage({
  recovery,
  history,
  enabled,
  onRun,
  busy,
  lastRecovery,
  simulation,
  simulationRca,
}) {
  const target = recovery?.target_container || "api-service-container";
  const simulationActive = simulation?.active === true;
  const steps = Array.isArray(lastRecovery?.steps) ? lastRecovery.steps : [];
  const before = lastRecovery?.before || {};
  const after = lastRecovery?.after || {};
  const hasComparison = Object.keys(before).length > 0 && Object.keys(after).length > 0;
  const verified = lastRecovery?.verified === true;

  const fallbackSteps = [
    { title: "Incident captured", detail: lastRecovery?.trigger || simulationRca?.probable_cause || "Recovery request received." },
    { title: "Recovery plan selected", detail: "Restore the in-memory simulation to its normal baseline." },
    { title: "Simulation state restored", detail: "Reset scenario, status, latency, request and error values." },
    { title: "Incident updated", detail: "Resolve the matching simulated incident after restoration." },
    { title: "Health verification", detail: verified ? "Healthy state and normal scenario were confirmed." : "Verification result was not confirmed." },
  ];

  const displaySteps = steps.length ? steps : fallbackSteps;

  return (
    <>
      <section className="recovery-hero">
        <div className="recovery-hero-symbol"><ShieldCheck size={30} /></div>
        <div className="recovery-hero-copy">
          <span className="eyebrow">AUTOMATED OPERATIONS</span>
          <h2>{verified ? "Recovery completed and verified" : simulationActive ? "A simulated incident is ready for recovery" : "Your recovery workflow is in safe demonstration mode"}</h2>
          <p>{recovery?.note || "The recovery engine demonstrates a guarded recovery workflow using an in-memory simulation. It does not restart a real Docker container."}</p>
        </div>
        <Badge status={verified ? "healthy" : enabled ? "warning" : "healthy"} dot>
          {verified ? "Verified" : enabled ? "Enabled" : "Safe demo mode"}
        </Badge>
      </section>

      <div className="metric-grid metric-grid-three">
        <MetricCard label="Recovery mode" value="Simulation" detail="No real container restart" icon={Shield} tone="green" />
        <MetricCard label="Target service" value="api-service" detail={target} icon={Server} tone="blue" />
        <MetricCard label="Recorded actions" value={number(history.length)} detail="Backend recovery history" icon={Clock3} tone="purple" />
      </div>

      <Panel title="Self-healing architecture" subtitle="Monitoring → diagnosis → guarded recovery → verification">
        <div className="recovery-architecture">
          {[
            { title: "Monitoring", description: "Health endpoint and telemetry", state: "completed" },
            { title: "Incident detection", description: simulationActive ? "Simulated anomaly detected" : "Waiting for an incident", state: simulationActive ? "active" : verified ? "completed" : "waiting" },
            { title: "Root-cause analysis", description: simulationRca?.probable_cause || lastRecovery?.trigger || "Diagnosis becomes available after a trigger", state: simulationActive || lastRecovery ? "completed" : "waiting" },
            { title: "Recovery engine", description: verified ? "Baseline values restored" : "Ready to execute guarded recovery", state: verified ? "completed" : "waiting" },
            { title: "Health verification", description: verified ? "Healthy state confirmed" : "Awaiting a recovery run", state: verified ? "completed" : "waiting" },
          ].map((stage, index, stages) => (
            <React.Fragment key={stage.title}>
              <div className={`architecture-node architecture-${stage.state}`}>
                <span className="architecture-number">{String(index + 1).padStart(2, "0")}</span>
                <strong>{stage.title}</strong>
                <small>{stage.description}</small>
                <Badge status={stage.state === "completed" ? "healthy" : stage.state === "active" ? "warning" : "neutral"} dot>
                  {stage.state === "completed" ? "Completed" : stage.state === "active" ? "Active" : "Waiting"}
                </Badge>
              </div>
              {index < stages.length - 1 && <div className="architecture-arrow" aria-hidden="true">→</div>}
            </React.Fragment>
          ))}
        </div>
        <div className="architecture-footer">
          <ShieldCheck size={18} />
          <span>{simulationActive ? "A controlled incident is active. Run recovery to restore the demonstration state." : verified ? "Recovery succeeded. The backend confirmed the normal simulation state." : "Monitoring is available. Trigger an incident in Simulation Lab before running recovery."}</span>
        </div>
        <div className="recovery-action-box">
          <div className="recovery-action-copy">
            <ShieldAlert size={19} />
            <div>
              <strong>Execute guarded recovery</strong>
              <span>{simulationActive ? "Restore the active simulated incident and verify the resulting state." : "No active simulation is detected. You can still run a preview, but it will not change system state."}</span>
            </div>
          </div>
          <button className="button button-primary" onClick={onRun} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            {busy ? "Recovering..." : "Run recovery"}
          </button>
        </div>
      </Panel>

      
{lastRecovery && (
  <>
    <Panel
      title="Recovery execution timeline"
      subtitle={`Execution ${lastRecovery.id || "—"} · ${prettyDate(lastRecovery.created_at)}`}
    >
      <div className="execution-timeline">
        {displaySteps.map((step, index) => {
          const stepStatus =
            step.status ||
            (lastRecovery.status === "executed"
              ? "completed"
              : lastRecovery.status === "failed"
              ? "failed"
              : "preview");

          const stepTitle =
            step.title || step.name || `Step ${index + 1}`;

          const recoveryDescriptions = {
            "Incident captured":
              "Captured the incident and recorded the affected service state.",
            "Recovery plan selected":
              "Selected a recovery strategy based on the detected scenario.",
            "Simulation state restored":
              "Restored simulated service metrics to their normal baseline values.",
            "Incident record updated":
              "Updated the incident record with the recovery execution result.",
            "Health verification":
              "Verified that the simulated service returned to a healthy state.",
          };

          const stepDescription =
            step.detail ||
            step.message ||
            step.description ||
            recoveryDescriptions[stepTitle] ||
            "Recovery operation completed successfully.";

          return (
            <div className="execution-step" key={`${stepTitle}-${index}`}>
              <div className={`execution-step-marker execution-${stepStatus}`}>
                {stepStatus === "completed" || stepStatus === "verified" ? (
                  <Check size={15} />
                ) : stepStatus === "failed" ? (
                  <AlertCircle size={15} />
                ) : (
                  <Clock3 size={15} />
                )}
              </div>

              <div className="execution-step-copy">
                <div className="execution-step-heading">
                  <strong>{stepTitle}</strong>
                  <Badge
                    status={
                      stepStatus === "verified" || stepStatus === "completed"
                        ? "healthy"
                        : stepStatus === "failed"
                        ? "critical"
                        : "warning"
                    }
                  >
                    {statusLabel(stepStatus)}
                  </Badge>
                </div>
                <p>{stepDescription}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>

    {hasComparison && (
      <Panel
        title="Before-and-after service state"
        subtitle="Values captured by the backend during this recovery operation"
      >
        <div className="recovery-comparison">
          {[
            { label: "Service status", before: statusLabel(before.status), after: statusLabel(after.status) },
            { label: "Scenario", before: statusLabel(before.scenario), after: statusLabel(after.scenario) },
            { label: "Latency", before: before.latency == null ? "—" : seconds(before.latency), after: after.latency == null ? "Normal baseline" : seconds(after.latency) },
            { label: "Requests", before: number(before.requests), after: number(after.requests) },
            { label: "Errors", before: number(before.errors), after: number(after.errors) },
            { label: "Incident", before: statusLabel(before.incident_status || "open"), after: statusLabel(after.incident_status || "unknown") },
          ].map((item) => (
            <div className="comparison-row" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.before}</strong>
              <ArrowRight size={15} />
              <strong className="comparison-after">{item.after}</strong>
            </div>
          ))}
        </div>
      </Panel>
    )}

    <Panel title="Recovery action details" subtitle="What the recovery engine changed">
      <div className="recovery-change-list">
        {(Array.isArray(lastRecovery.changes) ? lastRecovery.changes : [
          "Simulation active flag changed to false.",
          "Scenario changed to normal and service status changed to healthy.",
          "Simulated latency was cleared; request and error counters returned to baseline values.",
          "The matching open simulated incident was marked resolved after verification.",
        ]).map((change, index) => (
          <div className="recovery-change-row" key={index}>
            <span><CheckCircle2 size={16} /></span>
            <p>{typeof change === "string" ? change : change.detail || JSON.stringify(change)}</p>
          </div>
        ))}
      </div>
      <div className="recovery-safety-note">
        <Shield size={17} />
        <span>
          {lastRecovery.safety_note ||
            "Demonstration mode: only in-memory simulation values are changed. No real Docker container is restarted."}
        </span>
      </div>
    </Panel>
  </>
)}


      <Panel title="Recovery audit history" subtitle="Recorded recovery attempts returned by the backend">
        {history.length ? (
          <div className="history-list">
            {history.map((item, index) => (
              <div className="history-row" key={item.id || index}>
                <span className={`history-icon history-${severityOf(item.status)}`}><Clock3 size={17} /></span>
                <div className="history-copy">
                  <strong>{statusLabel(item.action || "Recovery action")}</strong>
                  <span>{item.id || "No action ID"} · {prettyDate(item.created_at)}</span>
                  <p>{item.message || item.trigger || "No additional details."}</p>
                </div>
                <Badge status={item.status || "neutral"}>{statusLabel(item.status || "unknown")}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Clock3} title="No recovery actions recorded" description="The audit history will appear after the backend records a recovery run or preview." />
        )}
      </Panel>

      <div className="alert-banner alert-banner-warning recovery-warning">
        <ShieldAlert size={19} />
        <div>
          <strong>Demonstration safety boundary</strong>
          <span>CloudPulse currently restores only its in-memory simulation. It does not restart, stop, or modify a real Docker container. The recovery timeline describes the actions returned by the backend.</span>
        </div>
      </div>
    </>
  );
}

function SimulationPage({ simulation, rca, onTrigger, onReset, busy }) {
  const active = simulation?.active === true;

  return (
    <div className="simulation-page">
      <section className={`simulation-hero ${active ? "hero-critical" : "hero-healthy"}`}>
        <div>
          <span className="eyebrow">CLOUDPULSE · DEMO ENVIRONMENT</span>
          <h2>Simulation Lab</h2>
          <p>
            Trigger a controlled incident, inspect the simulated diagnosis,
            and reset the environment when you're finished.
          </p>
          <span className={`status-pill ${active ? "status-danger" : "status-success"}`}>
            <span className="live-dot" />
            {active ? "SIMULATED INCIDENT ACTIVE" : "SYSTEM IN NORMAL SIMULATION STATE"}
          </span>
        </div>

        <div className="simulation-actions">
          <button
            className="primary-button"
            onClick={onTrigger}
            disabled={busy}
          >
            {busy ? "Processing..." : "Trigger Incident"}
          </button>

          <button
            className="secondary-button"
            onClick={onReset}
            disabled={busy}
          >
            Reset Simulation
          </button>
        </div>
      </section>

      <div className="simulation-notice">
        <strong>Demo mode:</strong> The values and diagnosis displayed here
        come from the application's simulation endpoint. They do not represent
        a confirmed failure in real cloud infrastructure.
      </div>

      <div className="simulation-metrics">
        <div className="simulation-card">
          <span>Scenario</span>
          <strong>{simulation?.scenario || "normal"}</strong>
        </div>

        <div className="simulation-card">
          <span>Status</span>
          <strong>{simulation?.status || "healthy"}</strong>
        </div>

        <div className="simulation-card">
          <span>Simulated latency</span>
          <strong>
            {simulation?.latency != null
              ? `${(Number(simulation.latency) * 1000).toFixed(0)} ms`
              : "—"}
          </strong>
        </div>

        <div className="simulation-card">
          <span>Simulated requests</span>
          <strong>{simulation?.requests ?? "—"}</strong>
        </div>

        <div className="simulation-card">
          <span>Simulated errors</span>
          <strong>{simulation?.errors ?? "—"}</strong>
        </div>

        <div className="simulation-card">
          <span>Latency vs baseline</span>
          <strong>{simulation?.latency != null ? `${(Number(simulation.latency) / 0.05).toFixed(1)}×` : "1.0×"}</strong>
        </div>
      </div>

      <section className="simulation-details">
        <h3>Incident diagnosis</h3>

        {rca ? (
          <>
            <div className="diagnosis-item">
              <span>Probable cause</span>
              <p>{rca.probable_cause || "No probable cause supplied."}</p>
            </div>

            <div className="diagnosis-item">
              <span>Confidence</span>
              <p>
                {rca.confidence != null
                  ? `${Math.round(Number(rca.confidence) * 100)}%`
                  : "Not available"}
              </p>
            </div>

            <div className="diagnosis-item">
              <span>Recommended action</span>
              <p>{rca.recommended_action || "No recommendation supplied."}</p>
            </div>

            {Array.isArray(rca.evidence) && rca.evidence.length > 0 && (
              <div className="diagnosis-item">
                <span>Evidence</span>
                <ul>
                  {rca.evidence.map((item, index) => (
                    <li key={index}>
                      {typeof item === "string" ? item : JSON.stringify(item)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="simulation-empty">
            No simulation diagnosis yet. Select <strong>Trigger Incident</strong>
            to generate a simulated incident and view its diagnosis.
          </p>
        )}
      </section>

      <section className="simulation-details">
        <h3>How the workflow operates</h3>

        <div className="simulation-workflow">
          <div className="workflow-step">
            <span>01</span>
            <strong>Trigger</strong>
            <p>Generate a simulated abnormal scenario.</p>
          </div>

          <div className="workflow-step">
            <span>02</span>
            <strong>Analyze</strong>
            <p>Inspect the probable cause and supporting evidence.</p>
          </div>

          <div className="workflow-step">
            <span>03</span>
            <strong>Recover</strong>
            <p>Review recovery options and reset the simulation.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
}