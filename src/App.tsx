import { useEffect, useRef, useState } from "react";
import { MineEngine, VIEW_W, VIEW_H } from "./game/engine";
import type { HudData, RunStats, Screen } from "./game/engine";

/* ---------------------------------------------------------------- */

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ShellPip({ lit }: { lit: boolean }) {
  return (
    <svg width="11" height="24" viewBox="0 0 11 24" style={{ opacity: lit ? 1 : 0.18 }}>
      <rect x="1.5" y="1" width="8" height="15" fill="#9c1d16" />
      <rect x="1.5" y="1" width="8" height="3" fill="#c22a1c" />
      <rect x="1.5" y="16" width="8" height="6" fill="#c8963c" />
      <rect x="1.5" y="16" width="8" height="2" fill="#e8c06a" />
    </svg>
  );
}

function Crosshair({ spread, kickKey }: { spread: number; kickKey: number }) {
  const g = spread;
  const bar = "absolute bg-[#e4d7b8]";
  return (
    <div key={kickKey} className={kickKey ? "xhair-kick absolute" : "absolute"} style={{ left: "50%", top: "50%" }}>
      <div className={bar} style={{ width: 2, height: 9, left: -1, top: -g - 9 }} />
      <div className={bar} style={{ width: 2, height: 9, left: -1, top: g }} />
      <div className={bar} style={{ width: 9, height: 2, top: -1, left: -g - 9 }} />
      <div className={bar} style={{ width: 9, height: 2, top: -1, left: g }} />
      <div className="absolute rounded-full bg-[#e4d7b8]" style={{ width: 2, height: 2, left: -1, top: -1, opacity: 0.9 }} />
    </div>
  );
}

/* ---------------------------------------------------------------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MineEngine | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudData | null>(null);
  const [msg, setMsg] = useState<{ main: string; sub?: string; key: number }>({ main: "", key: 0 });
  const [banner, setBanner] = useState<{ title: string; sub: string; key: number }>({ title: "", sub: "", key: 0 });
  const [dmgKey, setDmgKey] = useState(0);
  const [shotKey, setShotKey] = useState(0);
  const [hit, setHit] = useState<{ kill: boolean; key: number }>({ kill: false, key: 0 });
  const [pickup, setPickup] = useState<{ kind: string; amount: number; key: number }>({ kind: "", amount: 0, key: 0 });
  const [stats, setStats] = useState<RunStats | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new MineEngine(canvas, {
      onScreen: (s) => {
        setScreen(s);
        if (s === "dead") setStats(engine.getStats());
      },
      onHud: setHud,
      onMessage: (main, sub) => setMsg((m) => ({ main, sub, key: m.key + 1 })),
      onBanner: (title, sub) => setBanner((b) => ({ title, sub, key: b.key + 1 })),
      onDamage: () => setDmgKey((k) => k + 1),
      onShot: () => setShotKey((k) => k + 1),
      onHit: (kill) => setHit((h) => ({ kill, key: h.key + 1 })),
      onPickup: (kind, amount) => setPickup((p) => ({ kind, amount, key: p.key + 1 })),
    });
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  /* keep the 480p framebuffer cover-fitted to the window */
  useEffect(() => {
    const fit = () => {
      const c = canvasRef.current;
      if (!c) return;
      const s = Math.max(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
      c.style.width = `${Math.round(VIEW_W * s)}px`;
      c.style.height = `${Math.round(VIEW_H * s)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /* minimap redraw */
  useEffect(() => {
    if (screen !== "playing" && screen !== "paused") return;
    const id = window.setInterval(() => {
      const ctx = mapRef.current?.getContext("2d");
      if (ctx && engineRef.current) engineRef.current.drawMinimap(ctx, 138);
    }, 130);
    return () => clearInterval(id);
  }, [screen]);

  const eng = () => engineRef.current;
  const inGame = screen === "playing" || screen === "paused";
  const h = hud;
  const lowHp = !!h && h.hp < 35;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#040302] select-none">
      {/* 3D framebuffer — fixed 854×480, scaled nearest-neighbor */}
      <div className="absolute inset-0 flex items-center justify-center">
        <canvas ref={canvasRef} id="game-canvas" width={VIEW_W} height={VIEW_H} />
      </div>

      {/* film layers */}
      <div className="hud-frame pointer-events-none absolute inset-0 z-30" />
      <div className="scanlines-ui pointer-events-none absolute inset-0 z-[60]" />
      <div className="grain pointer-events-none absolute inset-0 z-[60]" />
      {lowHp && inGame && <div className="danger-vignette pointer-events-none absolute inset-0 z-30 bg-[radial-gradient(ellipse_at_center,transparent_52%,rgba(140,10,10,0.55)_100%)]" />}
      {dmgKey > 0 && <div key={`d${dmgKey}`} className="damage-flash pointer-events-none absolute inset-0 z-30" />}
      {inGame && h && <div className="pointer-events-none absolute inset-0 z-40 bg-black" style={{ opacity: h.fade }} />}

      {/* ---------------- HUD ---------------- */}
      {inGame && h && (
        <div className="pointer-events-none absolute inset-0 z-20 font-type">
          {/* top-left: map + objective */}
          <div className="absolute left-4 top-4">
            <div className="paper-panel p-2">
              <canvas ref={mapRef} width={138} height={138} className="minimap block" />
              <div className="mt-1 text-center text-[10px] tracking-[0.2em] text-[#8a6428]">SEAM MAP</div>
            </div>
            <div
              className={`mt-2 max-w-[220px] border border-[#3a2e22] bg-[rgba(10,7,4,0.72)] px-3 py-1.5 text-[11px] tracking-[0.18em] ${
                h.cageOpen && h.remaining === 0 ? "cage-blink text-[#ff5533]" : "text-[#d8a24a]"
              }`}
            >
              {h.remaining > 0 ? `PURGE THE SEAM — ${h.remaining} REMAIN` : "THE CAGE IS OPEN — FIND IT"}
            </div>
          </div>

          {/* top-right: ledger */}
          <div className="absolute right-4 top-4 text-right">
            <div className="paper-panel px-4 py-2 text-[11px] leading-5 tracking-[0.16em]">
              <div className="text-[#8a6428]">
                DEPTH <span className="text-[#e4d7b8]">&minus;{h.depthFt} FT</span>
              </div>
              <div className="text-[#8a6428]">
                SCORE <span className="text-[#e4d7b8]">{h.score}</span>
              </div>
              <div className="text-[#8a6428]">
                FELLED <span className="text-[#e4d7b8]">{h.kills}</span>
              </div>
              <div className="text-[#8a6428]">
                BELOW <span className="text-[#e4d7b8]">{fmtTime(h.time)}</span>
              </div>
            </div>
            <div className="mt-2 text-[10px] tracking-[0.22em] text-[#5a4a30]">ESC — SUSPEND SHIFT</div>
          </div>

          {/* bottom-left: vitals */}
          <div className="absolute bottom-5 left-4">
            <div className="mb-1 flex items-baseline gap-2 text-[10px] tracking-[0.24em] text-[#8a6428]">
              VITALS
              <span className={`font-type text-xl tracking-normal ${lowHp ? "text-[#ff3020]" : "text-[#e4d7b8]"}`}>{h.hp}</span>
            </div>
            <div className="flex gap-[3px] border border-[#3a2e22] bg-[rgba(10,7,4,0.72)] p-[5px]">
              {Array.from({ length: 20 }, (_, i) => {
                const lit = i < Math.round((h.hp / 100) * 20);
                return (
                  <div
                    key={i}
                    className={`h-4 w-[9px] ${lit ? (lowHp ? "bg-[#c1121f]" : "bg-[#d8a24a]") : "bg-[#241a10]"}`}
                    style={{ boxShadow: lit ? `0 0 6px ${lowHp ? "rgba(193,18,31,0.7)" : "rgba(216,162,74,0.45)"}` : "none" }}
                  />
                );
              })}
            </div>
          </div>

          {/* bottom-right: shells */}
          <div className="absolute bottom-5 right-4 text-right">
            <div className="mb-1 text-[10px] tracking-[0.24em] text-[#8a6428]">
              {h.reloading ? <span className="cage-blink text-[#d8a24a]">LOADING&hellip;</span> : h.shells === 0 ? <span className="cage-blink text-[#ff3020]">R — RELOAD</span> : "12-BORE"}
            </div>
            <div className="flex items-end justify-end gap-[5px] border border-[#3a2e22] bg-[rgba(10,7,4,0.72)] px-3 py-2">
              {Array.from({ length: h.tube }, (_, i) => (
                <ShellPip key={i} lit={i < h.shells} />
              ))}
              <span className="ml-2 pb-0.5 text-[11px] tracking-[0.14em] text-[#d8a24a]">+{h.reserve}</span>
            </div>
          </div>

          {/* center: crosshair + markers */}
          <Crosshair spread={h.spread} kickKey={shotKey} />
          {hit.key > 0 && (
            <div
              key={`h${hit.key}`}
              className={hit.kill ? "kill-marker absolute z-10 font-display text-3xl text-[#ff3020]" : "hit-marker absolute"}
              style={{ left: "50%", top: "50%" }}
            >
              {hit.kill ? (
                "\u2720"
              ) : (
                <svg width="22" height="22" viewBox="0 0 22 22">
                  <path d="M2 2 L8 8 M20 2 L14 8 M2 20 L8 14 M20 20 L14 14" stroke="#e4d7b8" strokeWidth="2.4" />
                </svg>
              )}
            </div>
          )}

          {/* messages */}
          {msg.key > 0 && (
            <div key={`m${msg.key}`} className="msg-line absolute left-1/2 top-[16%] -translate-x-1/2 text-center">
              <div className="text-[13px] tracking-[0.12em] text-[#d8a24a]" style={{ textShadow: "0 0 12px rgba(216,162,74,0.4), 0 2px 0 #000" }}>
                {msg.main}
              </div>
              {msg.sub && <div className="mt-1 text-[10px] tracking-[0.2em] text-[#8a6428]">{msg.sub}</div>}
            </div>
          )}

          {/* banner */}
          {banner.key > 0 && screen === "playing" && (
            <div key={`b${banner.key}`} className="banner-slam absolute left-1/2 top-[30%] -translate-x-1/2 text-center">
              <div className="font-display text-6xl font-bold text-[#e4d7b8]" style={{ textShadow: "0 0 34px rgba(179,18,27,0.65), 0 4px 0 #000" }}>
                {banner.title}
              </div>
              <div className="mt-2 text-[12px] tracking-[0.34em] text-[#b3121b]">{banner.sub}</div>
            </div>
          )}

          {/* pickup float */}
          {pickup.key > 0 && (
            <div key={`p${pickup.key}`} className="pickup-float absolute left-1/2 top-[58%] text-[13px] tracking-[0.2em]" style={{ color: pickup.kind === "shell" ? "#d8a24a" : "#55ff99" }}>
              {pickup.kind === "shell" ? `+${pickup.amount} SHELLS` : `+${pickup.amount} VITALS`}
            </div>
          )}

          {/* cage prompt */}
          {h.nearCage && (
            <div className="absolute bottom-[24%] left-1/2 -translate-x-1/2 text-center">
              <div className="flex items-center justify-center gap-2 text-[13px] tracking-[0.2em] text-[#e4d7b8]">
                <span className="kbd">E</span> RIDE THE CAGE DOWN
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- MENU ---------------- */}
      {screen === "menu" && (
        <div className="overlay-in absolute inset-0 z-40 overflow-y-auto bg-[rgba(5,3,2,0.6)]">
          <div className="lamp-flicker pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_30%_38%,rgba(255,150,50,0.13),transparent_70%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_45%_at_78%_70%,rgba(179,18,27,0.1),transparent_70%)]" />
          <div className="relative mx-auto flex min-h-full max-w-5xl flex-col justify-center gap-10 px-6 py-10 md:grid md:grid-cols-[1.35fr_1fr] md:items-center">
            <div>
              <div className="rise-in text-[11px] tracking-[0.42em] text-[#8a6428]">HARROW CREEK COLLIERIES LTD. &mdash; EST. 1919</div>
              <h1 className="title-breath font-display mt-3 text-7xl font-black leading-[0.9] text-[#e4d7b8] md:text-8xl">
                VESPER
                <br />
                SHAFT
              </h1>
              <div className="rise-in rise-in-1 mt-4 flex flex-wrap items-center gap-4">
                <span className="stamp font-display text-xl text-[#b3121b]">Condemned &mdash; Oct. 1926</span>
                <span className="text-[11px] tracking-[0.3em] text-[#5a4a30]">A DESCENT IN NINE FATHOMS</span>
              </div>
              <p className="rise-in rise-in-2 font-type mt-6 max-w-md text-[13px] leading-6">
                <span className="text-[#c9ba89]">
                  Eleven men went below on the night of the 3rd. At midnight the cage came back up &mdash; empty, warm, and smelling of copper. The company
                  sealed the shaft by morning. You are the third man they have paid to go down and learn why.
                </span>
                <span className="caret text-[#d8a24a]">&nbsp;&#9612;</span>
              </p>
              <div className="rise-in rise-in-3 mt-8 flex flex-wrap items-center gap-5">
                <button className="btn-coal font-display text-2xl tracking-[0.08em]" onClick={() => eng()?.startRun()}>
                  &#9660;&nbsp; Take the cage down
                </button>
                <div className="text-[10px] leading-4 tracking-[0.18em] text-[#5a4a30]">
                  HEADPHONES ADVISED
                  <br />
                  POINTER LOCK ENGAGES ON ENTRY
                </div>
              </div>
            </div>

            <div className="paper-panel rise-in rise-in-2 self-start p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-2xl text-[#d8a24a]">Company Rules N&ordm; 9</h2>
                <span className="text-[10px] tracking-[0.2em] text-[#5a4a30]">POSTED 1923</span>
              </div>
              <div className="mt-4 space-y-2.5 text-[12px] text-[#c9ba89]">
                <div className="flex items-center justify-between gap-3">
                  <span>Tram the seam</span>
                  <span className="flex gap-1"><span className="kbd">W</span><span className="kbd">A</span><span className="kbd">S</span><span className="kbd">D</span></span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Mind the dark</span>
                  <span className="kbd px-3">MOUSE</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Fire the 12-bore</span>
                  <span className="kbd px-3">LMB</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Load shells</span>
                  <span className="kbd px-3">R</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Ride the cage</span>
                  <span className="kbd px-3">E</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Run like hell</span>
                  <span className="kbd px-4">SHIFT</span>
                </div>
              </div>
              <div className="mt-5 border-t border-dashed border-[#3a2e22] pt-4 text-[11px] leading-5 text-[#8a6428]">
                NOTICE &mdash; cleanse each seam of what crawls in it. When the heads are counted, the cage lamp burns red. Ride it down. There is always
                another seam.
              </div>
              <div className="mt-4 text-right">
                <span className="stamp font-display text-sm text-[#8a6428]">By order of the foreman</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- PAUSED ---------------- */}
      {screen === "paused" && (
        <div className="overlay-in absolute inset-0 z-40 flex items-center justify-center bg-[rgba(4,3,2,0.78)]">
          <div className="paper-panel w-[min(92vw,440px)] p-8 text-center">
            <div className="text-[10px] tracking-[0.4em] text-[#8a6428]">THE LAMP STILL BURNS</div>
            <h2 className="font-display mt-2 text-5xl text-[#e4d7b8]">Shift suspended</h2>
            <p className="font-type mt-3 text-[12px] leading-5 text-[#8a6428]">
              They can smell the pause. Down below, nothing waits politely.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button className="btn-coal font-display w-56 text-xl" onClick={() => eng()?.resume()}>
                &#9654;&nbsp; Resume shift
              </button>
              <button className="btn-coal btn-blood font-type w-56 text-[12px]" onClick={() => eng()?.surface()}>
                Abandon &mdash; surface
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- DEAD ---------------- */}
      {screen === "dead" && stats && (
        <div className="overlay-in absolute inset-0 z-40 overflow-y-auto bg-[radial-gradient(80%_70%_at_50%_40%,rgba(60,6,4,0.88),rgba(4,2,1,0.96))]">
          <div className="flex min-h-full items-center justify-center px-6 py-10">
            <div className="w-full max-w-xl text-center">
              <div className="rise-in text-[11px] tracking-[0.42em] text-[#8a6428]">SHIFT REPORT &mdash; RECOVERED FROM THE LAMP-ROOM</div>
              <h2 className="title-breath font-display rise-in mt-3 text-6xl font-black leading-[0.95] text-[#c1121f] md:text-7xl">
                The mine keeps
                <br />
                what it takes
              </h2>
              <div className="paper-panel rise-in rise-in-1 mx-auto mt-8 max-w-md p-6 text-left">
                <div className="font-type space-y-1.5 text-[12px] tracking-[0.14em]">
                  <div className="flex justify-between"><span className="text-[#8a6428]">DEPTH REACHED</span><span className="text-[#e4d7b8]">&minus;{118 + (stats.depth - 1) * 86} FT</span></div>
                  <div className="flex justify-between"><span className="text-[#8a6428]">DEMONS FELLED</span><span className="text-[#e4d7b8]">{stats.kills}</span></div>
                  <div className="flex justify-between"><span className="text-[#8a6428]">SCORE</span><span className="text-[#d8a24a]">{stats.score}</span></div>
                  <div className="flex justify-between"><span className="text-[#8a6428]">ACCURACY</span><span className="text-[#e4d7b8]">{stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0}%</span></div>
                  <div className="flex justify-between"><span className="text-[#8a6428]">TIME BELOW</span><span className="text-[#e4d7b8]">{fmtTime(stats.time)}</span></div>
                </div>
                <div className="mt-4 border-t border-dashed border-[#3a2e22] pt-3 text-[10px] leading-4 text-[#5a4a30]">
                  The foreman notes: another man required. Pay doubled. No questions.
                </div>
              </div>
              <div className="rise-in rise-in-2 mt-7 flex flex-wrap items-center justify-center gap-4">
                <button className="btn-coal btn-blood font-display text-2xl" onClick={() => eng()?.startRun()}>
                  &#8635;&nbsp; Ride down again
                </button>
                <button className="btn-coal font-type text-[12px]" onClick={() => eng()?.surface()}>
                  Surface
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
