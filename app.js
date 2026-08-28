const initialIncident = {
  phase: "triage",
  severity: "SEV-1",
  incidentId: "INC-1042",
  title: "Checkout failures after deploy",
  metrics: {
    errorRate: 18.7,
    latency: 1240,
    affectedSessions: 8420,
    revenueRisk: 18300
  },
  roles: [
    { id: "commander", name: "Incident Commander", person: "Maya", agent: "Maya's agent" },
    { id: "backend", name: "Backend Engineer", person: "Jon", agent: "Jon's agent" },
    { id: "infra", name: "Infrastructure Engineer", person: "Priya", agent: "Priya's agent" },
    { id: "comms", name: "Communications Lead", person: "Sam", agent: "Sam's agent" }
  ],
  services: [
    {
      id: "checkout",
      name: "Checkout API",
      owner: "Backend",
      health: "failing",
      version: "v42",
      previousVersion: "v41",
      deployedAt: "10:14 AM",
      dependencies: ["payments", "inventory", "orders"],
      anomaly: "500s began 4 minutes after v42 deploy."
    },
    {
      id: "payments",
      name: "Payments",
      owner: "Backend",
      health: "healthy",
      version: "v18",
      previousVersion: "v17",
      deployedAt: "Yesterday",
      dependencies: ["stripe-gateway"],
      anomaly: "No deploy or error spike."
    },
    {
      id: "inventory",
      name: "Inventory",
      owner: "Platform",
      health: "degraded",
      version: "v12",
      previousVersion: "v11",
      deployedAt: "Yesterday",
      dependencies: ["catalog"],
      anomaly: "Queue depth elevated due to failed checkout retries."
    },
    {
      id: "orders",
      name: "Orders",
      owner: "Backend",
      health: "healthy",
      version: "v29",
      previousVersion: "v28",
      deployedAt: "3 days ago",
      dependencies: ["database"],
      anomaly: "No primary anomaly."
    },
    {
      id: "cdn",
      name: "Edge CDN",
      owner: "Infrastructure",
      health: "healthy",
      version: "ruleset-9",
      previousVersion: "ruleset-8",
      deployedAt: "2 days ago",
      dependencies: [],
      anomaly: "Stable cache and edge metrics."
    }
  ],
  hypotheses: [],
  actions: [],
  approvals: [],
  timeline: [
    {
      id: "evt-1",
      kind: "alert",
      title: "Incident opened",
      body: "Checkout error rate crossed SEV-1 threshold after the v42 checkout deploy.",
      time: "10:18 AM"
    }
  ],
  reports: []
};

let state = loadState();
const registeredToolNames = new Set();

const tools = {
  get_incident_state: {
    description: "Read the current incident phase, severity, metrics, services, proposed actions, approvals, and recent timeline.",
    phases: ["triage", "mitigation", "approval_pending", "approved", "resolved"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute: async () => logTool("get_incident_state", {}, summarizeState())
  },
  inspect_service: {
    description: "Inspect one service for health, version, dependencies, owner, deploy timing, and anomalies.",
    phases: ["triage", "mitigation", "approval_pending", "approved"],
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", enum: initialIncident.services.map((service) => service.id) }
      },
      required: ["serviceId"],
      additionalProperties: false
    },
    execute: async (input) => {
      const service = getService(input.serviceId);
      return logTool("inspect_service", input, service);
    }
  },
  compare_recent_deploys: {
    description: "Compare recent deploys with the incident start time and rank likely contributing services.",
    phases: ["triage", "mitigation"],
    inputSchema: {
      type: "object",
      properties: {
        windowMinutes: { type: "number", minimum: 5, maximum: 120, default: 30 }
      },
      required: [],
      additionalProperties: false
    },
    execute: async (input) => {
      const result = {
        windowMinutes: input.windowMinutes ?? 30,
        likelyCause: "checkout",
        evidence: [
          "Checkout API v42 deployed at 10:14 AM.",
          "SEV-1 threshold crossed at 10:18 AM.",
          "Payments and Orders show no matching deploy or primary error spike."
        ],
        confidence: 0.86
      };
      return logTool("compare_recent_deploys", input, result);
    }
  },
  estimate_customer_impact: {
    description: "Estimate affected sessions, user-visible symptoms, and revenue risk for selected services.",
    phases: ["triage", "mitigation", "approval_pending", "approved"],
    inputSchema: {
      type: "object",
      properties: {
        serviceIds: {
          type: "array",
          items: { type: "string", enum: initialIncident.services.map((service) => service.id) },
          minItems: 1
        }
      },
      required: ["serviceIds"],
      additionalProperties: false
    },
    execute: async (input) => {
      const result = {
        affectedSessions: state.metrics.affectedSessions,
        revenueRisk: state.metrics.revenueRisk,
        symptoms: input.serviceIds.includes("checkout")
          ? ["Users cannot complete checkout", "Retry storms are increasing inventory queue depth"]
          : ["No direct customer-facing symptom identified"]
      };
      return logTool("estimate_customer_impact", input, result);
    }
  },
  propose_hypothesis: {
    description: "Add a visible agent hypothesis with supporting evidence and confidence.",
    phases: ["triage", "mitigation"],
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 8 },
        evidence: { type: "array", items: { type: "string" }, minItems: 1 },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["summary", "evidence", "confidence"],
      additionalProperties: false
    },
    execute: async (input) => {
      const hypothesis = {
        id: makeId("hyp"),
        summary: input.summary,
        evidence: input.evidence,
        confidence: input.confidence
      };
      state.hypotheses.push(hypothesis);
      state.phase = "mitigation";
      addTimeline("tool", "Hypothesis added", input.summary);
      persistAndRender();
      return logTool("propose_hypothesis", input, { hypothesis, phase: state.phase }, false);
    }
  },
  propose_mitigation: {
    description: "Create a proposed mitigation. High-risk proposals require approval before execution tools can succeed.",
    phases: ["mitigation"],
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["rollback", "traffic_shift", "status_update"] },
        targetServiceId: { type: "string", enum: initialIncident.services.map((service) => service.id) },
        rationale: { type: "string", minLength: 8 },
        expectedOutcome: { type: "string", minLength: 8 },
        riskLevel: { type: "string", enum: ["low", "medium", "high"] }
      },
      required: ["type", "targetServiceId", "rationale", "expectedOutcome", "riskLevel"],
      additionalProperties: false
    },
    execute: async (input) => {
      const action = {
        id: makeId("act"),
        type: input.type,
        targetServiceId: input.targetServiceId,
        rationale: input.rationale,
        expectedOutcome: input.expectedOutcome,
        riskLevel: input.riskLevel,
        status: input.riskLevel === "high" ? "needs_approval" : "proposed"
      };
      state.actions.push(action);
      addTimeline("tool", "Mitigation proposed", `${input.type} for ${input.targetServiceId}: ${input.rationale}`);
      persistAndRender();
      return logTool("propose_mitigation", input, { action }, false);
    }
  },
  request_approval: {
    description: "Request human approval for a proposed action and optionally require a second approver.",
    phases: ["mitigation", "approval_pending"],
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        reason: { type: "string", minLength: 8 },
        requiredRole: { type: "string", enum: ["commander", "backend", "infra", "comms"] },
        requiresSecondApprover: { type: "boolean", default: true }
      },
      required: ["actionId", "reason", "requiredRole"],
      additionalProperties: false
    },
    execute: async (input) => {
      const action = getAction(input.actionId);
      const approval = {
        id: makeId("apr"),
        actionId: action.id,
        reason: input.reason,
        requiredRole: input.requiredRole,
        requiresSecondApprover: input.requiresSecondApprover !== false,
        decisions: [],
        status: "pending"
      };
      action.status = "approval_pending";
      state.phase = "approval_pending";
      state.approvals.push(approval);
      addTimeline("decision", "Approval requested", input.reason);
      persistAndRender();
      return logTool("request_approval", input, { approval, phase: state.phase }, false);
    }
  },
  record_human_decision: {
    description: "Record a human approval or rejection for a pending production action.",
    phases: ["approval_pending"],
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approved", "rejected"] },
        approverRole: { type: "string", enum: ["commander", "backend", "infra", "comms"] },
        note: { type: "string" }
      },
      required: ["approvalId", "decision", "approverRole"],
      additionalProperties: false
    },
    execute: async (input) => {
      const approval = getApproval(input.approvalId);
      if (approval.decisions.some((decision) => decision.approverRole === input.approverRole)) {
        return logTool("record_human_decision", input, {
          ok: false,
          message: "This role has already recorded a decision."
        });
      }
      approval.decisions.push({
        decision: input.decision,
        approverRole: input.approverRole,
        note: input.note || "",
        time: getClock()
      });
      if (input.decision === "rejected") {
        approval.status = "rejected";
        getAction(approval.actionId).status = "rejected";
      } else if (!approval.requiresSecondApprover || approval.decisions.filter((decision) => decision.decision === "approved").length >= 2) {
        approval.status = "approved";
        getAction(approval.actionId).status = "approved";
        state.phase = "approved";
      }
      addTimeline("decision", `Human decision: ${input.decision}`, `${input.approverRole}: ${input.note || "No note."}`);
      persistAndRender();
      return logTool("record_human_decision", input, { approval, phase: state.phase }, false);
    }
  },
  rollback_service: {
    description: "Rollback a service after the matching approval has passed. Fails closed without approval.",
    phases: ["approved"],
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", enum: initialIncident.services.map((service) => service.id) },
        targetVersion: { type: "string" },
        approvalId: { type: "string" }
      },
      required: ["serviceId", "targetVersion", "approvalId"],
      additionalProperties: false
    },
    execute: async (input) => {
      const approval = getApproval(input.approvalId);
      if (approval.status !== "approved") {
        return logTool("rollback_service", input, { ok: false, message: "Rollback blocked: approval is not complete." });
      }
      const service = getService(input.serviceId);
      service.version = input.targetVersion;
      service.health = "healthy";
      state.services.find((candidate) => candidate.id === "inventory").health = "healthy";
      state.metrics = {
        errorRate: 0.8,
        latency: 210,
        affectedSessions: 121,
        revenueRisk: 700
      };
      state.phase = "resolved";
      addTimeline("success", "Rollback executed", `${service.name} rolled back to ${input.targetVersion}. Metrics recovered.`);
      persistAndRender();
      return logTool("rollback_service", input, { ok: true, service, metrics: state.metrics, phase: state.phase }, false);
    }
  },
  draft_status_update: {
    description: "Draft a customer or internal incident update from current facts, decisions, and timeline.",
    phases: ["mitigation", "approval_pending", "approved", "resolved"],
    inputSchema: {
      type: "object",
      properties: {
        audience: { type: "string", enum: ["internal", "customer"] },
        tone: { type: "string", enum: ["concise", "detailed"] }
      },
      required: ["audience"],
      additionalProperties: false
    },
    execute: async (input) => {
      const draft = input.audience === "customer"
        ? "We identified and mitigated an issue preventing some customers from completing checkout. Service has recovered and we are monitoring."
        : "Likely cause was Checkout API v42. Approved rollback restored checkout metrics. Follow up: add canary checks around payment validation.";
      state.reports.push({ id: makeId("rep"), audience: input.audience, draft });
      addTimeline("tool", "Status update drafted", draft);
      persistAndRender();
      return logTool("draft_status_update", input, { draft }, false);
    }
  },
  resolve_incident: {
    description: "Close the incident with root cause and prevention notes.",
    phases: ["resolved"],
    inputSchema: {
      type: "object",
      properties: {
        rootCause: { type: "string", minLength: 8 },
        prevention: { type: "string", minLength: 8 }
      },
      required: ["rootCause", "prevention"],
      additionalProperties: false
    },
    execute: async (input) => {
      addTimeline("success", "Incident resolved", `Root cause: ${input.rootCause} Prevention: ${input.prevention}`);
      persistAndRender();
      return logTool("resolve_incident", input, { ok: true, phase: state.phase }, false);
    }
  }
};

function summarizeState() {
  return {
    incidentId: state.incidentId,
    title: state.title,
    severity: state.severity,
    phase: state.phase,
    metrics: state.metrics,
    services: state.services.map(({ id, name, health, version, owner }) => ({ id, name, health, version, owner })),
    hypotheses: state.hypotheses,
    actions: state.actions,
    approvals: state.approvals,
    recentTimeline: state.timeline.slice(-8)
  };
}

function getAvailableTools() {
  return Object.entries(tools)
    .filter(([, tool]) => tool.phases.includes(state.phase))
    .map(([name, tool]) => ({ name, ...tool }));
}

function registerWebMcpTools() {
  const modelContext = document.modelContext || navigator.modelContext;
  renderToolSupport(Boolean(modelContext));
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    renderToolList();
    return;
  }

  for (const { name, description, inputSchema, execute } of getAvailableTools()) {
    if (registeredToolNames.has(name)) continue;
    modelContext.registerTool({ name, description, inputSchema, execute });
    registeredToolNames.add(name);
  }

  if (typeof modelContext.dispatchEvent === "function") {
    modelContext.dispatchEvent(new Event("toolchange"));
  } else {
    document.dispatchEvent(new Event("toolchange"));
  }
  renderToolList();
}

function logTool(name, input, result, shouldAddTimeline = true) {
  if (shouldAddTimeline) {
    addTimeline("tool", `Tool called: ${name}`, JSON.stringify(input));
    persistAndRender();
  }
  return {
    ok: true,
    tool: name,
    input,
    result
  };
}

function getService(serviceId) {
  const service = state.services.find((candidate) => candidate.id === serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  return service;
}

function getAction(actionId) {
  const action = state.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  return action;
}

function getApproval(approvalId) {
  const approval = state.approvals.find((candidate) => candidate.id === approvalId);
  if (!approval) throw new Error(`Unknown approval: ${approvalId}`);
  return approval;
}

function addTimeline(kind, title, body) {
  state.timeline.push({
    id: makeId("evt"),
    kind,
    title,
    body,
    time: getClock()
  });
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function getClock() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function persistAndRender() {
  localStorage.setItem("incident-command-state", JSON.stringify(state));
  render();
  registerWebMcpTools();
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem("incident-command-state")) || structuredClone(initialIncident);
  } catch {
    return structuredClone(initialIncident);
  }
}

function resetDemo() {
  state = structuredClone(initialIncident);
  localStorage.removeItem("incident-command-state");
  persistAndRender();
}

function render() {
  renderMetrics();
  renderPhase();
  renderRoles();
  renderServices();
  renderHypotheses();
  renderActions();
  renderApprovals();
  renderTimeline();
  renderToolList();
}

function renderMetrics() {
  document.querySelector("#metric-error-rate").textContent = `${state.metrics.errorRate.toFixed(1)}%`;
  document.querySelector("#metric-latency").textContent = `${state.metrics.latency} ms`;
  document.querySelector("#metric-sessions").textContent = state.metrics.affectedSessions.toLocaleString();
  document.querySelector("#metric-revenue").textContent = `$${state.metrics.revenueRisk.toLocaleString()}`;
}

function renderPhase() {
  const phase = document.querySelector("#phase-pill");
  phase.className = `status-pill status-${state.phase.replace("_pending", "")}`;
  phase.textContent = `${state.severity} · ${state.phase.replace("_", " ")}`;
}

function renderRoles() {
  document.querySelector("#roles").innerHTML = state.roles.map((role) => `
    <article class="role">
      <div class="row">
        <h3>${escapeHtml(role.name)}</h3>
        <span class="tag">${escapeHtml(role.person)}</span>
      </div>
      <p>${escapeHtml(role.agent)}</p>
    </article>
  `).join("");
}

function renderServices() {
  document.querySelector("#services").innerHTML = state.services.map((service) => `
    <article class="service">
      <div class="row wrap">
        <div>
          <h3>${escapeHtml(service.name)}</h3>
          <p>${escapeHtml(service.owner)} · ${escapeHtml(service.version)} · deployed ${escapeHtml(service.deployedAt)}</p>
        </div>
        <span class="health health-${service.health}">${escapeHtml(service.health)}</span>
      </div>
      <p>${escapeHtml(service.anomaly)}</p>
      <div class="meta">
        ${service.dependencies.map((dependency) => `<span class="tag">${escapeHtml(dependency)}</span>`).join("") || "<span class=\"tag\">no dependencies</span>"}
      </div>
    </article>
  `).join("");
}

function renderHypotheses() {
  const container = document.querySelector("#hypotheses");
  if (!state.hypotheses.length) {
    container.innerHTML = "<p class=\"empty\">No hypothesis yet. Ask an agent to inspect services and compare deploys.</p>";
    return;
  }
  container.innerHTML = state.hypotheses.map((hypothesis) => `
    <article class="record">
      <div class="row">
        <h3>${escapeHtml(hypothesis.summary)}</h3>
        <span class="tag">${Math.round(hypothesis.confidence * 100)}%</span>
      </div>
      <p>${hypothesis.evidence.map(escapeHtml).join(" ")}</p>
    </article>
  `).join("");
}

function renderActions() {
  const container = document.querySelector("#actions");
  if (!state.actions.length) {
    container.innerHTML = "<p class=\"empty\">No proposed action yet. Mitigations created by agents appear here before execution.</p>";
    return;
  }
  container.innerHTML = state.actions.map((action) => `
    <article class="record">
      <div class="row wrap">
        <h3>${escapeHtml(action.type)} · ${escapeHtml(action.targetServiceId)}</h3>
        <span class="tag">${escapeHtml(action.status)}</span>
      </div>
      <p>${escapeHtml(action.rationale)}</p>
      <p>Expected: ${escapeHtml(action.expectedOutcome)}</p>
    </article>
  `).join("");
}

function renderApprovals() {
  const container = document.querySelector("#approvals");
  if (!state.approvals.length) {
    container.innerHTML = "<p class=\"empty\">No pending approvals. Risky agent actions will stop here before touching production state.</p>";
    return;
  }
  container.innerHTML = state.approvals.map((approval) => `
    <article class="record">
      <div class="row wrap">
        <h3>${escapeHtml(approval.id)}</h3>
        <span class="tag">${escapeHtml(approval.status)}</span>
      </div>
      <p>${escapeHtml(approval.reason)}</p>
      <p>${approval.decisions.length} approval${approval.decisions.length === 1 ? "" : "s"} recorded${approval.requiresSecondApprover ? " · two required" : ""}</p>
      <div class="action-buttons">
        <button class="primary-button" type="button" onclick="manualDecision('${approval.id}', 'commander')">Approve as commander</button>
        <button class="secondary-button" type="button" onclick="manualDecision('${approval.id}', 'infra')">Approve as infra</button>
      </div>
    </article>
  `).join("");
}

function manualDecision(approvalId, approverRole) {
  tools.record_human_decision.execute({
    approvalId,
    decision: "approved",
    approverRole,
    note: "Approved from the war room UI."
  });
}

function renderTimeline() {
  document.querySelector("#timeline").innerHTML = state.timeline.slice().reverse().map((event) => `
    <li class="${escapeHtml(event.kind)}">
      <time>${escapeHtml(event.time)}</time>
      <strong>${escapeHtml(event.title)}</strong>
      <p>${escapeHtml(event.body)}</p>
    </li>
  `).join("");
}

function renderToolSupport(isSupported) {
  document.querySelector("#webmcp-support").textContent = isSupported
    ? "Registered for this browser session."
    : "Browser WebMCP API not detected; showing fallback tool map.";
}

function renderToolList() {
  const availableNames = new Set(getAvailableTools().map((tool) => tool.name));
  document.querySelector("#tool-list").innerHTML = Object.entries(tools).map(([name, tool]) => `
    <article class="tool-card ${availableNames.has(name) ? "" : "unavailable"}">
      <div class="row wrap">
        <h3>${escapeHtml(name)}</h3>
        <span class="tag">${availableNames.has(name) ? "available" : "blocked"}</span>
      </div>
      <p>${escapeHtml(tool.description)}</p>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelector("#reset-demo").addEventListener("click", resetDemo);
document.querySelector("#run-demo").addEventListener("click", runDemoPath);
window.incidentCommandTools = tools;
window.incidentCommandState = () => structuredClone(state);
render();
registerWebMcpTools();

async function runDemoPath() {
  resetDemo();
  const compare = await tools.compare_recent_deploys.execute({ windowMinutes: 30 });
  await tools.propose_hypothesis.execute({
    summary: "Checkout API v42 is the likely cause of the checkout failures.",
    evidence: compare.result.evidence,
    confidence: compare.result.confidence
  });
  const mitigation = await tools.propose_mitigation.execute({
    type: "rollback",
    targetServiceId: "checkout",
    rationale: "v42 is tightly correlated with the error spike, and dependent services are stable.",
    expectedOutcome: "Restoring v41 should reduce checkout errors and drain retry pressure from inventory.",
    riskLevel: "high"
  });
  const approval = await tools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Rollback touches production checkout, so two humans must approve it.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  await tools.record_human_decision.execute({
    approvalId: approval.result.approval.id,
    decision: "approved",
    approverRole: "commander",
    note: "Customer checkout is degraded and rollback is the lowest-risk mitigation."
  });
  await tools.record_human_decision.execute({
    approvalId: approval.result.approval.id,
    decision: "approved",
    approverRole: "infra",
    note: "Rollback target is healthy and deployment controls are ready."
  });
  await tools.rollback_service.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  await tools.draft_status_update.execute({ audience: "customer", tone: "concise" });
  await tools.resolve_incident.execute({
    rootCause: "Checkout API v42 introduced failing payment-validation behavior.",
    prevention: "Add canary checks for checkout completion before global rollout."
  });
}
