# Viewer Example

This package demonstrates how to load and manipulate glTF models using
[@thatopen/components](https://www.npmjs.com/package/@thatopen/components).

## Installation

1. Install [Node.js](https://nodejs.org/) and [Yarn](https://yarnpkg.com/).
2. In the repository root run:
   ```bash
   yarn install
   ```
3. Start the development server:
   ```bash
   yarn workspace viewer dev --host
   ```
4. Open [http://localhost:5173](http://localhost:5173) in your browser.

If `unit1.glb` … `unit4.glb` exist under `packages/core/assets` they will load
automatically and appear side by side. You can also load a local `.glb` or
`.gltf` file via the file input.

## Building

To create a production build run:
```bash
yarn workspace viewer build
```

## Usage

- Select a model with the left mouse button to move it on the grid using the
  arrow keys. Press **R** to rotate it 90° around the Y&nbsp;axis.
- Right-click a mesh (for example a door) to select that part only. Use the
  color palette to apply a material to the selected object. The reset button
  restores the original material.


