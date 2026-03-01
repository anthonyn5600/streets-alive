import * as THREE from 'three';

const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.15;
const CENTER_LINE_COLOR = 0xf0c14b;

interface StencilConfig {
  stencilWrite: boolean;
  stencilFunc: THREE.StencilFunc;
  stencilRef: number;
  stencilFuncMask: number;
}

const LOCAL_STENCIL: StencilConfig = {
  stencilWrite: false,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilRef: 1,
  stencilFuncMask: 0xff,
};

class MaterialPool {
  private buildingMat: THREE.MeshLambertMaterial | null = null;
  private roadColorMats = new Map<string, THREE.MeshBasicMaterial>();
  private buildingFlattenUniforms = {
    uFocusXZ: { value: new THREE.Vector2(0, 0) },
    uFlattenStart: { value: 500.0 },
    uFlattenEnd: { value: 1500.0 },
  };
  private hwMaskMat: THREE.MeshBasicMaterial | null = null;
  private hwShadowMat: THREE.MeshBasicMaterial | null = null;
  private localCenterLineMat: THREE.MeshBasicMaterial | null = null;
  private hwCenterLineMat: THREE.MeshBasicMaterial | null = null;
  private localVertexColorMat: THREE.MeshBasicMaterial | null = null;
  private hwVertexColorMat: THREE.MeshBasicMaterial | null = null;
  private onewayArrowsMat: THREE.MeshBasicMaterial | null = null;

  getBuilding(): THREE.MeshLambertMaterial {
    if (!this.buildingMat) {
      const uniforms = this.buildingFlattenUniforms;
      this.buildingMat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      this.buildingMat.onBeforeCompile = (shader) => {
        shader.uniforms.uFocusXZ = uniforms.uFocusXZ;
        shader.uniforms.uFlattenStart = uniforms.uFlattenStart;
        shader.uniforms.uFlattenEnd = uniforms.uFlattenEnd;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
uniform vec2 uFocusXZ;
uniform float uFlattenStart;
uniform float uFlattenEnd;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float bldgDist = distance(transformed.xz, uFocusXZ);
float bldgScale = 1.0 - smoothstep(uFlattenStart, uFlattenEnd, bldgDist);
transformed.y *= bldgScale;`
        );
      };
      this.buildingMat.userData.shared = true;
    }
    return this.buildingMat;
  }

  updateBuildingFlatten(focusX: number, focusZ: number, start: number, end: number): void {
    this.buildingFlattenUniforms.uFocusXZ.value.set(focusX, focusZ);
    this.buildingFlattenUniforms.uFlattenStart.value = start;
    this.buildingFlattenUniforms.uFlattenEnd.value = end;
  }

  getRoadColor(color: number, stencil: StencilConfig | null): THREE.MeshBasicMaterial {
    const key = `${color}_${stencil ? 'stencil' : 'none'}`;
    let mat = this.roadColorMats.get(key);
    if (mat) return mat;

    mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    if (stencil) {
      mat.stencilWrite = stencil.stencilWrite;
      mat.stencilFunc = stencil.stencilFunc;
      mat.stencilRef = stencil.stencilRef;
      mat.stencilFuncMask = stencil.stencilFuncMask;
      mat.stencilFail = THREE.KeepStencilOp;
      mat.stencilZFail = THREE.KeepStencilOp;
      mat.stencilZPass = THREE.KeepStencilOp;
    }
    mat.userData.shared = true;
    this.roadColorMats.set(key, mat);
    return mat;
  }

  getLocalRoadColor(color: number): THREE.MeshBasicMaterial {
    return this.getRoadColor(color, LOCAL_STENCIL);
  }

  getHighwayRoadColor(color: number): THREE.MeshBasicMaterial {
    return this.getRoadColor(color, null);
  }

  getHighwayMask(): THREE.MeshBasicMaterial {
    if (!this.hwMaskMat) {
      this.hwMaskMat = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        side: THREE.DoubleSide,
      });
      this.hwMaskMat.userData.shared = true;
    }
    return this.hwMaskMat;
  }

  getHighwayShadow(): THREE.MeshBasicMaterial {
    if (!this.hwShadowMat) {
      this.hwShadowMat = new THREE.MeshBasicMaterial({
        color: SHADOW_COLOR,
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.hwShadowMat.userData.shared = true;
    }
    return this.hwShadowMat;
  }

  getLocalCenterLine(): THREE.MeshBasicMaterial {
    if (!this.localCenterLineMat) {
      this.localCenterLineMat = new THREE.MeshBasicMaterial({
        color: CENTER_LINE_COLOR,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        stencilWrite: false,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilRef: 1,
        stencilFuncMask: 0xff,
      });
      this.localCenterLineMat.userData.shared = true;
    }
    return this.localCenterLineMat;
  }

  getLocalVertexColorRoad(): THREE.MeshBasicMaterial {
    if (!this.localVertexColorMat) {
      this.localVertexColorMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.localVertexColorMat.stencilWrite = false;
      this.localVertexColorMat.stencilFunc = THREE.NotEqualStencilFunc;
      this.localVertexColorMat.stencilRef = 1;
      this.localVertexColorMat.stencilFuncMask = 0xff;
      this.localVertexColorMat.stencilFail = THREE.KeepStencilOp;
      this.localVertexColorMat.stencilZFail = THREE.KeepStencilOp;
      this.localVertexColorMat.stencilZPass = THREE.KeepStencilOp;
      this.localVertexColorMat.userData.shared = true;
    }
    return this.localVertexColorMat;
  }

  getHighwayVertexColorRoad(): THREE.MeshBasicMaterial {
    if (!this.hwVertexColorMat) {
      this.hwVertexColorMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.hwVertexColorMat.userData.shared = true;
    }
    return this.hwVertexColorMat;
  }

  getOnewayArrows(): THREE.MeshBasicMaterial {
    if (!this.onewayArrowsMat) {
      this.onewayArrowsMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        stencilWrite: false,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilRef: 1,
        stencilFuncMask: 0xff,
      });
      this.onewayArrowsMat.userData.shared = true;
    }
    return this.onewayArrowsMat;
  }

  getHighwayCenterLine(): THREE.MeshBasicMaterial {
    if (!this.hwCenterLineMat) {
      this.hwCenterLineMat = new THREE.MeshBasicMaterial({
        color: CENTER_LINE_COLOR,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.hwCenterLineMat.userData.shared = true;
    }
    return this.hwCenterLineMat;
  }

  dispose(): void {
    this.buildingMat?.dispose();
    this.buildingMat = null;
    for (const mat of this.roadColorMats.values()) mat.dispose();
    this.roadColorMats.clear();
    this.hwMaskMat?.dispose();
    this.hwMaskMat = null;
    this.hwShadowMat?.dispose();
    this.hwShadowMat = null;
    this.localCenterLineMat?.dispose();
    this.localCenterLineMat = null;
    this.hwCenterLineMat?.dispose();
    this.hwCenterLineMat = null;
    this.localVertexColorMat?.dispose();
    this.localVertexColorMat = null;
    this.hwVertexColorMat?.dispose();
    this.hwVertexColorMat = null;
    this.onewayArrowsMat?.dispose();
    this.onewayArrowsMat = null;
  }
}

export const materialPool = new MaterialPool();
