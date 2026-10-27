import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getQuestion } from '../game/engine';
import type { Command, Content, GameSession, QuizPack, Team } from '../game/types';
import { createBlankPack, createDemoPack } from '../data/packs';
import { exportPack, readPackFile, validatePack } from '../lib/packFile';
import { formatScore, kindDescriptions, kindLabels, kindSymbols } from '../lib/labels';
import { useHostGame } from '../lib/useGame';
import { appUrl } from '../lib/routes';
import Editor from './Editor';
import TeamChoices from './TeamChoices';
import { Icon } from './Icon';

type Act = (command: Command) => Promise<void>;
const isScoreEffect = (kind: string) => ['flip', 'swap', 'double'].includes(kind);
const roundLabel = (round: number) => round === 2 ? 'Финал' : `Раунд ${round + 1}`;

function ContentBlock({ content }: { content: Content }) {
  return <div className="rich-content">{content.text && <p>{content.text}</p>}{content.image && <img src={content.image} alt="Иллюстрация" />}</div>;
}

function BonusChips({ team }: { team: Team }) {
  const b = team.bonuses;
  return <div className="bonus-list">{b.approx && <span className="bonus-chip" title="Можно отвечать приблизительно до конца раунда">≈ И так сойдёт</span>}{b.shield > 0 && <span className="bonus-chip" title="Бронежилет">◇ {b.shield}</span>}{b.retry > 0 && <span className="bonus-chip" title="Вторая жизнь">↻ {b.retry}</span>}{b.doubleReward > 0 && <span className="bonus-chip" title="Двойной куш">×2★ {b.doubleReward}</span>}</div>;
}

function TeamCard({ team, selected, canRemove, act }: { team: Team; selected: boolean; canRemove: boolean; act: Act }) {
  const [score, setScore] = useState(String(team.score));
  const [name, setName] = useState(team.name);
  useEffect(() => setScore(String(team.score)), [team.score]);
  useEffect(() => setName(team.name), [team.name]);
  return <div className={`team-card ${selected ? 'is-answering' : ''}`} style={{ '--team-color': team.color } as React.CSSProperties}>
    <div className="team-top"><span className="team-avatar">{team.name.slice(0, 1).toUpperCase()}</span><input aria-label={`Название команды ${team.name}`} className="team-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== team.name) void act({ type: 'RENAME_TEAM', teamId: team.id, name }); else setName(team.name); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{canRemove && <button className="icon-button team-remove" title={`Удалить команду ${team.name}`} aria-label={`Удалить команду ${team.name}`} onClick={() => void act({ type: 'REMOVE_TEAM', teamId: team.id })}><Icon name="close" size={14} /></button>}</div>
    <div className={`team-score ${team.score < 0 ? 'negative' : ''}`}>{formatScore(team.score)} <span>очков</span></div>
    <div className="score-row"><button className="score-step" aria-label={`Снять 100 у ${team.name}`} onClick={() => void act({ type: 'SET_SCORE', teamId: team.id, score: team.score - 100 })}>−</button><input type="number" step="100" className="score-input" aria-label={`Счёт команды ${team.name}`} value={score} onChange={e => setScore(e.target.value)} onBlur={() => { const n = Number(score); if (score.trim() && Number.isSafeInteger(n) && n !== team.score) void act({ type: 'SET_SCORE', teamId: team.id, score: n }); else setScore(String(team.score)); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><button className="score-step" aria-label={`Добавить 100 команде ${team.name}`} onClick={() => void act({ type: 'SET_SCORE', teamId: team.id, score: team.score + 100 })}>+</button></div>
    <BonusChips team={team} />
    {selected && <div className="answering-label"><span className="status-dot" /> Сейчас отвечает</div>}
  </div>;
}

function QuestionControls({ session, pack, previewId, openingTeamId, act, edit }: { session: GameSession; pack: QuizPack; previewId: string; openingTeamId: string; act: Act; edit: () => void }) {
  const active = session.active;
  const isLive = !!active && ['special', 'question', 'answer'].includes(session.phase);
  const preview = getQuestion(pack, previewId);
  const data = isLive ? active : preview ? { ...preview.question, category: preview.category.title } : undefined;
  if (!data) return <section id="host-question" className="panel question-panel"><div className="panel-header"><div><h2 className="panel-title">Текущий вопрос</h2><p className="panel-subtitle">Здесь всё, что знает только ведущий</p></div><Icon name="eye" /></div><div className="empty-question"><span className="empty-icon"><Icon name="spark" size={28} /></span><h3>Всё начинается с выбора</h3><p>Выберите клетку на поле, чтобы посмотреть вопрос и ответ.</p></div></section>;
  const owner = session.teams.find(t => t.id === active?.openingTeamId);
  const responder = session.teams.find(t => t.id === active?.respondingTeamId);
  const awaitingRetry = !!active && !!active.respondingTeamId && active.retryUsedTeamIds.includes(active.respondingTeamId) && !active.attemptedTeamIds.includes(active.respondingTeamId) && !active.resolved;
  const unavailableTeams = active ? session.teams.filter(t => active.attemptedTeamIds.includes(t.id) || (active.kind === 'cat' && t.id !== active.targetTeamId)).map(t => t.id) : [];
  return <section id="host-question" className="panel question-panel">
    <div className="panel-header"><div><span className="eyebrow">{isLive ? 'СЕЙЧАС НА ЭКРАНЕ' : 'ПРЕДПРОСМОТР · ТОЛЬКО ВАМ'}</span><h2 className="panel-title">{data.category} <span className="question-value">/ {data.value}</span></h2></div><span className={`badge ${data.kind === 'normal' ? '' : 'badge-purple'}`}>{kindSymbols[data.kind]} {kindLabels[data.kind]}</span></div>
    {session.phase === 'special' && active ? <div className="question-content">
      <div className="special-preview"><span className="special-preview-symbol">{kindSymbols[active.kind]}</span><div><h3>{kindLabels[active.kind]}</h3><p>{kindDescriptions[active.kind]}</p><span className="badge">Выбрали: {owner?.name}</span></div></div>
      {['cat', 'swap'].includes(active.kind) && !active.effectApplied && <TeamChoices label={active.kind === 'cat' ? 'Кому передать вопрос?' : 'С кем обменяться очками?'} teams={session.teams.filter(t => t.id !== active.openingTeamId)} selectedId={active.targetTeamId} onSelect={teamId => void act({ type: 'SELECT_TARGET', teamId })} />}
      <div className="question-actions">{active.kind === 'cat' ? <button className="button button-primary" disabled={!active.targetTeamId} onClick={() => void act({ type: 'SHOW_QUESTION' })}><Icon name="play" />Показать вопрос</button> : !active.effectApplied ? <button className="button button-primary" disabled={active.kind === 'swap' && !active.targetTeamId} onClick={() => void act({ type: 'APPLY_SPECIAL' })}><Icon name="spark" />{isScoreEffect(active.kind) ? 'Применить эффект' : 'Выдать бонус'}</button> : isScoreEffect(active.kind) ? <><span className="effect-done"><Icon name="check" /> Счёт изменён</span><button className="button button-primary" onClick={() => void act({ type: 'CLOSE_QUESTION' })}>Вернуться к полю<Icon name="arrow" /></button></> : <button className="button button-primary" onClick={() => void act({ type: 'SHOW_QUESTION' })}><Icon name="play" />Показать вопрос</button>}</div>
    </div> : <>
      <div className="question-content"><span className="section-label">ВОПРОС</span><ContentBlock content={data.prompt} />{!data.prompt.text && !data.prompt.image && <p className="muted">Вопрос ещё не заполнен. Откройте редактор.</p>}<div className="answer-box"><span className="section-label"><Icon name="eye" size={14} /> ПРАВИЛЬНЫЙ ОТВЕТ · ТОЛЬКО ВЕДУЩЕМУ</span><ContentBlock content={data.answer} />{!data.answer.text && !data.answer.image && <p className="muted">Ответ ещё не заполнен</p>}</div></div>
      {isLive && active ? <div className="question-controls">
        <div className="question-role-note">Выбирали: <strong>{owner?.name}</strong>{responder && <> <span>·</span> Отвечают: <strong>{responder.name}</strong></>}</div>
        {session.phase === 'question' && !active.resolved && <>
          <TeamChoices label="Кто отвечает?" teams={session.teams} selectedId={active.respondingTeamId} disabled={active.retryPending || awaitingRetry || !!active.doubleTeamId || active.kind === 'cat'} disabledIds={unavailableTeams} onSelect={teamId => void act({ type: 'SELECT_RESPONDER', teamId })} />
          {responder?.bonuses.approx && <div className="info-note">≈ У команды «И так сойдёт»: можно засчитать ответ по смыслу.</div>}
          {active.retryPending ? <div className="retry-prompt"><h3>Дать второй шанс?</h3><p className="muted">У команды есть «Вторая жизнь». Штраф пока не применён.</p><div className="question-actions"><button className="button button-primary" onClick={() => void act({ type: 'USE_RETRY' })}><Icon name="refresh" />Использовать бонус</button><button className="button button-secondary" onClick={() => void act({ type: 'DECLINE_RETRY' })}>Зафиксировать ошибку</button></div></div> : <>
            {responder && responder.bonuses.doubleReward > 0 && !active.doubleUsedTeamIds.includes(responder.id) && !active.retryUsedTeamIds.includes(responder.id) && <button className="button bonus-activate" onClick={() => void act({ type: 'ACTIVATE_DOUBLE' })}><Icon name="bolt" />Активировать «Двойной куш»</button>}
            {active.doubleTeamId && <div className="info-note">×2★ Двойной куш активирован: верный ответ +{formatScore(active.value * 2)}</div>}
            <div className="judge-actions"><button className="button button-success" disabled={!active.respondingTeamId} onClick={() => void act({ type: 'JUDGE', correct: true })}><Icon name="check" />Верно <span>+{formatScore(active.value * (active.doubleTeamId ? 2 : 1))}</span></button><button className="button button-danger" disabled={!active.respondingTeamId} onClick={() => void act({ type: 'JUDGE', correct: false })}><Icon name="close" />Неверно <span>{responder && responder.bonuses.shield > 0 ? 'защита' : `−${formatScore(active.value)}`}</span></button></div>
          </>}
        </>}
        {active.resolved && session.phase === 'question' && <div className="info-note"><Icon name="check" /> Вопрос завершён. Можно раскрыть ответ или вернуться к полю.</div>}
        {awaitingRetry && <div className="info-note">↻ Вторая попытка: оцените ответ, чтобы продолжить игру.</div>}
        <div className="question-actions separated">{session.phase !== 'answer' && <button className="button button-secondary" disabled={active.retryPending || awaitingRetry} onClick={() => void act({ type: 'REVEAL_ANSWER' })}><Icon name="eye" />Показать ответ</button>}<button className="button button-primary" disabled={active.retryPending || awaitingRetry} onClick={() => void act({ type: 'CLOSE_QUESTION' })}>К полю<Icon name="arrow" /></button></div><details className="extra-controls"><summary>Другие действия</summary><button className="button button-secondary" onClick={() => void act({ type: 'REFRESH_CONTENT' })}><Icon name="refresh" size={15} />Обновить на экране</button></details>
      </div> : <div className="question-actions panel-bottom"><button className="button button-primary" disabled={session.phase !== 'board' || !openingTeamId || session.usedQuestionIds.includes(previewId)} onClick={() => void act({ type: 'OPEN_CELL', questionId: previewId, openingTeamId })}><Icon name="screen" />Открыть на экране</button><button className="button button-secondary" onClick={edit}><Icon name="edit" />Редактировать</button>{session.phase === 'setup' && <span className="muted small">Сначала начните раунд</span>}</div>}
    </>}
  </section>;
}

function BetInput({ team, value, act }: { team: Team; value: number | undefined; act: Act }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const save = () => {
    const amount = Number(draft);
    if (draft.trim() && Number.isSafeInteger(amount) && amount >= 0 && amount !== value) void act({ type: 'SET_BET', teamId: team.id, amount });
    else setDraft(value === undefined ? '' : String(value));
  };
  return <input aria-label={`Ставка команды ${team.name}`} type="number" min="0" step="1" placeholder="Ставка" value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
}

function FinalPanel({ session, pack, act }: { session: GameSession; pack: QuizPack; act: Act }) {
  const f = session.final;
  const order = f.order.length ? f.order : session.teams.map(t => t.id);
  const remaining = pack.final.filter(t => !f.eliminated.includes(t.id));
  const topic = pack.final.find(t => t.id === f.topicId);
  const selectingOrder = session.phase === 'setup' || (session.phase === 'finalElimination' && !f.eliminated.length);
  const move = (index: number, direction: number) => {
    const next = [...order];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    void act({ type: 'SET_FINAL_ORDER', order: next });
  };
  return <section className="panel"><div className="panel-header"><div><span className="eyebrow">ФИНАЛЬНЫЙ РАУНД</span><h2 className="panel-title">Одна тема. Любая ставка.</h2><p className="panel-subtitle">{session.phase === 'setup' ? 'Определите порядок команд перед стартом' : session.phase === 'finalElimination' ? `Осталось тем: ${remaining.length} из 9` : `Тема: ${topic?.title ?? '—'}`}</p></div><Icon name="trophy" size={24} /></div>
    <div className="final-body">
      {selectingOrder && <div className="final-order"><span className="section-label">ПОРЯДОК ВЫЧЁРКИВАНИЯ</span>{order.map((id, index) => <div className="order-row" key={id}><span className="order-number">{index + 1}</span><span>{session.teams.find(t => t.id === id)?.name}</span><button className="icon-button" aria-label="Поднять команду" disabled={!index} onClick={() => move(index, -1)}>↑ Выше</button><button className="icon-button" aria-label="Опустить команду" disabled={index === order.length - 1} onClick={() => move(index, 1)}>↓ Ниже</button></div>)}</div>}
      {['setup', 'finalElimination'].includes(session.phase) && <>{session.phase === 'finalElimination' && <div className="info-note">Вычёркивает: <strong>{session.teams.find(t => t.id === order[f.turn % order.length])?.name}</strong></div>}<div className="final-grid">{pack.final.map((t, i) => <button className={`final-topic ${f.eliminated.includes(t.id) ? 'eliminated' : ''}`} key={t.id} disabled={session.phase !== 'finalElimination' || f.eliminated.includes(t.id)} onClick={() => void act({ type: 'ELIMINATE_TOPIC', topicId: t.id })}><span className="eyebrow">ТЕМА {String(i + 1).padStart(2, '0')}</span>{t.title}{f.eliminated.includes(t.id) && <Icon name="close" />}</button>)}</div></>}
      {session.phase === 'finalBets' && <><div className="info-note">Введите ставки всех команд до показа вопроса. Можно ставить больше своего счёта, в том числе при отрицательном балансе.</div><div className="final-bets">{session.teams.map(t => <label className="bet-row" key={t.id}><span>{t.name}<small className="muted">Счёт: {formatScore(t.score)}</small></span><BetInput team={t} value={f.bets[t.id]} act={act} /></label>)}</div><button className="button button-primary" disabled={!session.teams.every(t => f.bets[t.id] !== undefined)} onClick={() => void act({ type: 'LOCK_BETS' })}><Icon name="play" />Зафиксировать ставки и показать вопрос</button></>}
      {['finalQuestion', 'finalAnswer'].includes(session.phase) && <><span className="section-label">ВОПРОС</span><ContentBlock content={f.prompt ?? topic?.prompt ?? { text: '' }} /><div className="answer-box"><span className="section-label">ОТВЕТ · ТОЛЬКО ВЕДУЩЕМУ</span><ContentBlock content={f.answer ?? topic?.answer ?? { text: '' }} /></div><div className="final-bets">{session.teams.map(t => <div className="bet-row" key={t.id}><span>{t.name}<small className="muted">Ставка: {formatScore(f.bets[t.id] ?? 0)}</small></span><div className="inline"><button className={`button ${f.results[t.id] === true ? 'button-success selected' : 'button-secondary'}`} onClick={() => void act({ type: 'SET_FINAL_RESULT', teamId: t.id, correct: true })}><Icon name="check" />Верно</button><button className={`button ${f.results[t.id] === false ? 'button-danger selected' : 'button-secondary'}`} onClick={() => void act({ type: 'SET_FINAL_RESULT', teamId: t.id, correct: false })}><Icon name="close" />Неверно</button></div></div>)}</div><div className="question-actions">{session.phase === 'finalQuestion' && <button className="button button-secondary" disabled={!session.teams.every(t => typeof f.results[t.id] === 'boolean')} onClick={() => void act({ type: 'REVEAL_FINAL_ANSWER' })}><Icon name="eye" />Раскрыть ответ</button>}<button className="button button-primary" disabled={session.phase !== 'finalAnswer' || !session.teams.every(t => typeof f.results[t.id] === 'boolean')} onClick={() => void act({ type: 'SETTLE_FINAL' })}><Icon name="trophy" />Подвести итоги</button><button className="button button-ghost" onClick={() => void act({ type: 'REFRESH_CONTENT' })}><Icon name="refresh" size={15} />Обновить на экране</button></div></>}
    </div>
  </section>;
}

function RankingPanel({ session, act }: { session: GameSession; act: Act }) {
  return <section className="panel ranking-host"><div className="panel-header"><div><span className="eyebrow">{session.round === 2 ? 'ИГРА ЗАВЕРШЕНА' : `${roundLabel(session.round).toUpperCase()} ЗАВЕРШЁН`}</span><h2 className="panel-title">{session.round === 2 ? 'Встречайте победителей' : 'Время подвести итоги'}</h2><p className="panel-subtitle">На проекторе команды появляются от последнего места к первому.</p></div><Icon name="trophy" size={32} /></div><div className="host-ranking-list">{session.ranking.map(t => <div className="host-ranking-row" key={t.teamId}><span className="ranking-place">{t.place}</span><span className="ranking-team-dot" style={{ background: t.color }} /><strong>{t.name}</strong><span className="ranking-score">{formatScore(t.score)}</span></div>)}</div><div className="question-actions panel-bottom">{session.phase !== 'finished' && <><button className="button button-secondary" onClick={() => void act({ type: 'RANKING_SHOW_ALL' })}><Icon name="eye" />Показать всех</button><button className="button button-secondary" onClick={() => void act({ type: 'RANKING_REPLAY' })}><Icon name="refresh" />Повторить</button></>}{session.phase !== 'finished' && <button className="button button-primary" onClick={() => void act({ type: 'NEXT_ROUND' })}>{session.round === 2 ? 'Завершить игру' : session.round === 1 ? 'К финалу' : 'Ко второму раунду'}<Icon name="arrow" /></button>}</div></section>;
}

function Rules() {
  return <div className="stack"><section className="panel"><div className="panel-header"><div><span className="eyebrow">ПАМЯТКА ВЕДУЩЕГО</span><h2 className="panel-title">Большая игра, простые правила</h2></div><Icon name="help" /></div><div className="rules-intro"><p>Подключите проектор в режиме <strong>расширения рабочего стола</strong>. Откройте экран игры кнопкой сверху, перенесите окно на проектор и нажмите «На весь экран».</p><p>На пульте выберите команду, открывающую клетку, и саму клетку. Предпросмотр виден только вам. «Открыть на экране» выводит вопрос зрителям.</p><p>Верный ответ приносит стоимость вопроса, неверный снимает её. После ошибки могут отвечать другие команды. При равных очках команды занимают одинаковое место. Бонусы заканчиваются вместе с раундом.</p><p>Фишки назначаются в редакторе. Каждый тип используется только в одном из двух раундов. Один и тот же тип можно назначить нескольким клеткам своего раунда.</p></div></section><div className="rules-grid">{Object.entries(kindLabels).filter(([kind]) => kind !== 'normal').map(([kind, name]) => <section className="panel rule-card" key={kind}><span className="rule-symbol">{kindSymbols[kind as keyof typeof kindSymbols]}</span><h3>{name}</h3><p>{kindDescriptions[kind as keyof typeof kindDescriptions]}</p></section>)}</div></div>;
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab' && ref.current) {
        const controls = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter(el => !(el as HTMLButtonElement).disabled);
        if (!controls.length) { e.preventDefault(); return; }
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [close]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="panel-header"><h2>{title}</h2><button className="icon-button" aria-label="Закрыть окно" onClick={close}><Icon name="close" /></button></div>{children}</div></div>;
}

export default function Host() {
  const store = useHostGame();
  const { game, loading, busy, readOnly, notice, setNotice, act, undo, updatePack, reset, screenConnected } = store;
  const [tab, setTab] = useState<'game' | 'editor' | 'history' | 'rules'>('game');
  const [previewId, setPreviewId] = useState('');
  const [openingTeam, setOpeningTeam] = useState('');
  const [newTeam, setNewTeam] = useState('');
  const [newGameModal, setNewGameModal] = useState(false);
  const [pendingPack, setPendingPack] = useState<QuizPack | null>(null);
  const [endRoundModal, setEndRoundModal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timeout); }, [notice, setNotice]);
  useEffect(() => { if (!game?.session.teams.some(t => t.id === openingTeam)) setOpeningTeam(game?.session.teams[0]?.id ?? ''); }, [game?.session.teams, openingTeam]);
  useEffect(() => setPreviewId(''), [game?.session.round, game?.session.id]);
  useEffect(() => {
    if (game?.session.phase === 'board' && game.session.usedQuestionIds.includes(previewId)) setPreviewId('');
  }, [game?.session.phase, game?.session.usedQuestionIds, previewId]);
  useEffect(() => {
    if (tab !== 'game' || (!previewId && !game?.session.active)) return;
    const frame = requestAnimationFrame(() => document.getElementById('host-question')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [previewId, game?.session.phase, tab]);
  if (loading) return <div className="loading-state"><div className="loading-symbol">СИ</div><p>Готовим вашу игру…</p></div>;
  if (!game) return <div className="loading-state"><h1>Не удалось открыть игру</h1><p>{notice}</p><button className="button button-primary" onClick={() => location.reload()}>Попробовать снова</button></div>;
  const { pack, session, history } = game;
  const round = session.round === 2 ? undefined : pack.rounds[session.round];
  const usedCount = round?.categories.flatMap(c => c.questions).filter(q => session.usedQuestionIds.includes(q.id)).length ?? 0;
  const retryUnfinished = !!session.active && (session.active.retryPending || (!!session.active.respondingTeamId && session.active.retryUsedTeamIds.includes(session.active.respondingTeamId) && !session.active.attemptedTeamIds.includes(session.active.respondingTeamId) && !session.active.resolved));
  const canEnd = ['board', 'question', 'answer', 'special'].includes(session.phase) && !retryUnfinished;
  const locked = busy || readOnly;
  const liveFocus = tab === 'game' && ['special', 'question', 'answer'].includes(session.phase);
  const startNew = async (next: QuizPack) => { if (!await reset(next)) return; setNewGameModal(false); setPendingPack(null); setTab('game'); setPreviewId(''); };
  const openScreen = () => { const url = appUrl('screen'); const win = window.open(url, 'svoya-igra-screen'); if (!win) setNotice(`Разрешите всплывающие окна для игры или откройте ${new URL(url, window.location.origin).href} во втором окне этого браузера.`); };
  return <div className={`app-shell ${liveFocus ? 'is-live' : ''}`}>
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><Icon name="bolt" size={24} /></span><div><div className="brand-name">своя игра<span>®</span></div><div className="brand-caption">ВАШ ВЕЧЕР. ВАШИ ПРАВИЛА.</div></div></div><div className="nav-label">УПРАВЛЕНИЕ</div><nav aria-label="Основная навигация"><button className={`nav-item ${tab === 'game' ? 'active' : ''}`} onClick={() => setTab('game')}><Icon name="grid" />Пульт ведущего<span className="nav-key">01</span></button><button className={`nav-item ${tab === 'editor' ? 'active' : ''}`} onClick={() => setTab('editor')}><Icon name="edit" />Редактор вопросов</button><button className={`nav-item ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}><Icon name="history" />История действий<span className="nav-count">{history.length}</span></button><button className={`nav-item ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}><Icon name="help" />Как играть</button></nav>
      <div className="sidebar-game"><span className="eyebrow">НАБОР ВОПРОСОВ</span><strong>{pack.title}</strong><span>2 раунда + финал</span><div className="sidebar-file-actions"><button aria-label="Импорт вопросов" onClick={() => fileInput.current?.click()} disabled={locked}><Icon name="upload" size={15} />Импорт</button><button onClick={() => exportPack(pack)}><Icon name="download" size={15} />Экспорт</button></div></div>
      <div className="sidebar-footer"><span className="local-icon"><Icon name="shield" size={18} /></span><div><strong>Всё на вашем ноутбуке</strong><p>Интернет для игры не нужен</p></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Игровая студия<Icon name="chevron" size={13} /><span>{tab === 'game' ? 'Пульт ведущего' : tab === 'editor' ? 'Редактор вопросов' : tab === 'history' ? 'История действий' : 'Как играть'}</span></div><div className="topbar-actions"><span className="save-status"><span className={`status-dot ${busy ? 'saving' : ''}`} />{busy ? 'Сохраняем…' : 'Всё сохранено'}</span><span className="host-avatar">В</span></div></header>
    <div className="workspace"><div className="page-header"><div><div className="eyebrow">РЕЖИССЁРСКИЙ ПУЛЬТ</div><h1>{tab === 'game' ? 'Пульт ведущего' : tab === 'editor' ? 'Вопросы с вашим характером' : tab === 'history' ? 'Каждый ход под контролем' : 'Пусть победит любопытство'}</h1><p>{tab === 'game' ? 'Вы управляете ходом игры. Команды создают историю.' : tab === 'editor' ? 'Темы, вопросы и неожиданные повороты — всё в ваших руках.' : tab === 'history' ? 'Очки, бонусы и решения ведущего сохраняются автоматически.' : 'Всё, что нужно знать перед первым вопросом.'}</p></div><div className="page-header-actions"><button className="button button-secondary" disabled={locked} onClick={() => setNewGameModal(true)}><Icon name="plus" />Новая игра</button><button className="button button-primary" onClick={openScreen}><Icon name="screen" />Открыть экран игры<Icon name="arrow" size={16} /></button></div></div>
    {readOnly && <div className="warning-banner">Этот пульт открыт для просмотра. Игрой уже управляет другое окно. Закройте его и обновите эту страницу.</div>}
    <fieldset className="app-fieldset" disabled={locked}>
    {tab === 'editor' ? <Editor pack={pack} onSave={async next => { await updatePack(validatePack(next)); }} onClose={() => setTab('game')} /> : tab === 'rules' ? <Rules /> : tab === 'history' ? <section className="panel"><div className="panel-header"><div><h2 className="panel-title">История этой игры</h2><p className="panel-subtitle">Последние 60 действий. Отмена восстанавливает счёт, бонусы и экран.</p></div><button className="button button-secondary" disabled={!history.length} onClick={() => void undo()}><Icon name="undo" />Отменить последнее</button></div><div className="history-list">{!history.length && <div className="empty-question"><Icon name="history" size={32} /><h3>Первый ход ещё впереди</h3><p>Начните раунд — и история появится здесь.</p></div>}{history.slice().reverse().map((entry, i) => <div className="history-entry" key={entry.id}><span className="history-index">{String(history.length - i).padStart(2, '0')}</span><strong>{entry.label}</strong><time>{new Date(entry.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></section> : <>
      <div className="round-strip">{[0, 1, 2].map((r) => <div className={`round-tab ${session.round === r ? 'active' : ''} ${session.round > r ? 'completed' : ''}`} key={r}><span className="round-number">{session.round > r ? <Icon name="check" size={14} /> : String(r + 1).padStart(2, '0')}</span><div><strong>{roundLabel(r)}</strong><small>{r === 2 ? '9 тем · любые ставки' : `5 тем · ${r ? '200—1 000' : '100—500'} очков`}</small></div>{session.round === r && <span className="badge">{session.phase === 'setup' ? 'Подготовка' : session.phase === 'ranking' || session.phase === 'finished' ? 'Итоги' : 'В игре'}</span>}</div>)}<div className={`screen-status ${screenConnected ? 'online' : ''}`}><span className="status-dot" />{screenConnected ? 'Экран подключён' : 'Экран не открыт'}</div></div>
      <div className="game-toolbar"><button className="button button-ghost" disabled={!history.length} onClick={() => void undo()}><Icon name="undo" size={16} />Отменить действие</button>{session.phase === 'setup' ? <button className="button button-primary" disabled={!session.teams.length} onClick={() => void act({ type: 'START_ROUND' })}><Icon name="play" />{session.round === 2 ? 'Начать финал' : 'Начать раунд'}</button> : canEnd && <button className="button button-ghost" onClick={() => setEndRoundModal(true)}>Завершить раунд<Icon name="chevron" size={14} /></button>}</div>
      <div className="dashboard-grid"><div className="main-column">
        {session.phase === 'ranking' || session.phase === 'finished' ? <RankingPanel session={session} act={act} /> : session.round === 2 ? <FinalPanel session={session} pack={pack} act={act} /> : <>
          {!liveFocus && <><div className="opening-team-bar"><TeamChoices label="Кто выбирает вопрос?" teams={session.teams} selectedId={openingTeam} onSelect={setOpeningTeam} /></div>
          <section className="panel board-panel"><div className="panel-header"><div><div className="eyebrow">ИГРОВОЕ ПОЛЕ</div><h2 className="panel-title">{round?.title || roundLabel(session.round)}</h2></div><span className="board-progress"><strong>{usedCount}</strong> / 25 <span>сыграно</span><span className="progress-track"><span style={{ width: `${usedCount * 4}%` }} /></span></span></div><div className="board-table">{round?.categories.map((category, index) => <div className="category-row" key={category.id}><div className="category-label"><span className="category-index">{String(index + 1).padStart(2, '0')}</span><strong>{category.title}</strong></div>{category.questions.map(question => <button className={`value-cell ${session.usedQuestionIds.includes(question.id) ? 'used' : ''} ${previewId === question.id ? 'selected' : ''}`} key={question.id} disabled={session.usedQuestionIds.includes(question.id) || !['setup', 'board'].includes(session.phase)} onClick={() => setPreviewId(question.id)} aria-label={`${category.title}, ${question.value}${question.kind !== 'normal' ? `, ${kindLabels[question.kind]}` : ''}`}><span>{session.usedQuestionIds.includes(question.id) ? '—' : question.value}</span>{question.kind !== 'normal' && !session.usedQuestionIds.includes(question.id) && <span className="cell-special" title={kindLabels[question.kind]}>{kindSymbols[question.kind]}</span>}</button>)}</div>)}</div><div className="board-footer"><span><Icon name="eye" size={14} />Фишки видны только вам</span><span>Выберите клетку для предпросмотра<Icon name="arrow" size={14} /></span></div></section>
          </>}
          {(liveFocus || !!previewId) && <QuestionControls session={session} pack={pack} previewId={previewId} openingTeamId={openingTeam} act={act} edit={() => setTab('editor')} />}
        </>}
        
      </div>
      <aside className="teams-column"><section className="panel teams-panel"><div className="panel-header"><div><h2 className="panel-title">Команды<span className="team-count">{session.teams.length}</span></h2><p className="panel-subtitle">Счёт можно менять вручную</p></div><Icon name="settings" size={18} /></div><div className="team-list">{session.teams.map(team => <TeamCard key={team.id} team={team} selected={session.active?.respondingTeamId === team.id && session.phase === 'question'} canRemove={session.phase === 'setup'} act={act} />)}</div>{session.phase === 'setup' ? <form className="add-team-form" onSubmit={e => { e.preventDefault(); if (newTeam.trim()) { void act({ type: 'ADD_TEAM', name: newTeam }); setNewTeam(''); } }}><input value={newTeam} maxLength={60} placeholder="Название новой команды" aria-label="Название новой команды" onChange={e => setNewTeam(e.target.value)} /><button className="button button-secondary" disabled={!newTeam.trim()} type="submit"><Icon name="plus" size={16} />Добавить команду</button></form> : <p className="teams-note">Добавить команды можно перед следующим раундом</p>}</section><div className="host-tip"><span className="tip-icon"><Icon name="spark" size={20} /></span><div><strong>Маленький совет</strong><p>{session.phase === 'setup' ? 'Проверьте вопросы и команды перед стартом. Всё остальное — дело азарта.' : 'Не спешите раскрывать ответ. Пауза делает игру интереснее.'}</p></div></div></aside></div>
    </>}
    </fieldset>
    <footer className="footer-note"><span>СВОЯ ИГРА <span className="footer-dot">·</span> СОЗДАВАЙТЕ СВОИ МОМЕНТЫ</span><span><Icon name="shield" size={12} />Сохраняется на этом устройстве</span></footer></div></main>
    <input ref={fileInput} type="file" accept=".json,.quiz.json,application/json" hidden onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) try { setPendingPack(await readPackFile(file)); } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось прочитать файл.'); } }} />
    {newGameModal && <Modal title="Начать новую игру" close={() => setNewGameModal(false)}><div className="modal-body"><p className="muted">Счёт, бонусы и история текущей игры будут сброшены. Названия команд сохранятся. Экспортируйте вопросы, если хотите оставить копию.</p><div className="new-game-options"><button className="new-game-option" disabled={locked} onClick={() => void startNew(pack)}><Icon name="refresh" /><div><strong>С текущими вопросами</strong><span>Тот же набор, новая история</span></div><Icon name="chevron" /></button><button className="new-game-option" disabled={locked} onClick={() => void startNew(createDemoPack())}><Icon name="spark" /><div><strong>Демонстрационная игра</strong><span>Готовые вопросы и разные фишки в раундах</span></div><Icon name="chevron" /></button><button className="new-game-option" disabled={locked} onClick={() => void startNew(createBlankPack())}><Icon name="edit" /><div><strong>Пустой шаблон</strong><span>Наполните игру своими темами и вопросами</span></div><Icon name="chevron" /></button></div></div></Modal>}
    {pendingPack && <Modal title="Импортировать набор?" close={() => setPendingPack(null)}><div className="modal-body"><h3>{pendingPack.title}</h3><p className="muted">Набор проверен: два раунда и девять финальных тем. Импорт начнёт новую игру и обнулит текущие результаты.</p><button className="button button-primary" disabled={locked} onClick={() => void startNew(pendingPack)}><Icon name="upload" />Импортировать и начать подготовку</button></div></Modal>}
    {endRoundModal && <Modal title="Завершить раунд досрочно?" close={() => setEndRoundModal(false)}><div className="modal-body"><p className="muted">На проекторе появится рейтинг, оставшиеся бонусы команд сгорят. Это действие можно отменить.</p><div className="question-actions"><button className="button button-secondary" onClick={() => setEndRoundModal(false)}>Продолжить игру</button><button className="button button-primary" disabled={locked} onClick={() => { void act({ type: 'END_ROUND' }); setEndRoundModal(false); }}>Показать рейтинг<Icon name="trophy" /></button></div></div></Modal>}
    {notice && <div className="toast" role="status"><Icon name="help" size={18} /><span>{notice}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}
  </div>;
}
