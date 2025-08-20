import * as THREE from 'three';
import { buildParamGroups, Label } from './parameter-visibility';

describe('buildParamGroups', () => {
  test('collects objects by ParameterTest value', async () => {
    const mesh = new THREE.Mesh();
    mesh.userData.expressID = 10;
    const root = new THREE.Object3D();
    root.add(mesh);

    const ifcAPI = {
      IFCRELDEFINESBYPROPERTIES: 1,
      GetLineIDsWithType: () => [1],
      GetLine: (_model: number, id: number) => {
        if (id === 1) return { RelatedObjects: [{ value: 10 }], RelatingPropertyDefinition: { value: 2 } };
        if (id === 2) return { HasProperties: [{ value: 3 }] };
        if (id === 3) return { Name: { value: 'ParameterTest' }, NominalValue: { value: 'AA' } };
        return null;
      },
    } as any;

    const groups = await buildParamGroups(ifcAPI, 0, root);
    expect(groups.map.get('AA')?.has(mesh)).toBe(true);
  });

  test('toggle changes visibility', async () => {
    const mesh = new THREE.Mesh();
    mesh.userData.expressID = 20;
    const root = new THREE.Object3D();
    root.add(mesh);

    const ifcAPI = {
      IFCRELDEFINESBYPROPERTIES: 1,
      GetLineIDsWithType: () => [1],
      GetLine: (_model: number, id: number) => {
        if (id === 1) return { RelatedObjects: [{ value: 20 }], RelatingPropertyDefinition: { value: 2 } };
        if (id === 2) return { HasProperties: [{ value: 3 }] };
        if (id === 3) return { Name: { value: 'ParameterTest' }, NominalValue: { value: 'BB' } };
        return null;
      },
    } as any;

    const groups = await buildParamGroups(ifcAPI, 0, root);
    groups.toggle('BB', false);
    expect(mesh.visible).toBe(false);
  });
});

