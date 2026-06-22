import { useState, useRef } from 'react';
import { Player } from '../types';
import { Plus, Trash2, Download, Upload, UserMinus, UserCheck } from 'lucide-react';

interface RosterManagerProps {
  team: 'A' | 'B';
  teamName: string;
  players: Player[];
  onPlayersChange: (updated: Player[]) => void;
  showToast: (msg: string) => void;
  onRequestIncrementPid: () => number;
}

const POSITIONS = ['투수', '포수', '1루수', '2루수', '3루수', '유격수', '좌익수', '중견수', '우익수', '지명타자'];
const AV_BG = [
  'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
  'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
  'bg-violet-500/10 text-violet-300 border border-violet-500/20',
  'bg-amber-500/10 text-amber-300 border border-amber-500/20',
  'bg-rose-500/10 text-rose-300 border border-rose-500/20',
  'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
];

export default function RosterManager({
  team,
  teamName,
  players,
  onPlayersChange,
  showToast,
  onRequestIncrementPid
}: RosterManagerProps) {
  const [newNum, setNewNum] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newPos, setNewPos] = useState<string>('투수');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddPlayer = () => {
    const numVal = parseInt(newNum) || players.length + 1;
    const nameVal = newName.trim() || `선수 ${players.length + 1}`;

    const newPlayer: Player = {
      id: onRequestIncrementPid(),
      num: numVal,
      name: nameVal,
      pos: newPos,
      status: 'active'
    };

    onPlayersChange([...players, newPlayer]);
    setNewNum('');
    setNewName('');
    showToast(`✅ [${teamName}] #${numVal} ${nameVal} 선수가 성공적으로 등록되었습니다.`);
  };

  const handleRemovePlayer = (id: number, name: string) => {
    if (!confirm(`선수 [${name}] 명단을 삭제하시겠습니까?`)) return;
    onPlayersChange(players.filter((p) => p.id !== id));
    showToast(`🗑️ ${name} 선수가 명단에서 삭제되었습니다.`);
  };

  const handleUpdatePlayerName = (id: number, name: string) => {
    if (!name.trim()) return;
    onPlayersChange(
      players.map((p) => (p.id === id ? { ...p, name: name.trim() } : p))
    );
  };

  const handleUpdatePlayerPos = (id: number, pos: string) => {
    onPlayersChange(
      players.map((p) => (p.id === id ? { ...p, pos } : p))
    );
  };

  const handleToggleBench = (id: number) => {
    onPlayersChange(
      players.map((p) => {
        if (p.id === id) {
          const nextStatus = p.status === 'bench' ? 'active' : 'bench';
          showToast(`🏃 #${p.num} ${p.name} 선수가 ${nextStatus === 'bench' ? '벤치 대기' : '출전 가능'} 상태가 되었습니다.`);
          return { ...p, status: nextStatus };
        }
        return p;
      })
    );
  };

  const handleClearRoster = () => {
    if (!confirm(`${teamName}의 모든 선수 명단을 완전히 초기화할까요?`)) return;
    onPlayersChange([]);
    showToast(`🗑️ ${teamName} 명단이 전체 초기화되었습니다.`);
  };

  const handleExportRoster = () => {
    const data = {
      team: teamName,
      exportedAt: new Date().toISOString(),
      players
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roster_${teamName.replace(/[^\w가-힣]/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`📥 ${teamName} 명단 JSON을 성공적으로 다운로드했습니다.`);
  };

  const handleImportRoster = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target?.result as string;
        const data = JSON.parse(raw);
        const importedPlayers = Array.isArray(data) ? data : data.players;

        if (!Array.isArray(importedPlayers)) {
          throw new Error('올바른 파일 형식이 아닙니다 (JSON Array 형태로 선수 정보가 제공되어야 함).');
        }

        if (
          !confirm(
            `${importedPlayers.length}명의 데이터를 불러와 [${teamName}]의 해당 명단을 대체하시겠습니까?`
          )
        ) {
          return;
        }

        const formatted: Player[] = importedPlayers.map((p, idx) => ({
          id: p.id || onRequestIncrementPid() + idx,
          num: p.num || idx + 1,
          name: p.name || `수입선수${idx + 1}`,
          pos: p.pos || '투수',
          status: p.status || 'active'
        }));

        onPlayersChange(formatted);
        showToast(`📂 [${teamName}] 에 ${formatted.length}명의 명단이 적용되었습니다.`);
      } catch (err: any) {
        alert('파일을 가져오는데 실패했습니다: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4" id="roster-manager">
      <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-5 shadow-[0_0_15px_rgba(79,70,229,0.05)] space-y-4">
        <div>
          <h3 className="font-bold text-white text-sm">신규 선수 추가</h3>
          <p className="text-xs text-slate-500 mt-1">
            등록된 양식에 맞춰 번호, 성명, 수비 포지션을 기입하여 추가하세요.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="number"
            placeholder="번호"
            value={newNum}
            onChange={(e) => setNewNum(e.target.value)}
            className="w-full sm:w-16 bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/55 placeholder:text-slate-600 font-mono"
            min="1"
            max="99"
          />
          <input
            type="text"
            placeholder="선수 성명"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 bg-[#080809] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/55 placeholder:text-slate-600"
          />
          <select
            value={newPos}
            onChange={(e) => setNewPos(e.target.value)}
            className="w-full sm:w-28 bg-[#080809] border border-white/10 text-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/55 font-semibold"
          >
            {POSITIONS.map((pos) => (
              <option key={pos} value={pos} className="bg-[#0c0c0e] text-white">
                {pos}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddPlayer}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(79,70,229,0.3)] w-full sm:w-auto shrink-0 cursor-pointer"
          >
            <Plus size={16} /> 등록
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
            라인업 명단 ({players.length}명)
          </h4>
          <span className="text-[11px] text-indigo-400 font-bold">
            ✓ 수비 포지션과 이름은 리스트 상에서 직접 수정할 수 있습니다.
          </span>
        </div>

        <div className="bg-[#0C0C0E] border border-white/10 rounded-2xl p-4 shadow-sm divide-y divide-white/5 max-h-[460px] overflow-y-auto">
          {players.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              등록된 선수가 아직 존재하지 않습니다. 상단 폼에서 선수를 기입해 주세요.
            </div>
          ) : (
            players.map((p, idx) => {
              const bgClass = AV_BG[idx % AV_BG.length];
              return (
                <div key={p.id} className="flex items-center gap-2 sm:gap-3 py-3 first:pt-0 last:pb-0">
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 select-none ${bgClass}`}>
                    {p.name.slice(0, 2)}
                  </div>

                  {/* Num */}
                  <span className="text-xs font-bold font-mono text-slate-500 tracking-wider w-8 text-right">
                    #{p.num}
                  </span>

                  {/* Name field (dynamic) */}
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => handleUpdatePlayerName(p.id, e.target.value)}
                    className="flex-1 bg-transparent font-medium text-white border-b border-transparent focus:border-indigo-500/50 focus:bg-white/5 focus:outline-none py-0.5 px-2 text-sm rounded transition-all"
                  />

                  {/* Pos selector */}
                  <select
                    value={p.pos}
                    onChange={(e) => handleUpdatePlayerPos(p.id, e.target.value)}
                    className="border border-white/10 bg-[#080809] text-slate-300 rounded-lg text-xs font-semibold py-1 px-2 focus:outline-none focus:border-indigo-500/50 cursor-pointer hover:bg-white/5 font-mono"
                  >
                    {POSITIONS.map((pos) => (
                      <option key={pos} value={pos} className="bg-[#0c0c0e] text-white">
                        {pos}
                      </option>
                    ))}
                  </select>

                  {/* Status indicator */}
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold select-none shrink-0 border uppercase tracking-wide font-mono ${
                      p.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : p.status === 'bench'
                        ? 'bg-slate-500/10 text-slate-400 border-white/10'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}
                  >
                    {p.status === 'active' ? '출전중' : p.status === 'bench' ? '벤치' : '아웃'}
                  </span>

                  {/* Bench Toggle button */}
                  <button
                    onClick={() => handleToggleBench(p.id)}
                    className="p-1 px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-slate-300 hover:text-white text-xs flex items-center gap-1 shrink-0 cursor-pointer"
                    title={p.status === 'bench' ? '경기 출전 명단에 복귀' : '시합 벤치에 대기'}
                  >
                    {p.status === 'bench' ? <UserCheck size={13} /> : <UserMinus size={13} />}
                    <span className="hidden sm:inline">{p.status === 'bench' ? '출전' : '대기'}</span>
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleRemovePlayer(p.id, p.name)}
                    className="p-1.5 text-rose-400 hover:text-rose-300 rounded-lg hover:bg-rose-500/10 transition-colors shrink-0 cursor-pointer"
                    title="선수 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Roster actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportRoster}
            className="flex items-center gap-1.5 bg-[#0C0C0E] border border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3.5 py-1.5 text-xs font-semibold scale-95 hover:scale-100 transition-all shadow-sm cursor-pointer"
          >
            <Download size={14} /> 명단 내보내기 (JSON)
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 bg-[#0C0C0E] border border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3.5 py-1.5 text-xs font-semibold scale-95 hover:scale-100 transition-all shadow-sm cursor-pointer"
          >
            <Upload size={14} /> 명단 불러오기
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".json,application/json"
            onChange={(e) => handleImportRoster(e.target.files)}
          />
        </div>
        <button
          onClick={handleClearRoster}
          className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-rose-500/20"
        >
          <Trash2 size={14} /> 전체 초기화
        </button>
      </div>
    </div>
  );
}
