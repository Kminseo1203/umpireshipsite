export interface Player {
  id: number;
  num: number;
  name: string;
  pos: string;
  status: 'active' | 'bench' | 'ph' | 'pr' | 'def' | 'out';
}

export interface PlayLogEntry {
  label: string;
  type: 'ball' | 'strike' | 'foul' | 'hit' | 'out' | 'hr';
  inning: number;
  half: 'top' | 'bot';
}

export interface KboState {
  offTimeUsed: number;
  moundVisitUsed: number;
  catcherMoundUsed: number;
  catcherMoundMax: number;
  ballChangeUsed: number;
}

export interface SubLogEntry {
  inning: number;
  half: 'top' | 'bot';
  team: 'A' | 'B';
  type: string;
  out: string;
  in: string;
  pos: string;
  reason: string;
  time: string;
}

export interface GameState {
  scoreA: number;
  scoreB: number;
  inning: number;
  half: 'top' | 'bot';
  balls: number;
  strikes: number;
  outs: number;
  bases: boolean[]; // size 4: index 1=1st, 2=2nd, 3=3rd, index 0 is placeholder
  playLog: PlayLogEntry[];
  inningScores: Record<string, number>; // key: "A-1", "B-2", etc.
  curBatter: string;
  curPitcher: string;
  curPitcherA: string;
  curPitcherB: string;
  teamA: string;
  teamB: string;
  memo: string;
  kbo: KboState;
  subLog: SubLogEntry[];
}

export type TabType = 'game' | 'rosterA' | 'rosterB' | 'subs' | 'kbo' | 'abs';
