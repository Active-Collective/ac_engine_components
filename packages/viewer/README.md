# Viewer Example

This demo showcases the most common features of
[@thatopen/components](https://www.npmjs.com/package/@thatopen/components) in a
small but extendable viewer.

## Quick start

1. Install [Node.js](https://nodejs.org/) and [Yarn](https://yarnpkg.com/).
2. From the repository root run:
   ```bash
   yarn install
   yarn workspace viewer dev --host
   ```
3. Open [http://localhost:5173](http://localhost:5173).

Four demo units (`unit1.glb` … `unit4.glb`) will appear side by side if they are
present under `packages/core/assets`. You can also drop additional `.glb` files
onto the canvas or choose one via the file input in the library sidebar.

## Features

| Feature | Description | Where to look |
| ------- | ----------- | ------------- |
| **Floor management** | Switch floors with the pill buttons or keys `1`‑`3`. Ghost grids and snapping are configured in **`levels.ts`**. | `levels.ts` |
| **Drag handle & nudge arrows** | Select a model to display a red drag sphere and six arrows for precise movement. See **`attachHandle`** and **`createNudgeGizmos`** in **`index.ts`**. | `index.ts` |
| **Keyboard controls** | Move with arrow keys or WASD/QE and rotate with `R`. Handled near the bottom of **`index.ts`**. | `index.ts` |
| **Material palette** | Right‑click a mesh to recolor it. Material logic lives in **`applyVariant`** and **`resetMaterial`**. | `index.ts` |
| **Metadata sidebar** | Each loaded model is analyzed in **`sidebar.ts`** to display mesh counts and materials. | `sidebar.ts` |

Most functions in `index.ts` include comments explaining their role and where to
extend them. Refer to the
[OBC documentation](https://docs.thatopen.com/intro) for deeper API details.

## Building

```bash
yarn workspace viewer build
```

The built files are output to `packages/viewer/dist`.



