# Agentic DevOps Updates

A lightweight GitHub Pages site that publishes curated updates for platform engineering and agent-assisted development.

## Pages

- **Agentic DevOps Watchlist:** Azure SRE Agent, Azure Monitor Observability Agent, resiliency, coding agents, Azure DevOps, and GitHub Spec Kit updates.
- **GitHub Copilot Ecosystem Updates:** Recent releases from GitHub Copilot App, CLI, SDK, Spec Kit, and Agentic Workflows.

The source pages are in [`docs/`](docs/).

## Repository layout

- `docs/` - Published HTML and landing page.
- `.github/scripts/` - Fetch, prepare, and render scripts for the digest pages.
- `.github/workflows/` - Agentic workflow definitions, compiled workflows, and GitHub Pages deployment.

## Automatic updates

The repository uses scheduled GitHub Agentic Workflows to refresh the digest pages on weekdays:

- `agentic-devops-updates.md` collects and summarizes Azure, GitHub, Azure DevOps, and Spec Kit updates from the last 90 days.
- `github-copilot-update.md` collects recent GitHub Copilot ecosystem releases from the last 14 days.
- `deploy.yml` publishes `docs/` to GitHub Pages after changes reach `main`.

Updated pages are proposed through pull requests by the workflows.

## Local preview

No build step or package installation is required. From the repository root, start a local HTTP server:

```bash
python3 -m http.server 8000 --directory docs
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/agentic-devops-releases.html`
- `http://localhost:8000/copilot-app-releases.html`

## Updating the digests locally

The Agentic DevOps digest supports a complete fetch, prepare, and render cycle:

```bash
node .github/scripts/agentic-devops-page.mjs fetch
node .github/scripts/agentic-devops-page.mjs prepare
# Add summaries to /tmp/gh-aw/agent/notes.json
node .github/scripts/agentic-devops-page.mjs render
```

The Copilot release workflow prepares and renders through the GitHub Actions workflow, using the GitHub API and the GitHub Changelog feed.
