# WebMCP Challenge Audit

Audit date: September 2, 2026 Central Time.

Official source checked through the Devpost Hackathons connector:

- submission requirements
- judging criteria
- key dates
- recent announcements
- official rules

## Deadline

Submissions close September 3, 2026 at 1:00 PM PT.

Devpost states this is a hard stop. After the deadline, the submission materials, video, repo, and live site cannot be changed for the judged submission.

## Hard Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Working live URL | Pass | `https://incident-command-jet.vercel.app` returns 200 and loads in the in-app browser. |
| Works with WebMCP enabled | Pass | In-app browser WebMCP capability listed `get_incident_state`, `investigate_incident`, and `propose_response`; dynamic service and capability changes updated the deployed tool surface. |
| Public code repository | Pass | GitHub reports `zekariasasaminew/incident-command` as public. |
| Open-source license visible | Pass | GitHub reports MIT License for the repository. `LICENSE` is present at repo root. |
| Source and instructions included | Pass | Root README includes run/test instructions. Submission details are in `docs/submission.md`. |
| Demo video under 3 minutes, public on YouTube, with audio | Not done | `docs/demo-script.md` is ready, but a public YouTube URL still has to be recorded and added to Devpost. |
| Text description explains the four required points | Ready | `docs/submission.md` includes a form-ready description covering WebMCP fit, better UX, human-agent collaboration, and WebMCP implementation. |
| Required Devpost custom fields ready | Mostly ready | `docs/submission.md` drafts all known answers. Teammate status and final YouTube URL still require user action. |
| Submission is not left as draft | Not verified | The Devpost connector reports no current projects. Create/save/submit the project before the deadline. |

## Announcement Standards

Recent Devpost guidance emphasized the demo and description.

| Standard | Status | Project Response |
| --- | --- | --- |
| Show project working in first 10-15 seconds | Ready | Demo script opens directly on the deployed app and starts with the WebMCP tool surface. |
| Show the agent actually using tools | Pass/Ready | Browser verification called `get_incident_state` and `investigate_incident`; demo script centers those calls. |
| Cut setup/loading/sign-in | Pass | App requires no login. Demo script starts from the live scenario URL. |
| Do not type live | Ready | Demo script says to paste the agent prompt and use short clips. |
| Show one strong example | Ready | Demo script uses `?scenario=s4` because it demonstrates prompt injection plus the approval boundary. |
| Write description like a human, not a feature list | Ready | Submission description is framed around a concrete safety problem and the human-agent workflow. |
| Do not overstate what is running | Pass | README and demo script explicitly say this is a simulator and not connected to real production systems. |
| Do not let AI name the project | Pass | `Incident Command` is direct and descriptive. |

## Judging Criteria

All four criteria are equally weighted.

### WebMCP Leverage

Status: Strong.

Evidence:

- Uses `document.modelContext.registerTool`.
- Tool registration is awaited and diagnostics are visible.
- Tool surface is small: six possible tools, three initial tools.
- The safety argument depends on WebMCP, not only on generic agent prompting.
- Phase-scoped and human-policy-scoped tool availability make the tool contract visible.
- Human service restrictions narrow WebMCP schemas and investigation evidence.
- Capability revocation unregisters tools through the `AbortController` signal passed to `registerTool`.

Remaining risk:

- WebMCP exposes no standalone `unregisterTool()` API; the app uses AbortSignal lifecycle unregistration and also fails closed at runtime.

### Execution

Status: Strong enough for submission, with one non-code blocker.

Evidence:

- Live Vercel URL works.
- App is coherent: incident state, service evidence, human console, approvals, activity feed, tool list, scorecard.
- `npm run check` passes.
- `npm run test:safety` passes.
- Production headers include `Origin-Agent-Cluster: ?1`. The app relies on the default same-origin WebMCP tools policy instead of sending an explicit `Permissions-Policy` header, because older stock browsers warn on the unrecognized `tools` feature.
- `/favicon.ico` returns 200.

Remaining blocker:

- Public YouTube video is not recorded/uploaded yet.

### Potential Impact

Status: Strong.

Evidence:

- The problem is specific: teams connecting agents to operational workflows need a safe way to evaluate behavior before real incidents.
- The simulator demonstrates red herrings, cascading failures, prompt-injected incident notes, human override, approvals, and scorecards.
- The README and submission copy explain why WebMCP improves the experience.

Remaining risk:

- The demo video must make the impact obvious quickly. Use the safety boundary, not a generic dashboard tour.

### Creativity & Ambition

Status: Strong.

Evidence:

- The project is not in a saturated shopping/travel/booking demo category.
- It frames WebMCP around agent safety and fail-closed production actions.
- It includes adversarial scenarios and regression tests rather than only a happy path.

Remaining risk:

- The UI is intentionally minimal. The demo must make the ambition visible through behavior: tool surface, injected instruction, approval gate, scorecard.

## Verified Live

Production alias:
https://incident-command-jet.vercel.app

Latest production deployment:
https://incident-command-bv13dvk1u-zekariasasaminews-projects.vercel.app

Checks run:

```powershell
npm run check
npm run test:safety
curl.exe -I https://incident-command-jet.vercel.app/
curl.exe -I https://incident-command-jet.vercel.app/favicon.ico
gh repo view zekariasasaminew/incident-command --json isPrivate,licenseInfo,defaultBranchRef,url,description
```

Browser/WebMCP smoke:

- opened `https://incident-command-jet.vercel.app/?scenario=s4`
- fetched WebMCP tools from the in-app browser
- confirmed initial tools: `get_incident_state`, `investigate_incident`, `propose_response`
- called `get_incident_state`
- called `investigate_incident`
- confirmed the production execution tool is unavailable before approval
- confirmed `record_human_decision` is absent
- confirmed injected instruction is visible as evidence
- confirmed trap labels are not visible in rendered copy
- confirmed revoking Payments removes it from `investigate_incident.serviceId` and `propose_response.targetServiceId` enums
- confirmed revoking the Investigate capability removes `investigate_incident` from the deployed WebMCP tool list
- confirmed agent/browser automation clicks against approval buttons are rejected as untrusted
- Chrome 151 verification from the project owner confirmed the full trusted human-approved execution path: one trusted approval leaves execution unavailable, the second approval exposes `execute_approved_action`, minimal execution rolls checkout from `v42` to `v41`, metrics recover, approval is consumed, and closeout grades `pass`
- local safety suite confirms all four scenarios can run investigate/propose/request approval/execute/close with correct runs grading `pass` and incorrect runs grading `needs_review`
- console warnings/errors were empty

## Must Finish Before Submission

1. Record the public YouTube demo video using `docs/demo-script.md`.
2. Add the YouTube URL to `docs/submission.md` if there is time before final commit, and to the Devpost form either way.
3. Create or update the Devpost project. The connector currently reports no projects.
4. Confirm teammate status. If submitting solo, choose `Individual`; if team, add every teammate before the deadline and make sure they accept.
5. Submit, then verify the Devpost submission is not a draft.
