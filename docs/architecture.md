# Architecture Overview

This document briefly describes the modular structure and main flows of the IFC-only viewer app.

- **Entry point:** `packages/viewer/index.ts` bootstraps the app and imports modules from `src/`.
- **Modules:** Logic is split into `ifc/`, `logic/`, and `ui/` for clear separation of BIM, interaction, and interface concerns.
- **Assets:** Only IFC files are used for model data; no GLTF or demo assets remain.
- **Build:** Vite is used for dev/build; strict TypeScript and lint enforced.

See README.md for setup and usage.
