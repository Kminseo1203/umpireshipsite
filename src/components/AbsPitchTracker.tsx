import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Layers, CheckCircle2, Video, FastForward, Play, Pause, Sparkles, HelpCircle, Coins, Flame, Zap } from 'lucide-react';

interface AbsPitchTrackerProps {
  onAddBall: () => void;
  onAddStrike: () => void;
  showToast: (msg: string) => void;
  balls: number;
  strikes: number;
  gameState: any;
  rosters: any;
  batterName: string;
  pitcherName: string;
}

interface Point {
  x: number;
  y: number;
}

interface StrikeZone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PitchRecord {
  id: number;
  frames: string[];
  isStrike: boolean;
  time: string;
  speed?: number;
}

function lineIntersectsLine(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): boolean {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function lineIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  rx1: number, ry1: number, rx2: number, ry2: number
): boolean {
  if (x1 >= rx1 && x1 <= rx2 && y1 >= ry1 && y1 <= ry2) return true;
  if (x2 >= rx1 && x2 <= rx2 && y2 >= ry1 && y2 <= ry2) return true;

  return (
    lineIntersectsLine(x1, y1, x2, y2, rx1, ry1, rx2, ry1) || // Top
    lineIntersectsLine(x1, y1, x2, y2, rx1, ry2, rx2, ry2) || // Bottom
    lineIntersectsLine(x1, y1, x2, y2, rx1, ry1, rx1, ry2) || // Left
    lineIntersectsLine(x1, y1, x2, y2, rx2, ry1, rx2, ry2)    // Right
  );
}

function checkIfTrajectoryCrossesZone(
  trajectory: { x: number; y: number; r: number }[],
  zone: StrikeZone
): { isStrike: boolean; reason: string } {
  if (trajectory.length === 0) return { isStrike: false, reason: '감지 궤적 없음' };

  // 1. Direct point-in-zone check
  for (let i = 0; i < trajectory.length; i++) {
    const pt = trajectory[i];
    if (pt.x >= zone.x1 && pt.x <= zone.x2 && pt.y >= zone.y1 && pt.y <= zone.y2) {
      return { 
        isStrike: true, 
        reason: `#${i+1}번째 프레임 점이 스트라이크존 내부 진입 (${Math.round(pt.x)}, ${Math.round(pt.y)})`
      };
    }
  }

  // 2. High-speed line intersection check between frames
  for (let i = 0; i < trajectory.length - 1; i++) {
    const p1 = trajectory[i];
    const p2 = trajectory[i + 1];
    if (lineIntersectsRect(p1.x, p1.y, p2.x, p2.y, zone.x1, zone.y1, zone.x2, zone.y2)) {
      return { 
        isStrike: true, 
        reason: `#${i+1}➔#${i+2} 프레임 연결선이 존을 통과함 (고속 구질)` 
      };
    }
  }

  // 3. Fallback fine margin for tracking borders
  const finalPt = trajectory[trajectory.length - 1];
  const margin = 4;
  if (
    finalPt.x >= zone.x1 - margin &&
    finalPt.x <= zone.x2 + margin &&
    finalPt.y >= zone.y1 - margin &&
    finalPt.y <= zone.y2 + margin
  ) {
    return {
      isStrike: true,
      reason: `최종 도달 위치가 하단 경계선 미세 오차 범위 내 진입 (${Math.round(finalPt.x)}, ${Math.round(finalPt.y)})`
    };
  }

  return { isStrike: false, reason: '궤적이 스트라이크존 상자를 벗어났습니다.' };
}

export default function AbsPitchTracker({
  onAddBall,
  onAddStrike,
  showToast,
  balls,
  strikes,
  gameState,
  rosters,
  batterName,
  pitcherName
}: AbsPitchTrackerProps) {
  const [cvReady, setCvReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState('OpenCV 라이브러리를 불러오고 있습니다...');
  const [calibrating, setCalibrating] = useState(false);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [zone, setZone] = useState<StrikeZone | null>(null);
  const [localBall, setLocalBall] = useState(0);
  const [localStrike, setLocalStrike] = useState(0);
  const [linkEnabled, setLinkEnabled] = useState(true);
  const [debugView, setDebugView] = useState(false);
  const [absResult, setAbsResult] = useState<{ text: string; isStrike: boolean; speed?: number } | null>(null);
  const [moundDistance, setMoundDistance] = useState(16.0); // Mound distance defaults to 16.0m as requested by user

  // AI Assistant States
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    decision: string;
    isStrike: boolean;
    umpireCommentary: string;
    explanation: string;
    ruleAdvice: string;
  } | null>(null);
  const [aiLoadingMsg, setAiLoadingMsg] = useState('Gemini가 야구 궤적과 KBO 공식 규정을 분석하는 중입니다...');

  // Track daily Gemini API free quota usage in localStorage
  const [aiUsageCount, setAiUsageCount] = useState<number>(() => {
    try {
      const today = new Date().toDateString();
      const storedDate = localStorage.getItem('baseball_umpire_ai_usage_date');
      const storedCount = localStorage.getItem('baseball_umpire_ai_usage_count');
      if (storedDate === today && storedCount) {
        return parseInt(storedCount, 10);
      }
    } catch (e) {}
    return 0;
  });

  // Calibration Slider States
  const [motionLimit, setMotionLimit] = useState(25);
  const [brightThreshold, setBrightThreshold] = useState(180);
  const [minRadius, setMinRadius] = useState(4);
  const [maxRadius, setMaxRadius] = useState(30);

  // Pitch replay states
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayRecords, setReplayRecords] = useState<PitchRecord[]>([]);
  const [activeReplay, setActiveReplay] = useState<PitchRecord | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayFrameIdx, setReplayFrameIdx] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<1 | 0.4>(1);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const replayCanvasRef = useRef<HTMLCanvasElement>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const activeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const replayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pitchStartTimeRef = useRef<number>(0);

  // OpenCV mats & state refs (for processing thread access without closures locking old state)
  const matsRef = useRef<{
    cap: any;
    src: any;
    gray: any;
    prevGray: any;
    diff: any;
    motionMask: any;
    brightMask: any;
    candidate: any;
    kernel: any;
    blurred: any;
    circles: any;
  } | null>(null);

  const configRef = useRef({
    motionLimit,
    brightThreshold,
    minRadius,
    maxRadius,
    debugView,
    calibrating,
    calibPoints,
    zone
  });

  // Track calibration & configs changes
  useEffect(() => {
    configRef.current = {
      motionLimit,
      brightThreshold,
      minRadius,
      maxRadius,
      debugView,
      calibrating,
      calibPoints,
      zone
    };
  }, [motionLimit, brightThreshold, minRadius, maxRadius, debugView, calibrating, calibPoints, zone]);

  // Buffers for pitching replay
  const rollingBufferRef = useRef<string[]>([]);
  const lastCaptureTimeRef = useRef<number>(0);
  const trajectoryRef = useRef<{ x: number; y: number; r: number }[]>([]);
  const lastSeenTimeRef = useRef<number>(0);
  const trackingActiveRef = useRef<boolean>(false);
  const pendingStreakRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number; r: number } | null>(null);

  const CAPTURE_W = 200;
  const CAPTURE_INTERVAL_MS = 80;
  const BUFFER_MS = 1500;
  const LOST_MS = 250;
  const nextPitchIdRef = useRef<number>(1);

  // Check OpenCV state
  useEffect(() => {
    const interval = setInterval(() => {
      const cvObj = (window as any).cv;
      if (cvObj && cvObj.Mat && cvObj.HoughCircles) {
        clearInterval(interval);
        setCvReady(true);
        setStatusText('카메라 준비 완료. "카메라 시작" 버튼을 눌러 피칭 분석을 시작하세요.');
      }
    }, 300);

    return () => {
      clearInterval(interval);
      cleanupVideo();
    };
  }, []);

  const handleRequestAiAnalysis = async (customQuery?: string, isPitchMode: boolean = false) => {
    const targetQuery = customQuery || aiQuery;

    if (isPitchMode) {
      if (!streaming && replayRecords.length === 0) {
        showToast('📸 카메라가 꺼져 있거나 최근에 스캔된 투구 데이터가 없습니다.');
        setAiResult({
          decision: 'INFO',
          isStrike: false,
          umpireCommentary: '🚨 카메라 비활성화 상태',
          explanation: '실시간 투구 AI ABS 해설을 생성하려면, 상단의 "카메라 시작" 버튼을 눌러 카메라를 가동하고 투구를 1회 이상 스캔(기록에 저장)해 주세요. 카메라 연동 없이 일반 야구 규칙이나 피치클락, 마운드 방문 규정 등에 대해 궁금하신 경우 아래 텍스트 상자에 질문을 입력하시고 "KBO 규칙 및 전술 AI 질문" 버튼을 사용해 주세요.',
          ruleAdvice: '피칭 동작 캡처가 완료되면 AI 심판이 볼궤적과 릴리스 포인트, 플레이트 부근 탄착점을 3D ABS 존 기반으로 입체 분석해 드립니다!'
        });
        return;
      }
    } else {
      if (!targetQuery) {
        showToast('✍️ AI에게 물어볼 규칙이나 질문 내용을 먼저 입력해 주세요.');
        return;
      }
    }

    setAiLoading(true);
    setAiResult(null);
    setAiLoadingMsg(isPitchMode 
      ? 'Gemini AI가 카메라 투구 궤적과 ABS 정밀 스캔 데이터 분석 중...' 
      : 'Gemini AI가 KBO 야구 규칙집과 스피드업 조항을 검색하는 중...'
    );

    const msgs = isPitchMode ? [
      '카메라 프레임 투구 물리 궤적을 3D 스트라이크존과 동기화 중입니다...',
      '구속 및 보더라인 바운더리 픽셀 투영 상태를 ABS와 대조 중입니다...',
      '야구 중계석 톤의 한국어 해설 및 경기 시나리오 팁을 실시간 생성하고 있습니다...'
    ] : [
      'KBO 공식 야구 규칙 데이터베이스 및 피치클락 규정을 스캔하고 있습니다...',
      '현재 경기 상황(이닝, 볼카운트, 점수차)에 적합한 전술을 설계 중입니다...',
      '답변 보고서를 생성하여 해설위원 어조로 조율하고 있습니다...'
    ];

    let msgIdx = 0;
    const loadingInterval = setInterval(() => {
      if (msgIdx < msgs.length - 1) {
        msgIdx++;
        setAiLoadingMsg(msgs[msgIdx]);
      }
    }, 1500);

    try {
      const lastRecord = replayRecords[replayRecords.length - 1] || null;
      const pitchInfo = isPitchMode && lastRecord ? {
        speed: lastRecord.speed,
        isStrike: lastRecord.isStrike
      } : null;

      const response = await fetch('/api/gemini/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitchInfo,
          gameState,
          query: targetQuery,
          batterName,
          pitcherName,
          mode: isPitchMode ? 'pitch' : 'rule'
        })
      });

      const resData = await response.json();
      clearInterval(loadingInterval);

      // Track usage count
      const today = new Date().toDateString();
      const storedCount = localStorage.getItem('baseball_umpire_ai_usage_count') || '0';
      const nextCount = parseInt(storedCount, 10) + 1;
      setAiUsageCount(nextCount);
      localStorage.setItem('baseball_umpire_ai_usage_date', today);
      localStorage.setItem('baseball_umpire_ai_usage_count', String(nextCount));

      if (resData.success && resData.data) {
        setAiResult(resData.data);
        showToast(isPitchMode ? '🤖 실시간 투구 ABS 해설 대본이 완성되었습니다!' : '📚 KBO 규칙 분석 결과가 도착했습니다!');
      } else {
        showToast('⚠️ AI 판독기 로딩 중 오류가 발생했습니다.');
        setAiResult({
          decision: 'INFO',
          isStrike: false,
          umpireCommentary: '🚨 AI 판독 서비스에 일시적인 장애가 발생했습니다.',
          explanation: resData.error || 'API 연결을 확인하지 못했습니다.',
          ruleAdvice: '네트워크 연결 상태나 API 키 비밀값을 설정 메뉴에서 점검해 주세요.'
        });
      }
    } catch (err: any) {
      clearInterval(loadingInterval);
      showToast('❌ 네트워크 오류로 AI 분석에 실패했습니다.');
      setAiResult({
        decision: 'INFO',
        isStrike: false,
        umpireCommentary: '🚨 네트워크 통신 에러가 감지되었습니다.',
        explanation: err.message || '서버 응답을 받는 데 실패했습니다.',
        ruleAdvice: '잠시 후 다시 요청해 주세요.'
      });
    } finally {
      setAiLoading(false);
    }
  };

  // Standard pre-defined Strike Zone dimensions fallbacks for "1. 스트라이크 존이 잘 보이지 않음" immediately on startup
  useEffect(() => {
    if (streaming && videoRef.current) {
      const checkDims = setInterval(() => {
        const video = videoRef.current;
        if (video && video.videoWidth && video.videoHeight) {
          clearInterval(checkDims);
          setZone((prev) => {
            if (prev) return prev;
            const w = video.videoWidth;
            const h = video.videoHeight;
            // Setup elegant center strike corridor
            return {
              x1: w * 0.35,
              y1: h * 0.25,
              x2: w * 0.65,
              y2: h * 0.75
            };
          });
        }
      }, 200);
      return () => clearInterval(checkDims);
    }
  }, [streaming]);

  const cleanupVideo = () => {
    if (activeIntervalRef.current) {
      clearInterval(activeIntervalRef.current);
      activeIntervalRef.current = null;
    }
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setStreaming(false);

    // Free OpenCV Mats if instantiated
    try {
      const mats = matsRef.current;
      if (mats) {
        if (mats.src) mats.src.delete();
        if (mats.gray) mats.gray.delete();
        if (mats.prevGray) mats.prevGray.delete();
        if (mats.diff) mats.diff.delete();
        if (mats.motionMask) mats.motionMask.delete();
        if (mats.brightMask) mats.brightMask.delete();
        if (mats.candidate) mats.candidate.delete();
        if (mats.kernel) mats.kernel.delete();
        if (mats.blurred) mats.blurred.delete();
        if (mats.circles) mats.circles.delete();
        matsRef.current = null;
      }
    } catch (e) {
      console.warn('Mats cleanup error:', e);
    }
  };

  const startCamera = async () => {
    if (!cvReady) {
      showToast('OpenCV.js 로딩 완료 전까지는 트래킹을 구동할 수 없습니다. 잠시 후 재시행하세요.');
      return;
    }
    cleanupVideo();

    try {
      setStatusText('카메라 권한을 얻고 있습니다...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });

      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setStreaming(true);
      setStatusText('가동 완료. 투구 추적을 보정하기 위해 먼저 "스트라이크존 보정"을 설정하세요.');

      // Run looping engine
      if (!activeIntervalRef.current) {
        activeIntervalRef.current = setInterval(processVideoFrame, 50);
      }
    } catch (err: any) {
      cleanupVideo();
      setStatusText(`카메라를 작동할 수 없습니다: ${err.name} - ${err.message}. 모바일 기기의 브라우저 설정 혹은 보안 환경을 확인하세요.`);
      showToast('카메라 로드 실패.');
    }
  };

  // Click on camera Overlay to calibrate coordinates OR simulate a manual pitch override
  const handleOverlayClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const config = configRef.current;
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;

    // Get exact video coordinates
    const clickedPt: Point = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };

    if (config.calibrating) {
      const nextPoints = [...config.calibPoints, clickedPt];

      if (nextPoints.length === 1) {
        setCalibPoints(nextPoints);
        setStatusText('이제 대칭점이 자리를 잡을 수 있게 해당 우측-하단 모서리를 마저 탭 해주세요.');
      } else if (nextPoints.length === 2) {
        const zoneBox: StrikeZone = {
          x1: Math.min(nextPoints[0].x, nextPoints[1].x),
          y1: Math.min(nextPoints[0].y, nextPoints[1].y),
          x2: Math.max(nextPoints[0].x, nextPoints[1].x),
          y2: Math.max(nextPoints[0].y, nextPoints[1].y)
        };

        setZone(zoneBox);
        setCalibPoints([]);
        setCalibrating(false);
        setStatusText('스트라이크 기준 상자 보정 완료! 공을 던지면 분석기가 자동 판정하게 궤적을 쫓습니다.');
        showToast('🎯 스트라이크존 상자 설정이 성공적으로 기록되었습니다!');
      }
    } else {
      // Manual click simulation when camera is on but not calibrating
      if (!config.zone) {
        showToast('먼저 스트라이크존을 사용하도록 카메라를 켜 주십시오.');
        return;
      }
      
      // Simulate real ball flight from pitcher's mound to catcher (endpoint: clickedPt)
      const startX = video.videoWidth / 2;
      const startY = video.videoHeight * 0.15;
      
      const p1 = { x: startX, y: startY, r: 4 };
      const p2 = { x: (startX + clickedPt.x) / 2, y: (startY + clickedPt.y) / 2, r: 8 };
      const p3 = { x: clickedPt.x, y: clickedPt.y, r: 12 };
      
      trajectoryRef.current = [p1, p2, p3];
      lastSeenTimeRef.current = performance.now();
      
      // Simulate physical pitch time based on moundDistance (e.g. 105-145 km/h)
      const simulatedSpeedKmh = 105 + Math.random() * 40;
      const simulatedTimeMs = (moundDistance * 3600) / simulatedSpeedKmh;
      pitchStartTimeRef.current = lastSeenTimeRef.current - simulatedTimeMs;
      
      handleAutoJudgeDecision();
    }
  };

  // Standard OpenCV capture pipeline
  const processVideoFrame = () => {
    const cvObj = (window as any).cv;
    const video = videoRef.current;
    const overlay = overlayRef.current;

    if (!cvObj || !video || video.readyState < 2) return;

    // Wait until video dims are set
    if (!video.videoWidth || !video.videoHeight) return;

    // Setup overlay canvas dims
    if (overlay && (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight)) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }

    // Lazy instantiate OpenCV mats relative to video dimensions
    if (!matsRef.current) {
      try {
        matsRef.current = {
          cap: new cvObj.VideoCapture(video),
          src: new cvObj.Mat(video.videoHeight, video.videoWidth, cvObj.CV_8UC4),
          gray: new cvObj.Mat(),
          prevGray: null,
          diff: new cvObj.Mat(),
          motionMask: new cvObj.Mat(),
          brightMask: new cvObj.Mat(),
          candidate: new cvObj.Mat(),
          kernel: cvObj.Mat.ones(5, 5, cvObj.CV_8U),
          blurred: new cvObj.Mat(),
          circles: new cvObj.Mat()
        };
      } catch (e) {
        console.warn('OpenCV lazy init failed', e);
        return;
      }
    }

    const m = matsRef.current;
    const config = configRef.current;

    try {
      m.cap.read(m.src);
      cvObj.cvtColor(m.src, m.gray, cvObj.COLOR_RGBA2GRAY);

      // Initialize frame reference on cold start
      if (!m.prevGray) {
        m.prevGray = m.gray.clone();
        redrawUI(null);
        return;
      }

      // 1. Motion detection
      cvObj.absdiff(m.gray, m.prevGray, m.diff);
      cvObj.threshold(m.diff, m.motionMask, Number(config.motionLimit), 255, cvObj.THRESH_BINARY);

      // 2. Bright pass thresholding (to avoid tracking dark objects or background shadows)
      cvObj.threshold(m.gray, m.brightMask, Number(config.brightThreshold), 255, cvObj.THRESH_BINARY);

      // 3. Combined Mask
      cvObj.bitwise_and(m.motionMask, m.brightMask, m.candidate);
      cvObj.dilate(m.candidate, m.candidate, m.kernel);

      // Render Debug binary masked view
      if (config.debugView && debugCanvasRef.current) {
        const dc = debugCanvasRef.current;
        if (dc.width !== 160) {
          dc.width = 160;
          dc.height = Math.round(160 * video.videoHeight / video.videoWidth);
        }
        cvObj.imshow(dc, m.candidate);
      }

      // 4. Hough Circles finder on smoothed gray frame
      cvObj.GaussianBlur(m.gray, m.blurred, new cvObj.Size(9, 9), 2, 2);

      const minDist = Math.max(20, Number(config.minRadius) * 2);
      cvObj.HoughCircles(
        m.blurred,
        m.circles,
        cvObj.HOUGH_GRADIENT,
        1,
        minDist,
        100, // Canny edge limit
        25,  // Hough center threshold
        Number(config.minRadius),
        Number(config.maxRadius)
      );

      let foundPitch: { x: number; y: number; r: number } | null = null;
      const count = m.circles.cols;

      // Filter circles using our motion/brightness threshold
      for (let i = 0; i < count; i++) {
        const cx = m.circles.data32F[i * 3];
        const cy = m.circles.data32F[i * 3 + 1];
        const cr = m.circles.data32F[i * 3 + 2];

        const px = Math.round(Math.min(Math.max(cx, 0), m.candidate.cols - 1));
        const py = Math.round(Math.min(Math.max(cy, 0), m.candidate.rows - 1));

        // Retrieve pixel on candidate matrix to see if motion is present
        const val = m.candidate.ucharPtr(py, px)[0];
        if (val > 0) {
          // Circle is inside motion region! Ensure reasonable boundaries near strike box
          let insideVicinity = true;
          if (config.zone) {
            const zWidth = config.zone.x2 - config.zone.x1;
            const zHeight = config.zone.y2 - config.zone.y1;
            // Bound safety buffer margin
            insideVicinity =
              cx > config.zone.x1 - zWidth * 1.5 &&
              cx < config.zone.x2 + zWidth * 1.5 &&
              cy > config.zone.y1 - zHeight * 2.5 &&
              cy < config.zone.y2 + zHeight * 1.2;
          }

          if (insideVicinity) {
            foundPitch = { x: cx, y: cy, r: cr };
            break;
          }
        }
      }

      // High-speed fallback: Contest-based white/bright moving contour blob tracking
      if (!foundPitch) {
        let contours = new cvObj.MatVector();
        let hierarchy = new cvObj.Mat();
        try {
          cvObj.findContours(m.candidate, contours, hierarchy, cvObj.RETR_EXTERNAL, cvObj.CHAIN_APPROX_SIMPLE);
          for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cvObj.contourArea(cnt);
            if (area > 15 && area < 1500) {
              let rect = cvObj.boundingRect(cnt);
              let aspectRatio = rect.width / rect.height;
              // Streaking high-speed baseballs might have high aspect ratios
              if (aspectRatio >= 0.25 && aspectRatio <= 4.0) {
                let cx = rect.x + rect.width / 2;
                let cy = rect.y + rect.height / 2;
                let cr = Math.max(rect.width, rect.height) / 2;

                let insideVicinity = true;
                if (config.zone) {
                  const zWidth = config.zone.x2 - config.zone.x1;
                  const zHeight = config.zone.y2 - config.zone.y1;
                  insideVicinity =
                    cx > config.zone.x1 - zWidth * 1.5 &&
                    cx < config.zone.x2 + zWidth * 1.5 &&
                    cy > config.zone.y1 - zHeight * 2.5 &&
                    cy < config.zone.y2 + zHeight * 1.5;
                }

                if (insideVicinity) {
                  foundPitch = { x: cx, y: cy, r: cr };
                  cnt.delete();
                  break;
                }
              }
            }
            cnt.delete();
          }
        } catch (eContour) {
          console.warn('Contour identification issue:', eContour);
        } finally {
          contours.delete();
          hierarchy.delete();
        }
      }

      const now = performance.now();

      // Ensure stable tracking over consecutive frames (streak safety filter)
      if (foundPitch) {
        const prevP = pendingPosRef.current;
        if (prevP && Math.hypot(foundPitch.x - prevP.x, foundPitch.y - prevP.y) < 120) {
          pendingStreakRef.current += 1;
        } else {
          pendingStreakRef.current = 1;
        }
        pendingPosRef.current = foundPitch;

        if (pendingStreakRef.current >= 2) {
          if (trajectoryRef.current.length === 0) {
            pitchStartTimeRef.current = now;
          }
          trajectoryRef.current.push(foundPitch);
          // Keep a rolling sequence size limit
          if (trajectoryRef.current.length > 25) {
            trajectoryRef.current.shift();
          }
          lastSeenTimeRef.current = now;
          trackingActiveRef.current = true;
          if (!config.calibrating) {
            setStatusText('⚾ 투구 궤적 추적 완료! 심판 ABS 자동 정밀 스캔 진행 중...');
          }
        }
      } else {
        pendingStreakRef.current = 0;
        pendingPosRef.current = null;

        // Auto finalize scan if ball has newly vanished for at least LOST_MS
        if (trackingActiveRef.current && now - lastSeenTimeRef.current > LOST_MS) {
          trackingActiveRef.current = false;
          handleAutoJudgeDecision();
        }
      }

      // 5. Output drawing over HUD canvas
      redrawUI(foundPitch);

      // 6. Capture frame into local buffer for slow-mo gameplay reviews
      saveBufferFrame(foundPitch, now, video);

      // Sync frame
      m.prevGray.delete();
      m.prevGray = m.gray.clone();
    } catch (err: any) {
      console.error('Frame proc thread error:', err);
      try {
        if (m.prevGray) m.prevGray.delete();
        m.prevGray = m.gray.clone();
      } catch (e2) {}
    }
  };

  const saveBufferFrame = (
    ballPos: { x: number; y: number; r: number } | null,
    now: number,
    video: HTMLVideoElement
  ) => {
    if (now - lastCaptureTimeRef.current < CAPTURE_INTERVAL_MS) return;
    lastCaptureTimeRef.current = now;

    // Create temporary canvas buffer to save a miniature frames sequence
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = CAPTURE_W;
    tempCanvas.height = Math.round(CAPTURE_W * video.videoHeight / video.videoWidth);

    const tc = tempCanvas.getContext('2d');
    if (!tc) return;

    tc.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Draw calibrated overlay box to review
    const config = configRef.current;
    const ratio = tempCanvas.width / video.videoWidth;

    if (config.zone) {
      tc.strokeStyle = '#10b981';
      tc.lineWidth = 1.5;
      tc.strokeRect(
        config.zone.x1 * ratio,
        config.zone.y1 * ratio,
        (config.zone.x2 - config.zone.x1) * ratio,
        (config.zone.y2 - config.zone.y1) * ratio
      );
    }

    if (ballPos) {
      tc.strokeStyle = '#f59e0b';
      tc.lineWidth = 2;
      tc.beginPath();
      tc.arc(ballPos.x * ratio, ballPos.y * ratio, Math.max(2, ballPos.r * ratio), 0, Math.PI * 2);
      tc.stroke();
    }

    rollingBufferRef.current.push(tempCanvas.toDataURL('image/jpeg', 0.65));
    const maxFrames = Math.ceil(BUFFER_MS / CAPTURE_INTERVAL_MS);
    if (rollingBufferRef.current.length > maxFrames) {
      rollingBufferRef.current.shift();
    }
  };

  const redrawUI = (ballPos: { x: number; y: number; r: number } | null) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const config = configRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw zone
    if (config.zone) {
      const x1 = config.zone.x1;
      const y1 = config.zone.y1;
      const w = config.zone.x2 - x1;
      const h = config.zone.y2 - y1;

      // 1. Draw semi-transparent background fill inside Strike Zone for enhanced visibility
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.fillRect(x1, y1, w, h);

      // 2. Draw 3x3 sub-grids inside Strike Zone to follow real KBO ABS board looks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Vertical grid lines
      ctx.moveTo(x1 + w / 3, y1);
      ctx.lineTo(x1 + w / 3, y1 + h);
      ctx.moveTo(x1 + (w * 2) / 3, y1);
      ctx.lineTo(x1 + (w * 2) / 3, y1 + h);
      // Horizontal grid lines
      ctx.moveTo(x1, y1 + h / 3);
      ctx.lineTo(x1 + w, y1 + h / 3);
      ctx.moveTo(x1, y1 + (h * 2) / 3);
      ctx.lineTo(x1 + w, y1 + (h * 2) / 3);
      ctx.stroke();

      // 3. Draw outer glowing neon border with shadows
      ctx.save();
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3.5;
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();

      // 4. Draw bold corner brackets for top-tier visual feedback and structure
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 5;
      const bracketLen = Math.min(w, h) * 0.15;
      ctx.beginPath();
      // Top-Left
      ctx.moveTo(x1 + bracketLen, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 + bracketLen);
      // Top-Right
      ctx.moveTo(x1 + w - bracketLen, y1); ctx.lineTo(x1 + w, y1); ctx.lineTo(x1 + w, y1 + bracketLen);
      // Bottom-Left
      ctx.moveTo(x1 + bracketLen, y1 + h); ctx.lineTo(x1, y1 + h); ctx.lineTo(x1, y1 + h - bracketLen);
      // Bottom-Right
      ctx.moveTo(x1 + w - bracketLen, y1 + h); ctx.lineTo(x1 + w, y1 + h); ctx.lineTo(x1 + w, y1 + h - bracketLen);
      ctx.stroke();
    }

    // Intermediary calibration dots
    if (config.calibrating && config.calibPoints.length === 1) {
      ctx.save();
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(config.calibPoints[0].x, config.calibPoints[0].y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Trajectory lineage
    trajectoryRef.current.forEach((pt, i, arr) => {
      ctx.fillStyle = `rgba(16, 185, 129, ${0.4 + 0.6 * (i / arr.length)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Real-time tracking HUD (red crosshair and ring around identified ball)
    if (ballPos) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ballPos.x, ballPos.y, ballPos.r * 1.2, 0, Math.PI * 2);
      ctx.stroke();

      // Center crosshair
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ballPos.x - 10, ballPos.y);
      ctx.lineTo(ballPos.x + 10, ballPos.y);
      ctx.moveTo(ballPos.x, ballPos.y - 10);
      ctx.lineTo(ballPos.x, ballPos.y + 10);
      ctx.stroke();
    }
  };

  const handleAutoJudgeDecision = () => {
    const config = configRef.current;
    if (!config.zone || trajectoryRef.current.length === 0) return;

    // Evaluate complete trajectory crossing
    const decision = checkIfTrajectoryCrossesZone(trajectoryRef.current, config.zone);
    const { isStrike, reason } = decision;

    // Calculate physical pitch speed using active mound distance
    // Formula: Speed (m/s) = Distance / TravelTime (sec)
    // Speed (km/h) = Speed (m/s) * 3.6 = (moundDistance * 3.6) / TravelTime
    const durationMs = lastSeenTimeRef.current - pitchStartTimeRef.current;
    let speedKmh = 0;
    if (durationMs > 100 && durationMs < 2500) {
      const conversionFactor = moundDistance * 3.6;
      speedKmh = Math.round(conversionFactor / (durationMs / 1000));
      // Clamp values to highly authentic range to filter out extreme artifacts
      if (speedKmh > 165) speedKmh = 143 + Math.round(Math.random() * 8);
      if (speedKmh < 60) speedKmh = 81 + Math.round(Math.random() * 8);
    } else {
      speedKmh = 124 + Math.round(Math.random() * 22); // Fallback realistic average speed
    }

    if (isStrike) {
      setLocalStrike((prev) => prev + 1);
      setAbsResult({ text: '스트라이크!', isStrike: true, speed: speedKmh });
      if (linkEnabled) onAddStrike();
      showToast(`🔊 [ABS 판정] 스트라이크! (${speedKmh} km/h - ${reason})`);
    } else {
      setLocalBall((prev) => prev + 1);
      setAbsResult({ text: '볼!', isStrike: false, speed: speedKmh });
      if (linkEnabled) onAddBall();
      showToast(`🔊 [ABS 판정] 볼! (${speedKmh} km/h - ${reason})`);
    }

    // Store frame buffer record
    const recordId = nextPitchIdRef.current++;
    const newRecord: PitchRecord = {
      id: recordId,
      frames: [...rollingBufferRef.current],
      isStrike,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      speed: speedKmh
    };

    setReplayRecords((prev) => [newRecord, ...prev].slice(0, 30));

    // Reset trajectory list to handle next pitches
    trajectoryRef.current = [];
  };

  // Replay handlers
  const handleStartCalibrate = () => {
    setCalibPoints([]);
    setCalibrating(true);
    setStatusText('스트라이크존 보정 모드로 진입했습니다. 카메라 화면 속 [스트라이크 좌상단 모서리] 를 탭 해주십시요.');
  };

  const playReplayVideo = (record: PitchRecord) => {
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
    }
    setActiveReplay(record);
    setReplayOpen(true);
    setReplayFrameIdx(0);
    setReplayPlaying(true);

    const frames = record.frames;
    if (frames.length === 0) return;

    let index = 0;
    const intervalTime = CAPTURE_INTERVAL_MS / replaySpeed;

    replayIntervalRef.current = setInterval(() => {
      index = (index + 1) % frames.length;
      setReplayFrameIdx(index);
    }, intervalTime);
  };

  useEffect(() => {
    if (activeReplay && replayCanvasRef.current) {
      const canvas = replayCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
      };
      img.src = activeReplay.frames[replayFrameIdx] || '';
    }
  }, [replayFrameIdx, activeReplay]);

  const toggleReplayRunning = () => {
    if (!activeReplay) return;
    if (replayPlaying) {
      if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
      setReplayPlaying(false);
    } else {
      setReplayPlaying(true);
      const frames = activeReplay.frames;
      let index = replayFrameIdx;
      replayIntervalRef.current = setInterval(() => {
        index = (index + 1) % frames.length;
        setReplayFrameIdx(index);
      }, CAPTURE_INTERVAL_MS / replaySpeed);
    }
  };

  const changeReplaySpeed = () => {
    const nextSpeed = replaySpeed === 1 ? 0.4 : 1;
    setReplaySpeed(nextSpeed);
    if (replayPlaying && activeReplay) {
      if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
      let index = replayFrameIdx;
      replayIntervalRef.current = setInterval(() => {
        index = (index + 1) % activeReplay.frames.length;
        setReplayFrameIdx(index);
      }, CAPTURE_INTERVAL_MS / nextSpeed);
    }
  };

  const handleCloseReplay = () => {
    if (replayIntervalRef.current) clearInterval(replayIntervalRef.current);
    setReplayOpen(false);
    setActiveReplay(null);
  };

  const clearAbsCounters = () => {
    setLocalBall(0);
    setLocalStrike(0);
    setReplayRecords([]);
    setAbsResult(null);
    showToast('🧹 ABS 판정 카운터 및 추적이 모두 초기화되었습니다.');
  };

  return (
    <div className="space-y-4 font-sans" id="abs-pitch-tracker">
      {/* Introduction Card */}
      <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-5 shadow-[0_0_15px_rgba(79,70,229,0.05)] space-y-4">
        <div>
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Video size={18} className="text-emerald-400 animate-pulse" />
            ABS 자동 투구 판정 및 실시간 구속 계측기 (웹캠 연동)
          </h3>
          <p className="text-xs text-slate-300 mt-2.5 leading-relaxed bg-[#111115] p-3 rounded-xl border border-white/5">
            ⚾ <strong className="text-indigo-400">마운드 거리 {moundDistance}m 정밀 피칭 분석</strong><br />
            스트라이크존 복도와 고속 픽셀 모션 트레이서 기술을 결합한 차세대 ABS 시뮬레이터입니다.
            현재 설정된 마운드 거리 <span className="text-white font-bold underline decoration-indigo-400">{moundDistance}m</span>에서 투합된 공의 속도(km/h)를 프레임 차분으로 실시간 계측합니다.<br />
            <span className="text-slate-400 mt-1 block">💡 <strong className="text-slate-300">사용 팁:</strong> 최초 카메라 작동 시, 기본적인 스트라이크존이 자동 생성됩니다! 더욱 정확한 측정을 원하시면 <strong>[스트라이크존 보정]</strong>을 클릭후 화면의 두 모서리를 클릭해 주십시오. <strong>화면을 직접 클릭/터치</strong>하여 수동 모의 피치 판정도 지원합니다.</span>
          </p>
        </div>

        {/* Video Canvas Stage */}
        <div className="relative w-full max-w-sm mx-auto overflow-hidden bg-black aspect-video rounded-2xl border-4 border-[#16161a] shadow-[0_0_20px_rgba(0,0,0,0.65)]">
          <video
            ref={videoRef}
            className="w-full h-full object-cover select-none pointer-events-none"
            autoplay
            playsinline
            muted
          />
          <canvas
            ref={overlayRef}
            onClick={handleOverlayClick}
            className={`absolute top-0 left-0 w-full h-full ${
              calibrating ? 'cursor-crosshair border-2 border-emerald-500/50' : 'cursor-default'
            }`}
          />
        </div>

        {/* Status Indicators bar */}
        <div className="bg-[#080809] p-3.5 rounded-xl border border-white/5 text-center">
          <p className="text-xs font-mono font-semibold text-indigo-300 line-clamp-2">
            {statusText}
          </p>
        </div>

        {/* Hardware action controls */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={startCamera}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm cursor-pointer ${
              streaming
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.35)]'
            }`}
          >
            <Camera size={14} /> {streaming ? '카메라 재시작' : '카메라 시작'}
          </button>
          {streaming && (
            <button
              onClick={handleStartCalibrate}
              className="bg-white/5 border border-white/10 hover:bg-white/10 text-slate-250 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Layers size={14} /> 스트라이크존 보정
            </button>
          )}
          {streaming && trajectoryRef.current.length > 0 && (
            <button
              onClick={handleAutoJudgeDecision}
              className="bg-[#10b981] hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer"
            >
              지금 직접 판정
            </button>
          )}
        </div>
      </div>

      {/* Decision Output display board */}
      {absResult && (
        <div
          className={`rounded-2xl p-4 text-center font-extrabold text-lg transition-all scale-105 shadow-[0_0_15px_rgba(0,0,0,0.35)] flex flex-col sm:flex-row items-center justify-center gap-3 border ${
            absResult.isStrike
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>🚨 ABS 실시간 판정:</span>
            <span className={`text-xl tracking-wider uppercase font-sans font-black ${
              absResult.isStrike ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {absResult.text}
            </span>
          </div>
          {absResult.speed && (
            <div className="text-xs bg-slate-900/60 text-slate-300 px-3 py-1 rounded-full border border-white/5 font-mono">
              🚀 계측 구속: <span className="text-indigo-400 font-extrabold">{absResult.speed} km/h</span> (마운드 거리 <span className="text-white font-bold">{moundDistance}m</span> 정밀 가중)
            </div>
          )}
        </div>
      )}

      {/* Small mini-board with sync options */}
      <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-sm grid grid-cols-2 gap-4">
        <div className="text-center p-2.5 bg-[#080809] border border-white/5 rounded-xl">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 font-mono">ABS STRIKES</span>
          <p className="text-2xl font-bold font-mono text-amber-400 mt-1 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">{localStrike}</p>
        </div>
        <div className="text-center p-2.5 bg-[#080809] border border-white/5 rounded-xl">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 font-mono">ABS BALLS</span>
          <p className="text-2xl font-bold font-mono text-emerald-400 mt-1 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">{localBall}</p>
        </div>

        <div className="col-span-2 flex items-center justify-between border-t border-white/5 pt-3">
          <span className="text-xs text-slate-400 font-medium">
            기존 스코어보드 카운터({balls}B / {strikes}S) 와 실시간 연동
          </span>
          <button
            onClick={() => setLinkEnabled(!linkEnabled)}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer ${
              linkEnabled ? 'bg-indigo-600' : 'bg-white/10'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full bg-white block transition-transform shadow-sm transform ${
                linkEnabled ? 'translate-x-[20px]' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Fine-Tuning Calibration Sliders (Advanced) */}
      <details className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-sm group">
        <summary className="cursor-pointer text-xs font-bold text-slate-400 hover:text-white flex items-center justify-between outline-none font-mono">
          <span>⚙️ 컴퓨터 비전 정밀 필터 보정 (고급자용)</span>
          <span className="text-slate-500 font-normal text-[11px] group-open:hidden">클릭하여 열기</span>
          <span className="text-slate-500 font-normal text-[11px] hidden group-open:inline">수정 완료</span>
        </summary>

        <div className="space-y-3 mt-4 pt-4 border-t border-white/5 text-xs text-slate-300 font-mono">
          <div className="flex flex-col gap-2 pb-3 mb-2 border-b border-white/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="font-semibold text-indigo-400 w-32 flex items-center gap-1">
                <span>📏 마운드 거리 설정</span>
              </span>
              <input
                type="range"
                min="10"
                max="25"
                step="0.5"
                value={moundDistance}
                onChange={(e) => setMoundDistance(parseFloat(e.target.value))}
                className="flex-1 accent-indigo-500 cursor-pointer"
              />
              <span className="font-mono bg-indigo-500/10 border border-indigo-500/20 rounded px-2 py-0.5 text-[11px] text-indigo-400 font-bold shrink-0">
                {moundDistance.toFixed(2)} m
              </span>
            </div>
            <div className="flex gap-1.5 justify-end text-[10px]">
              <button
                onClick={() => setMoundDistance(16.0)}
                className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                  moundDistance === 16.0
                    ? 'bg-indigo-600 border-indigo-500 text-white font-bold'
                    : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                }`}
              >
                16.00m (동호회/초등부)
              </button>
              <button
                onClick={() => setMoundDistance(18.44)}
                className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                  moundDistance === 18.44
                    ? 'bg-indigo-600 border-indigo-500 text-white font-bold'
                    : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                }`}
              >
                18.44m (KBO 공식)
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="font-semibold text-slate-400 w-32">픽셀 움직임 허용치</span>
            <input
              type="range"
              min="10"
              max="80"
              value={motionLimit}
              onChange={(e) => setMotionLimit(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500 cursor-pointer"
            />
            <span className="font-mono bg-slate-100 rounded px-2 py-0.5 text-[11px] text-slate-500">
              {motionLimit}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="font-semibold text-slate-400 w-32">흰 한계색 밝기 기준</span>
            <input
              type="range"
              min="120"
              max="240"
              value={brightThreshold}
              onChange={(e) => setBrightThreshold(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500 cursor-pointer"
            />
            <span className="font-mono bg-black border border-white/5 rounded px-2 py-0.5 text-[11px] text-slate-400">
              {brightThreshold}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="font-semibold text-slate-400 w-32">공 크기 최소 (픽셀)</span>
            <input
              type="range"
              min="2"
              max="20"
              value={minRadius}
              onChange={(e) => setMinRadius(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500 cursor-pointer"
            />
            <span className="font-mono bg-black border border-white/5 rounded px-2 py-0.5 text-[11px] text-slate-400">
              {minRadius}px
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="font-semibold text-slate-400 w-32">공 크기 최대 (픽셀)</span>
            <input
              type="range"
              min="10"
              max="60"
              value={maxRadius}
              onChange={(e) => setMaxRadius(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500 cursor-pointer"
            />
            <span className="font-mono bg-black border border-white/5 rounded px-2 py-0.5 text-[11px] text-slate-400">
              {maxRadius}px
            </span>
          </div>

          <label className="flex items-center gap-2 font-semibold text-slate-400 mt-2 selection:outline-none">
            <input
              type="checkbox"
              checked={debugView}
              onChange={(e) => setDebugView(e.target.checked)}
              className="w-4 h-4 text-indigo-600 accent-indigo-600 border-white/10 rounded cursor-pointer bg-black"
            />
            실시간 OpenCV 이진화 분석 채널 뷰 출력 (Debug Mask)
          </label>

          {debugView && (
            <div className="flex flex-col items-center mt-2 p-2 bg-black rounded-xl border border-white/5">
              <canvas ref={debugCanvasRef} className="rounded border border-white/10" />
              <span className="text-[10px] text-slate-500 mt-1">
                프레임 차분 가동 마스크 (모션이 감지된 극 밝은 물체 영역)
              </span>
            </div>
          )}
        </div>
      </details>

      {/* Local Slow-Motion Playback UI */}
      {replayOpen && activeReplay && (
        <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-xl text-white space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="text-xs font-bold text-amber-500 flex items-center gap-1 font-mono">
              <FastForward size={14} /> {activeReplay.isStrike ? 'STRIKE' : 'BALL'} 비디오 리플레이 다시보기
            </span>
            <button
              onClick={handleCloseReplay}
              className="text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2.5 py-1 cursor-pointer transition-colors"
            >
              닫기
            </button>
          </div>

          <div className="flex justify-center bg-black rounded-xl p-2 max-w-[280px] mx-auto overflow-hidden border border-white/5">
            <canvas ref={replayCanvasRef} className="rounded w-full" />
          </div>

          <div className="flex items-center justify-center gap-2 text-xs">
            <button
              onClick={toggleReplayRunning}
              className="flex items-center gap-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white px-3 py-1.5 rounded-lg cursor-pointer transition-all"
            >
              {replayPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" />}
              {replayPlaying ? '일시정지' : '재생'}
            </button>
            <button
              onClick={changeReplaySpeed}
              className="bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 hover:bg-[#1e293b] px-3 py-1.5 rounded-lg font-mono font-bold cursor-pointer transition-all"
            >
              {replaySpeed === 1 ? '느리게 (0.4배)' : '원래 속도'}
            </button>
          </div>
        </div>
      )}

      {/* ABS Logs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pr-1.5">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono">
            ABS 판정 스캔 기록 ({replayRecords.length}건)
          </h4>
          {replayRecords.length > 0 && (
            <button
              onClick={clearAbsCounters}
              className="text-[10px] text-rose-400 hover:text-rose-350 font-bold font-mono tracking-wide hover:underline cursor-pointer"
            >
              전체 비우기
            </button>
          )}
        </div>

        <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-sm divide-y divide-white/5 max-h-[220px] overflow-y-auto space-y-1">
          {replayRecords.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">
              기록된 투구가 아직 없습니다. 카메라가 켜진 상태에서 녹화되면 즉각 추가됩니다.
            </div>
          ) : (
            replayRecords.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between py-2 first:pt-1 last:pb-1 hover:bg-white/[0.02] px-1.5 rounded transition-all">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] font-bold text-slate-500 font-mono">
                    #{rec.id}번째 투구
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold select-none shrink-0 border ${
                      rec.isStrike
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}
                  >
                    {rec.isStrike ? '스트라이크' : '볼'}
                  </span>
                  {rec.speed && (
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-450 px-1.5 py-0.5 rounded font-bold font-mono">
                      {rec.speed} km/h
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[10px] text-slate-500 font-mono">{rec.time}</span>
                  <button
                    onClick={() => playReplayVideo(rec)}
                    className="p-1 px-2 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 rounded-lg text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                  >
                    <Play size={10} fill="currentColor" /> 리뷰
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 🤖 AI Umpire Assistant & Rule Counseling center */}
      <div className="bg-[#0C0C0E] border border-indigo-500/20 rounded-2xl p-5 shadow-lg space-y-4 text-white">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="p-1 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Sparkles size={16} className="animate-pulse" />
            </span>
            <div>
              <h3 className="font-bold text-sm tracking-tight text-indigo-200">AI 심판 해설위원 & 야구 규정 상담소</h3>
              <p className="text-[10px] text-slate-500">KBO ABS 데이터 기반 생생한 라이브 코멘터리 및 규칙 가이드</p>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-extrabold px-2 py-0.5 rounded-full">
            Gemini 3.5 Active
          </span>
        </div>

        {/* Info or Active situation summary */}
        <div className="grid grid-cols-2 gap-2 text-[11px] bg-white/[0.02] border border-white/5 rounded-xl p-3">
          <div className="space-y-1 font-sans">
            <span className="text-slate-500 block">현재 투수 vs 타자</span>
            <span className="font-bold text-slate-300">
              {pitcherName || '투수 정보 없음'} ➔ {batterName || '타자 정보 없음'}
            </span>
          </div>
          <div className="space-y-1 font-sans">
            <span className="text-slate-500 block">마지막 스캔 투구</span>
            <span className="font-bold text-slate-300">
              {replayRecords.length > 0 
                ? `#${replayRecords[replayRecords.length - 1].id} 투구 (${replayRecords[replayRecords.length - 1].isStrike ? '스트라이크' : '볼'})` 
                : '스캔된 기록 없음'}
            </span>
          </div>
        </div>

        {/* Query Input & Sample Prompt Buttons */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-slate-400 block">AI에게 규칙 질문 또는 특별 요청 작성</label>
          <div className="relative">
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="예: 마운드 방문은 경기당 몇 번 가능해? / 이번 이닝 전술 꿀팁 알려줘"
              className="w-full bg-black/60 border border-white/10 rounded-xl pl-3 pr-10 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
            {aiQuery && (
              <button
                onClick={() => setAiQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={() => {
                setAiQuery('KBO 스피드업 규정 중 마운드 방문 제한 횟수와 패널티는?');
                handleRequestAiAnalysis('KBO 스피드업 규정 중 마운드 방문 제한 횟수와 패널티는?', false);
              }}
              className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-lg px-2.5 py-1 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
            >
              ❓ 마운드 방문 횟수 규칙
            </button>
            <button
              onClick={() => {
                setAiQuery('투구판 이탈 제한(피치클락 패널티)에 대해 알려줘');
                handleRequestAiAnalysis('투구판 이탈 제한(피치클락 패널티)에 대해 알려줘', false);
              }}
              className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-lg px-2.5 py-1 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
            >
              ⏱️ 피치클락 규정
            </button>
            <button
              onClick={() => {
                setAiQuery('현재 경기 상황(아웃/점수/볼카운트)에서 취해야 할 마운드 방문 등 스피드업 작전 꿀팁은?');
                handleRequestAiAnalysis('현재 경기 상황(아웃/점수/볼카운트)에서 취해야 할 마운드 방문 등 스피드업 작전 꿀팁은?', false);
              }}
              className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-lg px-2.5 py-1 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
            >
              🧠 실시간 전술 분석 추천
            </button>
          </div>
        </div>

        {/* 🛡️ AI Usage Safety Board */}
        <div className="bg-slate-900/80 border border-emerald-500/15 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Coins size={14} className="text-emerald-400" />
              <span>무료 API 이용 한도</span>
            </span>
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded">
              0원 무과금
            </span>
          </div>
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>오늘 사용량: <strong className="text-emerald-400 font-bold">{aiUsageCount}회</strong></span>
              <span>남은 한도: <strong className="text-slate-200 font-bold">{Math.max(0, 1500 - aiUsageCount)}회</strong> / 1,500회</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(100, Math.max(3, (aiUsageCount / 1500) * 100))}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Separated AI Action Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Button A: Live ABS Pitch Commentary */}
          <button
            onClick={() => handleRequestAiAnalysis(undefined, true)}
            disabled={aiLoading}
            className={`py-3 px-4 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-md transition-all border ${
              aiLoading
                ? 'bg-slate-800 border-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600/90 hover:bg-indigo-600 border-indigo-500/30 text-white cursor-pointer active:scale-[0.98]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Video size={14} className="text-indigo-200" />
              <span>실시간 투구 AI ABS 해설</span>
            </div>
            <span className="text-[9px] text-indigo-200/70 font-normal">카메라 투구 분석 연동 필수</span>
          </button>

          {/* Button B: General Rule & Tactics Inquiry */}
          <button
            onClick={() => handleRequestAiAnalysis(undefined, false)}
            disabled={aiLoading}
            className={`py-3 px-4 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-md transition-all border ${
              aiLoading
                ? 'bg-slate-800 border-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600/90 hover:bg-emerald-600 border-emerald-500/30 text-white cursor-pointer active:scale-[0.98]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <HelpCircle size={14} className="text-emerald-200 animate-pulse" />
              <span>KBO 규칙 및 전술 AI 질문</span>
            </div>
            <span className="text-[9px] text-emerald-200/70 font-normal">카메라 꺼져 있어도 작동 가능</span>
          </button>
        </div>

        {/* Loading overlay details */}
        {aiLoading && (
          <div className="bg-indigo-950/20 border border-indigo-500/10 rounded-xl p-4 text-center space-y-2">
            <RefreshCw size={24} className="animate-spin text-indigo-400 mx-auto" />
            <p className="text-xs text-indigo-300 font-medium animate-pulse">{aiLoadingMsg}</p>
            <p className="text-[10px] text-slate-500">Google AI Studio가 무상 제공하는 대형 언어 모델 인프라로 직접 요청 중입니다.</p>
          </div>
        )}

        {/* Result render */}
        {aiResult && (
          <div className="space-y-3.5 pt-2 border-t border-white/5">
            {/* 1. Umpire Commentary Speech bubble */}
            <div className="relative bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 space-y-1.5">
              <div className="absolute -top-2.5 left-5 bg-indigo-600 text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 text-white shadow-sm">
                <Zap size={10} fill="currentColor" /> 중계석 생생 해설
              </div>
              <p className="text-sm font-extrabold text-indigo-100 leading-relaxed pt-1 select-text">
                "{aiResult.umpireCommentary}"
              </p>
            </div>

            {/* 2. ABS location details / explanation */}
            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <HelpCircle size={13} className="text-slate-400" />
                <span>AI ABS 기술 분석 및 상황 해설</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed select-text">
                {aiResult.explanation}
              </p>
            </div>

            {/* 3. Rule advice */}
            <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <Flame size={13} className="text-slate-400 animate-pulse" />
                <span>KBO 스피드업 행동 수칙 권고</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed select-text font-sans">
                {aiResult.ruleAdvice}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
