import { useState } from 'react';
import { Player, SubLogEntry } from '../types';
import { RefreshCw, UserPlus, FileText } from 'lucide-react';

interface SubstitutionManagerProps {
  inning: number;
  half: 'top' | 'bot';
  rosters: { A: Player[]; B: Player[] };
  onUpdateRosters: (team: 'A' | 'B', players: Player[]) => void;
  subLog: SubLogEntry[];
  onAddSubLog: (entry: SubLogEntry) => void;
  showToast: (msg: string) => void;
  teamAName: string;
  teamBName: string;
}

const POSITIONS = ['투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수', '지명타자'];

export default function SubstitutionManager({
  inning,
  half,
  rosters,
  onUpdateRosters,
  subLog,
  onAddSubLog,
  showToast,
  teamAName,
  teamBName
}: SubstitutionManagerProps) {
  const [subTeam, setSubTeam] = useState<'A' | 'B'>('A');
  const [subType, setSubType] = useState<'ph' | 'pr' | 'def' | 'p'>('ph');
  const [outId, setOutId] = useState<string>('');
  const [inId, setInId] = useState<string>('');
  const [newPos, setNewPos] = useState<string>('투수');
  const [subReason, setSubReason] = useState<string>('');

  const activeRoster = rosters[subTeam];
  const teamName = subTeam === 'A' ? teamAName : teamBName;

  // Players currently on field/active that can be taken OUT
  // ph/pr/def can be taken out. 'active' designates standard starting lineup.
  const outCandidates = activeRoster.filter((p) =>
    ['active', 'ph', 'pr', 'def'].includes(p.status)
  );

  // Bench players that can enter IN
  const inCandidates = activeRoster.filter((p) =>
    ['bench', 'active'].includes(p.status)
  );

  const handleApplySubstitution = () => {
    if (!outId || !inId) {
      showToast('⚠️ 나갈 선수와 대체 투입될 선수를 정확히 골라주세요.');
      return;
    }

    if (outId === inId) {
      showToast('⚠️ 나가는 선수와 들오는 선수가 동일 선수가 될 수 없습니다.');
      return;
    }

    const oPlayer = activeRoster.find((p) => p.id === parseInt(outId));
    const iPlayer = activeRoster.find((p) => p.id === parseInt(inId));

    if (!oPlayer || !iPlayer) {
      showToast('선수 데이터를 조회할 수 없습니다.');
      return;
    }

    const typeLabels = { ph: '대타', pr: '대주자', def: '수비교체', p: '투수교체' };
    const typeLabel = typeLabels[subType];

    // Create updated rosters
    const updatedPlayers = activeRoster.map((p) => {
      if (p.id === oPlayer.id) {
        // Player going out gets OUT status (cannot play anymore)
        return { ...p, status: 'out' as const };
      }
      if (p.id === iPlayer.id) {
        // Incoming status matches the type of substitution
        const nextStatus = subType === 'ph' ? ('ph' as const) : subType === 'pr' ? ('pr' as const) : subType === 'def' ? ('def' as const) : ('active' as const);
        const nextPos = (subType === 'def' || subType === 'p') ? newPos : oPlayer.pos;
        return { ...p, status: nextStatus, pos: nextPos };
      }
      return p;
    });

    onUpdateRosters(subTeam, updatedPlayers);

    // Save sub log entry
    const newEntry: SubLogEntry = {
      inning,
      half,
      team: subTeam,
      type: typeLabel,
      out: `#${oPlayer.num} ${oPlayer.name}`,
      in: `#${iPlayer.num} ${iPlayer.name}`,
      pos: (subType === 'def' || subType === 'p') ? newPos : oPlayer.pos,
      reason: subReason.trim(),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    onAddSubLog(newEntry);
    showToast(`🔄 [${typeLabel}] #${iPlayer.num} ${iPlayer.name} 선수가 경기에 투입되었습니다.`);

    // Reset fields
    setOutId('');
    setInId('');
    setSubReason('');
  };

  const getSubBadgeClass = (type: string) => {
    switch (type) {
      case '대타': return 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono';
      case '대주자': return 'bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono';
      case '수비교체': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono';
      case '투수교체': return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono';
      default: return 'bg-slate-500/10 text-slate-400 border border-white/10 font-mono';
    }
  };

  return (
    <div className="space-y-4 font-sans" id="substitution-manager">
      {/* Configuration Form */}
      <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-5 shadow-[0_0_15px_rgba(79,70,229,0.05)] space-y-4">
        <div>
          <h3 className="font-bold text-white text-sm">기반 선수 교체 기입</h3>
          <p className="text-xs text-slate-500 mt-1">
            시합 도중 일어나는 대타, 대주자 기입 및 투수/야수 수비 변경 상황을 입력하고 등록하세요.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1 font-mono tracking-wider">대상 팀</label>
            <select
              value={subTeam}
              onChange={(e) => {
                setSubTeam(e.target.value as 'A' | 'B');
                setOutId('');
                setInId('');
              }}
              className="w-full bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 font-semibold"
            >
              <option value="A" className="bg-[#0c0c0e] text-white">홈팀 ({teamAName})</option>
              <option value="B" className="bg-[#0c0c0e] text-white">원정팀 ({teamBName})</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1 font-mono tracking-wider">교체 형태</label>
            <select
              value={subType}
              onChange={(e) => setSubType(e.target.value as any)}
              className="w-full bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 font-semibold"
            >
              <option value="ph" className="bg-[#0c0c0e] text-white">대타 (PH)</option>
              <option value="pr" className="bg-[#0c0c0e] text-white">대주자 (PR)</option>
              <option value="def" className="bg-[#0c0c0e] text-white">수비 교체 (DEF)</option>
              <option value="p" className="bg-[#0c0c0e] text-white">투수 교체 (PITCHER)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1 font-mono tracking-wider">
              {subType === 'ph' ? '대타 원타자 (물러나는 타자)' : subType === 'pr' ? '물러나는 주자' : '그라운드에서 나가는 선수'}
            </label>
            <select
              value={outId}
              onChange={(e) => setOutId(e.target.value)}
              className="w-full bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
            >
              <option value="" className="bg-[#0c0c0e] text-slate-500">-- 선수 선택 --</option>
              {outCandidates.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0c0c0e] text-white">
                  #{p.num} {p.name} ({p.pos})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1 font-mono tracking-wider">
              새로 투입될 선수 (벤치 대기중)
            </label>
            <select
              value={inId}
              onChange={(e) => setInId(e.target.value)}
              className="w-full bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
            >
              <option value="" className="bg-[#0c0c0e] text-slate-500">-- 선수 선택 --</option>
              {inCandidates.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0c0c0e] text-white">
                  #{p.num} {p.name} ({p.pos}) {p.status === 'active' ? '(이미 출전중)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(subType === 'def' || subType === 'p') && (
          <div className="bg-[#080809] p-3 rounded-xl border border-white/10 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-300 block">수비 위치 배정</span>
              <span className="text-[11px] text-slate-500">교체되어 들어오는 선수가 선 수비 대형입니다.</span>
            </div>
            <select
              value={newPos}
              onChange={(e) => setNewPos(e.target.value)}
              className="border border-white/10 bg-[#0c0c0e] text-white rounded-lg text-xs font-bold py-1.5 px-3 focus:outline-none font-mono w-32 shadow-sm focus:border-indigo-500/50"
            >
              {POSITIONS.map((pos) => (
                <option key={pos} value={pos} className="bg-[#0c0c0e] text-white">
                  {pos}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1 font-mono tracking-wider">교체 특이사항 / 사유 (생략 가능)</label>
          <input
            type="text"
            placeholder="예: 전략 대타, 선발 투수 피로 누적, 부상 방지 등..."
            value={subReason}
            onChange={(e) => setSubReason(e.target.value)}
            className="w-full bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 placeholder:text-slate-600"
          />
        </div>

        <button
          onClick={handleApplySubstitution}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(79,70,229,0.4)] cursor-pointer"
        >
          <UserPlus size={16} /> 신규 교체 등록 및 게임 강제 동기화
        </button>
      </div>

      {/* Substitution History List */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-mono">
          금일 경기 교체 기록 ({subLog.length}건)
        </h4>

        <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-sm divide-y divide-white/5 max-h-[350px] overflow-y-auto space-y-1">
          {subLog.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              교체 내역이 아직 등록되지 않았습니다. 실시간 교체 카드로 반영됩니다.
            </div>
          ) : (
            subLog.map((log, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 py-3 first:pt-1 last:pb-1 text-xs hover:bg-white/[0.02] px-1.5 rounded transition-all">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getSubBadgeClass(log.type)}`}>
                    {log.type}
                  </span>
                  <span className="text-slate-400 font-bold font-mono">
                    {log.inning}회 {log.half === 'top' ? '초' : '말'}
                  </span>
                  <span className="font-bold text-white font-sans">
                    {log.in}
                  </span>
                  <span className="text-slate-500">투입</span>
                  <span className="text-white/10">|</span>
                  <span className="text-slate-400 font-sans">
                    {log.out} 아웃
                  </span>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-auto text-slate-400">
                  {log.pos && <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded text-[10px] font-mono">{log.pos}수 수비</span>}
                  {log.reason && <span className="italic text-slate-400">“{log.reason}”</span>}
                  <span className="font-mono text-[10px] bg-white/5 border border-white/5 text-slate-500 px-1.5 py-0.5 rounded">{log.time}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
