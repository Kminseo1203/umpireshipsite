import { useState, useEffect, useRef } from 'react';
import { KboState } from '../types';
import { Play, Square, RefreshCw, ShieldAlert } from 'lucide-react';

interface KboLimitTrackerProps {
  kbo: KboState;
  onChangeKbo: (updated: KboState) => void;
  showToast: (msg: string) => void;
}

type TimerKey = 'mound' | 'inning' | 'pitchChanger' | 'pitch';

interface TimerState {
  total: number;
  remaining: number;
  running: boolean;
  warnSec: number;
  label: string;
  toastAt?: { sec: number; msg: string }[];
}

export default function KboLimitTracker({ kbo, onChangeKbo, showToast }: KboLimitTrackerProps) {
  // Timer configurations
  const TIMER_DEFS: Record<TimerKey, TimerState> = {
    mound: {
      total: 30,
      remaining: 30,
      running: false,
      warnSec: 5,
      label: '마운드 방문 (30초)',
      toastAt: [{ sec: 5, msg: '⏰ 마운드 방문 5초 남음! 즉시 그라운드 밖으로 이동하세요.' }]
    },
    inning: {
      total: 120,
      remaining: 120,
      running: false,
      warnSec: 20,
      label: '이닝 교대 (2분)',
      toastAt: [{ sec: 25, msg: '⏰ 이닝 교대 25초 남음! 첫 타자는 타석에 준비하세요.' }]
    },
    pitchChanger: {
      total: 140,
      remaining: 140,
      running: false,
      warnSec: 25,
      label: '투수 교체 (2분 20초)',
      toastAt: [{ sec: 15, msg: '⏰ 투수 교체 15초 남음! 타자는 타석에 진입하세요.' }]
    },
    pitch: {
      total: 20,
      remaining: 20,
      running: false,
      warnSec: 5,
      label: '투구 간격 (20초)'
    }
  };

  const [timers, setTimers] = useState<Record<TimerKey, { remaining: number; running: boolean }>>({
    mound: { remaining: 30, running: false },
    inning: { remaining: 120, running: false },
    pitchChanger: { remaining: 140, running: false },
    pitch: { remaining: 20, running: false }
  });

  const timerRefs = useRef<Record<TimerKey, NodeJS.Timeout | null>>({
    mound: null,
    inning: null,
    pitchChanger: null,
    pitch: null
  });

  // Handle active timers using browser intervals
  useEffect(() => {
    (Object.keys(timers) as TimerKey[]).forEach((key) => {
      if (timers[key].running) {
        if (!timerRefs.current[key]) {
          timerRefs.current[key] = setInterval(() => {
            setTimers((prev) => {
              const current = prev[key];
              const nextVal = current.remaining - 1;

              // Handle warning conditions or timeouts
              const def = TIMER_DEFS[key];
              const toastAlert = def.toastAt?.find((t) => t.sec === nextVal);
              if (toastAlert) {
                showToast(toastAlert.msg);
              }

              if (nextVal <= 0) {
                if (timerRefs.current[key]) {
                  clearInterval(timerRefs.current[key]!);
                  timerRefs.current[key] = null;
                }
                showToast(`⚠️ [경고] ${def.label} 제한 시간이 경과했습니다!`);
                return {
                  ...prev,
                  [key]: { remaining: 0, running: false }
                };
              }

              return {
                ...prev,
                [key]: { ...current, remaining: nextVal }
              };
            });
          }, 1000);
        }
      } else {
        if (timerRefs.current[key]) {
          clearInterval(timerRefs.current[key]!);
          timerRefs.current[key] = null;
        }
      }
    });

    return () => {
      (Object.keys(timerRefs.current) as TimerKey[]).forEach((key) => {
        if (timerRefs.current[key]) {
          clearInterval(timerRefs.current[key]!);
        }
      });
    };
  }, [timers]);

  const toggleTimer = (key: TimerKey) => {
    setTimers((prev) => {
      const isRunning = !prev[key].running;
      // Start or stop
      return {
        ...prev,
        [key]: {
          ...prev[key],
          remaining: prev[key].remaining === 0 ? TIMER_DEFS[key].total : prev[key].remaining,
          running: isRunning
        }
      };
    });
  };

  const resetTimer = (key: TimerKey) => {
    setTimers((prev) => ({
      ...prev,
      [key]: { remaining: TIMER_DEFS[key].total, running: false }
    }));
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Helper values updater
  const updateKboValue = (field: keyof KboState, delta: number, max: number) => {
    const nextVal = Math.max(0, Math.min(max, kbo[field] + delta));
    onChangeKbo({ ...kbo, [field]: nextVal });
  };

  const useOffTime = () => {
    if (kbo.offTimeUsed >= 3) {
      showToast('⚠️ 공격팀 타임 한도 초과! (이닝당 최대 3회) 타임이 불허됩니다.');
      return;
    }
    const newVal = kbo.offTimeUsed + 1;
    onChangeKbo({ ...kbo, offTimeUsed: newVal });
    if (newVal >= 3) {
      showToast('⚠️ 공격팀 타임 3회 전량 소진! 이번 이닝 더 이상 타임 불가능합니다.');
    } else {
      showToast(`공격팀 타임 ${newVal}/3회 사용 기록`);
    }
  };

  const useMoundVisit = () => {
    if (kbo.moundVisitUsed >= 2) {
      showToast('⚠️ 마운드 방문 한도 초과! 추가 마운드 방문은 투수 교체를 의무화합니다.');
      return;
    }
    const newVal = kbo.moundVisitUsed + 1;
    onChangeKbo({ ...kbo, moundVisitUsed: newVal });
    if (newVal >= 2) {
      showToast('⚠️ 감독/코치 마운드 방문 2회 소진! 다음 마운드 접근 시 투수를 의무 교체해야 합니다.');
    } else {
      showToast(`감독/코치 마운드 방문 ${newVal}/2회 기록 (30초 타이머를 시작합니다)`);
    }
    // Automatically trigger mound timer
    setTimers((prev) => ({
      ...prev,
      mound: { remaining: 30, running: true }
    }));
  };

  const useCatcherMound = () => {
    const max = kbo.catcherMoundMax;
    if (kbo.catcherMoundUsed >= max) {
      showToast('⚠️ 포수 마운드 방문 한도 초과! 교체 조치 등이 필요합니다.');
      return;
    }
    const newVal = kbo.catcherMoundUsed + 1;
    onChangeKbo({ ...kbo, catcherMoundUsed: newVal });
    if (newVal >= max) {
      showToast(`⚠️ 포수 마운드 방문 ${max}회 도달! 추가 방문은 금지되어 있어 위반 시 포수 교체 벌칙이 따릅니다.`);
    } else {
      showToast(`포수 마운드 방문 ${newVal}/${max}회 기록`);
    }
  };

  const useBallChange = () => {
    if (kbo.ballChangeUsed >= 3) {
      showToast('⚠️ 볼 교체 한도 초과! (투수당 이닝 최대 3개) 심판은 특별 사유가 없는 한 교체를 불허합니다.');
      return;
    }
    const newVal = kbo.ballChangeUsed + 1;
    onChangeKbo({ ...kbo, ballChangeUsed: newVal });
    showToast(`투수용 볼 교환 ${newVal}/3개 사용`);
  };

  const addCatcherExtra = () => {
    onChangeKbo({ ...kbo, catcherMoundMax: kbo.catcherMoundMax + 1 });
    showToast(`포수 마운드 방문 한도가 ${kbo.catcherMoundMax + 1}회로 연장되었습니다.`);
  };

  // Pip dots rendering
  const renderPips = (used: number, max: number) => {
    return (
      <div className="flex gap-1 items-center">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={`w-3 h-3 rounded-full border transition-all ${
              i < used
                ? 'bg-rose-500 border-rose-400 scale-110 shadow-[0_0_8px_rgba(244,63,94,0.75)]'
                : 'bg-[#080809] border-white/10'
            }`}
          />
        ))}
      </div>
    );
  };

  const getTimerColorClass = (key: TimerKey) => {
    const r = timers[key].remaining;
    const def = TIMER_DEFS[key];
    if (r <= 0) return 'text-rose-500 font-extrabold animate-pulse drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]';
    if (r <= def.warnSec) return 'text-amber-400 font-bold drop-shadow-[0_0_4px_rgba(251,191,36,0.3)]';
    return 'text-emerald-400 font-bold drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]';
  };

  return (
    <div className="space-y-4" id="kbo-limit-tracker">
      {/* Dynamic Counter Panel */}
      <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-5 shadow-[0_0_15px_rgba(79,70,229,0.05)] space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-rose-400" />
            <h3 className="font-bold text-white text-sm">KBO 경기 스피드업 규정 적용</h3>
          </div>
          <span className="text-[10px] font-mono tracking-wider font-semibold bg-indigo-600/20 text-indigo-400 px-2.5 py-1 rounded-full border border-indigo-500/20">
            2025 공식 룰셋
          </span>
        </div>

        {/* 1. Offense team timeouts */}
        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-white/10 last:border-0">
          <div>
            <div className="text-xs font-bold text-slate-200">⚾ 공격팀 타임 (이닝당 최대 3회)</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">선수/코치 이탈 지연 방지</div>
          </div>
          <div className="flex items-center gap-3">
            {renderPips(kbo.offTimeUsed, 3)}
            <div className="flex items-center gap-1.5 ml-2">
              <button
                onClick={useOffTime}
                className="px-2.5 py-1 rounded bg-[#16161a] border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 transition-all cursor-pointer"
              >
                사용
              </button>
              <button
                onClick={() => onChangeKbo({ ...kbo, offTimeUsed: 0 })}
                className="px-2 py-1 rounded border border-transparent text-slate-500 text-xs hover:text-slate-300"
              >
                리셋
              </button>
            </div>
          </div>
        </div>

        {/* 2. Coach Mound Visit */}
        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-white/10 last:border-0">
          <div>
            <div className="text-xs font-bold text-slate-200">🏃 감독/코치 마운드 방문 (경기당 2회)</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">2회 방문 시 다음엔 교체 의무</div>
          </div>
          <div className="flex items-center gap-3">
            {renderPips(kbo.moundVisitUsed, 2)}
            <div className="flex items-center gap-1.5 ml-2">
              <button
                onClick={useMoundVisit}
                className="px-2.5 py-1 rounded bg-[#16161a] border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 transition-all cursor-pointer border-indigo-500/25 text-indigo-300"
              >
                방문
              </button>
              <button
                onClick={() => onChangeKbo({ ...kbo, moundVisitUsed: 0 })}
                className="px-2 py-1 rounded border border-transparent text-slate-500 text-xs hover:text-slate-300"
              >
                리셋
              </button>
            </div>
          </div>
        </div>

        {/* 3. Catcher Mound Visit */}
        <div className="flex items-center justify-between py-1.5 border-b border-dashed border-white/10 last:border-0">
          <div>
            <div className="text-xs font-bold text-slate-200">🥎 포수 마운드 방문 ({kbo.catcherMoundMax}회 제한)</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">정규이닝 2회 제공 (연장시 추가 가능)</div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                {renderPips(kbo.catcherMoundUsed, kbo.catcherMoundMax)}
                <div className="flex items-center gap-1">
                  <button
                    onClick={useCatcherMound}
                    className="px-2.5 py-1 rounded bg-[#16161a] border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 transition-all cursor-pointer"
                  >
                    방문
                  </button>
                  <button
                    onClick={() => onChangeKbo({ ...kbo, catcherMoundUsed: 0 })}
                    className="px-2 py-1 rounded border border-transparent text-slate-500 text-xs hover:text-slate-300"
                  >
                    리셋
                  </button>
                </div>
              </div>
              <button
                onClick={addCatcherExtra}
                className="text-[10px] text-indigo-400 font-bold hover:text-indigo-300 font-mono"
              >
                연장 돌입 +1회 추가하기
              </button>
            </div>
          </div>
        </div>

        {/* 4. Ball Exchange limit */}
        <div className="flex items-center justify-between py-1.5">
          <div>
            <div className="text-xs font-bold text-slate-200">⚾ 이닝당 볼 교체 (투수당 최대 3개)</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">불필요한 볼 교환 지연 규제 (첫 볼 제외)</div>
          </div>
          <div className="flex items-center gap-3">
            {renderPips(kbo.ballChangeUsed, 3)}
            <div className="flex items-center gap-1.5 ml-2">
              <button
                onClick={useBallChange}
                className="px-2.5 py-1 rounded bg-[#16161a] border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 transition-all cursor-pointer"
              >
                교체
              </button>
              <button
                onClick={() => onChangeKbo({ ...kbo, ballChangeUsed: 0 })}
                className="px-2 py-1 rounded border border-transparent text-slate-500 text-xs hover:text-slate-300"
              >
                리셋
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Specialized Timers Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" id="timers-dashboard">
        {(Object.keys(timers) as TimerKey[]).map((key) => {
          const t = timers[key];
          const def = TIMER_DEFS[key];
          return (
            <div key={key} className="bg-[#0C0C0E] border border-white/10 rounded-xl p-4 flex flex-col justify-between shadow-[0_0_15px_rgba(79,70,229,0.03)]">
              <div>
                <span className="text-[10px] font-mono tracking-widest text-slate-500 block mb-1 uppercase uppercase">{def.label}</span>
                <span className={`text-3xl font-mono tabular-nums tracking-tight ${getTimerColorClass(key)}`}>
                  {fmtTime(t.remaining)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => toggleTimer(key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                    t.running
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]'
                  }`}
                >
                  {t.running ? (
                    <>
                      <Square size={11} fill="white" /> 중지
                    </>
                  ) : (
                    <>
                      <Play size={11} fill="currentColor" /> 시작
                    </>
                  )}
                </button>
                <button
                  onClick={() => resetTimer(key)}
                  className="py-1.5 px-2.5 bg-white/5 border border-white/10 hover:border-white/20 rounded-lg text-slate-400 hover:text-white"
                  title="타이머 리셋"
                >
                  <RefreshCw size={13} className={t.running ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
