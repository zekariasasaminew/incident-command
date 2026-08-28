# Copilot Instructions

Build Incident Command as a minimal, reliable WebMCP incident-response workspace.

Favor boring, dependency-light implementation choices. The project currently uses static HTML, CSS, and JavaScript so it can deploy easily and avoid build-system risk.

Keep changes aligned with these constraints:

- WebMCP must remain central to the product.
- Tool calls must be visible in the timeline.
- Risky actions must fail closed without human approval.
- Dynamic incident phase should control available tools.
- UI should be restrained, readable, and functional.
- Do not add decorative UI or broad framework churn without a clear reason.
- Do not add real external service integrations before the deterministic demo flow is polished.

Before finishing work, run:

```powershell
npm run check
```

If changing the UI, manually inspect the page at desktop and mobile widths.
