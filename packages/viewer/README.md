# IFC Viewer

A minimal, modular IFC viewer built with TypeScript, Three.js, OBC, and web-ifc. No React, no GLTF, no demo code.

## Installatie

1. Installeer [Node.js](https://nodejs.org/) (aanbevolen: v18+) en [Yarn](https://yarnpkg.com/).
2. Voer uit in de root van de repository:
   ```bash
   yarn install
   yarn workspace viewer dev
   ```

## Assets
Alle IFC-bestanden staan nu onder `packages/viewer/assets/`. Voeg hier je eigen .ifc-bestanden toe voor tests of demo.

## WASM
web-ifc verwacht het bestand `web-ifc.wasm` onder `packages/viewer/public/wasm/`. Dit wordt automatisch geserveerd.

## Gebruik
Open [http://localhost:5173](http://localhost:5173) in je browser. Sleep een `.ifc` uit de bibliotheek in de viewer, of gebruik de “+” knop om een bestand te kiezen.

## Meer info
Zie [docs/architecture.md](../../docs/architecture.md) voor uitleg over de mapstructuur en modularisatie.

---

Voor technische details en uitbreidingen, zie de code en [OBC documentatie](https://docs.thatopen.com/intro).
