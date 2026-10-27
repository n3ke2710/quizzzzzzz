import { describe, expect, it } from 'vitest';
import { createSession, getQuestion, rankTeams, reduceGame, toPublicView } from '../src/game/engine';
import type { CellKind, Command, GameSession, QuizPack } from '../src/game/types';

function makePack(): QuizPack {
  return {
    version: 1, id: 'test-pack', title: 'Вечер игры',
    rounds: [0, 1].map((round) => ({
      id: `round-${round}`, title: `Раунд ${round + 1}`,
      categories: Array.from({ length: 5 }, (_, category) => ({
        id: `category-${round}-${category}`, title: `Тема ${category + 1}`,
        questions: Array.from({ length: 5 }, (_, index) => ({
          id: `q-${round}-${category}-${index}`, value: (index + 1) * 100 * (round + 1), kind: 'normal' as const,
          prompt: { text: `Вопрос ${round}-${category}-${index}` }, answer: { text: `СЕКРЕТ ${round}-${category}-${index}` },
        })),
      })),
    })) as QuizPack['rounds'],
    final: Array.from({ length: 9 }, (_, index) => ({
      id: `final-${index}`, title: `Финальная тема ${index}`, prompt: { text: `ФИНАЛЬНЫЙ ВОПРОС ${index}` }, answer: { text: `ФИНАЛЬНЫЙ СЕКРЕТ ${index}` },
    })),
  };
}

function prepared(pack = makePack()) {
  let session = createSession();
  const send = (command: Command) => { session = reduceGame(session, command, pack); return session; };
  send({ type: 'ADD_TEAM', name: 'Альфа' });
  send({ type: 'ADD_TEAM', name: 'Бета' });
  send({ type: 'ADD_TEAM', name: 'Гамма' });
  const [a, b, c] = session.teams.map((team) => team.id);
  send({ type: 'START_ROUND' });
  return { pack, send, get session() { return session; }, a, b, c };
}

function withKind(kind: CellKind) {
  const pack = makePack();
  pack.rounds[0].categories[0].questions[0].kind = kind;
  return prepared(pack);
}

function toFinal(game: ReturnType<typeof prepared>) {
  for (let round = 0; round < 2; round += 1) {
    game.send({ type: 'END_ROUND' });
    game.send({ type: 'NEXT_ROUND' });
    if (round === 0) game.send({ type: 'START_ROUND' });
  }
}

function open(game: ReturnType<typeof prepared>) {
  game.send({ type: 'OPEN_CELL', questionId: 'q-0-0-0', openingTeamId: game.a });
}

describe('подготовка и обычные вопросы', () => {
  it('требует команду и сохраняет исходное состояние при успешных и ошибочных командах', () => {
    const pack = makePack();
    const initial = createSession();
    expect(() => reduceGame(initial, { type: 'START_ROUND' }, pack)).toThrow('Добавьте');
    const added = reduceGame(initial, { type: 'ADD_TEAM', name: ' Альфа ' }, pack);
    expect(initial.teams).toEqual([]);
    expect(added.teams[0].name).toBe('Альфа');
    expect(added.revision).toBe(initial.revision + 1);
    expect(() => reduceGame(added, { type: 'ADD_TEAM', name: 'альфа' }, pack)).toThrow('уже есть');
    expect(added.teams).toHaveLength(1);
  });

  it('списывает ошибку один раз, позволяет перехват и завершает вопрос правильным ответом', () => {
    const game = prepared();
    open(game);
    game.send({ type: 'SELECT_RESPONDER', teamId: game.b });
    game.send({ type: 'JUDGE', correct: false });
    expect(game.session.teams[1].score).toBe(-100);
    expect(() => game.send({ type: 'JUDGE', correct: false })).toThrow();
    expect(() => game.send({ type: 'SELECT_RESPONDER', teamId: game.b })).toThrow('уже ответила');
    game.send({ type: 'SELECT_RESPONDER', teamId: game.c });
    game.send({ type: 'JUDGE', correct: true });
    expect(game.session.teams.map((team) => team.score)).toEqual([0, -100, 100]);
    expect(() => game.send({ type: 'JUDGE', correct: true })).toThrow('уже завершён');
    game.send({ type: 'REVEAL_ANSWER' });
    expect(toPublicView(game.session, game.pack).question?.answer?.text).toContain('СЕКРЕТ');
    game.send({ type: 'CLOSE_QUESTION' });
    expect(game.session.usedQuestionIds).toContain('q-0-0-0');
    expect(() => open(game)).toThrow('уже сыгран');
  });

  it('удаляет команды только при подготовке, сохраняя остальные очки и финальный порядок', () => {
    const game = prepared();
    expect(() => game.send({ type: 'REMOVE_TEAM', teamId: game.b })).toThrow('текущем экране');
    game.send({ type: 'SET_SCORE', teamId: game.a, score: 250 });
    toFinal(game);
    game.send({ type: 'SET_FINAL_ORDER', order: [game.b, game.c, game.a] });
    game.send({ type: 'REMOVE_TEAM', teamId: game.b });
    expect(game.session.teams.map((team) => [team.id, team.score])).toEqual([[game.a, 250], [game.c, 0]]);
    expect(game.session.final.order).toEqual([game.c, game.a]);
    game.send({ type: 'START_ROUND' });
    expect(toPublicView(game.session, game.pack).finalTurnTeamId).toBe(game.c);
  });

  it('не открывает вопрос из другого раунда или пустой вопрос, но допускает картинку без текста', () => {
    const game = prepared();
    expect(() => game.send({ type: 'OPEN_CELL', questionId: 'q-1-0-0', openingTeamId: game.a })).toThrow('текущем раунде');
    const question = game.pack.rounds[0].categories[0].questions[0];
    question.prompt = { text: ' ' };
    expect(() => open(game)).toThrow('Заполните');
    question.prompt.image = 'data:image/png;base64,aGVsbG8=';
    open(game);
    expect(game.session.phase).toBe('question');
  });

  it('не меняет публичный открытый вопрос при редактировании без явного применения', () => {
    const game = prepared();
    open(game);
    const question = game.pack.rounds[0].categories[0].questions[0];
    question.prompt.text = 'Новый текст';
    question.answer.text = 'Новый ответ';
    question.value = 500;
    question.kind = 'flip';
    game.pack.rounds[0].categories[0].title = 'Новая тема';
    expect(toPublicView(game.session, game.pack).question?.prompt.text).not.toBe('Новый текст');
    game.send({ type: 'REFRESH_CONTENT' });
    expect(game.session.active).toMatchObject({ kind: 'normal', value: 100, category: 'Новая тема', prompt: { text: 'Новый текст' }, answer: { text: 'Новый ответ' } });
    expect(toPublicView(game.session, game.pack).question?.answer).toBeUndefined();
  });

  it('после последней клетки автоматически показывает рейтинг и очищает бонусы', () => {
    const game = prepared();
    const all = game.pack.rounds[0].categories.flatMap((category) => category.questions.map((question) => question.id));
    const last = all.pop()!;
    const before = structuredClone(game.session);
    before.usedQuestionIds = all;
    before.teams[0].bonuses = { approx: true, shield: 2, retry: 1, doubleReward: 3 };
    const opened = reduceGame(before, { type: 'OPEN_CELL', questionId: last, openingTeamId: game.a }, game.pack);
    const closed = reduceGame(opened, { type: 'CLOSE_QUESTION' }, game.pack);
    expect(closed.phase).toBe('ranking');
    expect(closed.usedQuestionIds).toHaveLength(25);
    expect(closed.teams[0].bonuses).toEqual({ approx: false, shield: 0, retry: 0, doubleReward: 0 });
    expect(closed.rankingStartedAt).toBeGreaterThan(0);
  });
});

describe('клетки вместо вопроса', () => {
  it.each([
    ['flip', 300, -300], ['flip', -300, 300], ['flip', 0, 0],
    ['double', 300, 600], ['double', -300, -600], ['double', 0, 0],
  ] as const)('%s преобразует %s в %s без очков за номинал', (kind, initial, expected) => {
    const game = withKind(kind);
    game.send({ type: 'SET_SCORE', teamId: game.a, score: initial });
    open(game);
    game.send({ type: 'APPLY_SPECIAL' });
    expect(game.session.teams[0].score).toBe(expected);
    expect(game.session.active?.resolved).toBe(true);
    expect(() => game.send({ type: 'APPLY_SPECIAL' })).toThrow('уже применён');
    expect(() => game.send({ type: 'SHOW_QUESTION' })).toThrow('без вопроса');
    expect(() => game.send({ type: 'JUDGE', correct: true })).toThrow();
    game.send({ type: 'CLOSE_QUESTION' });
    expect(game.session.teams[0].score).toBe(expected);
  });

  it('обменивает полные счета только выбранных соперников', () => {
    const game = withKind('swap');
    game.send({ type: 'SET_SCORE', teamId: game.a, score: -500 });
    game.send({ type: 'SET_SCORE', teamId: game.b, score: 800 });
    game.send({ type: 'SET_SCORE', teamId: game.c, score: 123 });
    open(game);
    expect(() => game.send({ type: 'SELECT_TARGET', teamId: game.a })).toThrow('соперников');
    expect(() => game.send({ type: 'APPLY_SPECIAL' })).toThrow('выберите');
    game.send({ type: 'SELECT_TARGET', teamId: game.b });
    const before = structuredClone(game.session);
    game.send({ type: 'APPLY_SPECIAL' });
    expect(game.session.teams.map((team) => team.score)).toEqual([800, -500, 123]);
    expect(before.teams.map((team) => team.score)).toEqual([-500, 800, 123]);
    expect(toPublicView(game.session, game.pack).special?.result).toContain('-500');
  });

  it('кот раскрывается после передачи и только получатель имеет одну итоговую попытку', () => {
    const game = withKind('cat');
    open(game);
    expect(toPublicView(game.session, game.pack).question).toBeUndefined();
    expect(() => game.send({ type: 'SHOW_QUESTION' })).toThrow('передайте');
    game.send({ type: 'SELECT_TARGET', teamId: game.b });
    game.send({ type: 'SHOW_QUESTION' });
    expect(() => game.send({ type: 'SELECT_RESPONDER', teamId: game.a })).toThrow('только');
    game.send({ type: 'JUDGE', correct: false });
    expect(game.session.teams.map((team) => team.score)).toEqual([0, -100, 0]);
    expect(game.session.active?.resolved).toBe(true);
    expect(() => game.send({ type: 'SELECT_RESPONDER', teamId: game.c })).toThrow();
  });

  it('не переполняет безопасный диапазон при удвоении', () => {
    const game = withKind('double');
    game.send({ type: 'SET_SCORE', teamId: game.a, score: Number.MAX_SAFE_INTEGER });
    open(game);
    const before = structuredClone(game.session);
    expect(() => game.send({ type: 'APPLY_SPECIAL' })).toThrow('слишком большой');
    expect(game.session).toEqual(before);
  });
});

describe('бонусы и их сочетания', () => {
  it.each(['approx', 'shield', 'retry', 'doubleReward'] as const)('%s выдаётся выбравшей клетку команде перед обычным вопросом', (kind) => {
    const game = withKind(kind);
    open(game);
    expect(() => game.send({ type: 'SHOW_QUESTION' })).toThrow('Сначала выдайте');
    game.send({ type: 'APPLY_SPECIAL' });
    expect(game.session.teams[0].bonuses[kind]).toBe(kind === 'approx' ? true : 1);
    expect(game.session.teams[1].bonuses[kind]).toBe(kind === 'approx' ? false : 0);
    expect(() => game.send({ type: 'APPLY_SPECIAL' })).toThrow();
    game.send({ type: 'SHOW_QUESTION' });
    game.send({ type: 'SELECT_RESPONDER', teamId: game.b });
    game.send({ type: 'JUDGE', correct: true });
    expect(game.session.teams[1].score).toBe(100);
  });

  it('одинаковые разовые бонусы копятся, approx не выходит за пределы раунда', () => {
    const pack = makePack();
    pack.rounds[0].categories[0].questions[0].kind = 'shield';
    pack.rounds[0].categories[0].questions[1].kind = 'shield';
    const game = prepared(pack);
    for (const questionId of ['q-0-0-0', 'q-0-0-1']) {
      game.send({ type: 'OPEN_CELL', questionId, openingTeamId: game.a });
      game.send({ type: 'APPLY_SPECIAL' });
      game.send({ type: 'SHOW_QUESTION' });
      game.send({ type: 'CLOSE_QUESTION' });
    }
    expect(game.session.teams[0].bonuses.shield).toBe(2);
    game.send({ type: 'END_ROUND' });
    expect(game.session.teams.every((team) => !team.bonuses.approx && !team.bonuses.shield && !team.bonuses.retry && !team.bonuses.doubleReward)).toBe(true);
  });

  function bonusGame(kind: CellKind = 'normal') {
    const game = withKind(kind);
    const initial = structuredClone(game.session);
    initial.teams[1].bonuses = { approx: true, shield: 1, retry: 2, doubleReward: 2 };
    let session: GameSession = initial;
    const send = (command: Command) => { session = reduceGame(session, command, game.pack); return session; };
    send({ type: 'OPEN_CELL', questionId: 'q-0-0-0', openingTeamId: game.a });
    if (kind === 'cat') {
      send({ type: 'SELECT_TARGET', teamId: game.b });
      send({ type: 'SHOW_QUESTION' });
    } else send({ type: 'SELECT_RESPONDER', teamId: game.b });
    return { ...game, send, get session() { return session; } };
  }

  it('retry + doubleReward сохраняют удвоение на второй приблизительный ответ, shield остаётся', () => {
    const game = bonusGame();
    game.send({ type: 'ACTIVATE_DOUBLE' });
    expect(() => game.send({ type: 'ACTIVATE_DOUBLE' })).toThrow();
    expect(() => game.send({ type: 'SELECT_RESPONDER', teamId: game.c })).toThrow('активировавшей');
    game.send({ type: 'JUDGE', correct: false });
    expect(game.session.teams[1].score).toBe(0);
    expect(game.session.teams[1].bonuses.shield).toBe(1);
    expect(() => game.send({ type: 'JUDGE', correct: false })).toThrow('вторую попытку');
    game.send({ type: 'USE_RETRY' });
    expect(() => game.send({ type: 'USE_RETRY' })).toThrow();
    expect(() => game.send({ type: 'CLOSE_QUESTION' })).toThrow('оцените вторую');
    expect(() => game.send({ type: 'REVEAL_ANSWER' })).toThrow('оцените вторую');
    expect(() => game.send({ type: 'END_ROUND' })).toThrow('оцените вторую');
    game.send({ type: 'JUDGE', correct: true });
    expect(game.session.teams[1].score).toBe(200);
    expect(game.session.teams[1].bonuses).toEqual({ approx: true, shield: 1, retry: 1, doubleReward: 1 });
  });

  it('две ошибки расходуют retry, doubleReward и один shield без двойного штрафа', () => {
    const game = bonusGame();
    game.send({ type: 'ACTIVATE_DOUBLE' });
    game.send({ type: 'JUDGE', correct: false });
    game.send({ type: 'USE_RETRY' });
    game.send({ type: 'JUDGE', correct: false });
    expect(game.session.teams[1].score).toBe(0);
    expect(game.session.teams[1].bonuses).toEqual({ approx: true, shield: 0, retry: 1, doubleReward: 1 });
    expect(game.session.active?.attemptedTeamIds).toEqual([game.b]);
    expect(game.session.active?.retryPending).toBe(false);
    game.send({ type: 'SELECT_RESPONDER', teamId: game.c });
    game.send({ type: 'JUDGE', correct: true });
    expect(game.session.teams[2].score).toBe(100);
  });

  it('при двух ошибках без shield штраф равен одному номиналу независимо от удвоения', () => {
    const game = bonusGame();
    const initial = structuredClone(game.session);
    initial.teams[1].bonuses.shield = 0;
    let session = reduceGame(initial, { type: 'ACTIVATE_DOUBLE' }, game.pack);
    session = reduceGame(session, { type: 'JUDGE', correct: false }, game.pack);
    session = reduceGame(session, { type: 'USE_RETRY' }, game.pack);
    expect(() => reduceGame(session, { type: 'ACTIVATE_DOUBLE' }, game.pack)).toThrow();
    session = reduceGame(session, { type: 'JUDGE', correct: false }, game.pack);
    expect(session.teams[1].score).toBe(-100);
  });

  it('у получателя кота отказ от retry сохраняет заряд, а shield поглощает итоговую ошибку', () => {
    const game = bonusGame('cat');
    game.send({ type: 'JUDGE', correct: false });
    expect(() => game.send({ type: 'REVEAL_ANSWER' })).toThrow('второй попытке');
    game.send({ type: 'DECLINE_RETRY' });
    expect(game.session.teams.map((team) => team.score)).toEqual([0, 0, 0]);
    expect(game.session.teams[1].bonuses.retry).toBe(2);
    expect(game.session.teams[1].bonuses.shield).toBe(0);
    expect(game.session.active?.resolved).toBe(true);
  });
});

describe('финал и рейтинг', () => {
  it('сохраняет ручной циклический порядок и запрещает менять его после первого вычёркивания', () => {
    const game = prepared();
    toFinal(game);
    expect(game.session.phase).toBe('setup');
    expect(game.session.round).toBe(2);
    expect(() => game.send({ type: 'SET_FINAL_ORDER', order: [game.a, game.a, game.b] })).toThrow('ровно один раз');
    game.send({ type: 'SET_FINAL_ORDER', order: [game.c, game.b, game.a] });
    game.send({ type: 'START_ROUND' });
    game.send({ type: 'SET_FINAL_ORDER', order: [game.b, game.a, game.c] });
    expect(toPublicView(game.session, game.pack).finalTurnTeamId).toBe(game.b);
    game.send({ type: 'ELIMINATE_TOPIC', topicId: 'final-0' });
    expect(toPublicView(game.session, game.pack).finalTurnTeamId).toBe(game.a);
    expect(() => game.send({ type: 'SET_FINAL_ORDER', order: [game.a, game.b, game.c] })).toThrow('первым');
    expect(() => game.send({ type: 'ELIMINATE_TOPIC', topicId: 'final-0' })).toThrow('уже');
    game.send({ type: 'ELIMINATE_TOPIC', topicId: 'final-1' });
    game.send({ type: 'ELIMINATE_TOPIC', topicId: 'final-2' });
    expect(toPublicView(game.session, game.pack).finalTurnTeamId).toBe(game.b);
  });

  it('принимает ставки выше счёта и ноль, скрывает их и начисляет финал один раз после всех оценок', () => {
    const game = prepared();
    game.send({ type: 'SET_SCORE', teamId: game.a, score: -50 });
    game.send({ type: 'SET_SCORE', teamId: game.b, score: 100 });
    toFinal(game);
    game.send({ type: 'START_ROUND' });
    for (let i = 0; i < 8; i += 1) game.send({ type: 'ELIMINATE_TOPIC', topicId: `final-${i}` });
    expect(game.session.phase).toBe('finalBets');
    expect(game.session.final.topicId).toBe('final-8');
    expect(() => game.send({ type: 'SET_BET', teamId: game.a, amount: -1 })).toThrow('от нуля');
    game.send({ type: 'SET_BET', teamId: game.a, amount: 5000 });
    game.send({ type: 'SET_BET', teamId: game.b, amount: 2000 });
    expect(() => game.send({ type: 'LOCK_BETS' })).toThrow('каждой команды');
    game.send({ type: 'SET_BET', teamId: game.c, amount: 0 });
    game.send({ type: 'LOCK_BETS' });
    expect(() => game.send({ type: 'SET_BET', teamId: game.c, amount: 100 })).toThrow();
    const questionView = toPublicView(game.session, game.pack);
    expect(questionView.question?.answer).toBeUndefined();
    expect(JSON.stringify(questionView)).not.toMatch(/5000|2000|ФИНАЛЬНЫЙ СЕКРЕТ|"bets"|"results"/);
    game.send({ type: 'SET_FINAL_RESULT', teamId: game.a, correct: true });
    game.send({ type: 'SET_FINAL_RESULT', teamId: game.b, correct: false });
    expect(() => game.send({ type: 'REVEAL_FINAL_ANSWER' })).toThrow('всех команд');
    game.send({ type: 'SET_FINAL_RESULT', teamId: game.c, correct: false });
    expect(game.session.teams.map((team) => team.score)).toEqual([-50, 100, 0]);
    game.send({ type: 'REVEAL_FINAL_ANSWER' });
    expect(toPublicView(game.session, game.pack).question?.answer?.text).toContain('ФИНАЛЬНЫЙ СЕКРЕТ');
    game.send({ type: 'SETTLE_FINAL' });
    expect(game.session.teams.map((team) => team.score)).toEqual([4950, -1900, 0]);
    expect(game.session.phase).toBe('ranking');
    expect(game.session.final.settled).toBe(true);
    expect(() => game.send({ type: 'SETTLE_FINAL' })).toThrow();
    game.send({ type: 'NEXT_ROUND' });
    expect(game.session.phase).toBe('finished');
    expect(toPublicView(game.session, game.pack).rankingShowAll).toBe(true);
  });

  it('поддерживает равные места, отрицательные очки и перестроение рейтинга после ручной коррекции', () => {
    const game = prepared();
    game.send({ type: 'SET_SCORE', teamId: game.a, score: -100 });
    game.send({ type: 'SET_SCORE', teamId: game.b, score: 200 });
    game.send({ type: 'SET_SCORE', teamId: game.c, score: 200 });
    expect(rankTeams(game.session.teams).map((entry) => [entry.teamId, entry.place])).toEqual([[game.b, 1], [game.c, 1], [game.a, 3]]);
    game.send({ type: 'END_ROUND' });
    game.send({ type: 'RANKING_SHOW_ALL' });
    expect(game.session.rankingShowAll).toBe(true);
    game.send({ type: 'RANKING_REPLAY' });
    expect(game.session.rankingShowAll).toBe(false);
    game.send({ type: 'SET_SCORE', teamId: game.a, score: 300 });
    expect(game.session.ranking[0].teamId).toBe(game.a);
    expect(game.session.rankingShowAll).toBe(false);
    expect(toPublicView(game.session, game.pack).ranking?.[0].score).toBe(300);
  });
});

describe('публичная проекция', () => {
  it('на доске скрывает ответы, типы клеток и очки, не предоставляет изменяемых ссылок', () => {
    const game = withKind('cat');
    game.send({ type: 'SET_SCORE', teamId: game.a, score: -12345 });
    const view = toPublicView(game.session, game.pack);
    expect(JSON.stringify(view)).not.toMatch(/СЕКРЕТ|"kind"|"answer"|"score"|12345|"cat"/);
    expect(view.board?.categories[0].cells[0]).toEqual({ id: 'q-0-0-0', value: 100, used: false });
    view.teams[0].bonuses.shield = 100;
    expect(game.session.teams[0].bonuses.shield).toBe(0);
    expect(getQuestion(game.pack, 'q-1-0-0')?.question.value).toBe(200);
    expect(getQuestion(game.pack, 'нет')).toBeUndefined();
  });
});

it('проводит все 25 + 25 клеток со всеми фишками и бонусами до финального расчёта и победителя', () => {
  const pack = makePack();
  (['cat', 'approx', 'shield', 'retry'] as const).forEach((kind, index) => {
    pack.rounds[0].categories[0].questions[index].kind = kind;
  });
  (['flip', 'swap', 'double', 'doubleReward'] as const).forEach((kind, index) => {
    pack.rounds[1].categories[0].questions[index].kind = kind;
  });
  const game = prepared(pack);
  for (let round = 0; round < 2; round += 1) {
    for (const question of pack.rounds[round].categories.flatMap((category) => category.questions)) {
      expect(game.session.phase).toBe('board');
      game.send({ type: 'OPEN_CELL', questionId: question.id, openingTeamId: game.a });
      if (['flip', 'swap', 'double'].includes(question.kind)) {
        if (question.kind === 'swap') game.send({ type: 'SELECT_TARGET', teamId: game.b });
        game.send({ type: 'APPLY_SPECIAL' });
      } else {
        if (question.kind === 'cat') {
          game.send({ type: 'SELECT_TARGET', teamId: game.b });
          game.send({ type: 'SHOW_QUESTION' });
          game.send({ type: 'JUDGE', correct: false });
        } else {
          if (question.kind !== 'normal') {
            game.send({ type: 'APPLY_SPECIAL' });
            game.send({ type: 'SHOW_QUESTION' });
          }
          game.send({ type: 'SELECT_RESPONDER', teamId: game.a });
          if (question.kind === 'doubleReward') game.send({ type: 'ACTIVATE_DOUBLE' });
          if (question.kind === 'retry') {
            game.send({ type: 'JUDGE', correct: false });
            game.send({ type: 'USE_RETRY' });
          }
          if (question.kind === 'shield') {
            game.send({ type: 'JUDGE', correct: false });
            game.send({ type: 'SELECT_RESPONDER', teamId: game.b });
          }
          game.send({ type: 'JUDGE', correct: true });
        }
        game.send({ type: 'REVEAL_ANSWER' });
      }
      game.send({ type: 'CLOSE_QUESTION' });
    }
    expect(game.session.phase).toBe('ranking');
    expect(game.session.usedQuestionIds).toHaveLength((round + 1) * 25);
    expect(game.session.teams.map((team) => team.score)).toEqual(round === 0 ? [7100, 200, 0] : [15000, -7100, 0]);
    expect(game.session.teams.every((team) => !team.bonuses.approx && !team.bonuses.shield && !team.bonuses.retry && !team.bonuses.doubleReward)).toBe(true);
    game.send({ type: 'NEXT_ROUND' });
    if (round === 0) game.send({ type: 'START_ROUND' });
  }
  expect(game.session.phase).toBe('setup');
  expect(game.session.round).toBe(2);
  game.send({ type: 'SET_FINAL_ORDER', order: [game.b, game.c, game.a] });
  game.send({ type: 'START_ROUND' });
  pack.final.slice(0, 8).forEach((topic) => game.send({ type: 'ELIMINATE_TOPIC', topicId: topic.id }));
  game.send({ type: 'SET_BET', teamId: game.a, amount: 5000 });
  game.send({ type: 'SET_BET', teamId: game.b, amount: 10000 });
  game.send({ type: 'SET_BET', teamId: game.c, amount: 0 });
  game.send({ type: 'LOCK_BETS' });
  for (const teamId of [game.a, game.b, game.c]) game.send({ type: 'SET_FINAL_RESULT', teamId, correct: true });
  game.send({ type: 'REVEAL_FINAL_ANSWER' });
  game.send({ type: 'SET_FINAL_RESULT', teamId: game.b, correct: false });
  expect(game.session.teams.map((team) => team.score)).toEqual([15000, -7100, 0]);
  game.send({ type: 'SETTLE_FINAL' });
  expect(game.session.teams.map((team) => team.score)).toEqual([20000, -17100, 0]);
  expect(toPublicView(game.session, pack).ranking?.map(({ teamId, place, score }) => [teamId, place, score]))
    .toEqual([[game.a, 1, 20000], [game.c, 2, 0], [game.b, 3, -17100]]);
  game.send({ type: 'NEXT_ROUND' });
  expect(game.session.phase).toBe('finished');
});
