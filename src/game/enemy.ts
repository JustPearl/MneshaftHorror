import * as THREE from "three";

export type EnemyType = "wretch" | "skitter";

export interface EnemyRig {
  root: THREE.Group;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  legL: THREE.Group;
  legR: THREE.Group;
  legBL: THREE.Group | null;
  legBR: THREE.Group | null;
  torso: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group | null;
  mats: THREE.MeshLambertMaterial[];
  eyeMat: THREE.MeshBasicMaterial;
}

export interface EnemyStats {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  eye: number;
  score: number;
}

export function enemyStats(type: EnemyType, depth: number): EnemyStats {
  const d = depth - 1;
  return type === "wretch"
    ? { hp: 55 + d * 18, speed: 2.05 + d * 0.18, damage: 16 + d * 3, radius: 0.55, eye: 0xffb030, score: 100 }
    : { hp: 26 + d * 9, speed: 4.1 + d * 0.25, damage: 9 + d * 2, radius: 0.5, eye: 0xff3318, score: 60 };
}

function lam(color: number, mats: THREE.MeshLambertMaterial[]): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  mats.push(m);
  return m;
}

export function buildEnemy(type: EnemyType, eyeColor: number): EnemyRig {
  const root = new THREE.Group();
  const mats: THREE.MeshLambertMaterial[] = [];
  let armL: THREE.Group | null = null;
  let armR: THREE.Group | null = null;
  let legBL: THREE.Group | null = null;
  let legBR: THREE.Group | null = null;
  let jaw: THREE.Group | null = null;

  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });

  const torso = new THREE.Group();
  const head = new THREE.Group();

  if (type === "wretch") {
    const skin = lam(0x77805f, mats);
    const skinDark = lam(0x565c44, mats);
    const flesh = lam(0x8a3a2c, mats);

    // legs
    const mkLeg = (side: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(0.19 * side, 1.02, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.58, 0.26), skinDark);
      thigh.position.y = -0.28;
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.2), skin);
      shin.position.y = -0.78;
      g.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.42), skinDark);
      foot.position.set(0, -1.0, 0.09);
      g.add(foot);
      root.add(g);
      return g;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    // hunched torso
    torso.position.set(0, 1.08, 0.02);
    torso.rotation.x = 0.42;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.95, 0.46), skin);
    chest.position.y = 0.48;
    torso.add(chest);
    const gut = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.5), flesh);
    gut.position.set(0, 0.16, -0.04);
    torso.add(gut);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.16), skinDark);
    spine.position.set(0, 0.5, 0.26);
    torso.add(spine);
    root.add(torso);

    // arms (long, dragging)
    const mkArm = (side: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(0.47 * side, 0.82, 0.05);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.62, 0.21), skin);
      upper.position.y = -0.3;
      g.add(upper);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), skinDark);
      fore.position.y = -0.88;
      g.add(fore);
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.26, 4), new THREE.MeshLambertMaterial({ color: 0xcfc4a0, flatShading: true }));
        claw.position.set(0.055 * c, -1.28, 0);
        claw.rotation.x = Math.PI;
        g.add(claw);
      }
      torso.add(g);
      return g;
    };
    armL = mkArm(-1);
    armR = mkArm(1);

    // head
    head.position.set(0, 1.08, -0.22);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.44), skin);
    head.add(skull);
    jaw = new THREE.Group();
    jaw.position.set(0, -0.14, -0.16);
    const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.26), flesh);
    jaw.add(jawMesh);
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0xd8cfae }));
    teeth.position.set(0, 0.09, -0.1);
    jaw.add(teeth);
    head.add(jaw);
    // horns
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 5), new THREE.MeshLambertMaterial({ color: 0xb7a06a, flatShading: true }));
      horn.position.set(0.15 * side, 0.3, 0.03);
      horn.rotation.z = -0.4 * side;
      head.add(horn);
    }
    // eyes
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.05), eyeMat);
      eye.position.set(0.1 * side, 0.06, -0.23);
      head.add(eye);
    }
    root.add(head);
    return { root, armL, armR, legL, legR, legBL, legBR, torso, head, jaw, mats, eyeMat };
  }

  /* ---- skitterer: low quadruped ---- */
  const chitin = lam(0x4a1f18, mats);
  const chitinDark = lam(0x331511, mats);
  const meat = lam(0x7c2a1e, mats);

  torso.position.y = 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.42, 1.15), chitin);
  torso.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.8), chitinDark);
  plate.position.y = 0.28;
  torso.add(plate);
  const abdomen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.4), meat);
  abdomen.position.set(0, -0.02, 0.66);
  torso.add(abdomen);
  root.add(torso);

  head.position.set(0, 0.66, -0.72);
  const skullS = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.4), chitin);
  head.add(skullS);
  jaw = new THREE.Group();
  jaw.position.set(0, -0.1, -0.22);
  const mandible = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.24), meat);
  jaw.add(mandible);
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 4), new THREE.MeshLambertMaterial({ color: 0xd8cfae }));
    fang.position.set(0.11 * side, -0.02, -0.1);
    fang.rotation.x = Math.PI + 0.5 * side;
    jaw.add(fang);
  }
  head.add(jaw);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.05), eyeMat);
    eye.position.set(0.12 * side, 0.07, -0.2);
    head.add(eye);
    const eye2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.04), eyeMat);
    eye2.position.set(0.19 * side, 0.02, -0.18);
    head.add(eye2);
  }
  root.add(head);

  const mkLeg = (x: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, 0.62, z);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.13), chitinDark);
    upper.position.x = x > 0 ? 0.2 : -0.2;
    upper.rotation.z = x > 0 ? 0.75 : -0.75;
    g.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.11), chitin);
    lower.position.set(x > 0 ? 0.42 : -0.42, -0.32, 0);
    g.add(lower);
    root.add(g);
    return g;
  };
  const legL = mkLeg(-0.3, -0.4);
  const legR = mkLeg(0.3, -0.4);
  legBL = mkLeg(-0.3, 0.42);
  legBR = mkLeg(0.3, 0.42);

  return { root, armL, armR, legL, legR, legBL, legBR, torso, head, jaw, mats, eyeMat };
}
