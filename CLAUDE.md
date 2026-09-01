# Project Rules For Agents

This project is a WebMCP Challenge submission candidate. Optimize for qualification, a reliable demo, and clear WebMCP leverage before visual polish.

## Priorities

1. Keep the live app working and easy to test.
2. Preserve functional `document.modelContext.registerTool(...)` usage.
3. Make human-agent collaboration visible in the UI.
4. Keep risky actions approval-gated.
5. Keep the UI minimal, plain, readable, and consistent.

## Product Direction

The app is Incident Command: a simulated production incident war room where browser agents inspect incident state, propose hypotheses, request approvals, and execute gated mitigations through WebMCP tools.

Do not turn this into a general dashboard builder, visual design tool, or marketing site. The first screen should remain the actual product experience.

## UI Rules

- Use a small set of components and spacing rules.
- Avoid decorative gradients, fake glass effects, nested cards, oversized heroes, and ornamental animation.
- Make status and state changes obvious.
- Show exact tool calls, approvals, blocked actions, and outcomes.
- Do not hide why an action is disabled or blocked.
- Test for text overflow and panel collisions on narrow screens.

## Demo Rules

- The demo must be deterministic and resettable.
- Use simulated data honestly; never imply real production integrations exist.
- Preserve the manual console fallback via `window.incidentCommandTools`.
- Every important agent action should leave a timeline entry.
- Do not expose human approval as a WebMCP tool. Agents may request approval; only trusted page UI interactions may grant or reject it.

## Submission Rules

- Public repo required.
- MIT or another recognized open-source license required.
- Live URL required.
- README must explain how to test in ChatGPT's in-app browser or Chrome with WebMCP enabled.
- Demo video must be public, under 3 minutes, and include audio explaining how WebMCP is used.
