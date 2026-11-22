# Repository Guidelines

This repository builds and publishes static GitHub Pages digests.

- Do not commit or push changes unless the user explicitly requests it.
- Keep generated Agentic Workflows runtime logs out of version control.
- Keep workflow source Markdown and compiled `.lock.yml` files in `.github/workflows/`.
- Keep digest generation scripts in `.github/scripts/`.
- Keep published pages in `docs/`.
- Deploys run from `.github/workflows/deploy.yml` on pushes to `main`.
