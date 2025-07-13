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
   The viewer now uses [Bootstrap](https://getbootstrap.com/) and a fixed 1920×1080 canvas so you can place additional elements around it.

Four demo units (`unit1.glb` … `unit4.glb`) will appear side by side if they are
present under `packages/core/assets`. Drag items from the library sidebar or
choose a file via the **Choose file** button at the bottom of the sidebar.

## Features

| Feature | Description | Where to look |
| ------- | ----------- | ------------- |
| **Floor management** | Switch floors with the pill buttons or keys `1`‑`3`. Ghost grid opacity and visibility are adjustable in **`settings.ts`**. | `levels.ts` |
| **Nudge arrows** | Select a model to display six arrows for precise movement. See **`createNudgeGizmos`** in **`index.ts`**. | `index.ts` |
| **Keyboard controls** | Move with arrow keys or WASD/QE and rotate with `R`. Use Cmd/Ctrl+Z to undo the last move. Handled near the bottom of **`index.ts`**. | `index.ts` |
| **Material palette** | Right‑click a mesh to recolor it. Material logic lives in **`applyVariant`** and **`resetMaterial`**. | `index.ts` |
| **Metadata sidebar** | Each loaded model is analyzed in **`sidebar.ts`** to display mesh counts and materials. | `sidebar.ts` |
| **Navigation toolbar** | Centered toolbar with orbit, pan and camera view buttons. The paint brush reveals a palette for textures and colors. | `nav-controls.ts` |
| **Layout persistence** | Added/placed units restore after reload using `localStorage`. | `index.ts` |
| **Bootstrap UI** | Modern components and tooltips styled with Bootstrap 5. | `index.html` |

Most functions in `index.ts` include comments explaining their role and where to
extend them. Refer to the
[OBC documentation](https://docs.thatopen.com/intro) for deeper API details.

## Building

```bash
yarn workspace viewer build
```

The built files are output to `packages/viewer/dist`.



