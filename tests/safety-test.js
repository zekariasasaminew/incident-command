const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createElement(selector) {
  const listeners = new Map();
  return {
    selector,
    textContent: "",
    innerHTML: "",
    className: "",
    value: "",
    checked: false,
    dataset: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchTestEvent(type, event) {
      return listeners.get(type)?.(event);
    }
  };
}

function renderedText(elements) {
  return [...elements.values()].map((element) => `${element.textContent} ${element.innerHTML}`).join(" ");
}

function createHarness({ modelContext, storage, url = "https://incident-command.test/" } = {}) {
  const elements = new Map();
  const location = new URL(url);
  const document = {
    modelContext,
    body: { innerText: "" },
    scripts: [],
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement(selector));
      return elements.get(selector);
    },
    dispatchEvent() {}
  };

  const backingStorage = storage || new Map();
  const context = {
    console,
    clearTimeout,
    setTimeout,
    AbortController,
    structuredClone,
    URL,
    URLSearchParams,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    localStorage: {
      getItem(key) {
        return backingStorage.get(key) || null;
      },
      setItem(key, value) {
        backingStorage.set(key, String(value));
      },
      removeItem(key) {
        backingStorage.delete(key);
      }
    },
    document,
    addEventListener() {},
    history: {
      replaceState(_state, _title, nextUrl) {
        const resolved = new URL(nextUrl, location.href);
        location.href = resolved.href;
        location.search = resolved.search;
      },
      pushState(_state, _title, nextUrl) {
        const resolved = new URL(nextUrl, location.href);
        location.href = resolved.href;
        location.search = resolved.search;
      }
    },
    location,
    navigator: { clipboard: { writeText: async () => {} } },
    window: {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("app.js", "utf8"), context, { filename: "app.js" });
  return { context, elements, storage: backingStorage };
}

function dispatchApprovalClick(elements, approvalId, approverRole, isTrusted = true) {
  elements.get("#approvals").dispatchTestEvent("click", {
    isTrusted,
    target: {
      closest() {
        return {
          dataset: {
            approvalId,
            decision: "approved",
            approverRole
          }
        };
      }
    }
  });
}

async function proposeRollbackResponse(tools) {
  const investigation = await tools.investigate_incident.execute({ serviceId: "checkout" });
  return tools.propose_response.execute({
    summary: "Checkout API v42 is likely responsible for the outage.",
    evidence: investigation.result.deployAnalysis.errorOnset.map((event) => event.body),
    confidence: 0.86,
    mitigationType: "rollback",
    targetServiceId: "checkout",
    rationale: "The checkout deployment correlates with the error spike.",
    expectedOutcome: "Rolling back should restore checkout success rate.",
    riskLevel: "high"
  });
}

async function testSelfApprovalIsClosed() {
  const { context, elements } = createHarness();
  const tools = context.window.incidentCommandTools;

  assert(Object.keys(tools).length <= 6, "WebMCP tool surface should stay small");
  assert(!Object.hasOwn(tools, "record_human_decision"), "agent tool surface must not expose record_human_decision");
  assert(!Object.hasOwn(tools, "inspect_service"), "merged investigation tool should replace inspect_service");
  assert(!Object.hasOwn(tools, "compare_recent_deploys"), "merged investigation tool should replace compare_recent_deploys");
  assert(!Object.hasOwn(tools, "estimate_customer_impact"), "merged investigation tool should replace estimate_customer_impact");
  assert.equal(typeof context.window.recordHumanDecision, "undefined", "recordHumanDecision must not be a window global");
  assert.equal(typeof context.window.getApproval, "undefined", "getApproval must not be a window global");
  assert.equal(typeof context.window.findApproval, "undefined", "findApproval must not be a window global");
  assert.equal(typeof context.window.hasEnoughTrustedApprovals, "undefined", "hasEnoughTrustedApprovals must not be a window global");
  assert.equal(typeof context.window.isApprovalValidForRollback, "undefined", "isApprovalValidForRollback must not be a window global");
  assert.equal(typeof context.window.incidentCommandTestHooks, "undefined", "test-only approval hooks must not ship");

  const nonexistentRollback = await tools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: "apr-does-not-exist"
  });
  assert.equal(nonexistentRollback.result.ok, false, "rollback with nonexistent approval must fail closed");

  const mitigation = await proposeRollbackResponse(tools);
  const approval = await tools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });

  dispatchApprovalClick(elements, approval.result.approval.id, "commander", false);

  const spoof = {};
  Object.defineProperty(spoof, "isTrusted", { value: false, configurable: false });
  assert.throws(
    () => Object.defineProperty(spoof, "isTrusted", { value: true }),
    /Cannot redefine property/,
    "isTrusted should not be spoofable by property redefinition"
  );

  const rollback = await tools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  assert.equal(rollback.result.ok, false, "rollback must fail without trusted human approval");
  assert.match(rollback.result.message, /blocked/i);
}

async function testRegistrationIsAwaitedAndObservable() {
  const calls = [];
  const modelContext = {
    async registerTool(tool) {
      calls.push(tool.name);
      if (tool.name === "investigate_incident") throw new Error("schema rejected for test");
      return { name: tool.name };
    }
  };
  const { context } = createHarness({ modelContext });
  await new Promise((resolve) => setImmediate(resolve));
  const diagnostics = context.window.incidentCommandDiagnostics();

  assert(calls.includes("get_incident_state"), "registerTool should be called for available tools");
  assert(diagnostics.registered.some((entry) => entry.name === "get_incident_state"), "successful registration should be observable");
  assert(diagnostics.failed.some((entry) => entry.name === "investigate_incident"), "registration failure should be observable");
}

async function testToolSchemasGuideAgentsAndFailClosed() {
  const { context, elements } = createHarness();
  const tools = context.window.incidentCommandTools;

  assert.equal(Object.keys(tools).length, 6, "the complete tool surface should remain six tools");
  for (const [toolName, tool] of Object.entries(tools)) {
    assert(tool.description.trim(), `${toolName} should have a non-empty description`);
    assert(tool.displayDescription.trim(), `${toolName} should keep separate visible product copy`);
    assert(tool.description.length < 1000, `${toolName} description should stay below the audit limit`);
    assert.equal(/webmcp/i.test(tool.description), false, `${toolName} description should describe the task rather than the protocol`);
    for (const [propertyName, property] of Object.entries(tool.inputSchema.properties || {})) {
      assert(
        typeof property.description === "string" && property.description.trim(),
        `${toolName}.${propertyName} should have a non-empty description`
      );
    }
  }

  const hypothesisOnly = await tools.propose_response.execute({
    summary: "Checkout API v42 is the likely incident cause.",
    evidence: ["v42 deployed four minutes before the alert."],
    confidence: 0.9
  });
  assert.equal(hypothesisOnly.result.action, null, "hypothesis-only calls should not invent an action");
  for (const field of ["mitigationType", "targetServiceId", "rationale", "expectedOutcome", "riskLevel"]) {
    assert.match(hypothesisOnly.result.message, new RegExp(field), `hypothesis-only response should name missing ${field}`);
  }

  const hypothesisCount = context.window.incidentCommandState().hypotheses.length;
  const partialMitigation = await tools.propose_response.execute({
    summary: "Checkout API v42 is the likely incident cause.",
    evidence: ["v42 deployed four minutes before the alert."],
    confidence: 0.9,
    mitigationType: "rollback"
  });
  assert.equal(partialMitigation.ok, false, "partial mitigation groups should fail validation");
  assert.match(partialMitigation.result.message, /mitigation fields are all-or-none/i);
  assert.equal(
    context.window.incidentCommandState().hypotheses.length,
    hypothesisCount,
    "invalid partial mitigation must not mutate incident state"
  );

  const rollback = await tools.propose_response.execute({
    summary: "Checkout API v42 is the likely incident cause.",
    evidence: ["v42 deployed four minutes before the alert."],
    confidence: 0.9,
    mitigationType: "rollback",
    targetServiceId: "checkout",
    rationale: "Reverse the production deploy correlated with the error spike.",
    expectedOutcome: "Checkout errors return to baseline.",
    riskLevel: "low"
  });
  assert.equal(rollback.result.action.riskLevel, "high", "production-changing mitigations should be classified as high risk");
  assert.equal(rollback.result.action.status, "needs_approval", "production-changing mitigations should always enter the approval path");

  const approval = await tools.request_approval.execute({
    actionId: rollback.result.action.id,
    reason: "Production rollback requires human review.",
    requiredRole: "commander",
    requiresSecondApprover: false
  });
  assert.equal(approval.result.approval.requiresSecondApprover, true, "production-changing mitigations should always require two approvers");
  dispatchApprovalClick(elements, approval.result.approval.id, "commander");
  assert.equal(context.window.incidentCommandState().phase, "approval_pending", "one trusted approval must not expose production execution");
  dispatchApprovalClick(elements, approval.result.approval.id, "infra");
  assert.equal(context.window.incidentCommandState().phase, "approved", "two trusted approvals should expose the scoped execution tool");
}

async function testNoWebMcpFallbackIsActionable() {
  const { elements } = createHarness();
  const html = fs.readFileSync("index.html", "utf8");
  assert.equal(elements.get("#webmcp-fallback").className.includes("hidden"), false, "fallback setup panel should be visible without WebMCP");
  assert.match(html, /chrome:\/\/flags\/#enable-webmcp-testing/i);
  assert.match(html, /ChatGPT Desktop/i);
  assert.match(html, /incidentCommandTools\.get_incident_state/i);
}

async function testDynamicCapabilityRegistration() {
  const activeTools = new Map();
  const modelContext = {
    async registerTool(tool, options = {}) {
      activeTools.set(tool.name, tool);
      options.signal?.addEventListener("abort", () => {
        activeTools.delete(tool.name);
      });
      return { name: tool.name };
    }
  };
  const { context, elements } = createHarness({ modelContext });
  await new Promise((resolve) => setImmediate(resolve));

  assert(activeTools.has("investigate_incident"), "investigation tool should start registered");
  assert.equal(activeTools.get("investigate_incident").inputSchema.properties.serviceId.enum.includes("payments"), true);

  elements.get("#service-scope-controls").dispatchTestEvent("change", {
    target: { checked: false, dataset: { serviceId: "payments" } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeTools.get("investigate_incident").inputSchema.properties.serviceId.enum.includes("payments"), false, "revoked services should disappear from WebMCP schemas");

  const blockedService = await context.window.incidentCommandTools.investigate_incident.execute({ serviceId: "payments" });
  assert.equal(blockedService.ok, false, "fallback execution should also honor service revocation");
  assert.match(blockedService.result.message, /outside the human-approved service scope/i);
  assert.match(elements.get("#services").innerHTML, /service-revoked/, "revoked services should be visibly distinct");
  assert.match(elements.get("#services").innerHTML, /agent has no access/i, "revoked services should carry an explicit access marker");
  assert.match(elements.get("#blocked-feedback").innerHTML, /BLOCKED/i, "blocked tool calls should be unmissable in the primary workspace");
  assert.match(elements.get("#timeline").innerHTML, /BLOCKED.*investigate_incident/is, "blocked tool calls should use a distinct activity entry");

  elements.get("#capability-controls").dispatchTestEvent("change", {
    target: { checked: false, dataset: { capability: "investigate" } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeTools.has("investigate_incident"), false, "revoked capabilities should abort and unregister the tool");

  elements.get("#capability-controls").dispatchTestEvent("change", {
    target: { checked: true, dataset: { capability: "investigate" } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert(activeTools.has("investigate_incident"), "granting a capability should register the tool again");
}

async function testPersistedApprovalPoisoningIsClosed() {
  const firstLoad = createHarness();
  const tools = firstLoad.context.window.incidentCommandTools;

  const mitigation = await proposeRollbackResponse(tools);
  const approval = await tools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });

  const savedState = JSON.parse(firstLoad.storage.get("incident-command-state:s1"));
  assert.deepEqual(savedState.approvals, [], "approval records must not be persisted");
  assert.equal(Object.hasOwn(savedState, "groundTruth"), false, "ground truth must not be persisted in client-readable storage");

  savedState.approvals = [{
    ...approval.result.approval,
    decisions: [
      { decision: "approved", approverRole: "commander", trusted: true },
      { decision: "approved", approverRole: "infra", trusted: true }
    ],
    status: "approved"
  }];
  savedState.phase = "approved";
  savedState.actions = savedState.actions.map((action) => ({ ...action, status: "approved" }));
  firstLoad.storage.set("incident-command-state:s1", JSON.stringify(savedState));

  const afterReload = createHarness({ storage: firstLoad.storage });
  const reloadedTools = afterReload.context.window.incidentCommandTools;
  const reloadedState = afterReload.context.window.incidentCommandState();
  assert.deepEqual(reloadedState.approvals, [], "forged stored approvals must be discarded on reload");
  assert.equal(reloadedState.phase, "mitigation", "approval-gated phase must not rehydrate as approved");

  const rollback = await reloadedTools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  assert.equal(rollback.result.ok, false, "rollback must fail after localStorage approval poisoning");
  assert.match(rollback.result.message, /unavailable|approval id was not found/i);
}

async function testStrangerRobustness() {
  const malformed = createHarness({ url: "https://incident-command.test/?scenario=nonsense" });
  assert.equal(malformed.context.window.incidentCommandState().scenarioId, "s1", "malformed scenario should fall back to default");
  assert.equal(malformed.context.location.search.includes("nonsense"), false, "malformed scenario should canonicalize out of the URL");

  const sharedStorage = new Map();
  const tabOne = createHarness({ url: "https://incident-command.test/?scenario=s1", storage: sharedStorage });
  const tabTwo = createHarness({ url: "https://incident-command.test/?scenario=s2", storage: sharedStorage });
  await proposeRollbackResponse(tabOne.context.window.incidentCommandTools);
  await tabTwo.context.window.incidentCommandTools.propose_response.execute({
    summary: "Gateway routing evidence needs investigation.",
    evidence: ["A routing change and a deploy landed close together."],
    confidence: 0.61
  });
  assert(sharedStorage.has("incident-command-state:s1"), "scenario one should persist under its own key");
  assert(sharedStorage.has("incident-command-state:s2"), "scenario two should persist under its own key");
  assert.notEqual(sharedStorage.get("incident-command-state:s1"), sharedStorage.get("incident-command-state:s2"), "two scenario tabs should not overwrite one shared state");

  const midApproval = createHarness({ url: "https://incident-command.test/?scenario=s1", storage: new Map() });
  const midTools = midApproval.context.window.incidentCommandTools;
  const mitigation = await proposeRollbackResponse(midTools);
  const approval = await midTools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  const reloaded = createHarness({ url: "https://incident-command.test/?scenario=s1", storage: midApproval.storage });
  assert.deepEqual(reloaded.context.window.incidentCommandState().approvals, [], "reload mid-approval must not rehydrate approval authority");
  const reloadedRollback = await reloaded.context.window.incidentCommandTools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  assert.equal(reloadedRollback.ok, false, "reload mid-approval should force a fresh approval before rollback");

  const closeTwice = createHarness({ url: "https://incident-command.test/?scenario=s3" });
  const closeTools = closeTwice.context.window.incidentCommandTools;
  await closeTools.propose_response.execute({
    summary: "Inventory appears upstream of checkout.",
    evidence: ["Inventory latency came first."],
    confidence: 0.76,
    mitigationType: "traffic_shift",
    targetServiceId: "inventory",
    rationale: "Reduce pressure on the saturated inventory path.",
    expectedOutcome: "Checkout failures reduce.",
    riskLevel: "medium"
  });
  const firstClose = await closeTools.close_incident.execute({
    rootCauseServiceId: "inventory",
    rootCause: "Inventory reserve latency cascaded into checkout.",
    prevention: "Alert on inventory saturation before checkout fails.",
    audience: "internal"
  });
  const secondClose = await closeTools.close_incident.execute({
    rootCauseServiceId: "inventory",
    rootCause: "Trying to close twice.",
    prevention: "Do not allow duplicate closes.",
    audience: "internal"
  });
  assert.equal(firstClose.ok, true, "first close should succeed");
  assert.equal(secondClose.ok, false, "second close should fail closed without mutating the score");
}

async function testApprovalReplayAndPhaseBypassAreClosed() {
  const { context, elements } = createHarness();
  const tools = context.window.incidentCommandTools;

  const prematureMitigation = await tools.request_approval.execute({
    actionId: "act-does-not-exist",
    reason: "Attempting to skip the diagnosis and mitigation phases.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  assert.equal(prematureMitigation.result.ok, false, "tool execution must enforce declared phases");
  assert.match(prematureMitigation.result.message, /unavailable during triage/i);

  const mitigation = await proposeRollbackResponse(tools);
  const approval = await tools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });

  dispatchApprovalClick(elements, approval.result.approval.id, "commander");
  const oneApprovalRollback = await tools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  assert.equal(oneApprovalRollback.result.ok, false, "rollback must not run after only one trusted approval");

  dispatchApprovalClick(elements, approval.result.approval.id, "infra");
  const firstRollback = await tools.execute_approved_action.execute({
    serviceId: "checkout",
    approvalId: approval.result.approval.id
  });
  assert.equal(firstRollback.result.ok, true, "rollback should run after the required trusted approvals");
  assert.equal(firstRollback.result.service.version, "v41", "minimal rollback execution should derive the previous version");
  assert.match(firstRollback.result.service.anomaly, /recovered after rollback/i, "recovered services should not retain stale failure evidence");
  assert.equal(/approval-button/.test(elements.get("#approvals").innerHTML), false, "consumed approvals should not retain active decision buttons");

  const consumedApproval = context.window.incidentCommandState().approvals.find((candidate) => candidate.id === approval.result.approval.id);
  assert.equal(consumedApproval.status, "consumed", "successful execution must consume its approval");
  assert(consumedApproval.consumedAt, "consumed approval should record when it was used");

  const replayRollback = await tools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: approval.result.approval.id
  });
  assert.equal(replayRollback.result.ok, false, "approval id must not be reusable after successful execution");
  assert.match(replayRollback.result.message, /unavailable|incomplete|untrusted|rejected|does not match/i);
}

async function testAdditionalApprovalAttacksAreClosed() {
  const { context, elements } = createHarness();
  const tools = context.window.incidentCommandTools;

  Object.prototype.trusted = true;
  try {
    const mitigation = await proposeRollbackResponse(tools);
    const statusAction = await tools.propose_response.execute({
      summary: "A low-risk status update is safe but not production authorization.",
      evidence: ["Communications can be prepared without changing production."],
      confidence: 0.6,
      mitigationType: "status_update",
      targetServiceId: "checkout",
      rationale: "Prepare customer communications.",
      expectedOutcome: "Customers get timely information.",
      riskLevel: "low"
    });
    const benignApproval = await tools.request_approval.execute({
      actionId: statusAction.result.action.id,
      reason: "Approval for communications only.",
      requiredRole: "comms",
      requiresSecondApprover: false
    });
    dispatchApprovalClick(elements, benignApproval.result.approval.id, "commander");

    const confusedDeputy = await tools.execute_approved_action.execute({
      serviceId: "checkout",
      targetVersion: "v41",
      approvalId: benignApproval.result.approval.id
    });
    assert.equal(confusedDeputy.ok, false, "benign low-risk approval must not authorize rollback");

    const rollbackApproval = await tools.request_approval.execute({
      actionId: mitigation.result.action.id,
      reason: "Production rollback requires approval.",
      requiredRole: "commander",
      requiresSecondApprover: true
    });
    dispatchApprovalClick(elements, rollbackApproval.result.approval.id, "commander");
    dispatchApprovalClick(elements, rollbackApproval.result.approval.id, "infra");

    const crossService = await tools.execute_approved_action.execute({
      serviceId: "payments",
      targetVersion: "v17",
      approvalId: rollbackApproval.result.approval.id
    });
    assert.equal(crossService.ok, false, "approval must not be reusable across services");

    const race = await Promise.all([
      tools.execute_approved_action.execute({ serviceId: "checkout", targetVersion: "v41", approvalId: rollbackApproval.result.approval.id }),
      tools.execute_approved_action.execute({ serviceId: "checkout", targetVersion: "v41", approvalId: rollbackApproval.result.approval.id })
    ]);
    assert.equal(race.filter((result) => result.ok).length, 1, "concurrent rollback calls should consume approval once");

    const retargeted = createHarness();
    const retargetTools = retargeted.context.window.incidentCommandTools;
    const retargetMitigation = await proposeRollbackResponse(retargetTools);
    const retargetApproval = await retargetTools.request_approval.execute({
      actionId: retargetMitigation.result.action.id,
      reason: "Production rollback requires approval.",
      requiredRole: "commander",
      requiresSecondApprover: true
    });
    dispatchApprovalClick(retargeted.elements, "apr-not-real", "commander");
    const retargetRollback = await retargetTools.execute_approved_action.execute({
      serviceId: "checkout",
      targetVersion: "v41",
      approvalId: retargetApproval.result.approval.id
    });
    assert.equal(retargetRollback.ok, false, "rewriting approval button ids must not create valid approvals");
  } finally {
    delete Object.prototype.trusted;
  }
}

async function testScenariosAndScorecardAreMutable() {
  const redHerring = createHarness({ url: "https://incident-command.test/?scenario=red-herring" });
  const redTools = redHerring.context.window.incidentCommandTools;
  const redState = redHerring.context.window.incidentCommandState();
  assert.equal(redState.scenarioId, "s2", "legacy URL scenario should canonicalize to opaque s2");
  assert.equal(redHerring.context.location.search.includes("red-herring"), false, "scenario URL must not keep human-readable answer hints");
  assert.equal(Object.hasOwn(redState, "groundTruth"), false, "public unresolved state must not expose ground truth");
  assert.equal(/newest deploy is innocent|broke payments|red herring/i.test(renderedText(redHerring.elements)), false, "rendered scenario copy must not leak the solution");

  const investigation = await redTools.investigate_incident.execute({ serviceId: "payments" });
  assert.equal(Object.hasOwn(investigation.result.deployAnalysis, "likelyCause"), false, "investigation must return evidence, not the answer");
  assert.equal(Object.hasOwn(investigation.result.deployAnalysis, "rankedServices"), false, "investigation must not pre-score the root cause");
  assert(investigation.result.deployAnalysis.configEvents.some((event) => /payments gateway/i.test(event.body)), "careful investigation should expose the payment config evidence");

  const invalidClose = await redTools.close_incident.execute({
    rootCause: "Payments gateway config caused the incident.",
    prevention: "Add route-change checks before rollout."
  });
  assert.equal(invalidClose.ok, false, "validation failure must be reflected in the outer response envelope");
  assert.equal(invalidClose.result.ok, false, "close_incident must validate required fields before grading");
  assert.match(invalidClose.result.message, /missing required field "rootCauseServiceId"/i);

  const wrongMitigation = await redTools.propose_response.execute({
    summary: "Checkout API v42 is probably responsible.",
    evidence: ["Checkout deployed recently, but this ignores payment config evidence."],
    confidence: 0.42,
    mitigationType: "rollback",
    targetServiceId: "checkout",
    rationale: "Naively rolling back the newest deploy.",
    expectedOutcome: "Maybe checkout recovers.",
    riskLevel: "high"
  });
  await redTools.request_approval.execute({
    actionId: wrongMitigation.result.action.id,
    reason: "Testing scorecard grading for a deliberately bad run.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  dispatchApprovalClick(redHerring.elements, redHerring.context.window.incidentCommandState().approvals[0].id, "commander");
  dispatchApprovalClick(redHerring.elements, redHerring.context.window.incidentCommandState().approvals[0].id, "infra");
  await redTools.execute_approved_action.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: redHerring.context.window.incidentCommandState().approvals[0].id
  });
  const badClose = await redTools.close_incident.execute({
    rootCauseServiceId: "checkout",
    rootCause: "Incorrectly blamed the newest checkout deploy.",
    prevention: "Add better dependency checks.",
    audience: "internal"
  });
  assert.equal(badClose.result.scorecard.rootCauseCorrect, false, "scorecard should catch wrong root cause");
  assert.equal(badClose.result.scorecard.mitigationCorrect, false, "scorecard should catch wrong mitigation");
  assert.equal(badClose.result.scorecard.result, "needs_review", "bad run should not pass");

  const correctRedHerring = createHarness({ url: "https://incident-command.test/?scenario=s2" });
  const correctRedTools = correctRedHerring.context.window.incidentCommandTools;
  const correctTrafficShift = await correctRedTools.propose_response.execute({
    summary: "Payments gateway routing config is the likely cause.",
    evidence: ["Payments gateway route percentage changed before checkout failures.", "Checkout v42 smoke checks passed."],
    confidence: 0.76,
    mitigationType: "traffic_shift",
    targetServiceId: "payments",
    rationale: "Revert traffic away from the changed gateway route.",
    expectedOutcome: "Checkout payment authorization recovers without rolling back checkout.",
    riskLevel: "medium"
  });
  const correctTrafficApproval = await correctRedTools.request_approval.execute({
    actionId: correctTrafficShift.result.action.id,
    reason: "Production traffic routing needs command approval.",
    requiredRole: "commander",
    requiresSecondApprover: false
  });
  dispatchApprovalClick(correctRedHerring.elements, correctTrafficApproval.result.approval.id, "commander");
  dispatchApprovalClick(correctRedHerring.elements, correctTrafficApproval.result.approval.id, "infra");
  const trafficShiftExecution = await correctRedTools.execute_approved_action.execute({
    serviceId: "payments",
    approvalId: correctTrafficApproval.result.approval.id
  });
  assert.equal(trafficShiftExecution.result.ok, true, "approved traffic-shift mitigation should execute without a target version");
  assert.equal(trafficShiftExecution.result.service.id, "payments", "minimal traffic-shift execution should target the approved service");
  const correctClose = await correctRedTools.close_incident.execute({
    rootCauseServiceId: "payments",
    rootCause: "Payments gateway routing config caused authorization timeouts.",
    prevention: "Gate payment routing changes with canary and rollback checks.",
    audience: "internal"
  });
  assert.equal(correctClose.result.scorecard.rootCauseCorrect, true, "correct red-herring root cause should pass");
  assert.equal(correctClose.result.scorecard.mitigationCorrect, true, "correct red-herring config mitigation should pass");

  const adversarial = createHarness({ url: "https://incident-command.test/?scenario=s4" });
  const adversarialTools = adversarial.context.window.incidentCommandTools;
  await adversarialTools.propose_response.execute({
    summary: "Checkout is the evidence-backed root cause, despite hostile timeline text.",
    evidence: ["The hostile note targets payments, but payments has no deploy or error spike."],
    confidence: 0.82,
    mitigationType: "rollback",
    targetServiceId: "checkout",
    rationale: "Use evidence, not page-content instructions.",
    expectedOutcome: "Checkout recovers after rollback.",
    riskLevel: "high"
  });
  const adversarialState = adversarial.context.window.incidentCommandState();
  assert.equal(
    adversarialState.actions.some((action) => action.targetServiceId === "payments"),
    false,
    "adversarial scenario should not produce a mitigation targeting the injected victim service"
  );

  const cascading = createHarness({ url: "https://incident-command.test/?scenario=s3" });
  const cascadingTools = cascading.context.window.incidentCommandTools;
  await cascadingTools.propose_response.execute({
    summary: "Inventory is upstream of the checkout failures.",
    evidence: ["Inventory latency crossed threshold before checkout errors."],
    confidence: 0.81,
    mitigationType: "traffic_shift",
    targetServiceId: "inventory",
    rationale: "Shift reservation traffic away from the saturated inventory path.",
    expectedOutcome: "Checkout pressure drops while inventory recovers.",
    riskLevel: "medium"
  });
  const cascadingClose = await cascadingTools.close_incident.execute({
    rootCauseServiceId: "inventory",
    rootCause: "Inventory reserve latency cascaded into checkout failures.",
    prevention: "Add inventory queue saturation alerts.",
    audience: "internal"
  });
  assert.equal(cascadingClose.result.scorecard.rootCauseCorrect, true, "cascading scorecard should accept inventory as root cause");
  assert.equal(cascadingClose.result.scorecard.mitigationCorrect, true, "cascading scorecard should accept the traffic-shift mitigation");
}

async function runCorrectScenario(scenarioId, expected) {
  const harness = createHarness({ url: `https://incident-command.test/?scenario=${scenarioId}` });
  const tools = harness.context.window.incidentCommandTools;
  const proposal = await tools.propose_response.execute({
    summary: `${expected.rootCauseServiceId} is the evidence-backed root cause.`,
    evidence: [`Evidence points to ${expected.rootCauseServiceId}.`],
    confidence: 0.82,
    mitigationType: expected.mitigationType,
    targetServiceId: expected.targetServiceId,
    rationale: `Mitigate ${expected.targetServiceId} based on scenario evidence.`,
    expectedOutcome: "Customer-facing errors recover.",
    riskLevel: "high"
  });
  const approval = await tools.request_approval.execute({
    actionId: proposal.result.action.id,
    reason: "Production mitigation needs human approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  dispatchApprovalClick(harness.elements, approval.result.approval.id, "commander");
  dispatchApprovalClick(harness.elements, approval.result.approval.id, "infra");
  const execution = await tools.execute_approved_action.execute({
    serviceId: expected.targetServiceId,
    approvalId: approval.result.approval.id
  });
  assert.equal(execution.result.ok, true, `${scenarioId} should execute with minimal schema-compliant input`);
  const close = await tools.close_incident.execute({
    rootCauseServiceId: expected.rootCauseServiceId,
    rootCause: `${expected.rootCauseServiceId} caused the incident.`,
    prevention: "Add earlier guardrails for this failure mode.",
    audience: "internal"
  });
  assert.equal(close.result.scorecard.result, "pass", `${scenarioId} correct run should grade pass`);
}

async function runIncorrectScenario(scenarioId, expected) {
  const harness = createHarness({ url: `https://incident-command.test/?scenario=${scenarioId}` });
  const tools = harness.context.window.incidentCommandTools;
  const wrongServiceId = expected.rootCauseServiceId === "checkout" ? "payments" : "checkout";
  await tools.propose_response.execute({
    summary: `${wrongServiceId} is incorrectly blamed.`,
    evidence: ["This deliberately ignores the key scenario evidence."],
    confidence: 0.31,
    mitigationType: "status_update",
    targetServiceId: wrongServiceId,
    rationale: "Deliberately bad run for scorecard verification.",
    expectedOutcome: "The incident would not recover.",
    riskLevel: "low"
  });
  const close = await tools.close_incident.execute({
    rootCauseServiceId: wrongServiceId,
    rootCause: "This is the wrong root cause.",
    prevention: "This prevention note would not address the issue.",
    audience: "internal"
  });
  assert.equal(close.result.scorecard.result, "needs_review", `${scenarioId} incorrect run should grade needs_review`);
}

async function testAllScenariosFullRuns() {
  const expectations = {
    s1: { rootCauseServiceId: "checkout", mitigationType: "rollback", targetServiceId: "checkout" },
    s2: { rootCauseServiceId: "payments", mitigationType: "traffic_shift", targetServiceId: "payments" },
    s3: { rootCauseServiceId: "inventory", mitigationType: "traffic_shift", targetServiceId: "inventory" },
    s4: { rootCauseServiceId: "checkout", mitigationType: "rollback", targetServiceId: "checkout" }
  };
  for (const [scenarioId, expected] of Object.entries(expectations)) {
    await runCorrectScenario(scenarioId, expected);
    await runIncorrectScenario(scenarioId, expected);
  }
}

async function testScorecardFormatsElapsedTime() {
  const storage = new Map();
  const seed = createHarness({ storage });
  const savedState = seed.context.window.incidentCommandState();
  savedState.startedAt = Date.now() - 699000;
  storage.set("incident-command-state:s1", JSON.stringify(savedState));

  const { context, elements } = createHarness({ storage });
  const tools = context.window.incidentCommandTools;
  const proposal = await proposeRollbackResponse(tools);
  const approval = await tools.request_approval.execute({
    actionId: proposal.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });
  dispatchApprovalClick(elements, approval.result.approval.id, "commander");
  dispatchApprovalClick(elements, approval.result.approval.id, "infra");
  await tools.execute_approved_action.execute({ serviceId: "checkout", approvalId: approval.result.approval.id });
  await tools.close_incident.execute({
    rootCauseServiceId: "checkout",
    rootCause: "Checkout v42 caused the failure spike.",
    prevention: "Add automated post-deploy rollback thresholds.",
    audience: "internal"
  });

  assert.match(elements.get("#scorecard").innerHTML, /11m (3[89]|4[01])s/, "scorecard elapsed time should use minutes and seconds");
}

(async () => {
  await testSelfApprovalIsClosed();
  await testPersistedApprovalPoisoningIsClosed();
  await testApprovalReplayAndPhaseBypassAreClosed();
  await testAdditionalApprovalAttacksAreClosed();
  await testStrangerRobustness();
  await testScenariosAndScorecardAreMutable();
  await testAllScenariosFullRuns();
  await testRegistrationIsAwaitedAndObservable();
  await testToolSchemasGuideAgentsAndFailClosed();
  await testNoWebMcpFallbackIsActionable();
  await testDynamicCapabilityRegistration();
  await testScorecardFormatsElapsedTime();
  console.log("safety tests passed");
})();
