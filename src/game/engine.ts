import * as THREE from "three";
import { AudioEngine } from "./audio";
import { buildLevel, disposeLevel, worldToCell, CELL } from "./maze";
import type { LevelData } from "./maze";
import { buildEnemy, enemyStats } from "./enemy";
import type { EnemyRig, EnemyType } from "./enemy";
import { makeGlowTexture } from "./textures";

/* ------------------------------------------------------------------ */
/*  Public contract                                                    */
/* ------------------------------------------------------------------ */

export type Screen = "menu" | "playing" | "paused" | "dead";

export interface HudData {
  hp: number;
  shells: number;
  tube: number;
  reserve: number;
  score: number;
  kills: number;
  depth: number;
  depthFt: number;
  remaining: number;
  cageOpen: boolean;
  nearCage: boolean;
  time: number;
  reloading: boolean;
  fade: number;
  spread: number;
}

export interface RunStats {
  score: number;
  kills: number;
  depth: number;
  shots: number;
  hits: number;
  time: number;
}

export interface EngineCallbacks {
  onScreen: (s: Screen) => void;
  onHud: (h: HudData) => void;
  onMessage: (main: string, sub?: string) => void;
  onBanner: (title: string, sub: string) => void;
  onDamage: () => void;
  onShot: () => void;
  onHit: (kill: boolean) => void;
  onPickup: (kind: "shell" | "tonic", amount: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const VIEW_W = 854;
export const VIEW_H = 480;

const EYE = 1.62;
const PLAYER_R = 0.42;
const TUBE = 6;
const GRAV = 9.4;

/* PS2 vertex snapping — inject into any material that uses project_vertex */
function ps2ify(mat: THREE.Material) {
  const m = mat as THREE.MeshLambertMaterial;
  if ((m as any).__ps2) return;
  (m as any).__ps2 = true;
  m.onBeforeCompile = (shader) => {
    if (!shader.vertexShader.includes("#include <project_vertex>")) return;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      vec2 ps2g = vec2(213.0, 120.0);
      gl_Position.xy = floor(gl_Position.xy * ps2g / gl_Position.w + 0.5) / ps2g * gl_Position.w;
      `
    );
  };
}

/* ------------------------------------------------------------------ */
/*  Particle pool (chunky square points — very PS2)                    */
/* ------------------------------------------------------------------ */

class ParticlePool {
  max: number;
  pos: Float32Array;
  col: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  gravF: Float32Array;
  baseCol: Float32Array;
  points: THREE.Points;
  cursor = 0;

  constructor(max: number, size: number, additive: boolean, map: THREE.Texture | null) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravF = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: additive ? 0.95 : 1,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      map: map ?? undefined,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  burst(p: THREE.Vector3, hex: number, n: number, speed: number, up: number, grav: number, lifeS = 0.6) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const j = i * 3;
      this.pos[j] = p.x + (Math.random() - 0.5) * 0.15;
      this.pos[j + 1] = p.y + (Math.random() - 0.5) * 0.15;
      this.pos[j + 2] = p.z + (Math.random() - 0.5) * 0.15;
      this.vel[j] = (Math.random() - 0.5) * speed;
      this.vel[j + 1] = Math.random() * up;
      this.vel[j + 2] = (Math.random() - 0.5) * speed;
      const vary = 0.75 + Math.random() * 0.5;
      this.baseCol[j] = c.r * vary;
      this.baseCol[j + 1] = c.g * vary;
      this.baseCol[j + 2] = c.b * vary;
      this.col[j] = this.baseCol[j];
      this.col[j + 1] = this.baseCol[j + 1];
      this.col[j + 2] = this.baseCol[j + 2];
      this.life[i] = this.maxLife[i] = lifeS * (0.6 + Math.random() * 0.7);
      this.gravF[i] = grav;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      this.vel[j + 1] -= this.gravF[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.03 && this.vel[j + 1] < 0) {
        this.pos[j + 1] = 0.03;
        this.vel[j + 1] *= -0.35;
        this.vel[j] *= 0.7;
        this.vel[j + 2] *= 0.7;
      }
      const f = Math.min(1, this.life[i] / (this.maxLife[i] * 0.5));
      this.col[j] = this.baseCol[j] * f;
      this.col[j + 1] = this.baseCol[j + 1] * f;
      this.col[j + 2] = this.baseCol[j + 2] * f;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/*  Enemies                                                            */
/* ------------------------------------------------------------------ */

type EnemyState = "rise" | "roam" | "chase" | "windup" | "recover" | "stagger" | "dying";

interface ActiveEnemy {
  rig: EnemyRig;
  type: EnemyType;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  score: number;
  state: EnemyState;
  t: number;
  attackCd: number;
  growlCd: number;
  seed: number;
  alerted: boolean;
  flash: number;
  waypoint: THREE.Vector3;
  wpT: number;
  stuckT: number;
  strafe: number;
  knock: THREE.Vector3;
}

/* ------------------------------------------------------------------ */
/*  The engine                                                         */
/* ------------------------------------------------------------------ */

export class MineEngine {
  private canvas: HTMLCanvasElement;
  private cb: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private audio = new AudioEngine();
  private level!: LevelData;
  private openCells: THREE.Vector3[] = [];

  private screen: Screen = "menu";
  private pendingPlay = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;

  /* player */
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private pitchKick = 0;
  private hp = 100;
  private bobPhase = 0;
  private stepAcc = 0;
  private shake = 0;
  private dyingT = -1;
  private heartbeatT = 0;
  private lowHpWarned = false;

  /* weapon */
  private gun!: THREE.Group;
  private pump!: THREE.Mesh;
  private muzzleSprite!: THREE.Sprite;
  private muzzleLight!: THREE.PointLight;
  private spot!: THREE.SpotLight;
  private lanternLight!: THREE.PointLight;
  private shells = TUBE;
  private reserve = 18;
  private cooldown = 0;
  private recoil = 0;
  private pumpT = -1;
  private reloading = false;
  private reloadT = 0;
  private heat = 0;
  private muzzleT = 0;
  private gunSwayX = 0;
  private gunSwayY = 0;

  /* run state */
  private runId = 0;
  private runT = 0;
  private score = 0;
  private kills = 0;
  private shots = 0;
  private hitShots = 0;
  private depth = 1;
  private floorTotal = 0;
  private floorKilled = 0;
  private floorSpawned = 0;
  private spawnT = 2.5;
  private cageOpen = false;
  private rideT = -1;
  private rideSwitched = false;
  private ambientT = 14;
  private hudT = 0;
  private fade = 0;

  private enemies: ActiveEnemy[] = [];
  private blood!: ParticlePool;
  private fx!: ParticlePool;
  private casings: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private casingGeo = new THREE.BoxGeometry(0.05, 0.05, 0.14);
  private casingMat = new THREE.MeshLambertMaterial({ color: 0xc8963c });

  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(VIEW_W, VIEW_H, false);
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040302);
    this.scene.fog = new THREE.FogExp2(0x040302, 0.052);

    this.camera = new THREE.PerspectiveCamera(74, VIEW_W / VIEW_H, 0.05, 70);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    /* lights */
    const hemi = new THREE.HemisphereLight(0x35281c, 0x060403, 0.6);
    this.scene.add(hemi);
    this.spot = new THREE.SpotLight(0xffc078, 120, 30, 0.62, 0.55, 1.8);
    this.spot.position.set(0, 0.1, 0);
    this.spot.target.position.set(0, -0.12, -6);
    this.camera.add(this.spot, this.spot.target);
    this.lanternLight = new THREE.PointLight(0xff9538, 10, 9, 2);
    this.lanternLight.position.set(0.1, -0.15, 0.1);
    this.camera.add(this.lanternLight);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 15, 2);
    this.muzzleLight.position.set(0.36, -0.24, -1.3);
    this.camera.add(this.muzzleLight);

    const glow = makeGlowTexture();
    this.muzzleSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.muzzleSprite.scale.setScalar(0.001);
    this.muzzleSprite.position.set(0, 0.05, -1.18);

    this.blood = new ParticlePool(420, 0.1, false, null);
    this.fx = new ParticlePool(320, 0.17, true, glow);
    this.scene.add(this.blood.points, this.fx.points);

    this.buildGun();
    this.loadFloor(1, true);
    this.setScreen("menu");

    /* input */
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("blur", this.onBlur);

    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  /* ---------------- view model ---------------- */

  private buildGun() {
    const g = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: 0x24262c, flatShading: true });
    const steelDark = new THREE.MeshLambertMaterial({ color: 0x17181d, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: 0x5a3a1c, flatShading: true });
    const brass = new THREE.MeshLambertMaterial({ color: 0xc8963c, emissive: 0x3a2405, flatShading: true });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.52), steel);
    receiver.position.set(0, 0, 0);
    g.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.82, 7), steelDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.55);
    g.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 7), steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.025, -0.46);
    g.add(tube);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.115, 0.035), brass);
    band.position.set(0, 0.01, -0.2);
    g.add(band);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.018), brass);
    sight.position.set(0, 0.1, -0.92);
    g.add(sight);
    this.pump = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.085, 0.18), wood);
    this.pump.position.set(0, -0.03, -0.36);
    g.add(this.pump);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.16, 0.34), wood);
    stock.position.set(0, -0.07, 0.34);
    stock.rotation.x = 0.12;
    g.add(stock);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.09), wood);
    grip.position.set(0, -0.11, 0.12);
    grip.rotation.x = -0.35;
    g.add(grip);
    g.add(this.muzzleSprite);

    g.position.set(0.36, -0.34, -0.62);
    g.rotation.set(0, 0.02, 0);
    this.gun = g;
    this.camera.add(g);
    this.camera.add(this.muzzleLight);
  }

  /* ---------------- floor lifecycle ---------------- */

  private depthFt(d: number) {
    return 118 + (d - 1) * 86;
  }

  private loadFloor(depth: number, silent = false) {
    if (this.level) {
      this.level.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
        mats.forEach((mm) => {
          const withMap = mm as THREE.MeshLambertMaterial;
          if (withMap.map) withMap.map.dispose();
        });
      });
      this.scene.remove(this.level.group);
      disposeLevel(this.level);
    }
    for (const e of this.enemies) this.scene.remove(e.rig.root);
    this.enemies = [];

    this.depth = depth;
    this.level = buildLevel(depth + this.runId * 97);
    this.scene.add(this.level.group);

    /* PS2 vertex jitter on everything solid */
    this.level.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach(ps2ify);
      }
    });

    /* collect open cells */
    this.openCells = [];
    const { grid, W, H } = this.level;
    for (let cz = 1; cz < H - 1; cz++)
      for (let cx = 1; cx < W - 1; cx++)
        if (grid[cz * W + cx] === 1) {
          this.openCells.push(new THREE.Vector3((cx - W / 2) * CELL, 0, (cz - H / 2) * CELL));
        }

    /* player placement: spawn cell, face the corridor */
    this.pos.copy(this.level.spawn);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    let faceYaw = 0;
    const [scx, scz] = worldToCell(this.pos.x, this.pos.z, W, H);
    for (const [dx, dz] of dirs) {
      if (grid[(scz + dz) * W + (scx + dx)] === 1) {
        faceYaw = Math.atan2(-dx, -dz);
        break;
      }
    }
    this.yaw = faceYaw;
    this.pitch = 0;
    this.roll = 0;
    this.vel.set(0, 0, 0);
    this.dyingT = -1;

    /* floor state */
    this.floorTotal = Math.min(6 + (depth - 1) * 3, 24);
    this.floorKilled = 0;
    this.floorSpawned = 0;
    this.spawnT = 2.2;
    this.cageOpen = false;
    this.level.cageLight.intensity = 0;
    this.level.cageLamp.emissive.setHex(0x550000);
    this.level.cageLamp.emissiveIntensity = 0.6;
    this.level.cageGate.visible = true;

    if (!silent) {
      const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
      this.cb.onBanner(`DEPTH ${roman[Math.min(depth - 1, 11)]}`, `\u2212${this.depthFt(depth)} FT \u2014 ${this.floorTotal} HEADS BELOW`);
      const flavor = [
        "The timber groans. Something answers.",
        "Pick-axes lie where the men dropped them.",
        "The air tastes of iron and old fear.",
        "Scratching. Always just behind you.",
        "The company sealed these seams for a reason.",
        "Your lamp is the only honest thing down here.",
      ];
      this.cb.onMessage(flavor[(depth + this.runId) % flavor.length]);
    }
  }

  private openCage() {
    if (this.cageOpen) return;
    this.cageOpen = true;
    this.level.cageLight.intensity = 26;
    this.level.cageLamp.emissive.setHex(0xff2200);
    this.level.cageLamp.emissiveIntensity = 2.4;
    this.level.cageGate.visible = false;
    this.audio.cageUnlock();
    this.cb.onMessage("THE CAGE GLOWS RED", "Find it. Ride it down. Check the map.");
  }

  /* ---------------- public controls ---------------- */

  startRun() {
    this.audio.unlock();
    this.audio.startAmbience();
    this.runId++;
    this.hp = 100;
    this.score = 0;
    this.kills = 0;
    this.shots = 0;
    this.hitShots = 0;
    this.runT = 0;
    this.shells = TUBE;
    this.reserve = 18;
    this.reloading = false;
    this.cooldown = 0;
    this.heat = 0;
    this.lowHpWarned = false;
    this.fade = 0;
    this.rideT = -1;
    this.keys.clear();
    this.loadFloor(1);
    this.setScreen("playing");
    this.pendingPlay = true;
    this.lockPointer();
  }

  resume() {
    if (this.screen !== "paused") return;
    this.pendingPlay = true;
    this.lockPointer();
  }

  pause() {
    if (this.screen !== "playing") return;
    this.keys.clear();
    this.setScreen("paused");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  surface() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setScreen("menu");
  }

  getStats(): RunStats {
    return { score: this.score, kills: this.kills, depth: this.depth, shots: this.shots, hits: this.hitShots, time: this.runT };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("blur", this.onBlur);
    this.audio.stopAmbience();
    this.renderer.dispose();
  }

  private setScreen(s: Screen) {
    this.screen = s;
    this.cb.onScreen(s);
    this.pushHud();
  }

  private lockPointer() {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => undefined);
    } catch {
      /* pointer lock unsupported — game still renders */
    }
  }

  /* ---------------- input ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight", "KeyR", "KeyE"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (this.screen !== "playing") return;
    if (e.code === "KeyR") this.startReload();
    if (e.code === "KeyE") this.tryRide();
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.screen !== "playing") return;
    this.yaw -= e.movementX * 0.0021;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.movementY * 0.0021));
    this.gunSwayX = Math.max(-0.06, Math.min(0.06, this.gunSwayX - e.movementX * 0.0004));
    this.gunSwayY = Math.max(-0.05, Math.min(0.05, this.gunSwayY - e.movementY * 0.0003));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (this.screen !== "playing") return;
    if (document.pointerLockElement !== this.canvas) {
      /* click re-engages the pointer lock if the browser dropped it */
      this.lockPointer();
      return;
    }
    if (this.rideT >= 0 || this.dyingT >= 0) return;
    this.fire();
  };

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked && this.pendingPlay) {
      this.pendingPlay = false;
      if (this.screen !== "playing") this.setScreen("playing");
    } else if (!locked && this.screen === "playing") {
      this.pause();
    }
  };

  private onBlur = () => {
    if (this.screen === "playing") this.pause();
  };

  /* ---------------- collision ---------------- */

  private solidAt(cx: number, cz: number) {
    const { grid, W, H } = this.level;
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return true;
    return grid[cz * W + cx] === 0;
  }

  private hitSolid(x: number, z: number, r: number) {
    const { W, H } = this.level;
    const minC = worldToCell(x - r, z - r, W, H);
    const maxC = worldToCell(x + r, z + r, W, H);
    for (let cz = minC[1]; cz <= maxC[1]; cz++)
      for (let cx = minC[0]; cx <= maxC[0]; cx++) {
        if (!this.solidAt(cx, cz)) continue;
        const bx = (cx - W / 2) * CELL;
        const bz = (cz - H / 2) * CELL;
        const nx = Math.max(bx - CELL / 2, Math.min(x, bx + CELL / 2));
        const nz = Math.max(bz - CELL / 2, Math.min(z, bz + CELL / 2));
        const dx = x - nx;
        const dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    return false;
  }

  private tryMove(p: THREE.Vector3, dx: number, dz: number, r: number) {
    let blocked = 0;
    if (!this.hitSolid(p.x + dx, p.z, r)) p.x += dx;
    else blocked++;
    if (!this.hitSolid(p.x, p.z + dz, r)) p.z += dz;
    else blocked++;
    return blocked;
  }

  /* ---------------- combat ---------------- */

  private fire() {
    if (this.cooldown > 0) return;
    if (this.shells <= 0) {
      this.audio.dry();
      this.startReload();
      return;
    }
    if (this.reloading) {
      this.reloading = false; /* slam the tube shut and fire */
    }
    this.shells--;
    this.shots++;
    this.cooldown = 0.62;
    this.recoil = 1;
    this.pumpT = 0;
    this.muzzleT = 1;
    this.heat = Math.min(1.6, this.heat + 0.42);
    this.pitchKick += 0.028;
    this.shake = Math.min(1, this.shake + 0.35);
    this.audio.shot();
    this.audio.pump();
    this.cb.onShot();
    this.ejectCasing();

    /* alert everything below */
    for (const e of this.enemies) {
      if (e.state !== "dying") {
        const d = e.rig.root.position.distanceTo(this.pos);
        if (d < 30) e.alerted = true;
      }
    }

    /* pellets */
    const moving = this.vel.length() > 1.2;
    const spread = 0.016 + (moving ? 0.013 : 0) + this.heat * 0.014;
    const origin = this.camera.getWorldPosition(this.tmpV.clone());
    const fwd = this.camera.getWorldDirection(this.tmpV2.clone());
    let anyHit = false;
    const targets: THREE.Object3D[] = [...this.enemies.map((e) => e.rig.root), this.level.group];
    for (let i = 0; i < 7; i++) {
      const dir = fwd
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread))
        .normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = 38;
      const hits = this.raycaster.intersectObjects(targets, true);
      if (!hits.length) continue;
      const h = hits[0];
      const enemy = this.enemyOf(h.object);
      if (enemy) {
        anyHit = true;
        const dist = h.distance;
        const dmg = 14 * Math.max(0.3, Math.min(1, 1.35 - dist / 26));
        this.damageEnemy(enemy, dmg, dir, h.point);
      } else {
        this.fx.burst(h.point, 0x9a7a4a, 4, 2.4, 1.6, 5, 0.4);
        if (Math.random() < 0.4) this.audio.hitStone();
      }
    }
    if (anyHit) {
      this.hitShots++;
      this.audio.hitFlesh();
      this.cb.onHit(false);
    }
    this.pushHud();
  }

  private enemyOf(o: THREE.Object3D): ActiveEnemy | null {
    let cur: THREE.Object3D | null = o;
    while (cur) {
      if (cur.userData.enemy) return cur.userData.enemy as ActiveEnemy;
      cur = cur.parent;
    }
    return null;
  }

  private damageEnemy(e: ActiveEnemy, dmg: number, dir: THREE.Vector3, point: THREE.Vector3) {
    if (e.state === "dying") return;
    e.hp -= dmg;
    e.alerted = true;
    e.flash = 1;
    e.knock.addScaledVector(dir, 2.6);
    this.blood.burst(point, 0x8e1010, 9, 3.4, 2.6, GRAV, 0.7);
    if (e.hp <= 0) {
      e.state = "dying";
      e.t = 0;
      this.floorKilled++;
      this.kills++;
      this.score += e.score;
      this.audio.kill();
      this.blood.burst(e.rig.root.position.clone().setY(1), 0x7c0c0c, 22, 4.5, 3.4, GRAV, 0.9);
      this.cb.onHit(true);
      if (this.floorKilled >= this.floorTotal) this.openCage();
    } else {
      e.state = "stagger";
      e.t = 0;
    }
  }

  private startReload() {
    if (this.reloading || this.shells >= TUBE || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0.25;
  }

  private ejectCasing() {
    if (this.casings.length > 14) {
      const old = this.casings.shift()!;
      this.scene.remove(old.m);
    }
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    const p = this.camera.localToWorld(new THREE.Vector3(0.42, -0.3, -0.55));
    m.position.copy(p);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const v = right.multiplyScalar(1.6 + Math.random()).add(new THREE.Vector3(0, 2.2 + Math.random(), 0));
    this.scene.add(m);
    this.casings.push({ m, v, life: 5 });
    this.audio.eject();
  }

  private hurt(dmg: number, from: THREE.Vector3) {
    if (this.dyingT >= 0 || this.rideT >= 0) return;
    this.hp -= dmg;
    this.shake = Math.min(1.4, this.shake + 0.7);
    this.audio.hurt();
    this.cb.onDamage();
    const away = this.tmpV.copy(this.pos).sub(from).setY(0).normalize();
    this.vel.addScaledVector(away, 4.5);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dyingT = 0;
      this.audio.kill();
      this.audio.collapseRumble();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    } else if (this.hp < 35 && !this.lowHpWarned) {
      this.lowHpWarned = true;
      this.cb.onMessage("YOUR HANDS ARE SHAKING", "Find a green tonic. Keep moving.");
    }
    this.pushHud();
  }

  private tryRide() {
    if (!this.cageOpen || this.rideT >= 0 || this.dyingT >= 0) return;
    if (this.pos.distanceTo(this.level.cagePos) < 2.5) {
      this.rideT = 0;
      this.rideSwitched = false;
      this.audio.cageRide();
      this.audio.collapseRumble();
      this.score += 300 + this.depth * 150;
    }
  }

  /* ---------------- enemies ---------------- */

  private spawnEnemy() {
    const candidates = this.openCells.filter((c) => {
      if (c.distanceTo(this.pos) < 12) return false;
      if (c.distanceTo(this.level.cagePos) < 2.5) return false;
      return true;
    });
    if (!candidates.length) return;
    const at = candidates[Math.floor(Math.random() * candidates.length)];
    const type: EnemyType = Math.random() < Math.max(0.3, 0.72 - this.depth * 0.06) ? "wretch" : "skitter";
    const stats = enemyStats(type, this.depth);
    const rig = buildEnemy(type, stats.eye);
    rig.root.position.copy(at);
    rig.root.position.y = -1.5;
    rig.root.traverse((o) => (o as THREE.Mesh).isMesh && ps2ify((o as THREE.Mesh).material as THREE.Material));
    this.scene.add(rig.root);
    const e: ActiveEnemy = {
      rig,
      type,
      hp: stats.hp,
      speed: stats.speed,
      damage: stats.damage,
      radius: stats.radius,
      score: stats.score,
      state: "rise",
      t: 0,
      attackCd: 0,
      growlCd: Math.random() * 2,
      seed: Math.random() * 100,
      alerted: false,
      flash: 0,
      waypoint: at.clone(),
      wpT: 0,
      stuckT: 0,
      strafe: Math.random() < 0.5 ? -1 : 1,
      knock: new THREE.Vector3(),
    };
    rig.root.userData.enemy = e;
    rig.root.traverse((o) => (o.userData.enemy = e));
    this.enemies.push(e);
    this.floorSpawned++;
    this.fx.burst(at.clone().setY(0.2), 0x5a4630, 12, 2.2, 2.2, 4, 0.7);
    if (at.distanceTo(this.pos) < 20) this.audio.growl(type === "wretch");
  }

  private updateEnemies(dt: number) {
    const aliveCap = Math.min(7, 5 + Math.floor(this.depth / 2));
    if (this.floorSpawned < this.floorTotal && this.rideT < 0) {
      this.spawnT -= dt;
      const alive = this.enemies.filter((e) => e.state !== "dying").length;
      if (this.spawnT <= 0 && alive < aliveCap) {
        this.spawnEnemy();
        this.spawnT = Math.max(1.1, 3.6 - this.depth * 0.3) * (0.7 + Math.random() * 0.6);
      }
    }

    const removals: ActiveEnemy[] = [];
    for (const e of this.enemies) {
      const p = e.rig.root.position;
      const toPlayer = this.tmpV.copy(this.pos).sub(p).setY(0);
      const dist = toPlayer.length();
      e.t += dt;
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.growlCd -= dt;
      e.flash = Math.max(0, e.flash - dt * 5);

      /* hit flash */
      const flashCol = e.flash * 0.9;
      for (const m of e.rig.mats) {
        m.emissive.setRGB(flashCol, flashCol * 0.25, flashCol * 0.2);
      }

      /* knockback */
      if (e.knock.lengthSq() > 0.001) {
        this.tryMove(p, e.knock.x * dt, e.knock.z * dt, e.radius);
        e.knock.multiplyScalar(Math.max(0, 1 - dt * 9));
      }

      switch (e.state) {
        case "rise": {
          const k = Math.min(1, e.t / 0.85);
          p.y = -1.5 + 1.5 * k * k;
          if (k >= 1) {
            p.y = 0;
            e.state = "roam";
            e.t = 0;
          }
          break;
        }
        case "roam": {
          if (!e.alerted && (dist < 9 + this.depth * 0.4 || this.shots > 0 && dist < 16)) {
            e.alerted = true;
            e.state = "chase";
            if (e.growlCd <= 0) {
              this.audio.growl(e.type === "wretch");
              e.growlCd = 4 + Math.random() * 3;
            }
            break;
          }
          e.wpT -= dt;
          if (e.wpT <= 0 || p.distanceTo(e.waypoint) < 0.9) {
            e.waypoint.copy(this.openCells[Math.floor(Math.random() * this.openCells.length)]);
            e.wpT = 6;
          }
          this.walkToward(e, e.waypoint, 0.55, dt, 0.4);
          break;
        }
        case "chase": {
          if (dist > 40) {
            e.alerted = false;
            e.state = "roam";
            break;
          }
          if (e.growlCd <= 0 && dist < 14 && Math.random() < 0.02) {
            this.audio.growl(e.type === "wretch");
            e.growlCd = 5 + Math.random() * 4;
          }
          if (dist < (e.type === "wretch" ? 1.55 : 1.35) && e.attackCd <= 0) {
            e.state = "windup";
            e.t = 0;
            this.audio.lunge();
            break;
          }
          const blocked = this.walkToward(e, this.pos, e.speed, dt, 1);
          if (blocked === 2) {
            e.stuckT += dt;
            if (e.stuckT > 0.45) {
              e.strafe *= -1;
              e.stuckT = 0;
            }
          } else e.stuckT = 0;
          break;
        }
        case "windup": {
          const k = Math.min(1, e.t / 0.38);
          if (e.rig.armL) e.rig.armL.rotation.x = -2.4 * k;
          if (e.rig.armR) e.rig.armR.rotation.x = -2.4 * k;
          if (e.rig.jaw) e.rig.jaw.rotation.x = 0.7 * k;
          if (e.t >= 0.38) {
            e.state = "recover";
            e.t = 0;
            e.attackCd = 1.15;
            const d2 = this.pos.distanceTo(p);
            if (d2 < 2.05 && this.dyingT < 0) this.hurt(e.damage, p);
          }
          break;
        }
        case "recover": {
          const k = Math.max(0, 1 - e.t / 0.55);
          if (e.rig.armL) e.rig.armL.rotation.x = -2.4 * k;
          if (e.rig.armR) e.rig.armR.rotation.x = -2.4 * k;
          if (e.rig.jaw) e.rig.jaw.rotation.x = 0.7 * k;
          if (e.t >= 0.55) {
            e.state = "chase";
            e.t = 0;
          }
          break;
        }
        case "stagger": {
          if (e.t >= 0.22) {
            e.state = "chase";
            e.alerted = true;
            e.t = 0;
          }
          break;
        }
        case "dying": {
          const k = Math.min(1, e.t / 0.8);
          p.y = -1.7 * k * k;
          e.rig.root.rotation.z = k * 0.9;
          const op = 1 - k;
          for (const m of e.rig.mats) {
            m.transparent = true;
            m.opacity = op;
          }
          e.rig.eyeMat.transparent = true;
          e.rig.eyeMat.opacity = op;
          if (k >= 1) removals.push(e);
          break;
        }
      }

      /* locomotion anim */
      if (e.state === "chase" || e.state === "roam" || e.state === "windup") {
        const sp = e.state === "chase" ? e.speed : 0.6;
        const ph = this.elapsed * sp * 3.2 + e.seed;
        const swing = Math.sin(ph) * (e.state === "chase" ? 0.85 : 0.4);
        e.rig.legL.rotation.x = swing;
        e.rig.legR.rotation.x = -swing;
        if (e.rig.legBL) e.rig.legBL.rotation.x = -swing * 0.9;
        if (e.rig.legBR) e.rig.legBR.rotation.x = swing * 0.9;
        if (e.state !== "windup") {
          if (e.rig.armL) e.rig.armL.rotation.x = -swing * 0.5 - 0.25;
          if (e.rig.armR) e.rig.armR.rotation.x = swing * 0.5 - 0.25;
        }
        e.rig.torso.position.y = (e.type === "wretch" ? 1.08 : 0.62) + Math.abs(Math.sin(ph)) * 0.05;
        e.rig.head.rotation.z = Math.sin(ph * 0.5) * 0.12;
      }
    }

    /* separation */
    for (let i = 0; i < this.enemies.length; i++)
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i].rig.root.position;
        const b = this.enemies[j].rig.root.position;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.1 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((1.05 - d) / d) * 0.5;
          a.x += dx * push * dt * 8;
          a.z += dz * push * dt * 8;
          b.x -= dx * push * dt * 8;
          b.z -= dz * push * dt * 8;
        }
      }

    for (const e of removals) {
      this.scene.remove(e.rig.root);
      e.rig.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      e.rig.mats.forEach((m) => m.dispose());
      e.rig.eyeMat.dispose();
      this.enemies.splice(this.enemies.indexOf(e), 1);
    }
  }

  private walkToward(e: ActiveEnemy, target: THREE.Vector3, speed: number, dt: number, strafeAmt: number) {
    const p = e.rig.root.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    let mx = (dx / d) * speed;
    let mz = (dz / d) * speed;
    /* wall-hugging strafe when stuck */
    if (e.stuckT > 0.15) {
      mx += (-dz / d) * speed * 0.8 * e.strafe * strafeAmt;
      mz += (dx / d) * speed * 0.8 * e.strafe * strafeAmt;
    }
    /* face movement */
    const wantYaw = Math.atan2(-mx, -mz);
    let dy = wantYaw - e.rig.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    e.rig.root.rotation.y += dy * Math.min(1, dt * 9);
    return this.tryMove(p, mx * dt, mz * dt, e.radius);
  }

  /* ---------------- main tick ---------------- */

  private tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    if (this.screen === "playing") {
      this.runT += dt;
      this.updatePlayer(dt);
      this.updateWeapon(dt);
      this.updateEnemies(dt);
      this.updatePickups();
      this.updateRide(dt);
      this.updateAmbient(dt);
      this.markExplored();
    } else if (this.screen === "menu") {
      /* slow drift through the seam for the title backdrop */
      const t = this.elapsed;
      const s = this.level.spawn;
      this.pos.set(s.x + Math.sin(t * 0.11) * 1.4, 0, s.z + Math.cos(t * 0.09) * 1.4);
      this.yaw = t * 0.07;
      this.pitch = Math.sin(t * 0.17) * 0.06 - 0.03;
      this.roll = 0;
    }

    this.blood.update(dt);
    this.fx.update(dt);
    this.updateCasings(dt);
    this.updateLights(dt);
    this.applyCamera(dt);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.08;
      this.pushHud();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayer(dt: number) {
    if (this.dyingT >= 0) {
      this.dyingT += dt;
      this.roll = Math.min(1.25, this.dyingT * 1.6);
      this.pitch = Math.max(-1.2, this.pitch - dt * 0.9);
      if (this.dyingT > 1.25) this.setScreen("dead");
      return;
    }
    if (this.rideT >= 0) return;

    const fwd = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const sprint = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && fwd > 0;
    const speed = sprint ? 6.3 : 4.1;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * strafe;
    let wz = -cos * fwd - sin * strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx = (wx / wl) * speed;
      wz = (wz / wl) * speed;
    }
    /* accel toward wish velocity */
    const k = Math.min(1, dt * 11);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    this.tryMove(this.pos, this.vel.x * dt, this.vel.z * dt, PLAYER_R);

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.6) {
      this.bobPhase += dt * sp * 1.55;
      this.stepAcc += sp * dt;
      if (this.stepAcc > 2.3) {
        this.stepAcc = 0;
        this.audio.step();
      }
    }

    /* heartbeat */
    if (this.hp < 35) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = this.hp < 18 ? 0.72 : 1.05;
        this.audio.heartbeat();
      }
    }
  }

  private updateWeapon(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.muzzleT = Math.max(0, this.muzzleT - dt * 13);
    this.heat = Math.max(0, this.heat - dt * 1.1);
    this.pitchKick = Math.max(0, this.pitchKick - dt * 0.16);
    this.gunSwayX += (0 - this.gunSwayX) * Math.min(1, dt * 6);
    this.gunSwayY += (0 - this.gunSwayY) * Math.min(1, dt * 6);

    if (this.pumpT >= 0) {
      this.pumpT += dt;
      const p = this.pumpT / 0.42;
      this.pump.position.z = -0.36 - Math.sin(Math.min(1, p) * Math.PI) * 0.11;
      if (p >= 1) this.pumpT = -1;
    }

    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.shells++;
        this.reserve--;
        this.audio.reloadShell();
        if (this.shells >= TUBE || this.reserve <= 0) {
          this.reloading = false;
          this.audio.reloadClose();
        } else {
          this.reloadT = 0.4;
        }
      }
    }

    /* pose the gun */
    const bob = Math.sin(this.bobPhase * 2) * 0.012 * Math.min(1, this.vel.length() / 4);
    const reloadTilt = this.reloading ? 0.55 : 0;
    this.gun.position.set(
      0.36 + this.gunSwayX,
      -0.34 + bob + this.gunSwayY - (this.reloading ? 0.07 : 0),
      -0.62 + this.recoil * 0.1
    );
    this.gun.rotation.set(-this.recoil * 0.2, 0.02, reloadTilt);
    this.muzzleSprite.scale.setScalar(this.muzzleT > 0.4 ? 0.85 + Math.random() * 0.4 : 0.001);
    (this.muzzleSprite.material as THREE.SpriteMaterial).rotation = Math.random() * 6;
  }

  private updatePickups() {
    for (const pk of this.level.pickups) {
      if (pk.taken) continue;
      pk.mesh.rotation.y += 0.02;
      pk.mesh.position.y = Math.sin(this.elapsed * 2.4 + pk.mesh.position.x) * 0.03;
      if (this.pos.distanceTo(pk.mesh.position) < 1.15) {
        pk.taken = true;
        pk.mesh.visible = false;
        if (pk.kind === "shell") {
          this.reserve += 10;
          this.audio.pickupShell();
          this.cb.onPickup("shell", 10);
        } else {
          this.hp = Math.min(100, this.hp + 35);
          this.lowHpWarned = false;
          this.audio.pickupTonic();
          this.cb.onPickup("tonic", 35);
          this.fx.burst(pk.mesh.position.clone().setY(0.5), 0x55ff99, 10, 2, 2.4, 2, 0.6);
        }
        this.pushHud();
      }
    }
  }

  private updateRide(dt: number) {
    if (this.rideT < 0) return;
    this.rideT += dt;
    const t = this.rideT;
    /* walk into the cage */
    if (!this.rideSwitched) {
      const k = Math.min(1, t / 0.45);
      this.pos.lerpVectors(this.pos, this.tmpV.copy(this.level.cagePos), k * 0.4);
    }
    this.shake = Math.min(1, 0.25 + Math.sin(t * 22) * 0.08);
    /* fade out, switch floor, fade in */
    if (t < 1.0) this.fade = 0;
    else if (t < 1.7) this.fade = (t - 1.0) / 0.7;
    else if (t < 2.3) this.fade = 1;
    else if (t < 3.1) this.fade = 1 - (t - 2.3) / 0.8;
    else this.fade = 0;
    if (t >= 1.7 && !this.rideSwitched) {
      this.rideSwitched = true;
      this.loadFloor(this.depth + 1);
    }
    if (t >= 3.1) this.rideT = -1;
  }

  private updateAmbient(dt: number) {
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 14 + Math.random() * 16;
      const roll = Math.random();
      if (roll < 0.4) {
        this.shake = Math.min(1, this.shake + 0.5);
        this.audio.collapseRumble();
        this.cb.onMessage("Somewhere above, timber splits.");
      } else if (roll < 0.7) {
        this.audio.growl(Math.random() < 0.5);
      }
    }
  }

  private markExplored() {
    const { W, H, explored } = this.level;
    const [cx, cz] = worldToCell(this.pos.x, this.pos.z, W, H);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x >= 0 && z >= 0 && x < W && z < H) explored[z * W + x] = 1;
      }
  }

  private updateLights(dt: number) {
    const flick = 0.82 + 0.18 * Math.abs(Math.sin(this.elapsed * 13.7) * Math.sin(this.elapsed * 7.3));
    this.lanternLight.intensity = 10 * flick;
    this.spot.intensity = 120 * (0.9 + 0.1 * flick);
    this.muzzleLight.intensity = 70 * this.muzzleT;
    /* lantern sprites breathe */
    const sprites = this.level.lanternSprites;
    for (let i = 0; i < sprites.length; i++) {
      const f = 0.75 + 0.25 * Math.abs(Math.sin(this.elapsed * 3.1 + i * 2.2));
      (sprites[i].material as THREE.SpriteMaterial).opacity = 0.85 * f;
      const s = 1.5 + f * 0.5;
      sprites[i].scale.set(s, s, 1);
    }
    for (const m of this.level.lanternMats) m.color.setScalar(0.75 + 0.25 * flick);
    if (this.cageOpen) {
      this.level.cageLight.intensity = 22 + 10 * Math.abs(Math.sin(this.elapsed * 6.2));
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  private updateCasings(dt: number) {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.v.y -= GRAV * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 9;
      c.m.rotation.z += dt * 7;
      if (c.m.position.y < 0.04) {
        c.m.position.y = 0.04;
        c.v.y *= -0.3;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
      }
      if (c.life <= 0) {
        this.scene.remove(c.m);
        this.casings.splice(i, 1);
      }
    }
  }

  private applyCamera(dt: number) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * Math.min(1, sp / 4);
    const bobX = Math.cos(this.bobPhase) * 0.02 * Math.min(1, sp / 4);
    const dying = this.dyingT >= 0 ? Math.min(1, this.dyingT / 1.1) : 0;
    const rideDrop = this.rideT >= 0 ? Math.max(0, this.rideT - 0.5) * 3.2 : 0;

    this.camera.position.set(
      this.pos.x + bobX + (Math.random() - 0.5) * this.shake * 0.06,
      EYE + bobY - dying * 1.05 - rideDrop + (Math.random() - 0.5) * this.shake * 0.06,
      this.pos.z + (Math.random() - 0.5) * this.shake * 0.06
    );
    this.camera.rotation.set(
      this.pitch + this.pitchKick + (Math.random() - 0.5) * this.shake * 0.02,
      this.yaw + (Math.random() - 0.5) * this.shake * 0.02,
      this.roll + (Math.random() - 0.5) * this.shake * 0.02
    );
    /* sprint fov */
    const sprinting = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && sp > 4.5 && this.screen === "playing";
    const targetFov = 74 + (sprinting ? 5 : 0) + this.recoil * 3;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 9);
      this.camera.updateProjectionMatrix();
    }
  }

  private pushHud() {
    const moving = this.vel.length() > 1.2;
    this.cb.onHud({
      hp: Math.max(0, Math.round(this.hp)),
      shells: this.shells,
      tube: TUBE,
      reserve: this.reserve,
      score: this.score,
      kills: this.kills,
      depth: this.depth,
      depthFt: this.depthFt(this.depth),
      remaining: Math.max(0, this.floorTotal - this.floorKilled),
      cageOpen: this.cageOpen,
      nearCage: this.cageOpen && this.rideT < 0 && this.pos.distanceTo(this.level.cagePos) < 2.5,
      time: this.runT,
      reloading: this.reloading,
      fade: this.fade,
      spread: 9 + this.heat * 26 + (moving ? 5 : 0),
    });
  }

  /* ---------------- minimap ---------------- */

  drawMinimap(ctx: CanvasRenderingContext2D, size: number) {
    const { grid, W, H, explored, cagePos, railCells } = this.level;
    const cs = size / W;
    ctx.fillStyle = "#0a0705";
    ctx.fillRect(0, 0, size, size);
    for (let cz = 0; cz < H; cz++)
      for (let cx = 0; cx < W; cx++) {
        const i = cz * W + cx;
        if (!explored[i]) continue;
        if (grid[i] === 1) {
          ctx.fillStyle = "#332618";
          ctx.fillRect(cx * cs, cz * cs, cs + 0.5, cs + 0.5);
        }
      }
    ctx.fillStyle = "#4d4038";
    for (const rc of railCells) {
      const i = rc.cz * W + rc.cx;
      if (!explored[i]) continue;
      ctx.fillRect(rc.cx * cs + cs * 0.3, rc.cz * cs + cs * 0.3, cs * 0.4, cs * 0.4);
    }
    /* cage */
    if (this.cageOpen && Math.floor(this.elapsed * 3) % 2 === 0) {
      const [ccx, ccz] = worldToCell(cagePos.x, cagePos.z, W, H);
      ctx.fillStyle = "#ff3020";
      ctx.fillRect(ccx * cs - 1, ccz * cs - 1, cs + 2, cs + 2);
    }
    /* player */
    const [px, pz] = worldToCell(this.pos.x, this.pos.z, W, H);
    ctx.save();
    ctx.translate(px * cs + cs / 2, pz * cs + cs / 2);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = "#ffd9a0";
    ctx.beginPath();
    ctx.moveTo(0, -cs * 0.62);
    ctx.lineTo(cs * 0.42, cs * 0.5);
    ctx.lineTo(-cs * 0.42, cs * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
