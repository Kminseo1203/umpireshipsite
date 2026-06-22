import { GameState } from '../types';

interface ScoreBoardGridProps {
  gameState: GameState;
}

export default function ScoreBoardGrid({ gameState }: ScoreBoardGridProps) {
  const { inning, half, inningScores, scoreA, scoreB, teamA, teamB } = gameState;
  const maxInning = Math.max(9, inning);

  // Generate innings array [1, 2, ..., maxInning]
  const innings = Array.from({ length: maxInning }, (_, i) => i + 1);

  return (
    <div className="w-full overflow-x-auto bg-[#0C0C0E] border border-white/10 rounded-xl p-4 shadow-[0_0_15px_rgba(79,70,229,0.1)]" id="scoreboard-grid">
      <table className="w-full border-collapse text-sm min-w-[480px]">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left font-bold text-slate-400 pb-2 pl-2 w-28 uppercase font-sans tracking-widest text-xs">팀</th>
            {innings.map((inn) => (
              <th key={inn} className={`font-mono text-xs pb-2 w-8 ${inning === inn ? 'text-indigo-400 bg-indigo-500/10 rounded-t border-t border-x border-white/10 font-bold' : 'text-slate-500'}`}>
                {inn}
              </th>
            ))}
            <th className="font-bold text-center text-slate-300 pb-2 pl-4 pr-2 w-10 border-l border-white/10 font-mono">R</th>
          </tr>
        </thead>
        <tbody>
          {/* Home Team Row (A) */}
          <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td className="text-left font-bold text-white py-3 pl-2 truncate font-sans tracking-tight">{teamA || '홈팀'}</td>
            {innings.map((inn) => {
              const score = inningScores[`A-${inn}`];
              const isPastOrActive = inn < inning || (inn === inning && half === 'bot');
              return (
                <td
                  key={`scoreA-${inn}`}
                  className={`text-center font-mono py-3 ${inning === inn && half === 'bot' ? 'bg-indigo-500/15 text-indigo-400 font-bold' : 'text-slate-300'}`}
                >
                  {score !== undefined ? score : (isPastOrActive ? '0' : '-')}
                </td>
              );
            })}
            <td className="text-center font-mono font-bold text-emerald-400 pr-2 pl-4 border-l border-white/10 text-base">{scoreA}</td>
          </tr>

          {/* Away Team Row (B) */}
          <tr className="hover:bg-white/5 transition-colors">
            <td className="text-left font-bold text-white py-3 pl-2 truncate font-sans tracking-tight">{teamB || '원정팀'}</td>
            {innings.map((inn) => {
              const score = inningScores[`B-${inn}`];
              const isPastOrActive = inn < inning;
              return (
                <td
                  key={`scoreB-${inn}`}
                  className={`text-center font-mono py-3 ${inning === inn && half === 'top' ? 'bg-indigo-500/15 text-indigo-400 font-bold' : 'text-slate-300'}`}
                >
                  {score !== undefined ? score : (isPastOrActive ? '0' : '-')}
                </td>
              );
            })}
            <td className="text-center font-mono font-bold text-emerald-400 pr-2 pl-4 border-l border-white/10 text-base">{scoreB}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
