import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Cpu,
  Eye,
  FileCode2,
  HardDrive,
  Loader2,
  Logs,
  MoonStar,
  PlayCircle,
  ShieldCheck,
  UserCircle2
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  executeAISuggestion,
  fetchLogs,
  fetchNamespaceMetricsSummary,
  fetchNamespaces,
  fetchPodMetrics,
  fetchPods,
  inspectWithAI
} from "./api";

const PODS_AND_METRICS_POLL_MS = 5000;
const LOGS_POLL_MS = 5000;
const MAX_HISTORY_POINTS = 30;

function formatBytesMiBToHuman(memoryMiBString) {
  const value = Number(memoryMiBString || 0);
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} GiB`;
  }
  return `${value.toFixed(2)} MiB`;
}

function classifyLogLine(line) {
  const text = line.toLowerCase();
  if (text.includes("error") || text.includes("fatal")) return "error";
  if (text.includes("warn")) return "warn";
  return "info";
}

export default function App() {
  const [namespace, setNamespace] = useState("default");
  const [namespaces, setNamespaces] = useState([]);
  const [pods, setPods] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [namespaceSummary, setNamespaceSummary] = useState([]);
  const [globalCpuTotal, setGlobalCpuTotal] = useState("0.0000");
  const [globalMemoryTotal, setGlobalMemoryTotal] = useState("0.00");
  const [selectedPod, setSelectedPod] = useState("");
  const [expandedPod, setExpandedPod] = useState("");
  const [activeTab, setActiveTab] = useState("metrics");
  const [tail, setTail] = useState(200);
  const [logs, setLogs] = useState("");
  const [activeLogPod, setActiveLogPod] = useState("");
  const [logsPollingEnabled, setLogsPollingEnabled] = useState(false);
  const [loadingNamespaces, setLoadingNamespaces] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [metricsSource, setMetricsSource] = useState("");
  const [namespaceMenuOpen, setNamespaceMenuOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExecuting, setAiExecuting] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiExecutionResult, setAiExecutionResult] = useState(null);
  const [metricHistory, setMetricHistory] = useState([]);
  const namespaceDropdownRef = useRef(null);

  const runningPods = useMemo(() => pods.filter((pod) => pod.phase === "Running").length, [pods]);
  const degradedPods = useMemo(
    () => pods.filter((pod) => pod.phase !== "Running" || Number(pod.restarts || 0) > 0).length,
    [pods]
  );
  const metricsByPod = useMemo(() => {
    const map = new Map();
    metrics.forEach((metric) => {
      const podName = metric.pod || "unknown";
      const cpuCores = Number(metric.cpuCores || 0);
      const memoryMiB = Number(metric.memoryMiB || 0);
      const current = map.get(podName) || { cpuCores: 0, memoryMiB: 0 };
      current.cpuCores += cpuCores;
      current.memoryMiB += memoryMiB;
      map.set(podName, current);
    });
    return map;
  }, [metrics]);

  const podsWithMetrics = useMemo(
    () =>
      pods.map((pod) => {
        const aggregate = metricsByPod.get(pod.name);
        return {
          ...pod,
          cpuCores: aggregate ? aggregate.cpuCores.toFixed(4) : "n/a",
          memoryMiB: aggregate ? aggregate.memoryMiB.toFixed(2) : "n/a"
        };
      }),
    [pods, metricsByPod]
  );

  const selectedPodRow = useMemo(
    () => podsWithMetrics.find((pod) => pod.name === (expandedPod || selectedPod)),
    [podsWithMetrics, expandedPod, selectedPod]
  );

  const hotMetrics = useMemo(
    () => metrics.filter((metric) => Number(metric.cpuCores || 0) >= 0.15).length,
    [metrics]
  );

  const namespaceCpuTotal = useMemo(
    () => metrics.reduce((sum, metric) => sum + Number(metric.cpuCores || 0), 0).toFixed(4),
    [metrics]
  );

  const namespaceMemoryTotal = useMemo(
    () => metrics.reduce((sum, metric) => sum + Number(metric.memoryMiB || 0), 0).toFixed(2),
    [metrics]
  );

  const currentClusterMetrics = useMemo(
    () => namespaceSummary.find((item) => item.namespace === namespace),
    [namespaceSummary, namespace]
  );

  const aiConfidence = useMemo(() => {
    if (!aiResult) return 0;
    if (aiResult.risk_level === "low") return 84;
    if (aiResult.risk_level === "medium") return 63;
    return 42;
  }, [aiResult]);

  const aiSteps = useMemo(
    () => [
      { id: "inspect", label: "Inspect evidence", state: aiResult ? "done" : aiLoading ? "active" : "upcoming" },
      { id: "diagnose", label: "Diagnose root cause", state: aiResult ? "done" : "upcoming" },
      {
        id: "action",
        label: "Action approval",
        state: aiExecuting ? "active" : aiExecutionResult ? "done" : "upcoming"
      }
    ],
    [aiLoading, aiResult, aiExecuting, aiExecutionResult]
  );

  const podEvents = useMemo(() => {
    if (!selectedPodRow) return [];
    const events = [
      `Status is ${selectedPodRow.phase}`,
      `Restart count is ${selectedPodRow.restarts}`,
      `CPU usage observed at ${selectedPodRow.cpuCores} cores`,
      `Memory usage observed at ${selectedPodRow.memoryMiB} MiB`
    ];
    if (Number(selectedPodRow.restarts || 0) > 0) {
      events.unshift("Pod has restart activity and may need inspection.");
    }
    return events;
  }, [selectedPodRow]);

  const loadingAny = loadingNamespaces || loadingData || loadingLogs || aiLoading || aiExecuting;

  async function loadNamespaces() {
    setLoadingNamespaces(true);
    setError("");
    try {
      const data = await fetchNamespaces();
      const nextNamespaces = data.namespaces || [];
      setNamespaces(nextNamespaces);
      if (nextNamespaces.includes("simulation") && namespace !== "simulation") {
        setNamespace("simulation");
      } else if (nextNamespaces.length && !nextNamespaces.includes(namespace)) {
        setNamespace(nextNamespaces[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingNamespaces(false);
    }
  }

  async function refreshPodsAndMetrics() {
    try {
      setLoadingData(true);
      const [podData, metricData, nsSummaryData] = await Promise.all([
        fetchPods(namespace),
        fetchPodMetrics(namespace),
        fetchNamespaceMetricsSummary()
      ]);

      const nextPods = podData.pods || [];
      setPods(nextPods);
      setMetrics(metricData.metrics || []);
      setMetricsSource(metricData.source || "metrics-server");
      setNamespaceSummary(nsSummaryData.namespaces || []);
      setGlobalCpuTotal(nsSummaryData.totalCpuCores || "0.0000");
      setGlobalMemoryTotal(nsSummaryData.totalMemoryMiB || "0.00");

      if (nextPods.length && !nextPods.some((pod) => pod.name === selectedPod)) {
        setSelectedPod(nextPods[0].name);
      } else if (!nextPods.length) {
        setSelectedPod("");
      }
    } catch (err) {
      setError(err.message || "Failed to refresh pods and metrics.");
    } finally {
      setLoadingData(false);
    }
  }

  async function refreshLogsForPod(podName, showLoading = true) {
    if (!podName) return;
    if (showLoading) {
      setLoadingLogs(true);
    }
    setError("");
    try {
      const podObj = pods.find((pod) => pod.name === podName);
      const container = podObj?.containers?.[0] || "";
      const result = await fetchLogs({
        namespace,
        pod: podName,
        container,
        tail
      });
      setActiveLogPod(podName);
      setLogs(result.logs || "");
    } catch (err) {
      setError(err.message || "Failed to fetch logs.");
    } finally {
      if (showLoading) {
        setLoadingLogs(false);
      }
    }
  }

  async function runInspect(priorAttempt) {
    if (!selectedPod) return;
    setAiLoading(true);
    setAiExecutionResult(null);
    setError("");
    try {
      const result = await inspectWithAI({
        namespace,
        selectedPod,
        tail,
        priorAttempt
      });
      setAiResult(result);
    } catch (err) {
      setError(err.message || "AI inspect failed.");
    } finally {
      setAiLoading(false);
    }
  }

  async function runFixIt() {
    if (!aiResult?.commands?.length) return;
    setAiExecuting(true);
    setError("");
    try {
      const executable = aiResult.commands.filter((cmd) => !cmd.requires_manual);
      const result = await executeAISuggestion({
        namespace,
        commands: executable.map((cmd) => ({ id: cmd.id, command: cmd.command }))
      });
      setAiExecutionResult(result);
      await refreshPodsAndMetrics();
      if (selectedPod) {
        await refreshLogsForPod(selectedPod, false);
      }
    } catch (err) {
      setError(err.message || "AI execute failed.");
    } finally {
      setAiExecuting(false);
    }
  }

  useEffect(() => {
    loadNamespaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!namespace) return undefined;
    let mounted = true;
    async function tick() {
      if (!mounted) return;
      await refreshPodsAndMetrics();
    }
    tick();
    const intervalId = setInterval(tick, PODS_AND_METRICS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace]);

  useEffect(() => {
    const targetPod = expandedPod || selectedPod;
    if (!targetPod) return;
    const targetMetrics = metricsByPod.get(targetPod);
    if (!targetMetrics) return;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setMetricHistory((prev) => {
      const next = [...prev, { time, cpu: Number(targetMetrics.cpuCores), memory: Number(targetMetrics.memoryMiB) }];
      return next.slice(-MAX_HISTORY_POINTS);
    });
  }, [metricsByPod, expandedPod, selectedPod]);

  useEffect(() => {
    if (!logsPollingEnabled || !activeLogPod) return undefined;
    const intervalId = setInterval(() => {
      refreshLogsForPod(activeLogPod, false);
    }, LOGS_POLL_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logsPollingEnabled, activeLogPod, namespace, tail]);

  useEffect(() => {
    function onDocumentClick(event) {
      if (!namespaceDropdownRef.current) return;
      if (!namespaceDropdownRef.current.contains(event.target)) {
        setNamespaceMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  return (
    <div className="min-h-screen bg-[#F6F9FC]">
      <div className="mx-auto max-w-[1600px] px-6 py-5">
        <header className="mb-4 flex items-center justify-between rounded-card border border-[#DBEAFE] bg-[#F8FBFF] px-5 py-4 shadow-soft">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-nested border border-[#E2E8F0] bg-[#F8FAFC]">
              <Boxes className="h-5 w-5 text-[#0969F9]" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#0F172A]">On Call</h1>
              <p className="text-sm text-[#64748B]">See what needs fixing</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[#DCFCE7] bg-[#F0FDF4] px-3 py-1 text-sm text-[#166534]">
              <span className="h-2 w-2 rounded-full bg-[#16A34A]" />
              Connected to cluster
            </div>
            {loadingAny ? (
              <div className="flex items-center gap-2 text-sm text-[#64748B]">
                <Loader2 className="h-4 w-4 animate-spin text-[#0969F9]" />
                Syncing
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[#64748B]">
                <ShieldCheck className="h-4 w-4 text-[#16A34A]" />
                Live
              </div>
            )}
            <button className="rounded-btn border border-[#E2E8F0] bg-white p-2 text-[#64748B]">
              <MoonStar className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-[#0969F9]">
              <UserCircle2 className="h-5 w-5" />
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-btn border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:[grid-template-columns:minmax(0,74%)_minmax(320px,26%)]">
          <main className="space-y-4">
            <section className="rounded-card border border-[#E2E8F0] bg-white p-4 shadow-soft">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-nested border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#64748B]">Namespace</p>
                  <div className="relative" ref={namespaceDropdownRef}>
                    <button
                      className="flex w-full items-center justify-between rounded-btn border border-[#E2E8F0] bg-white px-3 py-2 text-left text-sm font-semibold text-[#0F172A]"
                      onClick={() => setNamespaceMenuOpen((prev) => !prev)}
                      disabled={loadingNamespaces || namespaces.length === 0}
                    >
                      <span>{loadingNamespaces ? "Loading..." : namespace}</span>
                      <ChevronDown className="h-4 w-4 text-[#64748B]" />
                    </button>
                    {namespaceMenuOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-btn border border-[#E2E8F0] bg-white p-1 shadow-soft">
                        {namespaces.map((item) => (
                          <button
                            key={item}
                            className={`block w-full rounded-btn px-2 py-1 text-left text-sm ${
                              item === namespace ? "bg-[#EAF2FF] text-[#0969F9]" : "text-[#0F172A] hover:bg-[#F8FAFC]"
                            }`}
                            onClick={() => {
                              setNamespace(item);
                              setNamespaceMenuOpen(false);
                            }}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-nested border border-[#BBF7D0] bg-[#F0FDF4] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Pods Running</p>
                  <p className="mt-2 text-2xl font-semibold text-[#0F172A]">{runningPods}</p>
                </div>
                <div className="rounded-nested border border-[#FDE68A] bg-[#FFFBEB] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Needs Attention</p>
                  <p className="mt-2 text-2xl font-semibold text-[#0F172A]">{degradedPods}</p>
                </div>
                <div className="rounded-nested border border-[#FECACA] bg-[#FEF2F2] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">High CPU Containers</p>
                  <p className="mt-2 text-2xl font-semibold text-[#0F172A]">{hotMetrics}</p>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-card border border-[#DBEAFE] bg-[#F8FBFF] p-4 shadow-soft">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#0F172A]">{namespace} (Current Usage)</h2>
                  <span className="rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-2 py-0.5 text-xs text-[#1D4ED8]">
                    Namespace
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-nested border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[#64748B]">
                      <span className="rounded-md bg-[#EAF2FF] p-1">
                        <Cpu className="h-4 w-4 text-[#0969F9]" />
                      </span>
                      <span className="text-sm font-medium">CPU Usage</span>
                    </div>
                    <p className="text-lg font-semibold text-[#0F172A]">{namespaceCpuTotal} cores</p>
                  </div>
                  <div className="rounded-nested border border-[#E9D5FF] bg-[#FAF5FF] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[#64748B]">
                      <span className="rounded-md bg-[#F3E8FF] p-1">
                        <HardDrive className="h-4 w-4 text-[#7C3AED]" />
                      </span>
                      <span className="text-sm font-medium">Memory Usage</span>
                    </div>
                    <p className="text-lg font-semibold text-[#0F172A]">{formatBytesMiBToHuman(namespaceMemoryTotal)}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-card border border-[#E2E8F0] bg-[#FCFCFD] p-4 shadow-soft">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#0F172A]">Cluster (Current Usage)</h2>
                  <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#64748B]">
                    All Namespaces
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-nested border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[#64748B]">
                      <span className="rounded-md bg-[#EAF2FF] p-1">
                        <Cpu className="h-4 w-4 text-[#0969F9]" />
                      </span>
                      <span className="text-sm font-medium">CPU Usage</span>
                    </div>
                    <p className="text-lg font-semibold text-[#0F172A]">{globalCpuTotal} cores</p>
                  </div>
                  <div className="rounded-nested border border-[#E9D5FF] bg-[#FAF5FF] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[#64748B]">
                      <span className="rounded-md bg-[#F3E8FF] p-1">
                        <HardDrive className="h-4 w-4 text-[#7C3AED]" />
                      </span>
                      <span className="text-sm font-medium">Memory Usage</span>
                    </div>
                    <p className="text-lg font-semibold text-[#0F172A]">{formatBytesMiBToHuman(globalMemoryTotal)}</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-card border border-[#E2E8F0] bg-white p-4 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#0F172A]">Pods</h2>
                <div className="flex items-center gap-2 text-xs text-[#64748B]">
                  <Clock3 className="h-4 w-4" />
                  Source: <span className="font-medium text-[#0F172A]">{metricsSource || "metrics-server"}</span>
                </div>
              </div>
              <div className="overflow-hidden rounded-nested border border-[#E2E8F0]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#EFF6FF] text-[#475569]">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Pod Name</th>
                      <th className="px-3 py-2 font-medium">Running Status</th>
                      <th className="px-3 py-2 font-medium">CPU</th>
                      <th className="px-3 py-2 font-medium">Memory</th>
                      <th className="px-3 py-2 font-medium">Restarts</th>
                      <th className="px-3 py-2 font-medium">Inspect</th>
                      <th className="px-3 py-2 font-medium">More</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] bg-white">
                    {podsWithMetrics.map((pod) => {
                      const isRunning = pod.phase === "Running";
                      const isExpanded = expandedPod === pod.name;
                      return (
                        <tr key={pod.name} className={`text-[#0F172A] ${isExpanded ? "bg-[#F8FAFC]" : "bg-white"}`}>
                          <td className="px-3 py-2 font-medium">{pod.name}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                isRunning
                                  ? "bg-[#ECFDF3] text-[#16A34A]"
                                  : "bg-[#FEF3C7] text-[#B45309]"
                              }`}
                            >
                              {pod.phase}
                            </span>
                          </td>
                          <td className="px-3 py-2">{pod.cpuCores} cores</td>
                          <td className="px-3 py-2">{formatBytesMiBToHuman(pod.memoryMiB)}</td>
                          <td className="px-3 py-2">{pod.restarts}</td>
                          <td className="px-3 py-2">
                            <button
                              className="rounded-btn border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-1 text-xs font-medium text-[#1D4ED8] disabled:opacity-60"
                              disabled={aiLoading}
                              onClick={() => {
                                setSelectedPod(pod.name);
                                runInspect();
                              }}
                            >
                              {aiLoading && selectedPod === pod.name ? "Inspecting..." : "Inspect"}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              className="inline-flex items-center gap-1 rounded-btn border border-[#E2E8F0] bg-white px-2 py-1 text-xs text-[#334155]"
                              onClick={() => {
                                setSelectedPod(pod.name);
                                setExpandedPod(isExpanded ? "" : pod.name);
                                if (!isExpanded) setActiveTab("metrics");
                              }}
                            >
                              More {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {podsWithMetrics.length === 0 && (
                      <tr>
                        <td className="px-3 py-5 text-center text-[#64748B]" colSpan={7}>
                          No pods found in this namespace.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {expandedPod && selectedPodRow && (
                <div className="mt-4 rounded-nested border border-[#E2E8F0] bg-white p-4">
                  <div className="mb-3 flex gap-4 border-b border-[#E2E8F0]">
                    {[
                      { id: "metrics", label: "Metrics", icon: Activity },
                      { id: "logs", label: "Logs", icon: Logs },
                      { id: "yaml", label: "YAML", icon: FileCode2 },
                      { id: "events", label: "Events", icon: Clock3 }
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          className={`inline-flex items-center gap-1 border-b-2 px-1 py-2 text-sm ${
                            active
                              ? "border-[#0969F9] text-[#0969F9]"
                              : "border-transparent text-[#64748B]"
                          }`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          <Icon className="h-4 w-4" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {activeTab === "metrics" && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-nested border border-[#E2E8F0] bg-white p-3">
                        <p className="mb-2 text-sm font-medium text-[#64748B]">CPU Usage History</p>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={metricHistory}>
                              <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#64748B" }} />
                              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
                              <Tooltip />
                              <Line type="monotone" dataKey="cpu" stroke="#0969F9" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="rounded-nested border border-[#E2E8F0] bg-white p-3">
                        <p className="mb-2 text-sm font-medium text-[#64748B]">Memory Usage History</p>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={metricHistory}>
                              <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#64748B" }} />
                              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
                              <Tooltip />
                              <Line type="monotone" dataKey="memory" stroke="#7C3AED" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "logs" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-sm text-[#64748B]">
                          Tail lines
                          <input
                            className="mt-1 block rounded-btn border border-[#E2E8F0] bg-white px-2 py-1 text-sm text-[#0F172A]"
                            type="number"
                            min="10"
                            max="1000"
                            value={tail}
                            onChange={(e) => setTail(Number(e.target.value))}
                          />
                        </label>
                        <button
                          className="rounded-btn bg-[#0969F9] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          disabled={loadingLogs}
                          onClick={async () => {
                            setActiveLogPod(expandedPod);
                            setLogsPollingEnabled(true);
                            await refreshLogsForPod(expandedPod, true);
                          }}
                        >
                          {loadingLogs ? "Refreshing..." : "Refresh Logs"}
                        </button>
                        <button
                          className="rounded-btn border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#334155] disabled:opacity-60"
                          disabled={!logsPollingEnabled}
                          onClick={() => setLogsPollingEnabled(false)}
                        >
                          Stop Logs
                        </button>
                        <button
                          className="rounded-btn border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1D4ED8] disabled:opacity-60"
                          disabled={aiLoading}
                          onClick={() => runInspect()}
                        >
                          {aiLoading ? "Inspecting..." : "Inspect"}
                        </button>
                      </div>
                      <div className="rounded-nested border border-[#1E293B] bg-[#17202D] p-3">
                        <pre className="log-scrollbar max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#E2E8F0]">
                          {(activeLogPod === expandedPod ? logs : "Click Refresh Logs to load output.")
                            .split("\n")
                            .map((line, idx) => {
                              const kind = classifyLogLine(line);
                              const color =
                                kind === "error"
                                  ? "text-[#EF4444]"
                                  : kind === "warn"
                                    ? "text-[#F59E0B]"
                                    : "text-[#38BDF8]";
                              return (
                                <span key={`${line}-${idx}`} className={line ? color : "text-[#94A3B8]"}>
                                  {line || " "}
                                  {"\n"}
                                </span>
                              );
                            })}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeTab === "yaml" && (
                    <div className="rounded-nested border border-[#E2E8F0] bg-[#0F172A] p-3">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-[#E2E8F0]">
                        {JSON.stringify(selectedPodRow, null, 2)}
                      </pre>
                    </div>
                  )}

                  {activeTab === "events" && (
                    <div className="space-y-2">
                      {podEvents.map((event, index) => (
                        <div
                          key={`${event}-${index}`}
                          className="flex items-start gap-2 rounded-nested border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-sm text-[#334155]"
                        >
                          <Clock3 className="mt-0.5 h-4 w-4 text-[#0969F9]" />
                          {event}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-4">
            <section className="rounded-card border border-[#E9D5FF] bg-[#FCFAFF] p-4 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-[#7C3AED]" />
                  <h2 className="text-base font-semibold text-[#0F172A]">AI Insight</h2>
                </div>
                <span className="rounded-full bg-[#F3E8FF] px-2 py-0.5 text-xs font-medium text-[#7C3AED]">Beta</span>
              </div>
              <p className="mb-4 text-sm text-[#64748B]">
                AI-assisted investigation summarizes live pod evidence and proposes safe next actions.
              </p>

              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-[#0F172A]">Investigation Progress</h3>
                <div className="space-y-2">
                  {aiSteps.map((step) => (
                    <div key={step.id} className="flex items-center gap-2 text-sm">
                      {step.state === "done" && <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />}
                      {step.state === "active" && <Loader2 className="h-4 w-4 animate-spin text-[#0969F9]" />}
                      {step.state === "upcoming" && <Circle className="h-4 w-4 text-[#94A3B8]" />}
                      <span className="text-[#334155]">{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-4 rounded-nested border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <h3 className="mb-2 text-sm font-semibold text-[#0F172A]">Key Evidence</h3>
                <ul className="space-y-1 text-sm text-[#475569]">
                  {(aiResult?.details || ["Run Investigate to collect evidence."]).slice(0, 3).map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Eye className="mt-0.5 h-4 w-4 text-[#64748B]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div
                className={`mb-4 rounded-nested border p-3 text-sm ${
                  aiResult?.risk_level === "high"
                    ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
                    : aiResult?.risk_level === "medium"
                      ? "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                      : "border-[#DCFCE7] bg-[#F0FDF4] text-[#166534]"
                }`}
              >
                <h3 className="mb-1 font-semibold">Likely Root Cause</h3>
                <p>{aiResult?.one_liner_reason || "No active diagnosis yet."}</p>
              </div>

              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <h3 className="font-semibold text-[#0F172A]">Confidence</h3>
                  <span className="text-[#64748B]">{aiConfidence}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#E2E8F0]">
                  <div className="h-2 rounded-full bg-[#0969F9]" style={{ width: `${aiConfidence}%` }} />
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-[#0F172A]">Proposed Action</h3>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-btn bg-[#0969F9] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={aiLoading || !selectedPod}
                    onClick={() => runInspect()}
                  >
                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                    Investigate
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-btn border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-medium text-[#0F172A] disabled:opacity-60"
                    disabled={aiExecuting || !aiResult?.commands?.length}
                    onClick={runFixIt}
                  >
                    {aiExecuting ? <Loader2 className="h-4 w-4 animate-spin text-[#0969F9]" /> : <ShieldCheck className="h-4 w-4 text-[#16A34A]" />}
                    Approve
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-btn border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-medium text-[#0F172A] disabled:opacity-60"
                    disabled={!selectedPod}
                    onClick={() => {
                      setExpandedPod(selectedPod);
                      setActiveTab("logs");
                    }}
                  >
                    <Logs className="h-4 w-4 text-[#64748B]" />
                    View Logs
                  </button>
                </div>
              </div>

              {aiExecutionResult?.results?.length > 0 && (
                <div className="mt-4 rounded-nested border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <h3 className="mb-2 text-sm font-semibold text-[#0F172A]">Execution Feedback</h3>
                  <div className="space-y-2 text-xs text-[#334155]">
                    {aiExecutionResult.results.map((r) => (
                      <div key={`${r.id}-${r.command}`} className="rounded-btn border border-[#E2E8F0] bg-white p-2">
                        <p className="mb-1 font-medium">
                          {r.status} - {r.command}
                        </p>
                        {r.reason && <p className="text-[#B45309]">{r.reason}</p>}
                        {r.stderr && <p className="font-mono text-[#EF4444]">{r.stderr}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
