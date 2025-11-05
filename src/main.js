import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
//////////////
// Initialize variables (global scope for VR/controllers)
//////////////
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let raycaster;
const intersected = [];
const tempMatrix = new THREE.Matrix4();
let group;
// names to exclude from interaction (landscape/ground etc.)
const excludedNames = ['Landscape', 'Plane'];
// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
// Enable shadows
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// append VRButton and init VR controllers later
function initVR() {
  document.body.appendChild(VRButton.createButton(renderer));
  renderer.xr.enabled = true;

  // controller setup
  controller1 = renderer.xr.getController(0);
  controller1.addEventListener('selectstart', onSelectStart);
  controller1.addEventListener('selectend', onSelectEnd);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener('selectstart', onSelectStart);
  controller2.addEventListener('selectend', onSelectEnd);
  scene.add(controller2);

  // controller grips with visible controller models
  const controllerModelFactory = new XRControllerModelFactory();

  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
  scene.add(controllerGrip1);

  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
  scene.add(controllerGrip2);

  // simple line visual for controllers (raycast pointer)
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);

  const line = new THREE.Line(geometry);
  line.name = 'line';
  line.scale.z = 5;

  controller1.add(line.clone());
  controller2.add(line.clone());

  // raycaster for interaction
  raycaster = new THREE.Raycaster();
}

// call initVR after scene is created (moved below)
// ---------- Scene & Camera ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(2.5, 1.8, 3.5);

// ---------- Controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

// If dragging feels reversed, keep this negative rotateSpeed.
// If it feels fine, change it to +1.0.
controls.rotateSpeed = -1.0;
controls.zoomSpeed = 1.2;
controls.minDistance = 0.3;
controls.maxDistance = 100;

// Hint UI
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = 'Drag to orbit • Mouse wheel to zoom';
document.body.appendChild(hint);

// --- Small control UI (scale + toggles) ---
const ctrlUi = document.createElement('div');
ctrlUi.style.position = 'fixed';
ctrlUi.style.top = '12px';
ctrlUi.style.right = '12px';
ctrlUi.style.background = 'rgba(0,0,0,0.6)';
ctrlUi.style.color = '#fff';
ctrlUi.style.padding = '8px 10px';
ctrlUi.style.borderRadius = '6px';
ctrlUi.style.fontFamily = 'sans-serif';
ctrlUi.style.fontSize = '13px';
ctrlUi.style.zIndex = '9999';
ctrlUi.style.lineHeight = '1.4';
ctrlUi.innerHTML = `
  <label style="display:block;margin-bottom:6px"><input id="ui_inside" type="checkbox" checked/> Inside VR</label>
  <label style="display:block;margin-bottom:6px"><input id="ui_autoscale" type="checkbox" checked/> Auto-scale</label>
  <div style="margin-top:6px">Scale: <span id="ui_scale_val">1.00</span></div>
  <input id="ui_scale" type="range" min="0.1" max="8" step="0.01" value="1" style="width:140px;display:block;margin-top:6px" />
  <div style="display:flex;gap:6px;margin-top:6px"><button id="ui_reset" style="flex:1">Reset</button><button id="ui_fit" style="flex:1">Auto</button></div>
  <div style="margin-top:6px;font-size:11px">Move: WASD / Arrows</div>
`;
document.body.appendChild(ctrlUi);

const uiInside = document.getElementById('ui_inside');
const uiAutoscale = document.getElementById('ui_autoscale');
const uiScale = document.getElementById('ui_scale');
const uiScaleVal = document.getElementById('ui_scale_val');
const uiReset = document.getElementById('ui_reset');
const uiFit = document.getElementById('ui_fit');

// XR placement controls & numeric readout (useful when testing with WebXR emulator)
const xrPanel = document.createElement('div');
xrPanel.style.marginTop = '8px';
xrPanel.style.fontSize = '12px';
xrPanel.style.lineHeight = '1.2';
xrPanel.innerHTML = `
  <div style="margin-bottom:6px">XR Headset: <span id="xr_pos">-</span></div>
  <div style="margin-bottom:6px">XR Rot (deg): <span id="xr_rot">-</span></div>
  <div style="display:flex;gap:6px"><button id="ui_place_front" style="flex:1">Place in front (XR)</button><button id="ui_place_center" style="flex:1">Place center (XR)</button></div>
`;
ctrlUi.appendChild(xrPanel);

const xrPosSpan = document.getElementById('xr_pos');
const xrRotSpan = document.getElementById('xr_rot');
const uiPlaceFront = document.getElementById('ui_place_front');
const uiPlaceCenter = document.getElementById('ui_place_center');

uiPlaceFront.addEventListener('click', () => {
  if (!loadedModel) return;
  try {
    // place model in front of current XR headset pose
    positionModelInFrontOfViewer(loadedModel, 1.6);
  } catch (e) {
    console.warn('Place in front (XR) failed', e);
  }
});

uiPlaceCenter.addEventListener('click', () => {
  if (!loadedModel) return;
  try {
    // align model center to headset
    positionModelInside(loadedModel, { minSize: 1.6, preserveY: false, standOnFloor: true, eyeHeight: 1.6 });
  } catch (e) {
    console.warn('Place center (XR) failed', e);
  }
});

// Add a simple "Flip" button to toggle model orientation around Y
const uiFlip = document.createElement('button');
uiFlip.id = 'ui_flip';
uiFlip.textContent = 'Flip';
uiFlip.style.marginLeft = '6px';
uiFlip.style.padding = '6px 10px';
uiFlip.style.fontSize = '13px';
uiFlip.style.cursor = 'pointer';
// place the flip button next to the existing reset/auto buttons
const btnRow = ctrlUi.querySelector('div[style*="display:flex"]');
if (btnRow) btnRow.appendChild(uiFlip);

uiFlip.addEventListener('click', () => {
  if (!loadedModel) return;
  loadedModel.rotation.y += Math.PI;
});

// Flip X (useful if model appears upside-down)
const uiFlipX = document.createElement('button');
uiFlipX.id = 'ui_flip_x';
uiFlipX.textContent = 'Flip X';
uiFlipX.style.marginLeft = '6px';
uiFlipX.style.padding = '6px 10px';
uiFlipX.style.fontSize = '13px';
uiFlipX.style.cursor = 'pointer';
if (btnRow) btnRow.appendChild(uiFlipX);
uiFlipX.addEventListener('click', () => {
  if (!loadedModel) return;
  loadedModel.rotation.x += Math.PI;
});

uiInside.addEventListener('change', (e) => { vrInsideMode = e.target.checked; });
uiAutoscale.addEventListener('change', (e) => { vrAutoScale = e.target.checked; });

function setModelScale(s) {
  if (!loadedModel) return;
  loadedModel.scale.setScalar(s);
  uiScale.value = s;
  uiScaleVal.textContent = s.toFixed(2);
  // after manual scaling, reposition in next XR frame if needed
  if (renderer.xr.isPresenting) pendingPositionOnXRStart = true;
}

uiScale.addEventListener('input', (e) => setModelScale(parseFloat(e.target.value)));
uiReset.addEventListener('click', () => setModelScale(1.0));
uiFit.addEventListener('click', () => {
  if (!loadedModel) return;
  fitCenterScaleAndFrame(loadedModel);
  const s = loadedModel.scale.x || 1.0;
  uiScale.value = s;
  uiScaleVal.textContent = s.toFixed(2);
});

// Optional soft light
const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.2);
scene.add(hemi);

// Directional light for shadows
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 10, 7.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.normalBias = 0.05;
scene.add(dirLight);
const dirHelper = new THREE.CameraHelper(dirLight.shadow.camera);
dirHelper.visible = false; // toggle true to debug
scene.add(dirHelper);

// Simple ground (optional)
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(10, 64),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Environment (try HDR then fallback to RoomEnvironment) ----------
const pmrem = new THREE.PMREMGenerator(renderer);

// Try to load an HDR environment (place HDR at public/textures/rogland_moonlit_night_1k.hdr)
new HDRLoader()
  .setPath('textures/')
  .load(
    'rogland_moonlit_night_1k.hdr',
    (hdrEquirect) => {
      // Defensive checks: HDRLoader may return undefined or an unexpected object
      if (!hdrEquirect) {
        console.warn('HDRLoader returned empty value — using RoomEnvironment fallback');
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTex;
        return;
      }

      // Some loader builds return textures, others return data objects — guard against both
      try {
        // prefer pmrem.fromEquirectangular when given a texture-like object
        const envMap = pmrem.fromEquirectangular(hdrEquirect).texture;
        if (!envMap) throw new Error('pmrem.fromEquirectangular returned no texture');
        scene.environment = envMap;
        scene.background = envMap; // optional
        if (typeof hdrEquirect.dispose === 'function') hdrEquirect.dispose();
      } catch (e) {
        console.warn('HDR load succeeded but PMREM conversion failed or returned unexpected data — falling back to RoomEnvironment', e);
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTex;
      }
    },
    undefined,
    (err) => {
      // fallback: RoomEnvironment
      console.warn('HDR load failed, using RoomEnvironment fallback', err);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
    },
  );

// Group that contains interactive objects (raycast target)
group = new THREE.Group();
scene.add(group);

// initialize VR after scene and group exist
initVR();

// ---------- Load model ----------
const loader = new GLTFLoader();
// keep a reference to the loaded model so we can reposition it when entering VR
let loadedModel = null;
// VR mode flags (toggleable via small UI below)
let vrInsideMode = true;     // if true, place user inside the model on session start
let vrAutoScale = true;     // if true, small models are scaled up to fit the user
// Defer positioning until XR pose is available (perform on next frame)
let pendingPositionOnXRStart = false;

// IMPORTANT: place your GLB at public/models/kuva.glb or change the name here.
loader.load(
  '/models/kuva.glb',
  (gltf) => {
  const model = gltf.scene;
  // add interactive model(s) to the group so raycaster sees them
  group.add(model);
    loadedModel = model;

    // Optional: small tweak to ensure decent PBR look
    model.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.material && obj.material.isMeshStandardMaterial) {
          obj.material.metalness = Math.min(1, obj.material.metalness ?? 0.2);
          obj.material.roughness = Math.max(0, obj.material.roughness ?? 0.6);
        }
        // enable shadows for meshes
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    fitCenterScaleAndFrame(model);
    // update UI scale to reflect fitted scale (assume uniform)
    try {
      const s = model.scale.x || 1.0;
      if (typeof uiScale !== 'undefined' && uiScale) {
        uiScale.value = s;
      }
      if (typeof uiScaleVal !== 'undefined' && uiScaleVal) {
        uiScaleVal.textContent = s.toFixed(2);
      }
    } catch (e) {
      // ignore if UI not yet created
    }
  },
  undefined,
  (err) => {
    console.error('GLB load error:', err);
    // Fallback cube so you still see something
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.6 })
    );
  fallback.position.y = 0.5;
  group.add(fallback);
  }
);

// When entering VR, place the model centered in front of the user for comfortable viewing.
function positionModelInFrontOfViewer(model, distance = 1.5) {
  if (!model) return;
  // XR camera group — contains the headset pose in world space
  const xrCam = renderer.xr.getCamera();
  const camPos = new THREE.Vector3();
  xrCam.getWorldPosition(camPos);
  const camDir = new THREE.Vector3();
  xrCam.getWorldDirection(camDir);

  // compute target X,Z in front of the user and keep model grounded at y = 0
  const target = camPos.clone().add(camDir.multiplyScalar(distance));
  model.position.set(target.x, 0, target.z);

  // Rotate model to face the user but keep it upright (only yaw)
  model.lookAt(camPos.x, model.position.y, camPos.z);
}

// Position the model so the user is inside it: align the model's bounding-box center to the
// headset world position. Optionally scale up small models so the user fits inside.
// options: { minSize: number, preserveY: boolean }
function positionModelInside(model, options = { minSize: 1.5, preserveY: false, standOnFloor: true, eyeHeight: 1.6 }) {
  if (!model) return;

  // compute world-space bounding box (current transform)
  let box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;

  const modelCenter = new THREE.Vector3();
  box.getCenter(modelCenter);
  const size = new THREE.Vector3();
  box.getSize(size);
  let maxDim = Math.max(size.x, size.y, size.z);

  const minSize = options.minSize ?? 1.5;
  // scale up small models so the user can be comfortably inside
  if (vrAutoScale && minSize && maxDim < minSize) {
    const scaleUp = minSize / maxDim;
    model.scale.multiplyScalar(scaleUp);
    // recompute box after scaling
    box = new THREE.Box3().setFromObject(model);
    box.getCenter(modelCenter);
    box.getSize(size);
    maxDim = Math.max(size.x, size.y, size.z);
  }

  // get headset world position
  const xrCam = renderer.xr.getCamera();
  const camPos = new THREE.Vector3();
  xrCam.getWorldPosition(camPos);

  // Align horizontally: move model so its center X/Z lines up with headset X/Z
  const deltaXZ = new THREE.Vector3(camPos.x - modelCenter.x, 0, camPos.z - modelCenter.z);
  model.position.add(deltaXZ);

  // Optionally align vertically so the user's eye sits on the model 'floor' (not under it)
  if (options.standOnFloor) {
    // Recompute box (world) after horizontal move
    box = new THREE.Box3().setFromObject(model);
    const modelFloorY = box.min.y; // world-space floor after current position
    const desiredEyeY = camPos.y; // headset world Y
    const eyeHeight = options.eyeHeight ?? 1.6;
    // We want the model floor to be at desiredEyeY - eyeHeight
    const targetFloorY = desiredEyeY - eyeHeight;
    const deltaY = targetFloorY - modelFloorY;
    model.position.y += deltaY;
  } else if (!options.preserveY) {
    // if not preserving Y and not standing on floor, center vertically on the headset
    const deltaY = camPos.y - modelCenter.y;
    model.position.y += deltaY;
  }

  // keep model upright and facing the user horizontally
  model.lookAt(camPos.x, model.position.y, camPos.z);
}

// Attach handlers for XR session start/end
renderer.xr.addEventListener('sessionstart', () => {
  // Defer model placement until we have a valid XR pose (run on next XR frame)
  pendingPositionOnXRStart = true;
  // optionally disable orbit controls while in VR
  controls.enabled = false;
  // Make model materials double-sided so interiors are visible when viewing from inside.
  if (loadedModel) {
    loadedModel.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        // store original side so we can restore it later
        if (obj.material.side !== undefined && obj.userData._origSide === undefined) {
          obj.userData._origSide = obj.material.side;
        }
        obj.material.side = THREE.DoubleSide;
        obj.material.needsUpdate = true;
      }
    });
  }
  // hide the ground so it doesn't clip into interior views
  if (ground) ground.visible = false;
  // hide on-screen UI and hint when entering VR
  try {
    if (ctrlUi) ctrlUi.style.display = 'none';
    if (hint) hint.style.display = 'none';
  } catch (e) {}
});
renderer.xr.addEventListener('sessionend', () => {
  // re-enable orbit controls when exiting VR
  controls.enabled = true;
  // restore original material side and visibility
  if (loadedModel) {
    loadedModel.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.userData._origSide !== undefined) {
        obj.material.side = obj.userData._origSide;
        delete obj.userData._origSide;
        obj.material.needsUpdate = true;
      }
    });
  }
  if (ground) ground.visible = true;
  // restore UI/hint
  try {
    if (ctrlUi) ctrlUi.style.display = '';
    if (hint) hint.style.display = '';
  } catch (e) {}
});

// ---------- Helpers ----------
// Axes helper: show world axes (X red, Y green, Z blue)
// Useful for orientation while modeling or when entering VR.
const axes = new THREE.AxesHelper(2.5);
scene.add(axes);

function fitCenterScaleAndFrame(root) {
  // 1) Compute initial bounds
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // 2) Center the model at (0,0,0)
  root.position.sub(center);

  // 3) Scale uniformly so the largest dimension ~= targetSize (bigger view)
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetSize = 3.5; // increase/decrease for bigger/smaller model in view
  const scaleFactor = targetSize / maxDim;
  root.scale.setScalar(scaleFactor);

  // 4) Place on ground (y = 0)
  const boxAfter = new THREE.Box3().setFromObject(root);
  const minY = boxAfter.min.y;
  root.position.y -= minY;

  // 5) Face the camera (flip 180° around Y). If not correct, try Math.PI / 2.
  // Do not force a 180° flip; allow the model's native orientation.
  // If you need to flip it manually, use the UI 'Flip' button (adds Math.PI around Y).
  // root.rotation.y = Math.PI;

  // 6) Recalculate bounds and frame the model using FOV
  const fitted = new THREE.Box3().setFromObject(root);
  const fittedSize = new THREE.Vector3();
  const fittedCenter = new THREE.Vector3();
  fitted.getSize(fittedSize);
  fitted.getCenter(fittedCenter);

  const fov = THREE.MathUtils.degToRad(camera.fov);
  const halfMax = Math.max(fittedSize.x, fittedSize.y, fittedSize.z) * 0.5;
  const dist = halfMax / Math.tan(fov / 2);

  // Camera direction: forward with slight upward tilt
  const dir = new THREE.Vector3(0, 0.35, 1).normalize();
  const offset = dist * 1.1; // small margin
  const camPos = new THREE.Vector3().copy(fittedCenter).addScaledVector(dir, offset);

  camera.position.copy(camPos);
  camera.near = 0.01;
  camera.far = Math.max(200, dist * 10);
  camera.updateProjectionMatrix();

  // Focus controls on the model center (lift a bit on Y for nicer orbit)
  controls.target.copy(new THREE.Vector3(fittedCenter.x, Math.max(fittedCenter.y, 0.8), fittedCenter.z));
  controls.update();
}

// ---------- Resize ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- XR & Render loop ----------
// Basic VR controller visuals and events (small, safe stub)
// controller1/2 and grips are created in initVR()

// simple visual for controllers so you can see hands in VR
const controllerGeom = new THREE.BoxGeometry(0.03, 0.03, 0.1);
const controllerMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x002200 });
const ctrlMesh1 = new THREE.Mesh(controllerGeom, controllerMat);
ctrlMesh1.position.z = -0.05;
controller1.add(ctrlMesh1);
const ctrlMesh2 = new THREE.Mesh(controllerGeom, controllerMat.clone());
ctrlMesh2.position.z = -0.05;
controller2.add(ctrlMesh2);

// Interaction / grabbing code (based on three.js webxr_xr_dragging example)
function getIntersections(controller) {
  if (!raycaster) return [];

  // Prefer the built-in XR helper if available (three.js r136+)
  if (typeof raycaster.setFromXRController === 'function') {
    controller.updateMatrixWorld();
    raycaster.setFromXRController(controller);
    return raycaster.intersectObjects(group.children, true);
  }

  // Fallback for older three.js versions: compute ray from controller matrix
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects(group.children, true);
}

function intersectObjects(controller) {
  // Do not highlight in mobile-ar
  if (!controller) return;
  if (controller.userData && controller.userData.targetRayMode === 'screen') return;

  // Do not highlight when already selected
  if (controller.userData && controller.userData.selected !== undefined) return;

  const line = controller.getObjectByName('line');
  const intersections = getIntersections(controller);

  if (intersections.length > 0) {
    const intersection = intersections[0];
    const object = intersection.object;
    if (!excludedNames.includes(object.name)) {
      if (intersected.indexOf(object) === -1) {
        intersected.push(object);
      }
      if (object.material && object.material.emissive) object.material.emissive.r = 1;
    }

    if (line) line.scale.z = intersection.distance;
  } else {
    if (line) line.scale.z = 5;
  }
}

function cleanIntersected() {
  while (intersected.length) {
    const object = intersected.pop();
    if (object.material && object.material.emissive) {
      object.material.emissive.r = 0;
    }
  }
}

function onSelectStart(event) {
  const controller = event.target;
  const intersections = getIntersections(controller);
  if (intersections.length > 0) {
    const object = intersections[0].object;
    // exclude some objects by name if needed (example)
    if (!excludedNames.includes(object.name)) {
      controller.userData.selected = object;
      controller.userData.prevParent = object.parent;
      if (object.material && object.material.emissive) object.material.emissive.b = 1;
      controller.attach(object);
    }
  }
  // store targetRayMode (e.g., 'tracked-pointer' or 'screen') for later logic
  if (event.data && event.data.targetRayMode) controller.userData.targetRayMode = event.data.targetRayMode;

}

function onSelectEnd(event) {
  const controller = event.target;
  if (controller.userData.selected !== undefined) {
    const object = controller.userData.selected;
    if (object.material && object.material.emissive) {
      object.material.emissive.b = 0;
    }
    // restore to previous parent or to group
    // Use attach() to preserve the object's world transform when re-parenting.
    // .add() changes local transform which can make the object appear to jump or disappear.
    if (controller.userData.prevParent) {
      try {
        controller.userData.prevParent.attach(object);
      } catch (e) {
        // if attach fails for some reason, fallback to add()
        controller.userData.prevParent.add(object);
      }
    } else {
      try {
        group.attach(object);
      } catch (e) {
        group.add(object);
      }
    }
    controller.userData.selected = undefined;
    delete controller.userData.prevParent;
  }
}

// Movement state (move the model relative to the camera so the camera stays in place)
const moveState = { forward: false, backward: false, left: false, right: false };
const moveSpeed = 1.5; // meters per second
// VR thumbstick parameters
const vrDeadzone = 0.18; // ignore small thumbstick noise
const vrThumbSpeed = 1.0; // multiplier for thumbstick movement
const clock = new THREE.Clock();

function onKeyDown(e) {
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': moveState.forward = true; break;
    case 'ArrowDown': case 'KeyS': moveState.backward = true; break;
    case 'ArrowLeft': case 'KeyA': moveState.left = true; break;
    case 'ArrowRight': case 'KeyD': moveState.right = true; break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': moveState.forward = false; break;
    case 'ArrowDown': case 'KeyS': moveState.backward = false; break;
    case 'ArrowLeft': case 'KeyA': moveState.left = false; break;
    case 'ArrowRight': case 'KeyD': moveState.right = false; break;
  }
}
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

// Use renderer.setAnimationLoop for WebXR compatibility
renderer.setAnimationLoop(() => {
  // If we just entered an XR session, wait for the first XR frame so camera pose is valid
  if (pendingPositionOnXRStart && renderer.xr.isPresenting) {
    // Smart placement: decide whether to place the model around the user or in front
    try {
      if (!loadedModel) {
        // nothing to place
        pendingPositionOnXRStart = false;
      } else {
        const box = new THREE.Box3().setFromObject(loadedModel);
        if (box.isEmpty()) {
          // fallback: put in front
          positionModelInFrontOfViewer(loadedModel, 1.6);
        } else {
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);

          // If user requested Inside VR but model is very large or very small, prefer in-front placement
          if (vrInsideMode) {
            // Always attempt to position the user inside the model when the
            // "Inside VR" option is enabled. If positioning fails (empty
            // bounds, unexpected transform, or any error), fall back to placing
            // the model in front of the user so the scene remains usable.
            try {
              positionModelInside(loadedModel, { minSize: 1.6, preserveY: false, standOnFloor: true, eyeHeight: 1.6 });
            } catch (e) {
              console.warn('positionModelInside failed, falling back to in-front placement', e);
              const dist = Math.max(1.2, maxDim * 0.6);
              positionModelInFrontOfViewer(loadedModel, dist);
            }
          } else {
            // Not inside mode: place in front, scale distance with model size
            const dist = Math.max(1.2, maxDim * 0.6);
            positionModelInFrontOfViewer(loadedModel, dist);
          }
        }
        pendingPositionOnXRStart = false;
      }
    } catch (e) {
      console.warn('XR placement failed, using simple in-front fallback', e);
      try { positionModelInFrontOfViewer(loadedModel, 1.6); } catch (e2) {}
      pendingPositionOnXRStart = false;
    }
  }

  // check controller intersections and update highlight
  try {
    cleanIntersected();
    if (controller1) intersectObjects(controller1);
    if (controller2) intersectObjects(controller2);
  } catch (e) {
    // ignore if controllers not yet ready
  }

  // apply movement: keyboard (desktop) + VR thumbstick (XR gamepads)
  const delta = clock.getDelta();
  if (loadedModel) {
    // compute camera basis once
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    const camRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camDir).normalize();

    // keyboard input
    const kbMove = new THREE.Vector3();
    if (moveState.forward) kbMove.add(camDir);
    if (moveState.backward) kbMove.addScaledVector(camDir, -1);
    if (moveState.left) kbMove.addScaledVector(camRight, -1);
    if (moveState.right) kbMove.add(camRight);

    // VR thumbstick input: read XR session gamepads
    const vrMove = new THREE.Vector3();
    try {
      if (renderer.xr.isPresenting && renderer.xr.getSession) {
        const session = renderer.xr.getSession();
        if (session && session.inputSources) {
          let totalX = 0;
          let totalY = 0;
          for (const src of session.inputSources) {
            if (!src.gamepad) continue;
            const gp = src.gamepad;
            // prefer second stick pair if present (axes[2], axes[3]), else fallback to axes[0],axes[1]
            const axX = (gp.axes.length >= 4 ? gp.axes[2] : (gp.axes.length >= 2 ? gp.axes[0] : 0));
            const axY = (gp.axes.length >= 4 ? gp.axes[3] : (gp.axes.length >= 2 ? gp.axes[1] : 0));
            // apply deadzone
            const dx = Math.abs(axX) > vrDeadzone ? axX : 0;
            const dy = Math.abs(axY) > vrDeadzone ? axY : 0;
            totalX += dx;
            totalY += dy;
          }
          // accumulate into vrMove vector (forward is -Y on many controllers so invert Y as needed)
          if (Math.abs(totalX) > 0 || Math.abs(totalY) > 0) {
            // forward component should use negative Y (thumb forward is typically negative)
            vrMove.addScaledVector(camDir, -totalY * vrThumbSpeed);
            vrMove.addScaledVector(camRight, totalX * vrThumbSpeed);
          }
        }
      }
    } catch (e) {
      // ignore XR gamepad read failures
    }

    // combine keyboard + vr inputs
    const moveVec = new THREE.Vector3();
    moveVec.add(kbMove).add(vrMove);
    if (moveVec.lengthSq() > 0.0001) {
      moveVec.normalize();
      loadedModel.position.addScaledVector(moveVec, -moveSpeed * delta);
    }
  }

  controls.update();
  // Update XR pose readout if presenting
  try {
    if (renderer.xr.isPresenting && typeof xrPosSpan !== 'undefined' && xrPosSpan) {
      const xrCam = renderer.xr.getCamera();
      const wpos = new THREE.Vector3();
      const wquat = new THREE.Quaternion();
      xrCam.getWorldPosition(wpos);
      xrCam.getWorldQuaternion(wquat);
      const weuler = new THREE.Euler().setFromQuaternion(wquat, 'YXZ');
      xrPosSpan.textContent = `${wpos.x.toFixed(2)}, ${wpos.y.toFixed(2)}, ${wpos.z.toFixed(2)}`;
      xrRotSpan.textContent = `${THREE.MathUtils.radToDeg(weuler.x).toFixed(1)}, ${THREE.MathUtils.radToDeg(weuler.y).toFixed(1)}, ${THREE.MathUtils.radToDeg(weuler.z).toFixed(1)}`;
    }
  } catch (e) {
    // ignore
  }

  renderer.render(scene, camera);
});
