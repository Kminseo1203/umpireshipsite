import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Support ES modules __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
}) : null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // CORS middleware to support clients running on external domains (such as kminseo1203.github.io)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

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

  // API 4: AI Umpire Decision & Rule Analyzer powered by Gemini
  app.post("/api/gemini/judge", async (req, res) => {
    try {
      const { pitchInfo, gameState, query, batterName, pitcherName, mode } = req.body;

      if (!ai) {
        return res.status(200).json({
          success: false,
          error: "GEMINI_API_KEY가 설정되지 않았습니다. AI Studio 설정에서 API 키가 잘 지정되었는지 확인해 주세요.",
          data: {
            decision: "INFO",
            isStrike: false,
            umpireCommentary: "🚨 아쉽게도 AI Umpire의 음성 분석이 비활성화 상태입니다.",
            explanation: "서버에 GEMINI_API_KEY 환경 변수가 정의되지 않아 인공지능 분석을 실행할 수 없습니다.",
            ruleAdvice: "오프라인 기본 규칙: 스트라이크 아웃 시 우완/좌완 투수 교체 간의 대기 시간(KBO 스피드업 규정)을 준수해 주세요."
          }
        });
      }

      // Build context description
      const activeInning = gameState ? `${gameState.inning}회 ${gameState.half === 'top' ? '초' : '말'}` : "진행 중";
      const balls = gameState ? gameState.balls : 0;
      const strikes = gameState ? gameState.strikes : 0;
      const outs = gameState ? gameState.outs : 0;
      const teamA = gameState ? gameState.teamA : "홈팀";
      const teamB = gameState ? gameState.teamB : "원정팀";
      const scoreA = gameState ? gameState.scoreA : 0;
      const scoreB = gameState ? gameState.scoreB : 0;

      const pName = pitcherName || "투수";
      const bName = batterName || "타자";

      const currentMode = mode || "pitch";

      let prompt = "";

      if (currentMode === "pitch") {
        const pitchDesc = pitchInfo ? 
          `구속: ${pitchInfo.speed || "측정불가"}km/h, 실측 ABS 스트라이크존 판정 결과: ${pitchInfo.isStrike ? 'STRIKE' : 'BALL'}` :
          `스캔된 최근 투구 기록 없음 (수동 판정 기준)`;

        prompt = `
          [요청 모드: 실시간 투구 ABS 분석 및 중계]
          실제 또는 시뮬레이션된 투구 데이터를 분석하여 한국 프로야구(KBO) ABS(자동 투구 판정 시스템) 관점에서 생생하고 명확한 판정 및 해설을 제공해 주세요.
          
          [경기 환경 및 상황]
          - 이닝: ${activeInning}
          - 현재 스코어: ${teamA} ${scoreA} : ${scoreB} ${teamB}
          - 카운트: ${balls} 볼, ${strikes} 스트라이크, ${outs} 아웃
          - 투수: ${pName} (${gameState?.half === 'top' ? teamA : teamB} 소속)
          - 타자: ${bName} (${gameState?.half === 'top' ? teamB : teamA} 소속)
          - 투구 정보: ${pitchDesc}
          - 추가 특이사항: ${query || "없음"}
          
          [출력 요구 조건]
          1. decision: STRIKE 또는 BALL 판정
          2. isStrike: 스트라이크 여부 boolean 값 (투구 정보의 판정 결과를 따르세요)
          3. umpireCommentary: 야구 캐스터나 허구연/고창 해설위원이 중계석에서 마이크를 잡고 샤우팅하는 듯한 고텐션의 생동감 넘치는 한국어 투구 중계 대본 (예: "몸쪽 꽉 찬 패스트볼! 스트라이크! 타자 꼼짝 못하고 삼진 아웃입니다!").
          4. explanation: 해당 투구의 위치(구속 포함)와 구종 분석 및 투타 대결 국면에 관한 세련된 해설.
          5. ruleAdvice: 현재 이닝 상황/볼카운트 및 KBO 스피드업 규정(피치클락, 마운드 지연 등)에 기반하여 투수나 타자가 주의해야 할 스마트한 실전 조언.
        `;
      } else {
        // Mode "rule" - general Q&A about baseball/KBO rules & strategies
        prompt = `
          [요청 모드: KBO 야구 규칙 Q&A 및 전술 상담]
          사용자가 제시한 질문에 대해 KBO 공식 규칙 및 최신 규정(피치클락, 스피드업 규정, 비디오 판독, 마운드 방문 규정 등)을 기반으로 전문적이고 명쾌한 답변을 주세요.
          투구가 방금 발생한 상황이 아니므로, 가상의 투구에 대한 중계 멘트를 억지로 만들어내지 마세요.
          
          [경기 환경 및 상황]
          - 이닝: ${activeInning}
          - 현재 스코어: ${teamA} ${scoreA} : ${scoreB} ${teamB}
          - 카운트: ${balls} 볼, ${strikes} 스트라이크, ${outs} 아웃
          - 투수: ${pName}, 타자: ${bName}
          - 질문 내용: ${query || "KBO 야구 규정 및 전술에 대해 알려주세요."}
          
          [출력 요구 조건]
          1. decision: INFO로 고정
          2. isStrike: false로 고정
          3. umpireCommentary: 질문을 받고 해설위원이 중계석에서 마이크를 잡고 정중하고 친근하게 설명을 시작하는 고품격 도입부 멘트 (예: "아! 시청자 여러분께서 아주 중요하고 흥미로운 규칙을 질문해 주셨습니다! 함께 살펴보시죠."). 가상의 투구(스트라이크/볼)를 중계하지 마세요.
          4. explanation: 질문에 대한 아주 정확하고 구체적이며 논리적인 KBO 공식 규칙 및 프로야구 규정 답변.
          5. ruleAdvice: 현재 진행 중인 상황(볼카운트, 이닝, 점수차 등)에서 질문한 규칙이나 전술을 지혜롭게 활용하여 팀이 승리하기 위한 감독 또는 선수용 행동 수칙 권고.
        `;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are a professional, friendly, and enthusiastic KBO Baseball Umpire and Sports Commentator with perfect knowledge of official baseball speed-up rules. Avoid any humor regarding personal budgets or money savings, keep the response professional.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              decision: { type: Type.STRING },
              isStrike: { type: Type.BOOLEAN },
              umpireCommentary: { type: Type.STRING },
              explanation: { type: Type.STRING },
              ruleAdvice: { type: Type.STRING }
            },
            required: ["decision", "isStrike", "umpireCommentary", "explanation", "ruleAdvice"]
          }
        }
      });

      const responseText = response.text;
      if (responseText) {
        const parsed = JSON.parse(responseText.trim());
        return res.json({ success: true, data: parsed });
      } else {
        throw new Error("Empty response from Gemini");
      }
    } catch (e: any) {
      console.error("Gemini API error:", e);
      return res.status(500).json({
        success: false,
        error: e.message || "Gemini 분석 중 오류가 발생했습니다."
      });
    }
  });

  // Helper to determine redirect URI dynamically
  const getRedirectUri = (req: any) => {
    if (process.env.APP_URL) {
      return `${process.env.APP_URL.replace(/\/$/, '')}/auth/callback`;
    }
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}/auth/callback`;
  };

  // Google OAuth URL generation endpoint
  app.get("/api/auth/google/url", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.json({
        configured: false,
        message: "Google OAuth 설정이 누락되었습니다. 설정 메뉴에서 GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET을 등록해 주십시오."
      });
    }

    const redirectUri = getRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      access_type: "offline",
      prompt: "consent"
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({
      configured: true,
      url: authUrl,
      redirectUri
    });
  });

  // Google OAuth Callback Handler
  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      return res.send(`
        <html>
          <head><meta charset="utf-8"/></head>
          <body style="font-family: system-ui, -apple-system, sans-serif; background: #0e0e11; color: #f4f4f5; text-align: center; padding-top: 50px;">
            <h2 style="color: #ef4444;">구글 로그인 실패</h2>
            <p>${error}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_FAILURE', error: "${error}" }, '*');
                setTimeout(() => window.close(), 3000);
              }
            </script>
            <p style="font-size: 12px; color: #a1a1aa;">이 창은 잠시 후 자동으로 닫힙니다.</p>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send("인증 코드가 누락되었습니다.");
    }

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID || "";
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
      const redirectUri = getRedirectUri(req);

      // Exchange code for Access Token
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        throw new Error(`토큰 교환 실패: ${errText}`);
      }

      const tokens = (await tokenResponse.json()) as any;
      const accessToken = tokens.access_token;

      // Request user profile details
      const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userResponse.ok) {
        throw new Error("사용자 프로필 조회 실패");
      }

      const profile = (await userResponse.json()) as any;

      res.send(`
        <html>
          <head><meta charset="utf-8"/></head>
          <body style="font-family: system-ui, -apple-system, sans-serif; background: #0e0e11; color: #f4f4f5; text-align: center; padding-top: 50px;">
            <h2 style="color: #10b981;">구글 로그인 완료 🎉</h2>
            <p>${profile.name || "사용자"}님 환영합니다!</p>
            <script>
              const userData = {
                name: ${JSON.stringify(profile.name || "구글 사용자")},
                email: ${JSON.stringify(profile.email || "")},
                picture: ${JSON.stringify(profile.picture || "")}
              };
              
              // Persist directly to localStorage so the parent polling loop can detect it immediately
              try {
                localStorage.setItem('baseball_umpire_user', JSON.stringify(userData));
              } catch (e) {
                console.error("Local storage error:", e);
              }

              if (window.opener) {
                try {
                  window.opener.postMessage({ 
                    type: 'OAUTH_AUTH_SUCCESS', 
                    user: userData
                  }, '*');
                } catch (e) {
                  console.error("PostMessage error:", e);
                }
              }
              
              // Close self shortly or immediately
              setTimeout(() => {
                window.close();
              }, 1000);
            </script>
            <button onclick="window.close()" style="background: #10b981; color: white; border: none; padding: 10px 24px; border-radius: 9999px; cursor: pointer; font-weight: bold; margin-top: 15px; font-size: 13px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">닫기</button>
            <p style="font-size: 11px; color: #71717a; margin-top: 12px;">인증이 동기화되었습니다. 창이 안 닫히면 버튼을 눌러주세요.</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error("Google OAuth token exchange error:", err);
      res.status(500).send(`
        <html>
          <head><meta charset="utf-8"/></head>
          <body style="font-family: system-ui, -apple-system, sans-serif; background: #0e0e11; color: #f4f4f5; text-align: center; padding-top: 50px;">
            <h2 style="color: #ef4444;">구글 인증 처리 오류</h2>
            <p>${err.message || err}</p>
            <button onclick="window.close()" style="background: #ef4444; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 15px;">닫기</button>
          </body>
        </html>
      `);
    }
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
