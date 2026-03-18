import * as THREE from 'three';

const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.15;
const CENTER_LINE_COLOR = 0xf0c14b;

const GROUND_VERTEX_SHADER = `
varying vec2 vWorldXZ;
#include <fog_pars_vertex>

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldXZ = worldPos.xz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GROUND_FRAGMENT_SHADER = `
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uAmbientIntensity;
uniform float uNoiseScale;

varying vec2 vWorldXZ;

#include <fog_pars_fragment>

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  for (int i = 0; i < 3; i++) {
    value += amplitude * snoise(p * frequency);
    frequency *= 2.5;
    amplitude *= 0.45;
  }
  return value;
}

void main() {
  float n = fbm(vWorldXZ * uNoiseScale);
  float t = n * 0.5 + 0.5;

  vec3 color;
  if (t < 0.33) {
    color = mix(uColor0, uColor1, t / 0.33);
  } else if (t < 0.66) {
    color = mix(uColor1, uColor2, (t - 0.33) / 0.33);
  } else {
    color = mix(uColor2, uColor3, (t - 0.66) / 0.34);
  }

  float nDotL = max(dot(vec3(0.0, 1.0, 0.0), uSunDirection), 0.0);
  float lighting = uAmbientIntensity + uSunIntensity * nDotL;
  color *= lighting;

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;

interface StencilConfig {
  stencilWrite: boolean;
  stencilFunc: THREE.StencilFunc;
  stencilRef: number;
  stencilFuncMask: number;
}

// Test-only stencil: local roads skip areas where highway mask wrote stencilRef=1.
// stencilWrite is false because local roads only read the stencil, never write to it.
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
  private groundMat: THREE.ShaderMaterial | null = null;
  private landUseMat: THREE.MeshBasicMaterial | null = null;

  getGround(): THREE.ShaderMaterial {
    if (!this.groundMat) {
      this.groundMat = new THREE.ShaderMaterial({
        vertexShader: GROUND_VERTEX_SHADER,
        fragmentShader: GROUND_FRAGMENT_SHADER,
        uniforms: {
          ...THREE.UniformsLib.fog,
          uColor0: { value: new THREE.Color(0xd4c89e) },
          uColor1: { value: new THREE.Color(0xb8c4a0) },
          uColor2: { value: new THREE.Color(0xc8bf9e) },
          uColor3: { value: new THREE.Color(0xa8b88c) },
          uSunDirection: { value: new THREE.Vector3(200, 500, 300).normalize() },
          uSunIntensity: { value: 0.45 },
          uAmbientIntensity: { value: 0.55 },
          uNoiseScale: { value: 0.002 },
        },
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.groundMat.userData.shared = true;
    }
    return this.groundMat;
  }

  getLandUse(): THREE.MeshBasicMaterial {
    if (!this.landUseMat) {
      this.landUseMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.landUseMat.userData.shared = true;
    }
    return this.landUseMat;
  }

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
float origY = transformed.y;
float bldgDist = distance(transformed.xz, uFocusXZ);
float bldgScale = 1.0 - smoothstep(uFlattenStart, uFlattenEnd, bldgDist);
transformed.y *= bldgScale;
// Roof/wall contrast: roof (normal up) slightly darker than walls
float roofDarken = step(0.5, normal.y) * 0.15;
// Ambient occlusion: wall bases darker, full brightness at ~15m height
float ao = normal.y > 0.5 ? 1.0 : mix(0.75, 1.0, smoothstep(0.0, 15.0, origY));
vColor.rgb *= (1.0 - roofDarken) * ao;`
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
    this.groundMat?.dispose();
    this.groundMat = null;
    this.landUseMat?.dispose();
    this.landUseMat = null;
  }
}

export const materialPool = new MaterialPool();
