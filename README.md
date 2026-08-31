# Incident Command

Incident Command is a WebMCP-enabled prototype for The WebMCP Challenge. It simulates a production incident room where humans and browser agents collaborate through structured tools, visible state, approvals, and an audit trail.

## What It Demonstrates

- Agents can inspect live page state through WebMCP tools.
- Agents can propose hypotheses and mitigations that update the visible war room.
- Risky production actions fail closed until trusted human approval exists.
- Agents can request approval, but there is intentionally no WebMCP tool for granting approval.
- Tool availability changes as the incident moves through triage, mitigation, approval, execution, and resolution.
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
Investigate the checkout incident. Find the likely cause, propose the safest mitigation, request the needed approvals, and after approval draft a customer update.
```

Manual fallback for local testing:

```js
await incidentCommandTools.get_incident_state.execute({})
await incidentCommandTools.inspect_service.execute({ serviceId: "checkout" })
await incidentCommandTools.compare_recent_deploys.execute({ windowMinutes: 30 })
await incidentCommandTools.propose_hypothesis.execute({
  summary: "Checkout API v42 is the likely cause of the checkout failures.",
  evidence: ["v42 deployed four minutes before the alert", "payments and orders have no matching deploy"],
  confidence: 0.86
})
```

## Safety Contract

Production-impacting tools are fail-closed. `rollback_service` requires a matching approval record for the same action and target service. That approval can only be created from the page UI by a trusted human click; synthetic approval attempts and agent-originated approval attempts are rejected.

This closes the script-level self-approval hole. It does not claim to prevent an OS-level computer-control agent from clicking the same visible button a human can click. That boundary is explicit: Incident Command is designed to make the request visible and require a human decision in the page.

Run the safety regression test:

```powershell
npm run test:safety
```

## License

MIT
