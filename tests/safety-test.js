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
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchTestEvent(type, event) {
      return listeners.get(type)?.(event);
    }
  };
}

function createHarness({ modelContext } = {}) {
  const elements = new Map();
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

  const storage = new Map();
  const context = {
    console,
    clearTimeout,
    setTimeout,
    structuredClone,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    document,
    navigator: {},
    window: {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("app.js", "utf8"), context, { filename: "app.js" });
  return { context, elements };
}

async function testSelfApprovalIsClosed() {
  const { context, elements } = createHarness();
  const tools = context.window.incidentCommandTools;

  assert(!Object.hasOwn(tools, "record_human_decision"), "agent tool surface must not expose record_human_decision");
  assert.equal(typeof context.window.recordHumanDecision, "undefined", "recordHumanDecision must not be a window global");
  assert.equal(typeof context.window.getApproval, "undefined", "getApproval must not be a window global");
  assert.equal(typeof context.window.findApproval, "undefined", "findApproval must not be a window global");
  assert.equal(typeof context.window.hasEnoughTrustedApprovals, "undefined", "hasEnoughTrustedApprovals must not be a window global");
  assert.equal(typeof context.window.isApprovalValidForRollback, "undefined", "isApprovalValidForRollback must not be a window global");
  assert.equal(typeof context.window.incidentCommandTestHooks, "undefined", "test-only approval hooks must not ship");

  const nonexistentRollback = await tools.rollback_service.execute({
    serviceId: "checkout",
    targetVersion: "v41",
    approvalId: "apr-does-not-exist"
  });
  assert.equal(nonexistentRollback.result.ok, false, "rollback with nonexistent approval must fail closed");

  const compare = await tools.compare_recent_deploys.execute({ windowMinutes: 30 });
  await tools.propose_hypothesis.execute({
    summary: "Checkout API v42 is likely responsible for the outage.",
    evidence: compare.result.evidence,
    confidence: compare.result.confidence
  });
  const mitigation = await tools.propose_mitigation.execute({
    type: "rollback",
    targetServiceId: "checkout",
    rationale: "The checkout deployment correlates with the error spike.",
    expectedOutcome: "Rolling back should restore checkout success rate.",
    riskLevel: "high"
  });
  const approval = await tools.request_approval.execute({
    actionId: mitigation.result.action.id,
    reason: "Production rollback requires approval.",
    requiredRole: "commander",
    requiresSecondApprover: true
  });

  const approvalsPanel = elements.get("#approvals");
  approvalsPanel.dispatchTestEvent("click", {
    isTrusted: false,
    target: {
      closest() {
        return {
          dataset: {
            approvalId: approval.result.approval.id,
            decision: "approved",
            approverRole: "commander"
          }
        };
      }
    }
  });

  const spoof = {};
  Object.defineProperty(spoof, "isTrusted", { value: false, configurable: false });
  assert.throws(
    () => Object.defineProperty(spoof, "isTrusted", { value: true }),
    /Cannot redefine property/,
    "isTrusted should not be spoofable by property redefinition"
  );

  const rollback = await tools.rollback_service.execute({
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
      if (tool.name === "inspect_service") throw new Error("schema rejected for test");
      return { name: tool.name };
    }
  };
  const { context } = createHarness({ modelContext });
  await new Promise((resolve) => setImmediate(resolve));
  const diagnostics = context.window.incidentCommandDiagnostics();

  assert(calls.includes("get_incident_state"), "registerTool should be called for available tools");
  assert(diagnostics.registered.some((entry) => entry.name === "get_incident_state"), "successful registration should be observable");
  assert(diagnostics.failed.some((entry) => entry.name === "inspect_service"), "registration failure should be observable");
}

(async () => {
  await testSelfApprovalIsClosed();
  await testRegistrationIsAwaitedAndObservable();
  console.log("safety tests passed");
})();
