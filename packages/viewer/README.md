# Viewer Example

This package demonstrates how to load and rotate a glTF model using
[@thatopen/components](https://www.npmjs.com/package/@thatopen/components).

## Installation

1. Install [Node.js](https://nodejs.org/) and [Yarn](https://yarnpkg.com/).
2. In the repository root run:
   ```bash
   yarn install
   ```
3. Start the development server:
   ```bash
   yarn workspace viewer dev
   ```
4. Open [http://localhost:5173/packages/viewer/index.html](http://localhost:5173/packages/viewer/index.html) in your browser.

You can load a local `.glb` or `.gltf` file via the file input. By default the
viewer loads `assets/unit1.glb` if present.

## Building

To create a production build run:
```bash
yarn workspace viewer build
```


