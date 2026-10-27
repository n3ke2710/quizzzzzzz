export type CellKind = 'normal' | 'cat' | 'flip' | 'swap' | 'double' | 'approx' | 'shield' | 'retry' | 'doubleReward';
export type Content = { text: string; image?: string };
export type Question = { id: string; value: number; kind: CellKind; prompt: Content; answer: Content };
export type Category = { id: string; title: string; questions: Question[] };
export type RegularRound = { id: string; title: string; categories: Category[] };
export type FinalTopic = { id: string; title: string; prompt: Content; answer: Content };
export type QuizPack = { version: 1; id: string; title: string; rounds: [RegularRound, RegularRound]; final: FinalTopic[] };
export type Bonuses = { approx: boolean; shield: number; retry: number; doubleReward: number };
export type Team = { id: string; name: string; color: string; score: number; bonuses: Bonuses };
export type RankingEntry = { teamId: string; name: string; color: string; score: number; place: number };
export type ActiveQuestion = {
  questionId: string;
  openingTeamId: string;
  targetTeamId?: string;
  respondingTeamId?: string;
  kind: CellKind;
  value: number;
  category: string;
  prompt: Content;
  answer: Content;
  attemptedTeamIds: string[];
  retryUsedTeamIds: string[];
  doubleUsedTeamIds: string[];
  doubleTeamId?: string;
  retryPending: boolean;
  resolved: boolean;
  effectApplied: boolean;
};
export type Phase = 'setup' | 'board' | 'special' | 'question' | 'answer' | 'ranking' | 'finalElimination' | 'finalBets' | 'finalQuestion' | 'finalAnswer' | 'finished';
export type FinalState = {
  order: string[];
  eliminated: string[];
  turn: number;
  bets: Record<string, number>;
  results: Record<string, boolean>;
  locked: boolean;
  settled: boolean;
  topicId?: string;
  prompt?: Content;
  answer?: Content;
};
export type GameSession = {
  id: string;
  revision: number;
  round: 0 | 1 | 2;
  phase: Phase;
  teams: Team[];
  usedQuestionIds: string[];
  active?: ActiveQuestion;
  final: FinalState;
  ranking: RankingEntry[];
  rankingStartedAt: number;
  rankingShowAll: boolean;
};
export type HistoryEntry = { id: string; label: string; at: number; before: GameSession };
export type SavedGame = { pack: QuizPack; session: GameSession; history: HistoryEntry[] };
export type PublicTeam = { id: string; name: string; color: string; bonuses: Bonuses };
export type PublicBoard = { title: string; categories: { id: string; title: string; cells: { id: string; value: number; used: boolean }[] }[] };
export type PublicView = {
  sessionId: string;
  revision: number;
  packTitle: string;
  round: number;
  phase: Phase;
  teams: PublicTeam[];
  board?: PublicBoard;
  question?: { category: string; value: number; prompt: Content; answer?: Content; respondingTeamId?: string; resolved: boolean };
  special?: { kind: CellKind; teamName: string; teamColor: string; targetName?: string; applied: boolean; result?: string };
  finalTopics?: { id: string; title: string; eliminated: boolean }[];
  finalTurnTeamId?: string;
  ranking?: RankingEntry[];
  rankingStartedAt?: number;
  rankingShowAll?: boolean;
};
export type Command =
  | { type: 'ADD_TEAM'; name: string; color?: string }
  | { type: 'REMOVE_TEAM'; teamId: string }
  | { type: 'RENAME_TEAM'; teamId: string; name: string }
  | { type: 'SET_SCORE'; teamId: string; score: number }
  | { type: 'START_ROUND' }
  | { type: 'OPEN_CELL'; questionId: string; openingTeamId: string }
  | { type: 'SELECT_TARGET'; teamId: string }
  | { type: 'APPLY_SPECIAL' }
  | { type: 'SHOW_QUESTION' }
  | { type: 'SELECT_RESPONDER'; teamId: string }
  | { type: 'ACTIVATE_DOUBLE' }
  | { type: 'JUDGE'; correct: boolean }
  | { type: 'USE_RETRY' }
  | { type: 'DECLINE_RETRY' }
  | { type: 'REVEAL_ANSWER' }
  | { type: 'CLOSE_QUESTION' }
  | { type: 'REFRESH_CONTENT' }
  | { type: 'END_ROUND' }
  | { type: 'RANKING_SHOW_ALL' }
  | { type: 'RANKING_REPLAY' }
  | { type: 'NEXT_ROUND' }
  | { type: 'SET_FINAL_ORDER'; order: string[] }
  | { type: 'ELIMINATE_TOPIC'; topicId: string }
  | { type: 'SET_BET'; teamId: string; amount: number }
  | { type: 'LOCK_BETS' }
  | { type: 'SET_FINAL_RESULT'; teamId: string; correct: boolean }
  | { type: 'REVEAL_FINAL_ANSWER' }
  | { type: 'SETTLE_FINAL' };
