declare module '@thatopen/components' {
  import * as THREE from 'three';

  export class Components {
    init(): void;
    get<T>(cls: any): T;
  }

  export class Worlds {
    create<T, U, V>(): any;
  }

  export class SimpleScene {
    constructor(components: any);
    setup(): void;
    three: THREE.Scene;
  }

  export class SimpleRenderer {
    constructor(components: any, container: HTMLElement);
    three: THREE.WebGLRenderer;
  }

  export class SimpleCamera {
    constructor(components: any);
    three: THREE.Camera;
    controls: any;
  }

  export class BoundingBoxer {
    reset(): void;
    addMesh(mesh: THREE.Mesh | THREE.InstancedMesh): void;
    get(): THREE.Box3;
    static getDimensions(box: THREE.Box3): { width: number; depth: number; height: number };
  }

  export class Raycasters {
    get(world: any): any;
  }

  export class SimpleGrid {
    constructor(components: any, world: any);
    setup(): void;
    config: { color: THREE.Color; primarySize: number; secondarySize: number };
    three: THREE.Object3D;
    material: THREE.Material;
  }

  export class IfcLoader {
    settings?: { wasm?: { path: string; absolute?: boolean } };
    setup?(): Promise<void>;
    load(data: any): Promise<any>;
    ifc?: { api?: { DisposeModel?: (id: number) => void } };
  }
}
