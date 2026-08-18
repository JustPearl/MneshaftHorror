import * as THREE from "three";
import { makeRockTexture, makeTimberTexture, makeDirtTexture, makeMetalTexture, makeGlowTexture } from "./textures";

export const CELL = 4;
export const WALL_H = 3.6;

export interface Pickup {
  mesh: THREE.Object3D;
  kind: "shell" | "tonic";
  taken: boolean;
}

export interface LevelData {
  group: THREE.Group;
  grid: Uint8Array; // 1 = floor, 0 = wall
  W: number;
  H: number;
  spawn: THREE.Vector3;
  cageCell: { cx: number; cz: number };
  cagePos: THREE.Vector3;
  cageLamp: THREE.MeshStandardMaterial;
  cageLight: THREE.PointLight;
  cageGate: THREE.Mesh;
  lanternSprites: THREE.Sprite[];
  lanternMats: THREE.MeshBasicMaterial[];
  pickups: Pickup[];
  explored: Uint8Array;
  railCells: { cx: number; cz: number; dir: "ew" | "ns" }[];
}

function hash2(cx: number, cz: number, seed: number): number {
  let h = (cx * 374761393 + cz * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

export function cellCenter(cx: number, cz: number, W: number, H: number): [number, number] {
  return [(cx - W / 2) * CELL, (cz - H / 2) * CELL];
}

export function worldToCell(x: number, z: number, W: number, H: number): [number, number] {
  return [Math.floor(x / CELL + W / 2), Math.floor(z / CELL + H / 2)];
}

function generateMaze(W: number, H: number, rng: () => number): Uint8Array {
  const g = new Uint8Array(W * H);
  const stack: [number, number][] = [[1, 1]];
  g[1 * W + 1] = 1;
  const dirs: [number, number][] = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const options = dirs
      .map(([dx, dz]) => [cx + dx, cz + dz, cx + dx / 2, cz + dz / 2] as const)
      .filter(([nx, nz]) => nx > 0 && nz > 0 && nx < W - 1 && nz < H - 1 && g[nz * W + nx] === 0);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, mx, mz] = options[Math.floor(rng() * options.length)];
    g[nz * W + nx] = 1;
    g[mz * W + mx] = 1;
    stack.push([nx, nz]);
  }
  // knock a few extra openings for loops (less trap-corridor feel)
  for (let cz = 1; cz < H - 1; cz++)
    for (let cx = 1; cx < W - 1; cx++) {
      if (g[cz * W + cx] === 0 && cx % 2 === 0 && cz % 2 === 1 && hash2(cx, cz, 99) < 0.14) g[cz * W + cx] = 1;
      if (g[cz * W + cx] === 0 && cz % 2 === 0 && cx % 2 === 1 && hash2(cx, cz, 77) < 0.14) g[cz * W + cx] = 1;
    }
  return g;
}

function bfsDistances(g: Uint8Array, W: number, H: number, sx: number, sz: number): Int16Array {
  const dist = new Int16Array(W * H).fill(-1);
  const q: [number, number][] = [[sx, sz]];
  dist[sz * W + sx] = 0;
  let head = 0;
  while (head < q.length) {
    const [cx, cz] = q[head++];
    const d = dist[cz * W + cx];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx,
        nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (g[nz * W + nx] === 1 && dist[nz * W + nx] === -1) {
        dist[nz * W + nx] = d + 1;
        q.push([nx, nz]);
      }
    }
  }
  return dist;
}

export function buildLevel(depth: number): LevelData {
  const seed = depth * 7 + 13;
  let s = seed;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };

  const W = 23,
    H = 23;
  const grid = generateMaze(W, H, rng);
  const group = new THREE.Group();

  const rockTex = makeRockTexture();
  const timberTex = makeTimberTexture();
  const dirtTex = makeDirtTexture();
  const metalTex = makeMetalTexture();
  const glowTex = makeGlowTexture();

  const rockMat = new THREE.MeshLambertMaterial({ map: rockTex });
  const timberMat = new THREE.MeshLambertMaterial({ map: timberTex });
  const dirtMat = new THREE.MeshLambertMaterial({ map: dirtTex });
  const metalMat = new THREE.MeshLambertMaterial({ map: metalTex });
  const ceilMat = new THREE.MeshLambertMaterial({ map: rockTex, color: 0x8f8f8f });

  const floorCells: [number, number][] = [];
  const wallCells: [number, number][] = [];
  for (let cz = 0; cz < H; cz++)
    for (let cx = 0; cx < W; cx++) (grid[cz * W + cx] === 1 ? floorCells : wallCells).push([cx, cz]);

  const dummy = new THREE.Object3D();

  // --- walls ---
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H + 0.6, CELL);
  const walls = new THREE.InstancedMesh(wallGeo, rockMat, wallCells.length);
  wallCells.forEach(([cx, cz], i) => {
    const [x, z] = cellCenter(cx, cz, W, H);
    dummy.position.set(x, (WALL_H + 0.6) / 2 - 0.1, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
  });
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  // --- floors & ceilings ---
  const planeGeo = new THREE.PlaneGeometry(CELL, CELL);
  const floors = new THREE.InstancedMesh(planeGeo, dirtMat, floorCells.length);
  const ceils = new THREE.InstancedMesh(planeGeo, ceilMat, floorCells.length);
  floorCells.forEach(([cx, cz], i) => {
    const [x, z] = cellCenter(cx, cz, W, H);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(1);
    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    floors.setMatrixAt(i, dummy.matrix);
    dummy.rotation.set(Math.PI / 2, 0, hash2(cx, cz, 5) * Math.PI * 2);
    dummy.position.set(x, WALL_H, z);
    dummy.updateMatrix();
    ceils.setMatrixAt(i, dummy.matrix);
  });
  floors.instanceMatrix.needsUpdate = true;
  ceils.instanceMatrix.needsUpdate = true;
  group.add(floors, ceils);

  // --- timber supports ---
  const postGeo = new THREE.BoxGeometry(0.3, WALL_H, 0.3);
  const lintelGeo = new THREE.BoxGeometry(CELL + 0.4, 0.32, 0.34);
  const supportCells = floorCells.filter(([cx, cz]) => hash2(cx, cz, seed) < 0.3);
  const posts = new THREE.InstancedMesh(postGeo, timberMat, supportCells.length * 2);
  const lintels = new THREE.InstancedMesh(lintelGeo, timberMat, supportCells.length);
  supportCells.forEach(([cx, cz], i) => {
    const [x, z] = cellCenter(cx, cz, W, H);
    const ew = grid[cz * W + cx + 1] === 1 || grid[cz * W + cx - 1] === 1;
    const off = ew ? CELL / 2 - 0.35 : 0;
    const offz = ew ? 0 : CELL / 2 - 0.35;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.position.set(x - off, WALL_H / 2, z - offz);
    dummy.updateMatrix();
    posts.setMatrixAt(i * 2, dummy.matrix);
    dummy.position.set(x + off, WALL_H / 2, z + offz);
    dummy.updateMatrix();
    posts.setMatrixAt(i * 2 + 1, dummy.matrix);
    dummy.position.set(x, WALL_H - 0.22, z);
    dummy.rotation.set(0, ew ? 0 : Math.PI / 2, 0);
    dummy.updateMatrix();
    lintels.setMatrixAt(i, dummy.matrix);
  });
  posts.instanceMatrix.needsUpdate = true;
  lintels.instanceMatrix.needsUpdate = true;
  group.add(posts, lintels);

  // --- rails ---
  const railGeo = new THREE.BoxGeometry(0.14, 0.12, CELL + 0.2);
  const railCells: LevelData["railCells"] = [];
  for (const [cx, cz] of floorCells) {
    const ewOpen = grid[cz * W + cx + 1] === 1 && grid[cz * W + cx - 1] === 1;
    const nsOpen = grid[(cz + 1) * W + cx] === 1 && grid[(cz - 1) * W + cx] === 1;
    let dir: "ew" | "ns" | null = null;
    if (ewOpen && hash2(cx, cz, seed + 1) < 0.55) dir = "ew";
    else if (nsOpen && hash2(cx, cz, seed + 2) < 0.55) dir = "ns";
    else if (ewOpen && !nsOpen && hash2(cx, cz, seed + 3) < 0.4) dir = "ew";
    if (dir) railCells.push({ cx, cz, dir });
  }
  const rails = new THREE.InstancedMesh(railGeo, metalMat, railCells.length * 2);
  railCells.forEach((rc, i) => {
    const [x, z] = cellCenter(rc.cx, rc.cz, W, H);
    dummy.rotation.set(0, rc.dir === "ew" ? Math.PI / 2 : 0, 0);
    dummy.scale.setScalar(1);
    const off = 0.62;
    if (rc.dir === "ew") {
      dummy.position.set(x, 0.07, z - off);
      dummy.updateMatrix();
      rails.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(x, 0.07, z + off);
    } else {
      dummy.position.set(x - off, 0.07, z);
      dummy.updateMatrix();
      rails.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(x + off, 0.07, z);
    }
    dummy.updateMatrix();
    rails.setMatrixAt(i * 2 + 1, dummy.matrix);
  });
  rails.instanceMatrix.needsUpdate = true;
  group.add(rails);

  // --- lanterns ---
  const lanternSprites: THREE.Sprite[] = [];
  const lanternMats: THREE.MeshBasicMaterial[] = [];
  const lanternBodyGeo = new THREE.BoxGeometry(0.18, 0.26, 0.18);
  const spriteMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc070, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const lanternCells = floorCells.filter(([cx, cz]) => hash2(cx, cz, seed + 11) < 0.085);
  for (const [cx, cz] of lanternCells) {
    const [x, z] = cellCenter(cx, cz, W, H);
    // hang beside a wall face if any
    let ox = 0,
      oz = 0;
    if (grid[cz * W + cx + 1] === 0) ox = CELL / 2 - 0.45;
    else if (grid[cz * W + cx - 1] === 0) ox = -CELL / 2 + 0.45;
    else if (grid[(cz + 1) * W + cx] === 0) oz = CELL / 2 - 0.45;
    else oz = -CELL / 2 + 0.45;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    lanternMats.push(mat);
    const body = new THREE.Mesh(lanternBodyGeo, mat);
    body.position.set(x + ox, 2.55, z + oz);
    group.add(body);
    const sp = new THREE.Sprite(spriteMat.clone());
    sp.position.copy(body.position);
    sp.scale.setScalar(1.7);
    (sp.material as THREE.SpriteMaterial).rotation = Math.random() * 6;
    lanternSprites.push(sp);
    group.add(sp);
    // hook
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), metalMat);
    hook.position.set(x + ox, 2.95, z + oz);
    group.add(hook);
  }

  // --- props: barrels, crates, bones, minecart ---
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.95, 7);
  const crateGeo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
  const boneGeo = new THREE.BoxGeometry(0.4, 0.09, 0.09);
  const boneMat = new THREE.MeshLambertMaterial({ color: 0xb9a98a });
  const propCells = floorCells.filter(
    ([cx, cz]) => !(cx === 1 && cz === 1) && hash2(cx, cz, seed + 21) < 0.12 && !railCells.some((r) => r.cx === cx && r.cz === cz)
  );
  propCells.forEach(([cx, cz], i) => {
    const [x, z] = cellCenter(cx, cz, W, H);
    const r = hash2(cx, cz, seed + 31);
    const jx = (hash2(cx, cz, seed + 41) - 0.5) * 1.4;
    const jz = (hash2(cx, cz, seed + 51) - 0.5) * 1.4;
    if (r < 0.4) {
      const b = new THREE.Mesh(barrelGeo, metalMat);
      b.position.set(x + jx, 0.48, z + jz);
      b.rotation.y = r * 9;
      group.add(b);
    } else if (r < 0.75) {
      const c = new THREE.Mesh(crateGeo, timberMat);
      c.position.set(x + jx, 0.48, z + jz);
      c.rotation.y = r * 5;
      group.add(c);
    } else {
      for (let k = 0; k < 4; k++) {
        const bone = new THREE.Mesh(boneGeo, boneMat);
        bone.position.set(x + jx + (hash2(k, i, 3) - 0.5) * 0.8, 0.05, z + jz + (hash2(i, k, 7) - 0.5) * 0.8);
        bone.rotation.y = hash2(k, i, 11) * 3;
        group.add(bone);
      }
    }
  });

  // minecart on a rail cell
  if (railCells.length) {
    const rc = railCells[Math.floor(rng() * railCells.length)];
    const [x, z] = cellCenter(rc.cx, rc.cz, W, H);
    const cart = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 2.3), metalMat);
    tub.position.y = 0.62;
    cart.add(tub);
    const coal = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 2.0), new THREE.MeshLambertMaterial({ color: 0x0c0a0c }));
    coal.position.y = 1.0;
    cart.add(coal);
    const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 6);
    for (const [wx, wz] of [
      [-0.7, -0.8],
      [0.7, -0.8],
      [-0.7, 0.8],
      [0.7, 0.8],
    ] as const) {
      const w = new THREE.Mesh(wheelGeo, new THREE.MeshLambertMaterial({ color: 0x22252a }));
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.24, wz);
      cart.add(w);
    }
    cart.position.set(x, 0, z);
    cart.rotation.y = rc.dir === "ew" ? Math.PI / 2 : 0;
    group.add(cart);
  }

  // --- spawn & cage ---
  const [sx, sz] = cellCenter(1, 1, W, H);
  const spawn = new THREE.Vector3(sx, 0, sz);
  const dist = bfsDistances(grid, W, H, 1, 1);
  let best: [number, number] = [W - 2, H - 2];
  let bestD = -1;
  for (let cz = 1; cz < H - 1; cz++)
    for (let cx = 1; cx < W - 1; cx++) {
      const d = dist[cz * W + cx];
      if (d > bestD && !(cx === 1 && cz === 1)) {
        bestD = d;
        best = [cx, cz];
      }
    }
  const [ccx, ccz] = best;
  const [cwx, cwz] = cellCenter(ccx, ccz, W, H);
  const cagePos = new THREE.Vector3(cwx, 0, cwz);

  // cage construction
  const cage = new THREE.Group();
  const postG = new THREE.BoxGeometry(0.18, 3.4, 0.18);
  for (const [px, pz] of [
    [-1.5, -1.5],
    [1.5, -1.5],
    [-1.5, 1.5],
    [1.5, 1.5],
  ] as const) {
    const p = new THREE.Mesh(postG, metalMat);
    p.position.set(px, 1.7, pz);
    cage.add(p);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.16, 3.3), metalMat);
  roof.position.y = 3.32;
  cage.add(roof);
  // bars on three sides
  const barG = new THREE.BoxGeometry(0.07, 3.2, 0.07);
  for (let i = -1; i <= 1; i++) {
    for (const side of [
      { x: -1.5, z: i * 0.75 },
      { x: 1.5, z: i * 0.75 },
      { x: i * 0.75, z: -1.5 },
    ]) {
      const bar = new THREE.Mesh(barG, metalMat);
      bar.position.set(side.x, 1.6, side.z);
      cage.add(bar);
    }
  }
  // front gate (faces the corridor toward spawn)
  const gateMat = new THREE.MeshLambertMaterial({ map: metalTex, color: 0x9a9a9a });
  const gate = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.1, 0.1), gateMat);
  gate.position.set(0, 1.6, 1.5);
  gate.visible = true;
  cage.add(gate);
  // lamp above cage
  const cageLamp = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x550000, emissiveIntensity: 0.6 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), cageLamp);
  lamp.position.y = 3.6;
  cage.add(lamp);
  const cageLight = new THREE.PointLight(0xff2200, 0, 14, 1.6);
  cageLight.position.y = 3.2;
  cage.add(cageLight);
  const cageGlow = new THREE.Sprite(spriteMat.clone());
  cageGlow.scale.setScalar(2.4);
  cageGlow.position.y = 3.6;
  (cageGlow.material as THREE.SpriteMaterial).color = new THREE.Color(0xff5533);
  cage.add(cageGlow);
  cage.position.copy(cagePos);
  group.add(cage);

  // --- pickups (dead ends) ---
  const pickups: Pickup[] = [];
  const deadEnds = floorCells.filter(([cx, cz]) => {
    if (cx === 1 && cz === 1) return false;
    if (cx === ccx && cz === ccz) return false;
    let walls = 0;
    if (grid[cz * W + cx + 1] === 0) walls++;
    if (grid[cz * W + cx - 1] === 0) walls++;
    if (grid[(cz + 1) * W + cx] === 0) walls++;
    if (grid[(cz - 1) * W + cx] === 0) walls++;
    return walls >= 3;
  });
  const shellGeo = new THREE.BoxGeometry(0.5, 0.22, 0.36);
  const shellMat = new THREE.MeshLambertMaterial({ color: 0x8a5a24 });
  const brassTop = new THREE.MeshLambertMaterial({ color: 0xd8a24a, emissive: 0x553300, emissiveIntensity: 0.5 });
  const tonicGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.36, 6);
  const tonicMat = new THREE.MeshLambertMaterial({ color: 0x2c7a46, emissive: 0x0a4422, emissiveIntensity: 0.9 });
  const shuffled = deadEnds.sort(() => rng() - 0.5);
  const nShells = Math.min(9, Math.ceil(shuffled.length * 0.62));
  shuffled.forEach(([cx, cz], i) => {
    const [x, z] = cellCenter(cx, cz, W, H);
    const isShell = i < nShells;
    const m = new THREE.Group();
    if (isShell) {
      const box = new THREE.Mesh(shellGeo, shellMat);
      box.position.y = 0.11;
      m.add(box);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.36), brassTop);
      top.position.y = 0.24;
      m.add(top);
    } else {
      const flask = new THREE.Mesh(tonicGeo, tonicMat);
      flask.position.y = 0.18;
      m.add(flask);
      const glow = new THREE.Sprite(spriteMat.clone());
      glow.scale.setScalar(0.8);
      glow.position.y = 0.3;
      (glow.material as THREE.SpriteMaterial).color = new THREE.Color(0x55ff99);
      m.add(glow);
    }
    m.position.set(x + (rng() - 0.5) * 1.2, 0, z + (rng() - 0.5) * 1.2);
    group.add(m);
    pickups.push({ mesh: m, kind: isShell ? "shell" : "tonic", taken: false });
  });

  const explored = new Uint8Array(W * H);
  explored[1 * W + 1] = 1;

  return {
    group,
    grid,
    W,
    H,
    spawn,
    cageCell: { cx: ccx, cz: ccz },
    cagePos,
    cageLamp,
    cageLight,
    cageGate: gate,
    lanternSprites,
    lanternMats,
    pickups,
    explored,
    railCells,
  };
}

export function disposeLevel(level: LevelData) {
  level.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
