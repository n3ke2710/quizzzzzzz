import type {
  ActiveQuestion, Bonuses, Category, Command, GameSession, PublicView,
  Question, QuizPack, RankingEntry, Team,
} from './types';

const palette = ['#5EEAD4', '#FBBF24', '#C4B5FD', '#FB7185', '#60A5FA', '#FDBA74', '#A3E635', '#F0ABFC'];
const prizeKinds = new Set(['flip', 'swap', 'double']);
const bonusKinds = new Set(['approx', 'shield', 'retry', 'doubleReward']);
const emptyBonuses = (): Bonuses => ({ approx: false, shield: 0, retry: 0, doubleReward: 0 });
const fail = (message: string): never => { throw new Error(message); };
const copy = <T,>(value: T): T => structuredClone(value);
const hasContent = (content: { text: string; image?: string }) => Boolean(content.text.trim() || content.image);
const validScore = (value: number) => Number.isSafeInteger(value);

export function createSession(): GameSession {
  return {
    id: crypto.randomUUID(), revision: 0, round: 0, phase: 'setup', teams: [], usedQuestionIds: [],
    final: { order: [], eliminated: [], turn: 0, bets: {}, results: {}, locked: false, settled: false },
    ranking: [], rankingStartedAt: 0, rankingShowAll: false,
  };
}

export function getQuestion(pack: QuizPack, id: string): { question: Question; category: Category } | undefined {
  for (const round of pack.rounds) {
    for (const category of round.categories) {
      const question = category.questions.find((item) => item.id === id);
      if (question) return { question, category };
    }
  }
  return undefined;
}

export function rankTeams(teams: Team[]): RankingEntry[] {
  const sorted = teams.map((team, index) => ({ team, index }))
    .sort((a, b) => b.team.score - a.team.score || a.index - b.index);
  let place = 0;
  return sorted.map(({ team }, index) => {
    if (index === 0 || team.score !== sorted[index - 1].team.score) place = index + 1;
    return { teamId: team.id, name: team.name, color: team.color, score: team.score, place };
  });
}

export function reduceGame(session: GameSession, command: Command, pack: QuizPack): GameSession {
  const next = copy(session);
  const phase = (...allowed: GameSession['phase'][]) => {
    if (!allowed.includes(next.phase)) fail('Это действие недоступно на текущем экране.');
  };
  const team = (id: string): Team => next.teams.find((item) => item.id === id) ?? fail('Команда не найдена.');
  const active = (): ActiveQuestion => next.active ?? fail('Сначала откройте вопрос.');
  const awaitingRetry = (question: ActiveQuestion) => Boolean(question.respondingTeamId
    && question.retryUsedTeamIds.includes(question.respondingTeamId)
    && !question.attemptedTeamIds.includes(question.respondingTeamId) && !question.resolved);
  const liveQuestion = (): ActiveQuestion => {
    phase('question');
    const question = active();
    if (question.resolved) fail('Ответ на этот вопрос уже завершён.');
    return question;
  };
  const adjust = (target: Team, delta: number) => {
    const result = target.score + delta;
    if (!validScore(result)) fail('Получился слишком большой счёт. Уменьшите значение.');
    target.score = result;
  };
  const validateOrder = (order: string[]) => {
    if (order.length !== next.teams.length || new Set(order).size !== order.length
      || order.some((id) => !next.teams.some((item) => item.id === id))) {
      fail('В порядке финала каждая команда должна быть указана ровно один раз.');
    }
  };
  const useCell = () => {
    if (next.active && !next.usedQuestionIds.includes(next.active.questionId)) next.usedQuestionIds.push(next.active.questionId);
  };
  const showRanking = () => {
    next.teams.forEach((item) => { item.bonuses = emptyBonuses(); });
    next.active = undefined;
    next.ranking = rankTeams(next.teams);
    next.rankingStartedAt = Date.now();
    next.rankingShowAll = false;
    next.phase = 'ranking';
  };
  const finishWrong = (question: ActiveQuestion) => {
    const respondent = team(question.respondingTeamId ?? fail('Выберите отвечающую команду.'));
    if (respondent.bonuses.shield > 0) respondent.bonuses.shield -= 1;
    else adjust(respondent, -question.value);
    question.attemptedTeamIds.push(respondent.id);
    question.retryPending = false;
    question.doubleTeamId = undefined;
    question.resolved = question.kind === 'cat' || next.teams.every((item) => question.attemptedTeamIds.includes(item.id));
    if (!question.resolved) question.respondingTeamId = undefined;
  };

  switch (command.type) {
    case 'ADD_TEAM': {
      phase('setup');
      const name = command.name.trim();
      if (!name) fail('Введите название команды.');
      if (next.teams.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Команда с таким названием уже есть.');
      next.teams.push({
        id: crypto.randomUUID(), name, score: 0, bonuses: emptyBonuses(),
        color: command.color && /^#[\da-f]{6}$/i.test(command.color) ? command.color : palette[next.teams.length % palette.length],
      });
      if (next.round === 2 && next.final.order.length > 0) next.final.order.push(next.teams[next.teams.length - 1].id);
      break;
    }
    case 'REMOVE_TEAM': {
      phase('setup');
      team(command.teamId);
      next.teams = next.teams.filter((item) => item.id !== command.teamId);
      next.final.order = next.final.order.filter((id) => id !== command.teamId);
      break;
    }
    case 'RENAME_TEAM': {
      const target = team(command.teamId);
      const name = command.name.trim();
      if (!name) fail('Введите название команды.');
      if (next.teams.some((item) => item.id !== target.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Команда с таким названием уже есть.');
      target.name = name;
      if (next.phase === 'ranking' || next.phase === 'finished') next.ranking = rankTeams(next.teams);
      break;
    }
    case 'SET_SCORE': {
      if (!validScore(command.score)) fail('Счёт должен быть целым числом в допустимом диапазоне.');
      team(command.teamId).score = command.score;
      if (next.phase === 'ranking' || next.phase === 'finished') {
        next.ranking = rankTeams(next.teams);
        next.rankingStartedAt = Date.now();
        next.rankingShowAll = false;
      }
      break;
    }
    case 'START_ROUND': {
      phase('setup');
      if (next.teams.length === 0) fail('Добавьте хотя бы одну команду.');
      next.active = undefined;
      if (next.round === 2) {
        if (pack.final.length !== 9) fail('Для финала нужны девять тем.');
        if (next.final.order.length === 0) next.final.order = next.teams.map((item) => item.id);
        validateOrder(next.final.order);
        next.phase = 'finalElimination';
      } else next.phase = 'board';
      break;
    }
    case 'OPEN_CELL': {
      phase('board');
      const roundIndex = next.round;
      if (roundIndex === 2) return fail('В финале нет таблицы вопросов.');
      team(command.openingTeamId);
      if (next.usedQuestionIds.includes(command.questionId)) fail('Этот вопрос уже сыгран.');
      const category = pack.rounds[roundIndex].categories.find((item) => item.questions.some((question) => question.id === command.questionId))
        ?? fail('Вопрос не найден в текущем раунде.');
      const question = category.questions.find((item) => item.id === command.questionId) ?? fail('Вопрос не найден в текущем раунде.');
      if (!prizeKinds.has(question.kind) && !hasContent(question.prompt)) fail('Заполните текст вопроса или добавьте картинку перед открытием.');
      if ((question.kind === 'cat' || question.kind === 'swap') && next.teams.length < 2) fail('Для этой клетки нужны хотя бы две команды.');
      next.active = {
        questionId: question.id, openingTeamId: command.openingTeamId, kind: question.kind,
        value: question.value, category: category.title, prompt: copy(question.prompt), answer: copy(question.answer),
        attemptedTeamIds: [], retryUsedTeamIds: [], doubleUsedTeamIds: [], retryPending: false,
        resolved: false, effectApplied: false,
      };
      next.phase = question.kind === 'normal' ? 'question' : 'special';
      break;
    }
    case 'SELECT_TARGET': {
      phase('special');
      const question = active();
      if (!['cat', 'swap'].includes(question.kind) || question.effectApplied || question.resolved) fail('Сейчас нельзя выбрать получателя.');
      team(command.teamId);
      if (command.teamId === question.openingTeamId) fail('Выберите команду соперников.');
      question.targetTeamId = command.teamId;
      if (question.kind === 'cat') question.respondingTeamId = command.teamId;
      break;
    }
    case 'APPLY_SPECIAL': {
      phase('special');
      const question = active();
      if (question.effectApplied || question.resolved) fail('Эффект этой клетки уже применён.');
      const owner = team(question.openingTeamId);
      switch (question.kind) {
        case 'flip':
          owner.score = owner.score === 0 ? 0 : -owner.score;
          break;
        case 'double':
          adjust(owner, owner.score);
          break;
        case 'swap': {
          const opponent = team(question.targetTeamId ?? fail('Сначала выберите соперника для обмена.'));
          [owner.score, opponent.score] = [opponent.score, owner.score];
          break;
        }
        case 'approx': owner.bonuses.approx = true; break;
        case 'shield': owner.bonuses.shield += 1; break;
        case 'retry': owner.bonuses.retry += 1; break;
        case 'doubleReward': owner.bonuses.doubleReward += 1; break;
        default: fail('Для этой клетки эффект не применяется этой кнопкой.');
      }
      question.effectApplied = true;
      question.resolved = prizeKinds.has(question.kind);
      break;
    }
    case 'SHOW_QUESTION': {
      phase('special');
      const question = active();
      if (question.resolved) fail('Эта клетка завершена без вопроса.');
      if (question.kind === 'cat') {
        if (!question.targetTeamId) fail('Сначала передайте вопрос соперникам.');
        question.respondingTeamId = question.targetTeamId;
        question.effectApplied = true;
      } else if (!bonusKinds.has(question.kind) || !question.effectApplied) fail('Сначала выдайте бонус команде.');
      next.phase = 'question';
      break;
    }
    case 'SELECT_RESPONDER': {
      const question = liveQuestion();
      team(command.teamId);
      if (question.retryPending) fail('Сначала решите, использовать ли вторую попытку.');
      if (question.attemptedTeamIds.includes(command.teamId)) fail('Эта команда уже ответила на вопрос.');
      if (question.kind === 'cat' && command.teamId !== question.targetTeamId) fail('На кота в мешке отвечает только получившая его команда.');
      if (question.doubleTeamId && question.doubleTeamId !== command.teamId) fail('Сначала оцените ответ команды, активировавшей удвоение.');
      if (question.respondingTeamId && question.retryUsedTeamIds.includes(question.respondingTeamId)
        && question.respondingTeamId !== command.teamId) fail('Сначала оцените вторую попытку команды.');
      question.respondingTeamId = command.teamId;
      break;
    }
    case 'ACTIVATE_DOUBLE': {
      const question = liveQuestion();
      if (question.retryPending) fail('Удвоение нужно активировать до первой попытки ответа.');
      const respondent = team(question.respondingTeamId ?? fail('Выберите отвечающую команду.'));
      if (question.doubleUsedTeamIds.includes(respondent.id) || question.retryUsedTeamIds.includes(respondent.id)) fail('Удвоение можно активировать один раз до первой попытки.');
      if (respondent.bonuses.doubleReward < 1) fail('У этой команды нет бонуса удвоения награды.');
      respondent.bonuses.doubleReward -= 1;
      question.doubleUsedTeamIds.push(respondent.id);
      question.doubleTeamId = respondent.id;
      break;
    }
    case 'JUDGE': {
      const question = liveQuestion();
      if (question.retryPending) fail('Сначала используйте вторую попытку или откажитесь от неё.');
      const respondent = team(question.respondingTeamId ?? fail('Выберите отвечающую команду.'));
      if (question.attemptedTeamIds.includes(respondent.id)) fail('Эта команда уже ответила на вопрос.');
      if (command.correct) {
        adjust(respondent, question.value * (question.doubleTeamId === respondent.id ? 2 : 1));
        question.attemptedTeamIds.push(respondent.id);
        question.resolved = true;
      } else if (respondent.bonuses.retry > 0 && !question.retryUsedTeamIds.includes(respondent.id)) {
        question.retryPending = true;
      } else finishWrong(question);
      break;
    }
    case 'USE_RETRY': {
      const question = liveQuestion();
      const respondent = team(question.respondingTeamId ?? fail('Выберите отвечающую команду.'));
      if (!question.retryPending || question.retryUsedTeamIds.includes(respondent.id) || respondent.bonuses.retry < 1) fail('Вторая попытка сейчас недоступна.');
      respondent.bonuses.retry -= 1;
      question.retryUsedTeamIds.push(respondent.id);
      question.retryPending = false;
      break;
    }
    case 'DECLINE_RETRY': {
      const question = liveQuestion();
      if (!question.retryPending) fail('Нет ожидающей второй попытки.');
      finishWrong(question);
      break;
    }
    case 'REVEAL_ANSWER': {
      phase('question');
      const question = active();
      if (question.retryPending) fail('Сначала завершите решение о второй попытке.');
      if (awaitingRetry(question)) fail('Сначала оцените вторую попытку команды.');
      question.resolved = true;
      next.phase = 'answer';
      break;
    }
    case 'CLOSE_QUESTION': {
      phase('question', 'answer', 'special');
      const question = active();
      if (question.retryPending) fail('Сначала завершите решение о второй попытке.');
      if (awaitingRetry(question)) fail('Сначала оцените вторую попытку команды.');
      if (next.phase === 'special' && !question.resolved) fail('Сначала завершите действие специальной клетки.');
      useCell();
      next.active = undefined;
      next.phase = 'board';
      if (next.round !== 2 && pack.rounds[next.round].categories.flatMap((item) => item.questions)
        .every((item) => next.usedQuestionIds.includes(item.id))) showRanking();
      break;
    }
    case 'REFRESH_CONTENT': {
      if (next.active) {
        const updated = getQuestion(pack, next.active.questionId) ?? fail('Открытый вопрос больше не найден в наборе.');
        next.active.prompt = copy(updated.question.prompt);
        next.active.answer = copy(updated.question.answer);
        next.active.category = updated.category.title;
      }
      if (next.final.locked && next.final.topicId) {
        const topic = pack.final.find((item) => item.id === next.final.topicId) ?? fail('Тема финала больше не найдена.');
        next.final.prompt = copy(topic.prompt);
        next.final.answer = copy(topic.answer);
      }
      break;
    }
    case 'END_ROUND': {
      phase('board', 'question', 'answer', 'special');
      if (next.round === 2) fail('Финал завершается после оценивания всех команд.');
      if (next.active?.retryPending) fail('Сначала завершите решение о второй попытке.');
      if (next.active && awaitingRetry(next.active)) fail('Сначала оцените вторую попытку команды.');
      useCell();
      showRanking();
      break;
    }
    case 'RANKING_SHOW_ALL': phase('ranking'); next.rankingShowAll = true; break;
    case 'RANKING_REPLAY': phase('ranking'); next.rankingStartedAt = Date.now(); next.rankingShowAll = false; break;
    case 'NEXT_ROUND': {
      phase('ranking');
      if (next.round === 2) next.phase = 'finished';
      else {
        next.round = (next.round + 1) as 1 | 2;
        next.phase = 'setup';
      }
      break;
    }
    case 'SET_FINAL_ORDER': {
      phase('setup', 'finalElimination');
      if (next.round !== 2 || next.final.eliminated.length > 0) fail('Порядок можно менять только перед первым вычёркиванием финала.');
      validateOrder(command.order);
      next.final.order = [...command.order];
      next.final.turn = 0;
      break;
    }
    case 'ELIMINATE_TOPIC': {
      phase('finalElimination');
      if (!pack.final.some((item) => item.id === command.topicId)) fail('Тема не найдена.');
      if (next.final.eliminated.includes(command.topicId)) fail('Эта тема уже вычеркнута.');
      if (pack.final.length - next.final.eliminated.length <= 1) fail('Последнюю тему вычеркнуть нельзя.');
      validateOrder(next.final.order);
      next.final.eliminated.push(command.topicId);
      next.final.turn = (next.final.turn + 1) % next.final.order.length;
      const remaining = pack.final.filter((item) => !next.final.eliminated.includes(item.id));
      if (remaining.length === 1) {
        next.final.topicId = remaining[0].id;
        next.phase = 'finalBets';
      }
      break;
    }
    case 'SET_BET': {
      phase('finalBets');
      team(command.teamId);
      if (next.final.locked) fail('Ставки уже зафиксированы.');
      if (!validScore(command.amount) || command.amount < 0) fail('Ставка должна быть целым числом от нуля.');
      next.final.bets[command.teamId] = command.amount;
      break;
    }
    case 'LOCK_BETS': {
      phase('finalBets');
      if (next.final.locked) fail('Ставки уже зафиксированы.');
      if (!next.teams.every((item) => Object.hasOwn(next.final.bets, item.id))) fail('Введите ставку каждой команды, включая нулевую.');
      const topic = pack.final.find((item) => item.id === next.final.topicId) ?? fail('Тема финала не выбрана.');
      if (!hasContent(topic.prompt)) fail('Заполните финальный вопрос перед открытием.');
      next.final.prompt = copy(topic.prompt);
      next.final.answer = copy(topic.answer);
      next.final.locked = true;
      next.phase = 'finalQuestion';
      break;
    }
    case 'SET_FINAL_RESULT': {
      phase('finalQuestion', 'finalAnswer');
      team(command.teamId);
      if (next.final.settled) fail('Финальные очки уже начислены.');
      next.final.results[command.teamId] = command.correct;
      break;
    }
    case 'REVEAL_FINAL_ANSWER': {
      phase('finalQuestion');
      if (!next.teams.every((item) => Object.hasOwn(next.final.results, item.id))) fail('Сначала оцените ответы всех команд.');
      next.phase = 'finalAnswer';
      break;
    }
    case 'SETTLE_FINAL': {
      phase('finalAnswer');
      if (next.final.settled) fail('Финальные очки уже начислены.');
      if (!next.teams.every((item) => Object.hasOwn(next.final.results, item.id))) fail('Сначала оцените ответы всех команд.');
      next.teams.forEach((item) => adjust(item, next.final.bets[item.id] * (next.final.results[item.id] ? 1 : -1)));
      next.final.settled = true;
      showRanking();
      break;
    }
    default: fail('Неизвестное действие.');
  }
  next.revision = session.revision + 1;
  return next;
}

export function toPublicView(session: GameSession, pack: QuizPack): PublicView {
  const view: PublicView = {
    sessionId: session.id, revision: session.revision, packTitle: pack.title, round: session.round,
    phase: session.phase, teams: session.teams.map(({ id, name, color, bonuses }) => ({ id, name, color, bonuses: copy(bonuses) })),
  };
  if (session.round !== 2 && (session.phase === 'board' || session.phase === 'setup')) {
    const round = pack.rounds[session.round];
    view.board = {
      title: round.title,
      categories: round.categories.map((category) => ({
        id: category.id, title: category.title,
        cells: category.questions.map(({ id, value }) => ({ id, value, used: session.usedQuestionIds.includes(id) })),
      })),
    };
  }
  if (session.active && (session.phase === 'question' || session.phase === 'answer')) {
    const question = session.active;
    view.question = {
      category: question.category, value: question.value, prompt: copy(question.prompt),
      respondingTeamId: question.respondingTeamId, resolved: question.resolved,
      ...(session.phase === 'answer' ? { answer: copy(question.answer) } : {}),
    };
  }
  if (session.active && session.phase === 'special') {
    const question = session.active;
    const owner = session.teams.find((item) => item.id === question.openingTeamId);
    const target = session.teams.find((item) => item.id === question.targetTeamId);
    view.special = {
      kind: question.kind, teamName: owner?.name ?? '', teamColor: owner?.color ?? '#5EEAD4',
      targetName: target?.name, applied: question.effectApplied,
    };
    if (question.effectApplied && prizeKinds.has(question.kind) && owner) {
      view.special.result = `${owner.name}: ${owner.score} очков${target ? ` · ${target.name}: ${target.score} очков` : ''}`;
    }
  }
  if (session.round === 2 && ['setup', 'finalElimination', 'finalBets'].includes(session.phase)) {
    view.finalTopics = pack.final.map((topic) => ({ id: topic.id, title: topic.title, eliminated: session.final.eliminated.includes(topic.id) }));
    if (session.phase === 'finalElimination') view.finalTurnTeamId = session.final.order[session.final.turn % session.final.order.length];
  }
  if (session.phase === 'finalQuestion' || session.phase === 'finalAnswer') {
    const topic = pack.final.find((item) => item.id === session.final.topicId);
    if (session.final.prompt) view.question = {
      category: topic?.title ?? 'Финал', value: 0, prompt: copy(session.final.prompt), resolved: session.phase === 'finalAnswer',
      ...(session.phase === 'finalAnswer' && session.final.answer ? { answer: copy(session.final.answer) } : {}),
    };
  }
  if (session.phase === 'ranking' || session.phase === 'finished') {
    view.ranking = copy(session.ranking);
    view.rankingStartedAt = session.rankingStartedAt;
    view.rankingShowAll = session.rankingShowAll || session.phase === 'finished';
  }
  return view;
}

export function commandLabel(command: Command): string {
  const labels: Record<Command['type'], string> = {
    ADD_TEAM: 'Добавлена команда', REMOVE_TEAM: 'Удалена команда', RENAME_TEAM: 'Переименована команда', SET_SCORE: 'Изменён счёт', START_ROUND: 'Начат раунд',
    OPEN_CELL: 'Открыта клетка', SELECT_TARGET: 'Выбран соперник', APPLY_SPECIAL: 'Применена фишка', SHOW_QUESTION: 'Показан вопрос',
    SELECT_RESPONDER: 'Выбрана отвечающая команда', ACTIVATE_DOUBLE: 'Активировано удвоение награды', JUDGE: command.type === 'JUDGE' && command.correct ? 'Засчитан верный ответ' : 'Засчитана ошибка',
    USE_RETRY: 'Использована вторая попытка', DECLINE_RETRY: 'Отказ от второй попытки', REVEAL_ANSWER: 'Раскрыт ответ', CLOSE_QUESTION: 'Закрыт вопрос',
    REFRESH_CONTENT: 'Применены изменения вопроса', END_ROUND: 'Завершён раунд', RANKING_SHOW_ALL: 'Показан весь рейтинг', RANKING_REPLAY: 'Повторён показ рейтинга',
    NEXT_ROUND: 'Переход к следующему раунду', SET_FINAL_ORDER: 'Изменён порядок финала', ELIMINATE_TOPIC: 'Вычеркнута тема',
    SET_BET: 'Изменена финальная ставка', LOCK_BETS: 'Зафиксированы ставки', SET_FINAL_RESULT: 'Оценён ответ финала',
    REVEAL_FINAL_ANSWER: 'Раскрыт финальный ответ', SETTLE_FINAL: 'Начислены очки финала',
  };
  return labels[command.type];
}
