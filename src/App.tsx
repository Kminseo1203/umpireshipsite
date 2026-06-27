import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, Player, TabType, SubLogEntry, PlayLogEntry } from './types';
import ScoreBoardGrid from './components/ScoreBoardGrid';
import KboLimitTracker from './components/KboLimitTracker';
import RosterManager from './components/RosterManager';
import SubstitutionManager from './components/SubstitutionManager';
import AbsPitchTracker from './components/AbsPitchTracker';

import {
  ClipboardList,
  Users,
  RefreshCw,
  Clock,
  Video,
  FileText,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Download,
  Upload,
  Copy,
  Undo2,
  Trash2,
  Info
} from 'lucide-react';

const SAVE_KEY = 'baseball_umpire_v3_react';
const ROSTER_KEY = 'baseball_umpire_rosters_v1_react';

const getApiUrl = (path: string) => {
  const host = window.location.hostname;
  const isLocalOrCloudRun = host === 'localhost' || 
                            host === '127.0.0.1' || 
                            host.endsWith('.run.app');
  // If hosted on GitHub Pages or custom domain, route API requests to our live Cloud Run container URL
  const base = isLocalOrCloudRun ? '' : 'https://ais-pre-2mljdcdy7iopruotoxw6gh-607464111897.asia-northeast1.run.app';
  return `${base}${path}`;
};

export default function App() {
  // 1. Current Active Tab
  const [currentTab, setCurrentTab] = useState<TabType>('game');

  // 2. Alert Toast message
  const [toast, setToast] = useState<string | null>(null);

  // 3. Incrementing ID for player rosters
  const [pid, setPid] = useState<number>(1);

  // 4. Integrated rosters for both teams
  const [rosters, setRosters] = useState<{ A: Player[]; B: Player[] }>({
    A: [],
    B: []
  });

  // 5. Game Core State
  const [gameState, setGameState] = useState<GameState>({
    scoreA: 0,
    scoreB: 0,
    inning: 1,
    half: 'top',
    balls: 0,
    strikes: 0,
    outs: 0,
    bases: [false, false, false, false], // Index 1: 1st, 2: 2nd, 3: 3rd. Index 0 is ignored
    playLog: [],
    inningScores: {},
    curBatter: '',
    curPitcher: '',
    curPitcherA: '',
    curPitcherB: '',
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
  });

  // 6. Modal Overlay state
  const [modal, setModal] = useState<{
    title: string;
    sub: string;
    content: React.ReactNode;
    onApply: () => void;
  } | null>(null);

  // Google Auth User State
  const [user, setUser] = useState<{ name: string; email: string; picture: string } | null>(() => {
    try {
      const stored = localStorage.getItem('baseball_umpire_user');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return null;
  });

  // Listen to OAuth success/failure messages from popup
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const u = event.data.user;
        setUser(u);
        localStorage.setItem('baseball_umpire_user', JSON.stringify(u));
        showToast(`👋 ${u.name}님, 구글 로그인 성공!`);
      } else if (event.data?.type === 'OAUTH_AUTH_FAILURE') {
        showToast(`❌ 구글 로그인 실패: ${event.data.error || '알 수 없는 오류'}`);
      }
    };
    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);


  // Real-time server state sync states
  const [syncEnabled, setSyncEnabled] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const serverUpdateTimeRef = React.useRef<number>(0);
  const isPostingRef = React.useRef<boolean>(false);

  // Helper to post current state and sync to server
  const postRostersAndGameState = async (g: GameState, r: { A: Player[]; B: Player[] }, currentPid: number) => {
    if (isPostingRef.current || !syncEnabled) return;
    try {
      isPostingRef.current = true;
      setSyncStatus('syncing');
      const res = await fetch(getApiUrl('/api/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameState: g,
          rosters: r,
          pid: currentPid
        })
      });
      if (res.ok) {
        const data = await res.json();
        serverUpdateTimeRef.current = data.lastUpdateTime;
        setSyncStatus('success');
      } else {
        setSyncStatus('error');
      }
    } catch (e) {
      console.warn('Sync post failed:', e);
      setSyncStatus('error');
    } finally {
      isPostingRef.current = false;
    }
  };

  // Load state on mount plus synchronizer
  useEffect(() => {
    const initializeState = async () => {
      try {
        // 1. Initial local load fallbacks
        const savedRosters = localStorage.getItem(ROSTER_KEY);
        let localRosters = { A: [] as Player[], B: [] as Player[] };
        let localPid = 1;
        let initRosterNeeded = false;

        if (savedRosters) {
          const parsed = JSON.parse(savedRosters);
          localRosters = {
            A: parsed.A || [],
            B: parsed.B || []
          };
          localPid = parsed._pid || 1;
        } else {
          initRosterNeeded = true;
        }

        let localGameState: GameState | null = null;
        const savedGame = localStorage.getItem(SAVE_KEY);
        if (savedGame) {
          const parsed = JSON.parse(savedGame);
          localGameState = {
            ...parsed,
            curPitcherA: parsed.curPitcherA || parsed.curPitcher || '',
            curPitcherB: parsed.curPitcherB || '',
            curPitcher: parsed.curPitcher || parsed.curPitcherA || ''
          };
        }

        if (initRosterNeeded && !localGameState) {
          const pos = ['투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수', '지명타자'];
          const tempA: Player[] = [];
          const tempB: Player[] = [];
          let currentPid = localPid;

          for (let i = 0; i < 10; i++) {
            tempA.push({ id: currentPid++, num: i + 1, name: `홈선수 ${i + 1}`, pos: pos[i], status: 'active' });
          }
          for (let i = 0; i < 10; i++) {
            tempB.push({ id: currentPid++, num: i + 1, name: `원정선수 ${i + 1}`, pos: pos[i], status: 'active' });
          }

          localRosters = { A: tempA, B: tempB };
          localPid = currentPid;

          const firstA_pitcher = String(tempA[0].id);
          const firstB_pitcher = String(tempB[0].id);
          const nonPitcherB = tempB.filter(p => p.pos !== '투수');
          const firstB_batter = nonPitcherB.length > 0 ? String(nonPitcherB[0].id) : '';

          localGameState = {
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
            curBatter: firstB_batter,
            curPitcher: firstA_pitcher,
            curPitcherA: firstA_pitcher,
            curPitcherB: firstB_pitcher,
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

        // Try syncing with the server first
        setSyncStatus('syncing');
        const res = await fetch(getApiUrl('/api/sync'));
        if (res.ok) {
          const data = await res.json();
          // If server already contains custom rosters, we pull from server.
          // Otherwise, we populate local state, and then upload it to server!
          if (data.rosters && (data.rosters.A.length > 0 || data.rosters.B.length > 0)) {
            setGameState(data.gameState);
            setRosters(data.rosters);
            setPid(data.pid);
            serverUpdateTimeRef.current = data.lastUpdateTime;
            setSyncStatus('success');
            showToast('📡 실시간 클라우드 명단이 연결 장치들과 즉시 동기화되었습니다!');
          } else {
            // Push local to server to synchronize starting defaults
            if (localGameState) {
              setGameState(localGameState);
              setRosters(localRosters);
              setPid(localPid);
              // Store locally
              localStorage.setItem(SAVE_KEY, JSON.stringify(localGameState));
              localStorage.setItem(ROSTER_KEY, JSON.stringify({ ...localRosters, _pid: localPid }));
              await postRostersAndGameState(localGameState, localRosters, localPid);
            }
          }
        } else {
          // offline fallback
          if (localGameState) {
            setGameState(localGameState);
            setRosters(localRosters);
            setPid(localPid);
          }
        }
      } catch (e) {
        console.warn('Initial server sync failed, falling back to offline mode:', e);
        setSyncStatus('error');
        // offline fallback load
        try {
          const savedRosters = localStorage.getItem(ROSTER_KEY);
          if (savedRosters) {
            const parsed = JSON.parse(savedRosters);
            setRosters({ A: parsed.A || [], B: parsed.B || [] });
            setPid(parsed._pid || 1);
          }
          const savedGame = localStorage.getItem(SAVE_KEY);
          if (savedGame) {
            setGameState(JSON.parse(savedGame));
          }
        } catch (eLocal) {
          console.warn('Local read fail:', eLocal);
        }
      }
    };

    initializeState();
  }, []);

  // Background polling loop for active sync across other devices
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const pollServer = async () => {
      if (!syncEnabled || isPostingRef.current) return;
      try {
        const res = await fetch(getApiUrl('/api/sync'));
        if (res.ok) {
          const data = await res.json();
          // Overwrite local if server's update timestamp is newer than our recorded one
          if (data.lastUpdateTime > serverUpdateTimeRef.current) {
            setGameState(data.gameState);
            setRosters(data.rosters);
            setPid(data.pid);
            serverUpdateTimeRef.current = data.lastUpdateTime;
            
            // Also update localStorage so they are in sync
            localStorage.setItem(SAVE_KEY, JSON.stringify(data.gameState));
            localStorage.setItem(ROSTER_KEY, JSON.stringify({ ...data.rosters, _pid: data.pid }));
            
            setSyncStatus('success');
          }
        }
      } catch (e) {
        setSyncStatus('error');
      }
    };

    if (syncEnabled) {
      timer = setInterval(pollServer, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [syncEnabled]);

  // Save changes automatically
  const saveState = (updatedGame: GameState) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(updatedGame));
    } catch (e) {
      console.warn('Auto save failed:', e);
    }
  };

  const updateGameState = (updater: Partial<GameState> | ((prev: GameState) => GameState)) => {
    setGameState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      saveState(next);
      postRostersAndGameState(next, rosters, pid);
      return next;
    });
  };

  const showToast = (msg: string) => {
    setToast(msg);
  };

  // Auto clear toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const handleGoogleLogin = async () => {
    try {
      const res = await fetch(getApiUrl('/api/auth/google/url'));
      const data = await res.json();
      if (data.configured && data.url) {
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        // Clear old user first to guarantee difference detection
        localStorage.removeItem('baseball_umpire_user');

        const popup = window.open(
          data.url,
          'google_oauth_popup',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        if (!popup) {
          showToast('⚠️ 팝업 차단기를 해제하고 다시 시도해 주세요.');
          return;
        }

        // Active polling on localStorage to handle sandbox / cross-origin opener nullification
        const pollInterval = setInterval(() => {
          try {
            const stored = localStorage.getItem('baseball_umpire_user');
            if (stored) {
              const u = JSON.parse(stored);
              setUser(u);
              clearInterval(pollInterval);
              if (popup && !popup.closed) {
                popup.close();
              }
            }
          } catch (e) {}

          if (!popup || popup.closed) {
            clearInterval(pollInterval);
          }
        }, 800);
      } else {
        setModal({
          title: 'Google OAuth 환경설정 가이드',
          sub: '구글 로그인을 사용하기 위해 Google Cloud Console 설정이 필요합니다.',
          onApply: () => {
            const virtualUser = {
              name: '체험용 구글러',
              email: 'uyeon71@gmail.com',
              picture: 'https://lh3.googleusercontent.com/a/default-user=s100'
            };
            setUser(virtualUser);
            localStorage.setItem('baseball_umpire_user', JSON.stringify(virtualUser));
            showToast('💡 가상 로그인 체험 모드가 활성화되었습니다!');
            setModal(null);
          },
          content: (
            <div className="space-y-4 text-xs text-slate-600 leading-relaxed max-h-[350px] overflow-y-auto pr-1">
              <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-xl">
                ⚠️ <strong>"Access blocked: This app's request is invalid" 오류 해결법:</strong><br/>
                Google Cloud Console에서 <strong>승인된 자바스크립트 원본</strong>과 <strong>승인된 리디렉션 URI</strong>가 아래의 실제 호스팅 도메인 주소와 일치하도록 정확하게 등록되어야 합니다.
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-slate-800">1. 승인된 자바스크립트 원본 (Authorized JavaScript origins) 입력값</p>
                <div className="bg-slate-100 p-2.5 rounded font-mono text-[10px] text-indigo-700 space-y-1 select-all">
                  <div>https://ais-dev-2mljdcdy7iopruotoxw6gh-607464111897.asia-northeast1.run.app</div>
                  <div>https://ais-pre-2mljdcdy7iopruotoxw6gh-607464111897.asia-northeast1.run.app</div>
                  <div>{window.location.origin}</div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-slate-800">2. 승인된 리디렉션 URI (Authorized redirect URIs) 입력값</p>
                <div className="bg-slate-100 p-2.5 rounded font-mono text-[10px] text-indigo-700 space-y-1 select-all">
                  <div>https://ais-dev-2mljdcdy7iopruotoxw6gh-607464111897.asia-northeast1.run.app/auth/callback</div>
                  <div>https://ais-pre-2mljdcdy7iopruotoxw6gh-607464111897.asia-northeast1.run.app/auth/callback</div>
                  <div>{data.redirectUri || `${window.location.origin}/auth/callback`}</div>
                </div>
              </div>

              <p className="font-semibold text-slate-800">3. AI Studio Settings에 환경변수 추가</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>AI Studio 우측 상단 Settings(설정) 메뉴에서 아래 변수명으로 클라이언트 ID와 비밀번호를 기입해 주십시오:</li>
                <li className="font-mono bg-slate-100 p-1 rounded text-[10px] text-indigo-700">
                  GOOGLE_CLIENT_ID = [구글 클라이언트 ID]<br/>
                  GOOGLE_CLIENT_SECRET = [구글 클라이언트 보안 비밀번호]
                </li>
              </ul>

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-800">
                💡 <strong>가상 로그인 테스트:</strong><br/>
                환경변수를 아직 등록하지 않았거나 설정 과정 중이라면, 아래의 <strong>[기입 확정]</strong>을 누르시면 가상 계정으로 체험하실 수 있습니다.
              </div>
            </div>
          )
        });
      }
    } catch (e) {
      console.error(e);
      showToast('⚠️ 인증 서버 요청 중 오류가 발생했습니다.');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('baseball_umpire_user');
    showToast('👋 안전하게 로그아웃 되었습니다.');
  };


  // Utility helpers
  const getBattingTeamKey = () => (gameState.half === 'top' ? 'B' : 'A');
  const getPitchingTeamKey = () => (gameState.half === 'top' ? 'A' : 'B');
  const getBattingTeamName = () => (gameState.half === 'top' ? gameState.teamB : gameState.teamA);
  const getPitchingTeamName = () => (gameState.half === 'top' ? gameState.teamA : gameState.teamB);

  const getBatterablePlayers = (team: 'A' | 'B') => {
    return rosters[team].filter((p) => p.status !== 'out' && p.pos !== '투수');
  };

  const handlePlayersChange = (team: 'A' | 'B', updated: Player[]) => {
    setRosters((prev) => {
      const next = { ...prev, [team]: updated };
      localStorage.setItem(ROSTER_KEY, JSON.stringify({ ...next, _pid: pid }));
      postRostersAndGameState(gameState, next, pid);
      return next;
    });
  };

  const handleIncrementPid = () => {
    const nextPid = pid + 1;
    setPid(nextPid);
    postRostersAndGameState(gameState, rosters, nextPid);
    return pid;
  };

  // Base runner display and count syncing
  const renderBasesSvg = () => {
    const b1 = gameState.bases[1];
    const b2 = gameState.bases[2];
    const b3 = gameState.bases[3];

    const toggleBase = (idx: number) => {
      const nextBases = [...gameState.bases];
      nextBases[idx] = !nextBases[idx];
      updateGameState({ bases: nextBases });
    };

    return (
      <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 shadow-sm flex flex-col items-center">
        <span className="text-xs font-bold text-slate-500 mb-4 block">베이스 전황 (탭 시 주자 수동 조율)</span>
        <svg width="150" height="150" viewBox="0 0 140 140" className="drop-shadow-sm select-none">
          {/* 2nd Base */}
          <rect
            x="53"
            y="5"
            width="34"
            height="34"
            rx="4"
            className={`transition-all duration-200 cursor-pointer stroke-2 stroke-slate-350 ${
              b2 ? 'fill-amber-500 stroke-amber-600 scale-105 origin-center' : 'fill-white hover:fill-slate-5'
            }`}
            onClick={() => toggleBase(2)}
          />
          <text x="70" y="26" textAnchor="middle" className="text-[10px] font-extrabold fill-slate-400 pointer-events-none">2루</text>

          {/* 1st Base */}
          <rect
            x="101"
            y="53"
            width="34"
            height="34"
            rx="4"
            className={`transition-all duration-200 cursor-pointer stroke-2 stroke-slate-350 ${
              b1 ? 'fill-amber-500 stroke-amber-600 scale-105 origin-center' : 'fill-white hover:fill-slate-5'
            }`}
            onClick={() => toggleBase(1)}
          />
          <text x="118" y="74" textAnchor="middle" className="text-[10px] font-extrabold fill-slate-400 pointer-events-none">1루</text>

          {/* 3rd Base */}
          <rect
            x="5"
            y="53"
            width="34"
            height="34"
            rx="4"
            className={`transition-all duration-200 cursor-pointer stroke-2 stroke-slate-350 ${
              b3 ? 'fill-amber-500 stroke-amber-600 scale-105 origin-center' : 'fill-white hover:fill-slate-5'
            }`}
            onClick={() => toggleBase(3)}
          />
          <text x="22" y="74" textAnchor="middle" className="text-[10px] font-extrabold fill-slate-400 pointer-events-none">3루</text>

          {/* Homplate (Not clickable, static display) */}
          <polygon
            points="70,103 87,120 70,137 53,120"
            className="fill-slate-200 stroke-slate-300 stroke-2"
          />
          <text x="70" y="125" textAnchor="middle" className="text-[9px] font-extrabold fill-slate-500">HOM</text>
        </svg>
      </div>
    );
  };

  // Ball & Strike score addition logic
  const addBall = () => {
    updateGameState((prev) => {
      const nextBalls = prev.balls + 1;
      if (nextBalls >= 4) {
        // Automatically walk the batter
        showToast('🚶 [볼 4합] 볼넷 출루가 선언되었습니다.');
        return handleWalk(prev, '볼넷 출루 🚶');
      }
      return { ...prev, balls: nextBalls };
    });
  };

  const addStrike = () => {
    updateGameState((prev) => {
      const nextStrikes = prev.strikes + 1;
      if (nextStrikes >= 3) {
        showToast('❌ [스트라이크 3합] 삼진 아웃이 선언되었습니다.');
        return handleStrikeout(prev);
      }
      return { ...prev, strikes: nextStrikes };
    });
  };

  const addFoul = () => {
    updateGameState((prev) => {
      const nextStrikes = prev.strikes < 2 ? prev.strikes + 1 : prev.strikes;
      const logEntry: PlayLogEntry = { label: '파울', type: 'foul', inning: prev.inning, half: prev.half };
      return {
        ...prev,
        strikes: nextStrikes,
        playLog: [...prev.playLog, logEntry]
      };
    });
    showToast('⚾ 파울 선언 (2스트라이크 이후에는 카운트가 올라가지 않습니다)');
  };

  const addOut = (count = 1) => {
    updateGameState((prev) => {
      const nextOuts = prev.outs + count;
      if (nextOuts >= 3) {
        showToast('🔔 3아웃 교대! 기입 후 반이닝이 자동으로 전환됩니다.');
        // Deferred automatic changeover slightly to avoid abrupt UX
        setTimeout(() => handleInningChangeover(), 900);
        return { ...prev, outs: 3, balls: 0, strikes: 0 };
      }
      return { ...prev, outs: nextOuts, balls: 0, strikes: 0 };
    });
  };

  const advanceBatterLineup = (team: 'A' | 'B', currentId: string) => {
    const list = getBatterablePlayers(team);
    if (list.length === 0) return '';
    const currentIndex = list.findIndex((p) => String(p.id) === String(currentId));
    const nextIndex = (currentIndex + 1) % list.length;
    return String(list[nextIndex].id);
  };

  const handleWalk = (prev: GameState, label: string) => {
    let runsEarned = 0;
    const nextBases = [...prev.bases];

    if (prev.bases[1] && prev.bases[2] && prev.bases[3]) {
      runsEarned = 1;
      // All bases loaded - 3rd base runner forced home
      nextBases[3] = true; // Still loaded
    } else if (prev.bases[1] && prev.bases[2]) {
      nextBases[3] = true;
    } else if (prev.bases[1]) {
      nextBases[2] = true;
    }
    nextBases[1] = true;

    const scoringKey = prev.half === 'top' ? 'B' : 'A';
    const updatedInningScores = { ...prev.inningScores };
    const currentInningVal = updatedInningScores[`${scoringKey}-${prev.inning}`] || 0;

    let scoreA = prev.scoreA;
    let scoreB = prev.scoreB;

    if (runsEarned > 0) {
      if (scoringKey === 'A') {
        scoreA += runsEarned;
      } else {
        scoreB += runsEarned;
      }
      updatedInningScores[`${scoringKey}-${prev.inning}`] = currentInningVal + runsEarned;
      showToast(`💥 밀어내기 볼넷! [${prev.half === 'top' ? prev.teamB : prev.teamA}] 1점 득점`);
    }

    const logEntry: PlayLogEntry = {
      label,
      type: 'ball',
      inning: prev.inning,
      half: prev.half
    };

    const nextBatter = advanceBatterLineup(getBattingTeamKey(), prev.curBatter);

    return {
      ...prev,
      balls: 0,
      strikes: 0,
      bases: nextBases,
      scoreA,
      scoreB,
      inningScores: updatedInningScores,
      curBatter: nextBatter,
      playLog: [...prev.playLog, logEntry]
    };
  };

  const handleStrikeout = (prev: GameState) => {
    const nextOuts = prev.outs + 1;
    const logEntry: PlayLogEntry = {
      label: '삼진 K',
      type: 'out',
      inning: prev.inning,
      half: prev.half
    };

    const nextBatter = advanceBatterLineup(getBattingTeamKey(), prev.curBatter);

    if (nextOuts >= 3) {
      setTimeout(() => handleInningChangeover(), 900);
      return {
        ...prev,
        balls: 0,
        strikes: 0,
        outs: 3,
        curBatter: nextBatter,
        playLog: [...prev.playLog, logEntry]
      };
    }

    return {
      ...prev,
      balls: 0,
      strikes: 0,
      outs: nextOuts,
      curBatter: nextBatter,
      playLog: [...prev.playLog, logEntry]
    };
  };

  const handleInningChangeover = () => {
    updateGameState((prev) => {
      // Clear speedup Kbo counters upon half inning transition
      const updatedKbo = {
        ...prev.kbo,
        offTimeUsed: 0,
        ballChangeUsed: 0
      };

      const nextHalf = prev.half === 'top' ? 'bot' : 'top';
      const nextInning = prev.half === 'bot' ? Math.min(prev.inning + 1, 20) : prev.inning;

      showToast(`🔄 [이닝 교전] ${nextInning}회 ${nextHalf === 'top' ? '초' : '말'} 공격이 시작됩니다.`);

      // Reset batter selector base
      const battingKey = nextHalf === 'top' ? 'B' : 'A';
      const battingLineup = getBatterablePlayers(battingKey);
      const firstId = battingLineup.length > 0 ? String(battingLineup[0].id) : '';

      // Determine correct pitcher for the team that will now defend
      const nextPitchingKey = nextHalf === 'top' ? 'A' : 'B';
      const nextPitcherId = nextPitchingKey === 'A' ? prev.curPitcherA : prev.curPitcherB;

      return {
        ...prev,
        balls: 0,
        strikes: 0,
        outs: 0,
        bases: [false, false, false, false],
        half: nextHalf,
        inning: nextInning,
        kbo: updatedKbo,
        curBatter: firstId,
        curPitcher: nextPitcherId,
        playLog: []
      };
    });
  };

  // Advanced play loggers that invoke interactive React modals
  const handleSingleDoubleTriplePlay = (label: string, basesAdvancable: number) => {
    // Generate active base runners list
    const runners: { base: number; text: string }[] = [{ base: 0, text: '타자 (홈 ➔ 필드 진입)' }];
    [1, 2, 3].forEach((b) => {
      if (gameState.bases[b]) {
        runners.push({ base: b, text: `${b}루 주자` });
      }
    });

    const tempState: Record<number, number> = {};
    runners.forEach((r) => {
      tempState[r.base] = r.base === 0 ? basesAdvancable : Math.min(r.base + basesAdvancable, 4);
    });

    const content = (
      <div className="space-y-3 font-sans pb-3 border-b border-slate-100">
        <p className="text-xs text-slate-400">각 주자가 도달할 목적지 베이스를 선택하세요.</p>
        <div className="divide-y divide-slate-100 max-h-[240px] overflow-y-auto">
          {runners.map((r) => {
            const suggested = tempState[r.base];
            return (
              <div key={r.base} className="flex items-center justify-between py-2.5">
                <label htmlFor={`runner-dest-${r.base}`} className="text-sm font-bold text-slate-800">{r.text}</label>
                <select
                  id={`runner-dest-${r.base}`}
                  name={`runner-dest-${r.base}`}
                  defaultValue={suggested}
                  onChange={(e) => {
                    tempState[r.base] = parseInt(e.target.value);
                  }}
                  className="border border-slate-200 bg-white font-semibold text-slate-700 text-xs rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="0">이동 안 함</option>
                  <option value="1">1루</option>
                  <option value="2">2루</option>
                  <option value="3">3루</option>
                  <option value="4">홈인 (득점) ⭐</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>
    );

    const applyAdvancement = () => {
      updateGameState((prev) => {
        const nextBases = [false, false, false, false];
        let scored = 0;

        Object.keys(tempState).forEach((keyStr) => {
          const dest = tempState[parseInt(keyStr)];
          if (dest >= 4) {
            scored += 1;
          } else if (dest > 0) {
            nextBases[dest] = true;
          }
        });

        let updatedScoreA = prev.scoreA;
        let updatedScoreB = prev.scoreB;
        const scoringKey = prev.half === 'top' ? 'B' : 'A';
        const updatedInningScores = { ...prev.inningScores };

        if (scored > 0) {
          if (scoringKey === 'A') {
            updatedScoreA += scored;
          } else {
            updatedScoreB += scored;
          }
          const currentInningVal = updatedInningScores[`${scoringKey}-${prev.inning}`] || 0;
          updatedInningScores[`${scoringKey}-${prev.inning}`] = currentInningVal + scored;
          showToast(`💥 안타 출루 및 주자 전진! ${scored}점 득점 완료`);
        } else {
          showToast(`🏃 안타 출루! 베이스 주자가 진루했습니다.`);
        }

        const logEntry: PlayLogEntry = {
          label: `${label}${scored > 0 ? ` (${scored}점)` : ''}`,
          type: 'hit',
          inning: prev.inning,
          half: prev.half
        };

        const nextBatter = advanceBatterLineup(getBattingTeamKey(), prev.curBatter);

        return {
          ...prev,
          balls: 0,
          strikes: 0,
          bases: nextBases,
          scoreA: updatedScoreA,
          scoreB: updatedScoreB,
          inningScores: updatedInningScores,
          curBatter: nextBatter,
          playLog: [...prev.playLog, logEntry]
        };
      });
      setModal(null);
    };

    setModal({
      title: `${label} - 주자 이동 승인`,
      sub: `출루 방식: ${label}`,
      content,
      onApply: applyAdvancement
    });
  };

  const handleHomeRun = () => {
    updateGameState((prev) => {
      let scored = 1; // Batter scores
      [1, 2, 3].forEach((b) => {
        if (prev.bases[b]) scored += 1;
      });

      const scoringKey = prev.half === 'top' ? 'B' : 'A';
      const updatedInningScores = { ...prev.inningScores };
      const currentInningVal = updatedInningScores[`${scoringKey}-${prev.inning}`] || 0;
      updatedInningScores[`${scoringKey}-${prev.inning}`] = currentInningVal + scored;

      const scoreA = scoringKey === 'A' ? prev.scoreA + scored : prev.scoreA;
      const scoreB = scoringKey === 'B' ? prev.scoreB + scored : prev.scoreB;

      const logEntry: PlayLogEntry = {
        label: `홈런 💥 (${scored}점)`,
        type: 'hr',
        inning: prev.inning,
        half: prev.half
      };

      const nextBatter = advanceBatterLineup(getBattingTeamKey(), prev.curBatter);

      showToast(`💥💥 대형 홈런 폭발! 주자 전원 홈 슬라이딩해 총 ${scored}점 득점`);

      return {
        ...prev,
        balls: 0,
        strikes: 0,
        bases: [false, false, false, false],
        scoreA,
        scoreB,
        inningScores: updatedInningScores,
        curBatter: nextBatter,
        playLog: [...prev.playLog, logEntry]
      };
    });
  };

  // Force play advance (Balks, passed balls)
  const handleGenericAdvance = (label: string) => {
    const activeRunners = [1, 2, 3].filter((b) => gameState.bases[b]);
    if (activeRunners.length === 0) {
      showToast('⚠️ 보크/폭투 등이 발령되었으나 진루할 주자가 루상에 없습니다.');
      return;
    }

    const tempState: Record<number, number> = {};
    activeRunners.forEach((b) => {
      tempState[b] = b + 1; // Default advance by 1 base
    });

    const content = (
      <div className="space-y-3 font-sans pb-3 border-b border-slate-100">
        <p className="text-xs text-slate-400">주자가 이동할 베이스를 입력하세요.</p>
        {activeRunners.map((b) => (
          <div key={b} className="flex items-center justify-between py-2">
            <label htmlFor={`runner-bork-dest-${b}`} className="text-sm font-bold text-slate-800">{b}루 주자</label>
            <select
              id={`runner-bork-dest-${b}`}
              name={`runner-bork-dest-${b}`}
              defaultValue={tempState[b]}
              onChange={(e) => {
                tempState[b] = parseInt(e.target.value);
              }}
              className="border border-slate-200 bg-white font-semibold text-slate-700 text-xs rounded-lg px-2 py-1"
            >
              <option value="0">주자 견제사 아웃</option>
              <option value="1">1루</option>
              <option value="2">2루</option>
              <option value="3">3루</option>
              <option value="4">홈 (득점) ⭐</option>
            </select>
          </div>
        ))}
      </div>
    );

    const applyChange = () => {
      updateGameState((prev) => {
        const nextBases = [false, false, false, false];
        let scored = 0;
        let outsEarned = 0;

        activeRunners.forEach((b) => {
          const dest = tempState[b];
          if (dest >= 4) scored += 1;
          else if (dest > 0) nextBases[dest] = true;
          else outsEarned += 1;
        });

        // Retain un-advanced batter on plate
        let scoreA = prev.scoreA;
        let scoreB = prev.scoreB;
        const scoringKey = prev.half === 'top' ? 'B' : 'A';
        const updatedInningScores = { ...prev.inningScores };

        if (scored > 0) {
          if (scoringKey === 'A') scoreA += scored;
          else scoreB += scored;
          const currentInningVal = updatedInningScores[`${scoringKey}-${prev.inning}`] || 0;
          updatedInningScores[`${scoringKey}-${prev.inning}`] = currentInningVal + scored;
        }

        const logEntry: PlayLogEntry = {
          label: `${label}${scored > 0 ? ` (${scored}점 득점)` : ''}${outsEarned > 0 ? ` (주자 아웃 ${outsEarned})` : ''}`,
          type: scored > 0 ? 'hit' : 'ball',
          inning: prev.inning,
          half: prev.half
        };

        let nextOuts = prev.outs + outsEarned;
        if (nextOuts >= 3) {
          setTimeout(() => handleInningChangeover(), 900);
          nextOuts = 3;
        }

        return {
          ...prev,
          scoreA,
          scoreB,
          inningScores: updatedInningScores,
          bases: nextBases,
          outs: nextOuts,
          playLog: [...prev.playLog, logEntry]
        };
      });
      setModal(null);
    };

    setModal({
      title: `${label} - 주자 강제 진루`,
      sub: label,
      content,
      onApply: applyChange
    });
  };

  // Stealing base modal
  const handleStolenBaseAction = (isFailed: boolean, customLabel?: string) => {
    const activeRunners = [1, 2, 3].filter((b) => gameState.bases[b]);
    if (activeRunners.length === 0) {
      showToast('⚠️ 베이스 주자가 없어 도루를 신청할 수 없습니다.');
      return;
    }

    let selectedRunner = activeRunners[0];
    const label = customLabel || (isFailed ? '도루 실패 (CS)' : '도루 성공 (SB)');

    const content = (
      <div className="space-y-4 font-sans pb-3 border-b border-slate-100 text-xs">
        <div>
          <span className="block font-bold text-slate-700 mb-1">도루 대상 주자 선택</span>
          <div className="flex gap-2">
            {activeRunners.map((b) => (
              <label key={b} htmlFor={`steal-runner-${b}`} className="flex items-center gap-1.5 bg-slate-50 border rounded-lg px-3 py-1.5 cursor-pointer hover:bg-slate-100 font-semibold text-slate-800">
                <input
                  id={`steal-runner-${b}`}
                  type="radio"
                  name="steal-runner"
                  defaultChecked={b === selectedRunner}
                  onChange={() => {
                    selectedRunner = b;
                  }}
                  className="accent-slate-900 cursor-pointer"
                />
                {b}루 주자
              </label>
            ))}
          </div>
        </div>
      </div>
    );

    const applyChange = () => {
      const from = selectedRunner;
      const to = from + 1; // Stealing to next base

      updateGameState((prev) => {
        const nextBases = [...prev.bases];
        nextBases[from] = false;

        let scoreA = prev.scoreA;
        let scoreB = prev.scoreB;
        let outs = prev.outs;
        const updatedInningScores = { ...prev.inningScores };

        if (isFailed) {
          outs += 1;
          showToast(`🛑 [도루 실패] ${from}루 주자가 견제 태그아웃 당했습니다.`);
          if (outs >= 3) {
            setTimeout(() => handleInningChangeover(), 900);
            outs = 3;
          }
        } else {
          if (to >= 4) {
            const scoringKey = prev.half === 'top' ? 'B' : 'A';
            if (scoringKey === 'A') scoreA += 1;
            else scoreB += 1;
            updatedInningScores[`${scoringKey}-${prev.inning}`] = (updatedInningScores[`${scoringKey}-${prev.inning}`] || 0) + 1;
            showToast('🏃 홈스틸 성공! 공격팀 1점 득점!');
          } else {
            nextBases[to] = true;
            showToast(`🏃 도루 성공! ${from}루 주자가 ${to}루에 안착했습니다.`);
          }
        }

        const logEntry: PlayLogEntry = {
          label: `${label} (${from}루 ➔ ${to >= 4 ? '홈' : `${to}루`})`,
          type: isFailed ? 'out' : 'hit',
          inning: prev.inning,
          half: prev.half
        };

        return {
          ...prev,
          bases: nextBases,
          outs,
          scoreA,
          scoreB,
          inningScores: updatedInningScores,
          playLog: [...prev.playLog, logEntry]
        };
      });
      setModal(null);
    };

    setModal({
      title: `${label} - 도루 세부 기입`,
      sub: label,
      content,
      onApply: applyChange
    });
  };

  // Complex out modal (Flyout, groundout, Double-play)
  const handleOutModal = (label: string, outsToCredit: number, allowAdvance = false, isSacFly = false) => {
    const activeRunners = [1, 2, 3].filter((b) => gameState.bases[b]);
    const advanceMap: Record<number, boolean> = {};
    const destMap: Record<number, number> = {};
    const addtionalOutMap: Record<number, boolean> = {};

    activeRunners.forEach((b) => {
      advanceMap[b] = isSacFly && b === 3; // Default true on 3rd base runner on sacrifice fly
      destMap[b] = b + 1;
      addtionalOutMap[b] = false;
    });

    const content = (
      <div className="space-y-4 font-sans pb-3 border-b border-slate-100 text-xs">
        <p className="text-slate-400">타자는 아웃 처리됩니다. 주자 진루나 추가 사살 아웃 사항을 마킹하세요.</p>

        {allowAdvance && activeRunners.length > 0 && (
          <div className="space-y-2">
            <span className="block font-bold text-slate-700">주자 언더플레이/진루선택</span>
            {activeRunners.map((b) => (
              <div key={b} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-2 border border-slate-100 rounded-xl bg-slate-50/50">
                <label htmlFor={`advance-runner-${b}`} className="flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer select-none">
                  <input
                    id={`advance-runner-${b}`}
                    type="checkbox"
                    name={`advance-runner-${b}`}
                    defaultChecked={advanceMap[b]}
                    onChange={(e) => {
                      advanceMap[b] = e.target.checked;
                    }}
                    className="accent-slate-900 rounded cursor-pointer w-4 h-4"
                  />
                  {b}루 주자 진루
                </label>
                {/* Destination */}
                <select
                  id={`advance-dest-${b}`}
                  name={`advance-dest-${b}`}
                  aria-label={`${b}루 주자 진루 목적지`}
                  defaultValue={b + 1}
                  onChange={(e) => {
                    destMap[b] = parseInt(e.target.value);
                  }}
                  className="border border-slate-200 bg-white rounded-lg px-2 py-0.5"
                >
                  {[2, 3].filter((d) => d > b).map((d) => (
                    <option key={d} value={d}>{d}루</option>
                  ))}
                  <option value="4">홈 (득점) ⭐</option>
                </select>
              </div>
            ))}
          </div>
        )}

        {outsToCredit > 1 && activeRunners.length > 0 && (
          <div className="space-y-2">
            <span className="block font-bold text-slate-700 text-red-600">병살/추가 주자 태그아웃 지정</span>
            <div className="flex gap-2flex-wrap">
              {activeRunners.map((b) => (
                <label key={b} htmlFor={`double-play-runner-${b}`} className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer font-bold text-red-800">
                  <input
                    id={`double-play-runner-${b}`}
                    type="checkbox"
                    name={`double-play-runner-${b}`}
                    defaultChecked={addtionalOutMap[b]}
                    onChange={(e) => {
                      addtionalOutMap[b] = e.target.checked;
                    }}
                    className="accent-red-600 cursor-pointer w-4 h-4"
                  />
                  {b}루 주자 병살사
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );

    const applyChange = () => {
      updateGameState((prev) => {
        const nextBases = [...prev.bases];
        let scored = 0;
        let totalOutsEarned = outsToCredit;

        // Batter out unless it is specifically not counted
        nextBases[0] = false;

        // Calculate runner advancements
        activeRunners.forEach((b) => {
          if (advanceMap[b]) {
            nextBases[b] = false; // Left this base
            const dest = destMap[b];
            if (dest >= 4) {
              scored += 1;
            } else {
              nextBases[dest] = true;
            }
          }

          if (addtionalOutMap[b]) {
            nextBases[b] = false; // Out
            totalOutsEarned += 1;
          }
        });

        // Remove batter from base if he was credited as out
        const scoringKey = prev.half === 'top' ? 'B' : 'A';
        const updatedInningScores = { ...prev.inningScores };
        let scoreA = prev.scoreA;
        let scoreB = prev.scoreB;

        if (scored > 0) {
          if (scoringKey === 'A') scoreA += scored;
          else scoreB += scored;
          updatedInningScores[`${scoringKey}-${prev.inning}`] = (updatedInningScores[`${scoringKey}-${prev.inning}`] || 0) + scored;
          showToast(` 희생플레이/언더태그! ${scored}점 득점 반영 완료`);
        } else {
          showToast(`아웃 기입: ${label}`);
        }

        const logEntry: PlayLogEntry = {
          label: `${label}${scored > 0 ? ` (${scored}점 득점)` : ''}`,
          type: scored > 0 ? 'hit' : 'out',
          inning: prev.inning,
          half: prev.half
        };

        const nextBatter = advanceBatterLineup(getBattingTeamKey(), prev.curBatter);

        let nextOuts = prev.outs + totalOutsEarned;
        if (nextOuts >= 3) {
          setTimeout(() => handleInningChangeover(), 900);
          nextOuts = 3;
        }

        return {
          ...prev,
          balls: 0,
          strikes: 0,
          scoreA,
          scoreB,
          inningScores: updatedInningScores,
          bases: nextInningBases(nextBases, prev.bases, advanceMap, addtionalOutMap),
          outs: nextOuts,
          curBatter: nextBatter,
          playLog: [...prev.playLog, logEntry]
        };
      });
      setModal(null);
    };

    const nextInningBases = (
      nextBases: boolean[],
      original: boolean[],
      advanceMap: Record<number, boolean>,
      outMap: Record<number, boolean>
    ) => {
      const copyVal = [...nextBases];
      // Batter doesn't make base since he is out
      copyVal[1] = original[1] && !advanceMap[1] && !outMap[1];
      copyVal[2] = original[2] && !advanceMap[2] && !outMap[2];
      copyVal[3] = original[3] && !advanceMap[3] && !outMap[3];

      // Add newly advanced ones
      Object.keys(destMap).forEach((keyStr) => {
        const from = parseInt(keyStr);
        if (advanceMap[from]) {
          const dest = destMap[from];
          if (dest < 4) {
            copyVal[dest] = true;
          }
        }
      });

      return copyVal;
    };

    setModal({
      title: `${label} - 상세 아웃 및 득점 관리`,
      sub: label,
      content,
      onApply: applyChange
    });
  };

  const handleApplySingleAdvancing = (actionKey: string) => {
    switch (actionKey) {
      case 'single': return handleSingleDoubleTriplePlay('안타', 1);
      case 'double': return handleSingleDoubleTriplePlay('2루타', 2);
      case 'triple': return handleSingleDoubleTriplePlay('3루타', 3);
      case 'hr': return handleHomeRun();
      case 'bb': return updateGameState((p) => handleWalk(p, '볼넷 🚶'));
      case 'hbp': return updateGameState((p) => handleWalk(p, '몸에 맞는 공 🚶'));
      case 'pi': return updateGameState((p) => handleWalk(p, '타격 방해 🚶'));
      case 'fc': return handleSingleDoubleTriplePlay('야수 선택', 1);
      case 'e': return handleSingleDoubleTriplePlay('수비 실책 (E)', 1);

      // Outs
      case 'k': return updateGameState((p) => handleStrikeout(p));
      case 'k_looking': return updateGameState((p) => handleStrikeout(p));
      case 'go': return handleOutModal('땅볼 아웃', 1, true);
      case 'fo': return handleOutModal('플라이 아웃', 1, true);
      case 'lo': return handleOutModal('라인드라이브 아웃', 1, false);
      case 'sac_fly': return handleOutModal('희생 플라이', 1, true, true);
      case 'sac_bunt': return handleOutModal('희생 번트', 1, true);
      case 'interference': return handleOutModal('수비 / 주루 방해', 1, true);
      case 'dp': return handleOutModal('병살타 (DP)', 1, true); // credited to batter out, plus option to tag runner out
      case 'tp': return handleOutModal('삼중살 (TP)', 1, true);

      // Steals & Runs
      case 'sb': return handleStolenBaseAction(false);
      case 'cs': return handleStolenBaseAction(true);
      case 'pick_off': return handleStolenBaseAction(true, '견제사 out');
      case 'run_down': return handleStolenBaseAction(true, '런다운 태그아웃');
      case 'wp': return handleGenericAdvance('폭투 (WP)');
      case 'pb': return handleGenericAdvance('포일 (PB)');
      case 'bk': return handleGenericAdvance('보크 (BK)');
      default: return;
    }
  };

  const handleUndoSinglePlay = () => {
    if (gameState.playLog.length === 0) {
      showToast('⚠️ 취소할 경기 기록이 비어 있습니다.');
      return;
    }
    updateGameState((prev) => {
      const nextLog = [...prev.playLog];
      const items = nextLog.pop();
      showToast(`↩️ 마지막 기록 [ ${items?.label} ] 건이 전조 취소 처리되었습니다.`);
      return {
        ...prev,
        playLog: nextLog
      };
    });
  };

  const handleFullReset = () => {
    if (user?.email !== 'kmimseo1203@gmail.com') {
      showToast('🔒 경기 리셋 권한이 없습니다. 관리자 이메일(kmimseo1203@gmail.com)로 로그인이 필요합니다.');
      return;
    }
    if (!confirm('경기의 스코어 및 아웃카운트 데이터만 초기화합니다. 선수 등록 명단은 유지됩니다. 진행할까요?')) return;
    const defaultState: GameState = {
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
      curBatter: '',
      curPitcher: '',
      curPitcherA: '',
      curPitcherB: '',
      teamA: gameState.teamA,
      teamB: gameState.teamB,
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

    setRosters((prev) => {
      const restoredA = prev.A.map((p) => ({ ...p, status: 'active' as const }));
      const restoredB = prev.B.map((p) => ({ ...p, status: 'active' as const }));
      localStorage.setItem(ROSTER_KEY, JSON.stringify({ A: restoredA, B: restoredB, _pid: pid }));
      return { A: restoredA, B: restoredB };
    });

    setGameState(defaultState);
    saveState(defaultState);
    showToast('🧹 게임 판넬 점수 데이터 및 베이스 주자가 성공적으로 전면 초기화되었습니다.');
  };

  const handleExportFull = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      rosters,
      gameState,
      pid
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baseball_scorecard_full_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 현재 게임 전 구간 이닝 시뮬레이션 백업 파일 다운로드 완료.');
  };

  const handleCopyReport = () => {
    const { teamA, teamB, scoreA, scoreB, inning, half, balls, strikes, outs, bases, subLog, playLog, memo } = gameState;
    const basesActive = [1, 2, 3].filter((b) => bases[b]).map((b) => `${b}루`).join(', ') || '루상 무주자';

    const subText = subLog.map((s) => `  - ${s.inning}회 ${s.half === 'top' ? '초' : '말'} [${s.type}] ${s.in} 수혈 (물러남: ${s.out})`).join('\n') || '교체 기록 없음';
    const playsList = playLog.map((p) => p.label).join(', ') || '기록 없음';

    const report = `=== [야구 공식 심판 기록 보고] ===
경기 정보: ${teamA} (홈) ${scoreA} : ${scoreB} ${teamB} (원정)
진행 사항: ${inning}회 ${half === 'top' ? '초' : '말'}
볼 카운트: ${balls}볼 ${strikes}스트라이크 ${outs}아웃
주자 배정: ${basesActive}

KBO 한계량 사용기록:
  - 공격 타임아웃: ${gameState.kbo.offTimeUsed}/3
  - 감독 마운드 방문: ${gameState.kbo.moundVisitUsed}/2
  - 포수 마운드 방문: ${gameState.kbo.catcherMoundUsed}/${gameState.kbo.catcherMoundMax}
  - 볼교환 횟수: ${gameState.kbo.ballChangeUsed}/3

교체 현황:
${subText}

이닝별 투구 기록: ${playsList}
기록 메모: ${memo || '기입 정보 없음'}
=============================`;

    navigator.clipboard.writeText(report).then(
      () => showToast('📋 심판 보고서 데이터가 클립보드에 깔끔하게 복사되었습니다.'),
      () => alert(report)
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-12 font-sans selection:bg-slate-900 selection:text-white" id="main-container">
      {/* Dynamic Header */}
      <header className="bg-slate-900 text-white py-5 px-4 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="text-amber-400 shrink-0" size={26} />
            <div>
              <h1 className="text-lg font-black tracking-tight flex items-center gap-1.5">
                야구 심판 공식 스코어카드 및 스피드업 가이드
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">
                경기 기록 판정 제어 · 실시간 KBO 스피드업 한도 스틸러 · ABS 자동 궤적 판정기
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2 bg-slate-800 border border-slate-700/85 px-3 py-1.5 rounded-full text-xs" id="auth-profile">
                {user.picture ? (
                  <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full border border-white/20 shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0">G</div>
                )}
                <span className="text-slate-200 font-bold max-w-[80px] truncate" title={user.email}>{user.name}</span>
                <button
                  onClick={handleLogout}
                  className="text-[10px] text-slate-400 hover:text-rose-400 font-bold pl-2 border-l border-slate-700 transition-colors cursor-pointer"
                  id="btn-logout"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-full border border-indigo-500 shadow-md transition-all active:scale-95 cursor-pointer"
                id="btn-google-login"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.578-7.859-8s3.53-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l3.227-3.227C18.251 1.637 15.485 1 12.24 1c-6.075 0-11 4.925-11 11s4.925 11 11 11c6.34 0 10.564-4.453 10.564-10.75 0-.724-.078-1.275-.172-1.825H12.24z" />
                </svg>
                구글 로그인
              </button>
            )}
            <span className="text-[11px] font-semibold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-full border border-slate-700">
              공식 리그 룰셋 완비 포맷
            </span>
          </div>
        </div>
      </header>

      {/* Dynamic Sync Status bar right under the header */}
      <div className="bg-indigo-900/5 border-b border-indigo-150 py-2 px-4 shadow-inner-sm">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 text-indigo-900 font-bold">
            <span className={`w-2.5 h-2.5 rounded-full ${syncStatus === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : syncStatus === 'syncing' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'} shrink-0`} />
            <span>
              {syncStatus === 'success' && '✨ 실시간 기기 간 명단/스코인 클라우드 동기화 완료 (연결 완료)'}
              {syncStatus === 'syncing' && '🔄 연결된 휴대폰/태블릿의 최신 명단과 즉시 연동 중...'}
              {syncStatus === 'error' && '⚠️ 오프라인 모드 작동 중 (서버 대기 중)'}
              {syncStatus === 'idle' && '💤 동기화 대기 중'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="sync-enabled-chk" className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer">
              <input
                id="sync-enabled-chk"
                type="checkbox"
                name="sync-enabled"
                checked={syncEnabled}
                onChange={(e) => setSyncEnabled(e.target.checked)}
                className="rounded text-indigo-650 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-300"
              />
              <span>실시간 동기화 활성화</span>
            </label>
            <button
              onClick={async () => {
                if (user?.email !== 'kmimseo1203@gmail.com') {
                  showToast('🔒 전체 기기 연동 리셋 권한이 없습니다. 관리자 이메일(kmimseo1203@gmail.com)로 로그인이 필요합니다.');
                  return;
                }
                if (window.confirm("정말로 모든 장치의 명단과 게임 데이터를 초기값으로 리셋하시겠습니까?")) {
                  try {
                    const res = await fetch(getApiUrl('/api/sync/reset'), { method: 'POST' });
                    if (res.ok) {
                      const data = await res.json();
                      setGameState(data.gameState);
                      setRosters(data.rosters);
                      setPid(data.pid);
                      serverUpdateTimeRef.current = data.lastUpdateTime;
                      showToast('🔄 모든 연결 기기의 게임 및 명단 데이터가 전면 리셋 연동되었습니다.');
                    }
                  } catch (e) {
                    showToast('서버 초기화 실패');
                  }
                }
              }}
              className="text-[10px] text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold px-2 py-0.5 rounded cursor-pointer"
            >
              전체 기기 연동 리셋
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Menu Navigation inside Max Grid */}
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-2 flex justify-start items-center overflow-x-auto scrollbar-none gap-1 py-1.5">
          {[
            { id: 'game', label: '경기 카운트', icon: ClipboardList },
            { id: 'rosterA', label: `${gameState.teamA || '홈팀'} 명단`, icon: Users },
            { id: 'rosterB', label: `${gameState.teamB || '원정팀'} 명단`, icon: Users },
            { id: 'subs', label: '선수 교체', icon: RefreshCw },
            { id: 'kbo', label: 'KBO 공식규정', icon: Clock },
            { id: 'abs', label: '실시간 ABS 궤적', icon: Video }
          ].map((tab) => {
            const ActiveIcon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id as TabType)}
                className={`flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg transition-all absolute-transition whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                <ActiveIcon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Dynamic Alerts notification toast layer */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed top-16 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-50 max-w-md mx-auto"
          >
            <div className="bg-slate-950 text-white rounded-xl shadow-xl p-3 px-4 flex items-center justify-between border border-slate-850 gap-3">
              <span className="text-xs font-bold tracking-tight">{toast}</span>
              <button
                onClick={() => setToast(null)}
                className="text-[10px] uppercase font-bold text-slate-400 hover:text-white"
              >
                닫기
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content Canvas Frame Grid */}
      <main className="max-w-4xl mx-auto px-4 mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="space-y-6"
          >
            {/* TAB 1: Main Game controller views */}
            {currentTab === 'game' && (
              <div className="space-y-6">
                {/* Team naming labels input bar */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="w-full flex-1">
                      <label htmlFor="team-a-name-input" className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">홈팀 명칭</label>
                      <input
                        id="team-a-name-input"
                        name="teamA"
                        type="text"
                        value={gameState.teamA}
                        onChange={(e) => updateGameState({ teamA: e.target.value })}
                        className="w-full text-base font-black border-b-2 border-slate-100 hover:border-slate-250 focus:border-slate-800 focus:outline-none pb-1 bg-transparent text-center sm:text-left text-slate-850"
                      />
                    </div>
                    <span className="text-xs font-black text-slate-350 shrink-0 select-none">VS</span>
                    <div className="w-full flex-1">
                      <label htmlFor="team-b-name-input" className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1 text-center sm:text-right">원정팀 명칭</label>
                      <input
                        id="team-b-name-input"
                        name="teamB"
                        type="text"
                        value={gameState.teamB}
                        onChange={(e) => updateGameState({ teamB: e.target.value })}
                        className="w-full text-base font-black border-b-2 border-slate-100 hover:border-slate-250 focus:border-slate-800 focus:outline-none pb-1 bg-transparent text-center sm:text-right text-slate-850"
                      />
                    </div>
                  </div>

                  {/* Summary Scores layout card details */}
                  <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-center gap-1 md:gap-4 select-none">
                    <div className="text-center flex-1">
                      <span className="text-[10px] font-extrabold text-slate-400 tracking-widest block mb-2 uppercase">RUNS HOME</span>
                      <span className="text-4xl md:text-5xl font-black font-mono tracking-tighter text-slate-900 block leading-none">{gameState.scoreA}</span>
                      <div className="flex justify-center gap-1.5 mt-3.5">
                        <button onClick={() => updateGameState({ scoreA: Math.max(0, gameState.scoreA + 1) })} className="w-8 h-8 rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-100"><Plus size={14} /></button>
                        <button onClick={() => updateGameState({ scoreA: Math.max(0, gameState.scoreA - 1) })} className="w-8 h-8 rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-100"><Minus size={14} /></button>
                      </div>
                    </div>

                    <span className="text-3xl font-extrabold text-slate-300 px-2 leading-none">:</span>

                    <div className="text-center flex-1">
                      <span className="text-[10px] font-extrabold text-slate-400 tracking-widest block mb-2 uppercase">RUNS AWAY</span>
                      <span className="text-4xl md:text-5xl font-black font-mono tracking-tighter text-slate-900 block leading-none">{gameState.scoreB}</span>
                      <div className="flex justify-center gap-1.5 mt-3.5">
                        <button onClick={() => updateGameState({ scoreB: Math.max(0, gameState.scoreB + 1) })} className="w-8 h-8 rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-100"><Plus size={14} /></button>
                        <button onClick={() => updateGameState({ scoreB: Math.max(0, gameState.scoreB - 1) })} className="w-8 h-8 rounded-full border border-slate-200 bg-white shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-100"><Minus size={14} /></button>
                      </div>
                    </div>
                  </div>

                  {/* Half Inning Controls panel */}
                  <div className="flex items-center justify-center gap-1 sm:gap-3 py-1 bg-white border border-slate-100 rounded-xl max-w-xs mx-auto">
                    <button
                      onClick={() => updateGameState({ inning: Math.max(1, gameState.inning - 1) })}
                      className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                      title="이닝 감소"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-slate-900 font-mono tracking-tight">{gameState.inning}</span>
                      <span className="text-xs font-bold text-slate-500">회</span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-extrabold border ${
                          gameState.half === 'top'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {gameState.half === 'top' ? '초' : '말'}
                      </span>
                    </div>
                    <button
                      onClick={() => updateGameState({ inning: Math.min(20, gameState.inning + 1) })}
                      className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                      title="이닝 증가"
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={handleInningChangeover}
                      className="ml-3 px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-extrabold text-slate-600"
                    >
                      교대
                    </button>
                  </div>
                </div>

                {/* Batter & Pitcher select and details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                    <label htmlFor="cur-batter-select" className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      현재 타석 타자 ({getBattingTeamName()} 공격팀)
                    </label>
                    <select
                      id="cur-batter-select"
                      name="curBatter"
                      value={gameState.curBatter}
                      onChange={(e) => updateGameState({ curBatter: e.target.value })}
                      className="w-full border border-slate-250 bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-500 font-bold text-slate-800"
                    >
                      <option value="">-- 선수 리스트 선택 --</option>
                      {getBatterablePlayers(getBattingTeamKey()).map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.num} {p.name} ({p.pos})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                      투수 라인업 설정 (홈 / 원정 개별 지정)
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* 홈팀 투수 */}
                      <div className={`p-3 rounded-xl border transition-all ${getPitchingTeamKey() === 'A' ? 'bg-indigo-50/50 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-slate-50/30 border-slate-150'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="cur-pitcher-a-select" className="text-xs font-extrabold text-slate-700">🏠 홈투수 ({gameState.teamA})</label>
                          {getPitchingTeamKey() === 'A' && (
                            <span className="text-[9px] font-black tracking-wide uppercase bg-indigo-600 text-white px-1.5 py-0.5 rounded-md animate-pulse">수비 (마운드)</span>
                          )}
                        </div>
                        <select
                          id="cur-pitcher-a-select"
                          name="curPitcherA"
                          value={gameState.curPitcherA}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateGameState((prev) => ({
                              ...prev,
                              curPitcherA: val,
                              curPitcher: getPitchingTeamKey() === 'A' ? val : prev.curPitcher
                            }));
                          }}
                          className="w-full border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">-- 선수 리스트 선택 --</option>
                          {rosters.A
                            .filter((p) => p.pos === '투수' && p.status !== 'out')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                #{p.num} {p.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* 원정팀 투수 */}
                      <div className={`p-3 rounded-xl border transition-all ${getPitchingTeamKey() === 'B' ? 'bg-indigo-50/50 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-slate-50/30 border-slate-150'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="cur-pitcher-b-select" className="text-xs font-extrabold text-slate-700">🚌 원정투수 ({gameState.teamB})</label>
                          {getPitchingTeamKey() === 'B' && (
                            <span className="text-[9px] font-black tracking-wide uppercase bg-indigo-600 text-white px-1.5 py-0.5 rounded-md animate-pulse">수비 (마운드)</span>
                          )}
                        </div>
                        <select
                          id="cur-pitcher-b-select"
                          name="curPitcherB"
                          value={gameState.curPitcherB}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateGameState((prev) => ({
                              ...prev,
                              curPitcherB: val,
                              curPitcher: getPitchingTeamKey() === 'B' ? val : prev.curPitcher
                            }));
                          }}
                          className="w-full border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">-- 선수 리스트 선택 --</option>
                          {rosters.B
                            .filter((p) => p.pos === '투수' && p.status !== 'out')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                #{p.num} {p.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interactive Base Runner, Out circles and Live summary panel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {renderBasesSvg()}

                  {/* Balls strikes counts circle lists */}
                  <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 shadow-sm space-y-5">
                    <div>
                      <span className="text-xs font-bold text-slate-500 block mb-2.5">심판 볼카운트 기입</span>
                      <div className="space-y-2">
                        {/* Balls row */}
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-xs font-black text-slate-500">BALLS</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <span
                                key={i}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${
                                  i < gameState.balls
                                    ? 'bg-green-500 border-green-600 scale-105 shadow-sm'
                                    : 'bg-white border-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 w-8 pr-1.5">{gameState.balls}/3</span>
                        </div>

                        {/* Strikes row */}
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-xs font-black text-slate-500">STRIKES</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            {Array.from({ length: 2 }).map((_, i) => (
                              <span
                                key={i}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${
                                  i < gameState.strikes
                                    ? 'bg-amber-500 border-amber-600 scale-105 shadow-sm'
                                    : 'bg-white border-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 w-8 pr-1.5">{gameState.strikes}/2</span>
                        </div>

                        {/* Outs row */}
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-xs font-black text-slate-500">OUTS</span>
                          <div className="flex items-center gap-1.5 flex-1">
                            {Array.from({ length: 2 }).map((_, i) => (
                              <span
                                key={i}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${
                                  i < gameState.outs
                                    ? 'bg-red-500 border-red-600 scale-105 shadow-sm'
                                    : 'bg-white border-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 w-8 pr-1.5">{gameState.outs}/2</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={addBall}
                        className="flex-1 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-green-700 transition-all shadow-sm"
                      >
                        + 1볼
                      </button>
                      <button
                        onClick={addStrike}
                        className="flex-1 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-amber-700 transition-all shadow-sm"
                      >
                        + 1스트라이크
                      </button>
                      <button
                        onClick={() => addOut(1)}
                        className="flex-1 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-red-700 transition-all shadow-sm"
                      >
                        + 1아웃
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3.5">
                      <button
                        onClick={() => updateGameState({ balls: 0, strikes: 0 })}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                      >
                        <RefreshCw size={11} /> 볼카운트만 리셋
                      </button>
                      <button
                        onClick={() => updateGameState((p) => ({ ...p, balls: 0, strikes: 0, curBatter: advanceBatterLineup(getBattingTeamKey(), p.curBatter) }))}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                      >
                        → 다음 타자 수동 전환
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scoreboard and Speedup widget */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono">
                    이닝 전광판 (LINE SCOREBOARD)
                  </h4>
                  <ScoreBoardGrid gameState={gameState} />
                </div>

                {/* 실시간 양팀 전체 명단 (LIVE LINEUPS) */}
                <div className="space-y-2" id="live-lineups-view">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono flex items-center justify-between">
                    <span>실시간 경기 출전 선수 명단 (LIVE LINEUPS & ROSTERS)</span>
                    <span className="text-[10px] text-indigo-400 font-normal">상단의 개별 팀 탭에서 선수 정보 추가/수정이 가능합니다.</span>
                  </h4>
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      {/* 홈팀 명단 */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                          <span className="text-sm font-black text-indigo-700 flex items-center gap-1.5">
                            🏠 {gameState.teamA} (홈) 명단
                            <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold font-mono">
                              {rosters.A.length}명
                            </span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">현재 라인업 활성 매칭</span>
                        </div>
                        {rosters.A.length === 0 ? (
                          <p className="text-xs text-slate-400 py-4 text-center">등록된 홈팀 선수가 없습니다.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {rosters.A.map((p) => {
                              const isActiveBatter = gameState.curBatter === String(p.id) && getBattingTeamKey() === 'A';
                              const isActivePitcher = gameState.curPitcherA === String(p.id);
                              let highlightBg = 'bg-slate-50/60 border-slate-100';
                              if (isActiveBatter) highlightBg = 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/10 font-bold scale-[1.02] shadow-sm';
                              if (isActivePitcher) highlightBg = 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-500/10 font-bold scale-[1.02] shadow-sm';

                              return (
                                <div
                                  key={p.id}
                                  className={`flex items-center justify-between p-2 rounded-xl border transition-all ${highlightBg}`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[10px] text-slate-400 font-mono font-bold shrink-0">#{p.num}</span>
                                    <span className="truncate text-slate-800 font-bold text-ellipsis overflow-hidden whitespace-nowrap">{p.name}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[9px] bg-slate-200/80 text-slate-600 px-1 py-0.5 rounded font-black font-mono">{p.pos}</span>
                                    {isActiveBatter && <span className="text-[9px] bg-blue-600 text-white px-1 py-0.5 rounded font-black animate-pulse">타자</span>}
                                    {isActivePitcher && <span className="text-[9px] bg-indigo-600 text-white px-1 py-0.5 rounded font-black animate-pulse">투수</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 원정팀 명단 */}
                      <div className="space-y-3 pt-4 md:pt-0 md:pl-6">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                          <span className="text-sm font-black text-rose-700 flex items-center gap-1.5">
                            🚌 {gameState.teamB} (원정) 명단
                            <span className="text-xs bg-rose-50 text-rose-650 px-2 py-0.5 rounded-full font-bold font-mono">
                              {rosters.B.length}명
                            </span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">현재 라인업 활성 매칭</span>
                        </div>
                        {rosters.B.length === 0 ? (
                          <p className="text-xs text-slate-400 py-4 text-center">등록된 원정팀 선수가 없습니다.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {rosters.B.map((p) => {
                              const isActiveBatter = gameState.curBatter === String(p.id) && getBattingTeamKey() === 'B';
                              const isActivePitcher = gameState.curPitcherB === String(p.id);
                              let highlightBg = 'bg-slate-50/60 border-slate-100';
                              if (isActiveBatter) highlightBg = 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/10 font-bold scale-[1.02] shadow-sm';
                              if (isActivePitcher) highlightBg = 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-500/10 font-bold scale-[1.02] shadow-sm';

                              return (
                                <div
                                  key={p.id}
                                  className={`flex items-center justify-between p-2 rounded-xl border transition-all ${highlightBg}`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[10px] text-slate-400 font-mono font-bold shrink-0">#{p.num}</span>
                                    <span className="truncate text-slate-800 font-bold text-ellipsis overflow-hidden whitespace-nowrap">{p.name}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[9px] bg-slate-200/80 text-slate-600 px-1 py-0.5 rounded font-black font-mono">{p.pos}</span>
                                    {isActiveBatter && <span className="text-[9px] bg-blue-600 text-white px-1 py-0.5 rounded font-black animate-pulse">타자</span>}
                                    {isActivePitcher && <span className="text-[9px] bg-indigo-600 text-white px-1 py-0.5 rounded font-black animate-pulse">투수</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pitch Play controls panel */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono">
                    실시간 투구 및 플레이 기록기 (PITCH LOGIC)
                  </h4>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                    {/* Live streaming logs */}
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-2.5">
                        최근 플레이 로그
                      </span>
                      <div className="flex flex-wrap gap-2 min-h-12 border border-slate-100 p-3 bg-slate-50/50 rounded-xl items-center">
                        {gameState.playLog.length === 0 ? (
                          <span className="text-xs font-medium text-slate-400">아직 입력된 플레이 기록이 없습니다. 아래 간편 기입 단축키를 활용하세요.</span>
                        ) : (
                          gameState.playLog.map((log, i) => {
                            let bgClass = 'bg-slate-100 text-slate-600 border-slate-200';
                            if (log.type === 'hit') bgClass = 'bg-blue-50 text-blue-700 border-blue-200';
                            if (log.type === 'out') bgClass = 'bg-red-50 text-red-700 border-red-200';
                            if (log.type === 'foul') bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
                            if (log.type === 'hr') bgClass = 'bg-violet-50 text-violet-700 border-violet-200';

                            return (
                              <span
                                key={i}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${bgClass}`}
                              >
                                {log.label}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Fast logging controls buttons */}
                    <div className="space-y-4">
                      {/* Balls and strikes */}
                      <div>
                        <span className="text-[10px] uppercase font-black text-slate-400 block mb-2 tracking-wider">볼카운트 기입</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <button
                            onClick={addBall}
                            className="py-1.5 px-3 bg-green-50 text-green-700 hover:bg-green-100 rounded-xl text-xs font-bold border border-green-200 transition-all"
                          >
                            볼 기입
                          </button>
                          <button
                            onClick={addStrike}
                            className="py-1.5 px-3 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-xl text-xs font-bold border border-amber-200 transition-all"
                          >
                            스트라이크 기입
                          </button>
                          <button
                            onClick={addFoul}
                            className="py-1.5 px-3 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-bold border border-slate-200 transition-all"
                          >
                            파울
                          </button>
                          <button
                            onClick={addFoul}
                            className="py-1.5 px-3 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-bold border border-slate-200 transition-all"
                          >
                            번트 파울
                          </button>
                        </div>
                      </div>

                      {/* Advances & scoring */}
                      <div>
                        <span className="text-[10px] uppercase font-black text-slate-400 block mb-2 tracking-wider">안타 및 출루 판정</span>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: 'single', label: '단타 🏃', bg: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
                            { key: 'double', label: '2루타 🏃🏃', bg: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
                            { key: 'triple', label: '3루타 🏃🏃🏃', bg: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200' },
                            { key: 'hr', label: '홈런 💥', bg: 'bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200' },
                            { key: 'bb', label: '볼넷 지정 🚶', bg: 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-150' },
                            { key: 'hbp', label: '데드볼 사구 🚶', bg: 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-150' },
                            { key: 'fc', label: '야수 선택', bg: 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-150' },
                            { key: 'e', label: '수비 실책', bg: 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-150' }
                          ].map((a) => (
                            <button
                              key={a.key}
                              onClick={() => handleApplySingleAdvancing(a.key)}
                              className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all shadow-sm ${a.bg}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Outs */}
                      <div>
                        <span className="text-[10px] uppercase font-black text-slate-400 block mb-2 tracking-wider">그라운드 아웃 판정</span>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: 'k', label: '삼진 K ❌', bg: 'bg-red-50 text-red-750 hover:bg-red-105 border-red-200' },
                            { key: 'go', label: '땅볼 아웃', bg: 'bg-slate-50 text-slate-750 hover:bg-slate-100 border-slate-150' },
                            { key: 'fo', label: '플라이 아웃', bg: 'bg-slate-50 text-slate-750 hover:bg-slate-100 border-slate-150' },
                            { key: 'lo', label: '라인드라이브', bg: 'bg-slate-50 text-slate-750 hover:bg-slate-100 border-slate-150' },
                            { key: 'sac_fly', label: '희생 플라이', bg: 'bg-slate-50 text-slate-750 hover:bg-slate-100 border-slate-150' },
                            { key: 'sac_bunt', label: '희생 번트', bg: 'bg-slate-50 text-slate-750 hover:bg-slate-100 border-slate-150' },
                            { key: 'dp', label: '병살타 (DP)', bg: 'bg-red-50 text-red-750 hover:bg-red-105 border-red-200' },
                            { key: 'tp', label: '삼중살 (TP)', bg: 'bg-red-50 text-red-750 hover:bg-red-105 border-red-200' }
                          ].map((a) => (
                            <button
                              key={a.key}
                              onClick={() => handleApplySingleAdvancing(a.key)}
                              className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all shadow-sm ${a.bg}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Steals & Runners actions */}
                      <div>
                        <span className="text-[10px] uppercase font-black text-slate-400 block mb-2 tracking-wider">주루 및 기타 변동</span>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: 'sb', label: '도루 성공 (SB) 🏃', bg: 'bg-slate-50 text-slate-750 border-slate-150' },
                            { key: 'cs', label: '도루 실패 (CS) 🛑', bg: 'bg-red-50 text-red-750 border-red-220' },
                            { key: 'wp', label: '폭투 (WP)', bg: 'bg-slate-50 text-slate-750 border-slate-150' },
                            { key: 'pb', label: '포일 (PB)', bg: 'bg-slate-50 text-slate-750 border-slate-150' },
                            { key: 'bk', label: '보크 (BK)', bg: 'bg-slate-50 text-slate-750 border-slate-150' },
                            { key: 'pick_off', label: '견제사', bg: 'bg-red-50 text-red-750 border-red-220' },
                            { key: 'run_down', label: '협살 아웃', bg: 'bg-red-50 text-red-750 border-red-220' }
                          ].map((a) => (
                            <button
                              key={a.key}
                              onClick={() => handleApplySingleAdvancing(a.key)}
                              className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all shadow-sm ${a.bg}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
                      <button
                        onClick={handleUndoSinglePlay}
                        className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl border border-slate-200 text-xs font-bold hover:bg-slate-50 text-slate-650"
                      >
                        <Undo2 size={13} /> 마지막 기입 플레이 취소
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline rules checker */}
                <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
                  <div className="absolute right-0 bottom-0 translate-y-1/3 translate-x-1/4 opacity-15 text-slate-100 scale-150 select-none">
                    <Clock size={160} />
                  </div>
                  <KboLimitTracker
                    kbo={gameState.kbo}
                    onChangeKbo={(updated) => updateGameState({ kbo: updated })}
                    showToast={showToast}
                  />
                </div>

                {/* Umpire text memoing screen */}
                <div className="space-y-2">
                  <label htmlFor="umpire-memo-textarea" className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono block mb-1">
                    심판 특이사항 및 그라운드 메모 (UMPIRE NOTES)
                  </label>
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <textarea
                      id="umpire-memo-textarea"
                      name="umpireMemo"
                      placeholder="특이 판정 시위 항의 사항, 우천 대기 혹은 선수 부상 기록 등을 기입하세요..."
                      value={gameState.memo}
                      onChange={(e) => updateGameState({ memo: e.target.value })}
                      className="w-full text-sm border border-slate-150 rounded-xl p-3 focus:outline-none focus:border-slate-400 min-h-24 resize-y bg-slate-50/20"
                    />
                  </div>
                </div>

                {/* System export and restore handlers */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleExportFull}
                      className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl px-4 py-2 text-xs font-bold transition-all"
                    >
                      <Download size={14} /> 경기 전체 JSON 백업 다운로드
                    </button>
                    <button
                      onClick={handleCopyReport}
                      className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl px-4 py-2 text-xs font-bold transition-all"
                    >
                      <Copy size={14} /> 보고서 텍스트 복사
                    </button>
                  </div>
                  <button
                    onClick={handleFullReset}
                    className="bg-red-50 hover:bg-red-100 text-red-650 rounded-xl px-4 py-2 text-xs font-extrabold flex items-center gap-1.5 transition-all"
                  >
                    <Trash2 size={13} /> 전면 경기 스코어보드 리셋
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2 & 3: Roster managers */}
            {(currentTab === 'rosterA' || currentTab === 'rosterB') && (
              <RosterManager
                team={currentTab === 'rosterA' ? 'A' : 'B'}
                teamName={currentTab === 'rosterA' ? gameState.teamA : gameState.teamB}
                players={rosters[currentTab === 'rosterA' ? 'A' : 'B']}
                onPlayersChange={(updated) => handlePlayersChange(currentTab === 'rosterA' ? 'A' : 'B', updated)}
                showToast={showToast}
                onRequestIncrementPid={handleIncrementPid}
                isAdmin={user?.email === 'kmimseo1203@gmail.com'}
              />
            )}

            {/* TAB 4: Substitutes manager */}
            {currentTab === 'subs' && (
              <SubstitutionManager
                inning={gameState.inning}
                half={gameState.half}
                rosters={rosters}
                onUpdateRosters={handlePlayersChange}
                subLog={gameState.subLog}
                onAddSubLog={(newEntry) => updateGameState((prev) => ({ ...prev, subLog: [newEntry, ...prev.subLog] }))}
                showToast={showToast}
                teamAName={gameState.teamA}
                teamBName={gameState.teamB}
              />
            )}

            {/* TAB 5: KBO Speed-up detailed Rules directory */}
            {currentTab === 'kbo' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Info className="text-blue-500" size={18} />
                    <h3 className="font-bold text-slate-800 text-sm">2025 KBO 공식 개정 세부 스피드업 규정</h3>
                  </div>

                  <div className="space-y-4 text-xs leading-relaxed text-slate-650">
                    <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl space-y-1">
                      <span className="font-extrabold text-blue-800 text-xs">⏰ 타자 타석 무단 이탈 금지</span>
                      <p>타자는 투구 간 최소 한 발은 타석 내에 머물러야 합니다. 미이탈 위반 시 즉각 서면 경고 조치 및 건당 20만원의 선수 벌금이 부과됩니다.</p>
                    </div>

                    <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl space-y-1">
                      <span className="font-extrabold text-amber-800 text-xs">🏃 감독 및 코칭스태프 항의 시간제</span>
                      <p>감독 단독 어필만 허용되며, 동반 코치진 접근은 금지됩니다. 3분 경과 시 1차 경고, 4분 도과 시 즉각 심판 직권 퇴장 명령이 주어집니다.</p>
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-1">
                      <span className="font-extrabold text-slate-800 text-xs text-slate-700">⚾ 투구수 / 투수 볼 무단 교체 제한</span>
                      <p>심판으로부터의 공 교체 희망 시 이닝당 최대 투수별 3구까지로 제한하며 (우천 등 천재지변 제외), 포수가 마운드에 동의 없이 동반 집결하는 횟수를 엄격히 규제합니다.</p>
                    </div>

                    <div className="p-3 bg-red-50/50 border border-red-100 rounded-xl space-y-1">
                      <span className="font-extrabold text-red-800 text-xs">⏱️ 포격 단축: 마운드 30초 / 피치교환 2분 20초</span>
                      <p>교체 타작 수 시간 지연 조치 시 주심은 즉각 타이머 경고음을 울리며, 투수가 20초 룰 초과 시 자동 1볼 부여 패널티가 부과됩니다.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: ABS Camera pitch detector program */}
            {currentTab === 'abs' && (() => {
              const getActiveBatterName = () => {
                const key = gameState.half === 'top' ? 'B' : 'A';
                const list = rosters[key] || [];
                const found = list.find((p: any) => String(p.id) === gameState.curBatter);
                return found ? found.name : '';
              };

              const getActivePitcherName = () => {
                const pitchingKey = gameState.half === 'top' ? 'A' : 'B';
                const list = rosters[pitchingKey] || [];
                const activePitcherId = pitchingKey === 'A' ? gameState.curPitcherA : gameState.curPitcherB;
                const found = list.find((p: any) => String(p.id) === activePitcherId);
                return found ? found.name : '';
              };

              return (
                <AbsPitchTracker
                  onAddBall={addBall}
                  onAddStrike={addStrike}
                  showToast={showToast}
                  balls={gameState.balls}
                  strikes={gameState.strikes}
                  gameState={gameState}
                  rosters={rosters}
                  batterName={getActiveBatterName()}
                  pitcherName={getActivePitcherName()}
                />
              );
            })()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Advanced React Modal Dialog Overlay */}
      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-sm w-full p-5 space-y-4"
              id="app-modal"
            >
              <div>
                <h3 className="font-black text-slate-905 text-base">{modal.title}</h3>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-extrabold uppercase px-2 py-0.5 rounded-full inline-block mt-1">
                  {modal.sub}
                </span>
              </div>

              <div>{modal.content}</div>

              <div className="flex items-center justify-end gap-2 text-xs font-bold pt-1">
                <button
                  onClick={() => setModal(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-500"
                >
                  취소
                </button>
                <button
                  onClick={modal.onApply}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm"
                >
                  기입 확정
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
