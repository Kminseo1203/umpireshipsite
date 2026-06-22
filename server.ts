import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// Support ES modules __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // Shared state variables kept in-memory at the server container level
  let serverGameState: any = null;
  let serverRosters: any = null;
  let serverPid: number = 1;
  let lastUpdateTime: number = Date.now();

  // Helper function to initialize mock rosters if never customized on server
  function initializeServerDefaults() {
    if (serverRosters) return;

    const pos = ['투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수', '지명타자'];
    const tempA: any[] = [];
    const tempB: any[] = [];
    let currentPid = 1;

    for (let i = 0; i < 10; i++) {
      tempA.push({ id: currentPid++, num: i + 1, name: `홈선수 ${i + 1}`, pos: pos[i], status: 'active' });
    }
    for (let i = 0; i < 10; i++) {
      tempB.push({ id: currentPid++, num: i + 1, name: `원정선수 ${i + 1}`, pos: pos[i], status: 'active' });
    }

    serverRosters = { A: tempA, B: tempB };
    serverPid = currentPid;

    serverGameState = {
      scoreA: 0,
      scoreB: 0,
      inning: 1,
      half: 'top',
      balls: 0,
      strikes: 0,
      outs: 0,
      bases: [false, false, false, false],
      playLog: [],
      inningScores: {},
      curBatter: String(tempB.filter((p: any) => p.pos !== '투수')[0]?.id || ''),
      curPitcher: String(tempA[0]?.id || ''),
      curPitcherA: String(tempA[0]?.id || ''),
      curPitcherB: String(tempB[0]?.id || ''),
      teamA: '홈팀',
      teamB: '원정팀',
      memo: '',
      kbo: {
        offTimeUsed: 0,
        moundVisitUsed: 0,
        catcherMoundUsed: 0,
        catcherMoundMax: 2,
        ballChangeUsed: 0
      },
      subLog: []
    };
  }

  // API 1: Get the current server-side synchronized state
  app.get("/api/sync", (req, res) => {
    initializeServerDefaults();
    res.json({
      gameState: serverGameState,
      rosters: serverRosters,
      pid: serverPid,
      lastUpdateTime
    });
  });

  // API 2: Post updates to synchronize state live
  app.post("/api/sync", (req, res) => {
    initializeServerDefaults();
    const { gameState, rosters, pid, clientTime } = req.body;

    // Direct synchronization update
    if (gameState) serverGameState = gameState;
    if (rosters) serverRosters = rosters;
    if (pid) serverPid = pid;

    lastUpdateTime = Date.now();

    res.json({
      success: true,
      gameState: serverGameState,
      rosters: serverRosters,
      pid: serverPid,
      lastUpdateTime
    });
  });

  // API 3: Clear and reset server synchronized state back to defaults
  app.post("/api/sync/reset", (req, res) => {
    serverGameState = null;
    serverRosters = null;
    serverPid = 1;
    initializeServerDefaults();
    lastUpdateTime = Date.now();
    res.json({
      success: true,
      gameState: serverGameState,
      rosters: serverRosters,
      pid: serverPid,
      lastUpdateTime
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
