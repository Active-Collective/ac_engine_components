const { NodeIO } = require('@gltf-transform/core');
const path = require('path');

describe('unit1.glb validation', () => {
  const io = new NodeIO();
  const glbPath = path.resolve(__dirname, '../../../../assets/unit1.glb');

  test('loads without errors', async () => {
    const doc = await io.read(glbPath);
    const root = doc.getRoot();
    expect(root.listScenes().length).toBeGreaterThan(0);
    expect(root.listMeshes().length).toBeGreaterThan(0);
  });

  test('first node has a rotation', async () => {
    const doc = await io.read(glbPath);
    const scene = doc.getRoot().listScenes()[0];
    const node = scene.listChildren()[0];
    expect(node.getRotation()[3]).not.toBe(1);
  });
});
