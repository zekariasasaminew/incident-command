# Incident Command

Incident Command is a WebMCP-enabled prototype for The WebMCP Challenge. It simulates a production incident room where humans and browser agents collaborate through structured tools, visible state, approvals, and an audit trail.

## What It Demonstrates

- Agents can inspect live page state through WebMCP tools.
- Agents can propose hypotheses and mitigations that update the visible war room.
- Risky production actions fail closed until trusted human approval exists.
- Agents can request approval, but there is intentionally no WebMCP tool for granting approval.
- Tool availability changes as the incident moves through triage, mitigation, approval, execution, and resolution.
- Tools are registered by phase, so the agent sees a small focused surface instead of every capability at once.
- Every tool call and human decision appears in the timeline.

## Running Locally

Open `index.html` in a browser.

For WebMCP testing, use ChatGPT's in-app browser or Google Chrome with WebMCP enabled through `chrome://flags/#enable-webmcp-testing`.

## Live Demo

Production deployment:

https://incident-command-jet.vercel.app

## Demo Prompt

Ask the browser agent:

```text
Investigate the selected incident. Find the likely cause, propose the safest mitigation, request approval, execute only after approval, and close the incident with root cause and prevention notes.
```

Scenarios are URL-selectable:

- `?scenario=deploy-regression`
- `?scenario=red-herring`
- `?scenario=cascading`
- `?scenario=adversarial`

Changing scenario changes the ground truth used by the scorecard.

Manual fallback for local testing:

```js
await incidentCommandTools.get_incident_state.execute({})
await incidentCommandTools.investigate_incident.execute({ serviceId: "checkout" })
await incidentCommandTools.propose_response.execute({
  summary: "Checkout API v42 is the likely cause of the checkout failures.",
  evidence: ["v42 deployed four minutes before the alert", "payments and orders have no matching deploy"],
  confidence: 0.86,
  mitigationType: "rollback",
  targetServiceId: "checkout",
  rationale: "Checkout v42 correlates with the failure window.",
  expectedOutcome: "Rolling back should restore checkout success.",
  riskLevel: "high"
})
```

The WebMCP surface is intentionally six tools total: `get_incident_state`, `investigate_incident`, `propose_response`, `request_approval`, `rollback_service`, and `close_incident`. Registration is phase-scoped, so a triage agent starts with only the state, investigation, and response tools.

Agents should re-fetch WebMCP tools after each phase transition. Browser-provided `RegisteredTool` handles can go stale when the visible phase-scoped surface changes.

## Safety Contract

Production-impacting tools are fail-closed. `rollback_service` requires a matching approval record for the same action and target service. That approval can only be created from the page UI by a trusted human click; synthetic approval attempts and agent-originated approval attempts are rejected.

Approval records are deliberately memory-only. Encapsulation protects live references, not serialized copies; any trust decision written to client-writable storage stops being a trust decision and becomes caller-supplied data.

The safety contract was hardened through adversarial passes: `record_human_decision` moved out of the tool surface, trusted approval moved behind page clicks, helper globals moved behind a closure, and approval state was removed from client-writable persistence. Each step closed a bypass exposed by the previous one.

Approvals authorize one production action, not a standing license. A successful execution consumes its approval, and every tool enforces its declared incident phases at runtime as well as through WebMCP registration.

Tool schemas are also validated by the app before execution. WebMCP describes the contract, but Incident Command returns explicit fail-closed errors for missing required fields, unexpected fields, invalid enums, and basic type/length violations.

This closes the script-level self-approval hole. It does not claim to prevent an OS-level computer-control agent from clicking the same visible button a human can click. That boundary is explicit: Incident Command is designed to make the request visible and require a human decision in the page.

Run the safety regression test:

```powershell
npm run test:safety
```

## License

MIT
