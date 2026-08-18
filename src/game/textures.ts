import * as THREE from "three";

/* Small procedural textures — chunky, nearest-filtered, very PS2. */

function canvasOf(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, n: number, alpha: number, dark: boolean) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * (dark ? 40 : 70));
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.5})`;
    ctx.fillStyle = dark
      ? `rgba(${v},${v},${Math.floor(v * 0.8)},${alpha})`
      : `rgba(255,240,210,${alpha * 0.45})`;
    ctx.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 1 + Math.floor(Math.random() * 2), 1);
  }
}

export function makeRockTexture(): THREE.CanvasTexture {
  return canvasOf(64, (ctx, s) => {
    ctx.fillStyle = "#2c2420";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const g = 30 + Math.floor(Math.random() * 34);
      ctx.fillStyle = `rgb(${g + 8},${g},${Math.max(0, g - 6)})`;
      const w = 4 + Math.floor(Math.random() * 14);
      const h = 3 + Math.floor(Math.random() * 10);
      ctx.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), w, h);
    }
    // coal seams glinting
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = "rgba(10,8,10,0.9)";
      ctx.fillRect(0, Math.floor(Math.random() * s), s, 1 + Math.floor(Math.random() * 2));
    }
    speckle(ctx, s, 220, 0.5, true);
    speckle(ctx, s, 60, 0.3, false);
  });
}

export function makeTimberTexture(): THREE.CanvasTexture {
  return canvasOf(64, (ctx, s) => {
    ctx.fillStyle = "#4a2f16";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      const v = Math.random();
      ctx.fillStyle = v > 0.72 ? "#5d3d1d" : v > 0.35 ? "#43290f" : "#38220d";
      ctx.fillRect(0, y, s, 2);
    }
    // grain streaks
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = "rgba(20,10,3,0.55)";
      ctx.fillRect(Math.floor(Math.random() * s), 0, 1, s);
    }
    // knots + nails
    ctx.fillStyle = "#241206";
    ctx.beginPath();
    ctx.arc(14, 40, 3, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#777";
    ctx.fillRect(52, 12, 2, 2);
    ctx.fillRect(8, 56, 2, 2);
    speckle(ctx, s, 90, 0.35, true);
  });
}

export function makeDirtTexture(): THREE.CanvasTexture {
  return canvasOf(64, (ctx, s) => {
    ctx.fillStyle = "#241a12";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const g = 20 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${g + 12},${g + 4},${g - 4})`;
      ctx.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 2 + Math.floor(Math.random() * 5), 2);
    }
    // rail grease stains
    ctx.fillStyle = "rgba(8,6,6,0.5)";
    ctx.fillRect(20, 0, 5, s);
    ctx.fillRect(40, 0, 5, s);
    speckle(ctx, s, 260, 0.45, true);
    speckle(ctx, s, 40, 0.25, false);
  });
}

export function makeMetalTexture(): THREE.CanvasTexture {
  return canvasOf(64, (ctx, s) => {
    ctx.fillStyle = "#3a3d40";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 3) {
      ctx.fillStyle = Math.random() > 0.5 ? "#43474b" : "#31343a";
      ctx.fillRect(0, y, s, 2);
    }
    // rust
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${110 + Math.floor(Math.random() * 40)},${50 + Math.floor(Math.random() * 25)},20,0.75)`;
      ctx.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 2 + Math.floor(Math.random() * 6), 2 + Math.floor(Math.random() * 4));
    }
    ctx.fillStyle = "#1c1e22";
    ctx.fillRect(0, 0, s, 2);
    ctx.fillRect(0, s - 2, s, 2);
    // rivets
    ctx.fillStyle = "#565b61";
    for (let x = 6; x < s; x += 14) {
      ctx.fillRect(x, 5, 2, 2);
      ctx.fillRect(x, s - 8, 2, 2);
    }
    speckle(ctx, s, 110, 0.4, true);
  });
}

export function makeGlowTexture(): THREE.CanvasTexture {
  return canvasOf(32, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,214,140,1)");
    g.addColorStop(0.25, "rgba(255,170,70,0.55)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function makeBloodSplatTexture(): THREE.CanvasTexture {
  return canvasOf(32, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const r = 1 + Math.random() * 4;
      ctx.fillStyle = `rgba(${120 + Math.floor(Math.random() * 60)},${8 + Math.floor(Math.random() * 14)},10,${0.6 + Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(s / 2 + (Math.random() - 0.5) * s * 0.8, s / 2 + (Math.random() - 0.5) * s * 0.8, r, 0, 7);
      ctx.fill();
    }
  });
}
