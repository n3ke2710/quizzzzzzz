import { useEffect, useState, type CSSProperties } from 'react';
import type { CellKind, Content, PublicView, RankingEntry } from '../game/types';

type Props = { view: PublicView | null; connected: boolean };

const bonusLabels = { approx: 'И так сойдёт', shield: 'Бронежилет', retry: 'Вторая жизнь', doubleReward: 'Двойной куш' };
const bonusSymbols = { approx: '≈', shield: '◇', retry: '↺', doubleReward: '×2' };
const specialCopy: Record<CellKind, { symbol: string; title: string; description: string; color: string }> = {
  normal: { symbol: '?', title: 'Ваш вопрос', description: 'Время показать, на что вы способны.', color: 'lime' },
  cat: { symbol: '✦', title: 'Кот в мешке', description: 'Сюрприз для соперника. Передайте ему этот вопрос.', color: 'purple' },
  flip: { symbol: '±', title: '+ на −', description: 'Весь счёт меняет знак. Поворот, которого никто не ждал.', color: 'pink' },
  swap: { symbol: '⇄', title: 'Обмен очками', description: 'Выберите соперника и поменяйтесь с ним счетами.', color: 'cyan' },
  double: { symbol: '×2', title: 'Всё вдвойне', description: 'Ваш счёт умножается на два. В любую сторону.', color: 'lime' },
  approx: { symbol: '≈', title: 'И так сойдёт', description: 'До конца раунда можно отвечать приблизительно. Главное — попасть в смысл.', color: 'purple' },
  shield: { symbol: '◇', title: 'Бронежилет', description: 'Одна ближайшая итоговая ошибка обойдётся без штрафа.', color: 'cyan' },
  retry: { symbol: '↺', title: 'Вторая жизнь', description: 'Ещё одна попытка, когда первая не удалась.', color: 'pink' },
  doubleReward: { symbol: '×2', title: 'Двойной куш', description: 'Активируйте до ответа: двойная награда за правильный ответ.', color: 'lime' },
};

function Media({ content, answer = false }: { content: Content; answer?: boolean }) {
  const safeImage = content.image?.startsWith('data:image/') ? content.image : undefined;
  return <div className={`screen-content-body${safeImage ? ' with-image' : ''}${answer ? ' is-answer' : ''}`}>
    {content.text && <div className="screen-content-text">{content.text}</div>}
    {safeImage && <img className="screen-content-image" src={safeImage} alt={answer ? 'Иллюстрация к ответу' : 'Иллюстрация к вопросу'} />}
    {!content.text && !safeImage && <div className="screen-content-text muted">Ведущий готовит вопрос…</div>}
  </div>;
}

function TeamStrip({ view }: { view: PublicView }) {
  if (!view.teams.length) return null;
  return <footer className="screen-teams" aria-label="Команды">
    {view.teams.map(team => <div key={team.id} className={`screen-team${view.question?.respondingTeamId === team.id ? ' is-responding' : ''}`} style={{ '--team-color': team.color } as CSSProperties}>
      <span className="team-color-dot" /><span className="screen-team-name">{team.name}</span>
      <span className="screen-team-bonuses">{(Object.keys(bonusLabels) as (keyof typeof bonusLabels)[]).map(key => {
        const value = team.bonuses[key];
        return value ? <span className={`bonus-mini bonus-${key}`} key={key} title={`${bonusLabels[key]}${typeof value === 'number' ? `: ${value}` : ''}`}>{bonusSymbols[key]}{typeof value === 'number' && value > 1 && <small>{value}</small>}</span> : null;
      })}</span>
    </div>)}
  </footer>;
}

function Board({ view }: { view: PublicView }) {
  return <div className="screen-board-wrap">
    <div className="screen-section-heading"><div><span className="eyebrow">{view.phase === 'setup' ? 'Скоро начинаем' : 'Ваша следующая победа'}</span><h1>{view.board?.title || 'Выбирайте вопрос'}</h1></div><span className="screen-round-note">5 категорий <span>·</span> 25 вопросов</span></div>
    {view.board ? <div className="screen-board" role="table" aria-label="Игровое поле">{view.board.categories.map(category => <div className="screen-category-row" role="row" key={category.id}>
      <div className="screen-category" role="rowheader">{category.title || 'Без названия'}</div>
      {category.cells.map(cell => <div className={`screen-cell${cell.used ? ' is-used' : ''}`} role="cell" key={cell.id}>{cell.used ? <span className="used-cell-mark" aria-label="Вопрос разыгран">—</span> : cell.value}</div>)}
    </div>)}</div> : <div className="screen-wait-card"><span className="waiting-orbit">✦</span><h2>Всё готово к большой игре</h2><p>Ждём сигнала ведущего</p></div>}
    <div className="screen-board-caption"><span className="live-dot" />{view.phase === 'setup' ? 'Собираем команды. Настраиваемся на победу.' : 'Выбирайте категорию и стоимость вопроса.'}<span>Знания решают. Но не всегда.</span></div>
  </div>;
}

function QuestionView({ view }: { view: PublicView }) {
  const question = view.question;
  if (!question) return <div className="screen-wait-card"><span className="waiting-orbit">?</span><h1>Сейчас будет вопрос</h1><p>Ведущий готовит следующий ход</p></div>;
  const answerShown = (view.phase === 'answer' || view.phase === 'finalAnswer') && question.answer;
  const final = view.round === 2;
  const team = view.teams.find(item => item.id === question.respondingTeamId);
  return <section className={`screen-question${answerShown ? ' answer-revealed' : ''}`}>
    <div className="screen-question-meta"><span className="category-pill">{final ? 'Финал' : question.category}</span>{!final && <span className="question-value">{question.value}<small>очков</small></span>}<span className="screen-question-state">{answerShown ? 'Правильный ответ' : final ? 'Решающий вопрос' : 'Внимание, вопрос'}</span></div>
    {answerShown ? <Media content={answerShown} answer /> : <Media content={question.prompt} />}
    <div className="screen-question-footer">{answerShown ? <span className="answer-check">✓ <span>А вы знали ответ?</span></span> : team ? <span className="responding-label" style={{ '--team-color': team.color } as CSSProperties}><span className="team-color-dot" />Отвечает <strong>{team.name}</strong></span> : <span>Обсудите. Рискните. Ответьте.</span>}<span className="screen-question-decoration">✦</span></div>
  </section>;
}

function Special({ view }: { view: PublicView }) {
  if (!view.special) return null;
  const special = view.special;
  const copy = specialCopy[special.kind];
  const isBonus = ['approx', 'shield', 'retry', 'doubleReward'].includes(special.kind);
  return <section className={`screen-special special-${copy.color}`}>
    <div className="special-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
    <span className="eyebrow">{isBonus ? 'Приятный поворот' : 'Правила меняются'}</span>
    <div className="special-orbit"><span>{copy.symbol}</span></div>
    <h1>{copy.title}</h1><p>{copy.description}</p>
    <div className="special-team" style={{ '--team-color': special.teamColor } as CSSProperties}><span className="team-color-dot" />{special.teamName}{special.targetName && <><span className="special-arrow">→</span>{special.targetName}</>}</div>
    {special.applied && <div className="special-applied">✓ {special.result || (isBonus ? 'Бонус получен' : 'Ход выполнен')}</div>}
  </section>;
}

function FinalTopics({ view }: { view: PublicView }) {
  const team = view.teams.find(item => item.id === view.finalTurnTeamId);
  const remaining = view.finalTopics?.filter(topic => !topic.eliminated).length || 0;
  return <section className="screen-final">
    <div className="screen-section-heading"><div><span className="eyebrow">Девять тем. Один шанс.</span><h1>{view.phase === 'finalBets' ? 'Делайте ставки' : 'Останется только одна'}</h1></div><span className="final-remaining">{view.phase === 'finalBets' ? 'Финальный вопрос выбран' : `${remaining} из 9 тем`}</span></div>
    <div className="final-topic-grid">{view.finalTopics?.map((topic, index) => <div className={`public-final-topic${topic.eliminated ? ' is-eliminated' : ''}${remaining === 1 && !topic.eliminated ? ' is-selected' : ''}`} key={topic.id}><span className="final-topic-number">{String(index + 1).padStart(2, '0')}</span><span>{topic.title || 'Без названия'}</span>{topic.eliminated && <span className="final-topic-cross" aria-label="Тема вычеркнута">×</span>}{remaining === 1 && !topic.eliminated && <span className="final-topic-star">✦</span>}</div>)}</div>
    <div className="final-instruction">{view.phase === 'finalBets' ? <><span className="live-dot" />Команды делают ставки. Всё решит последний ответ.</> : team ? <><span className="team-color-dot" style={{ '--team-color': team.color } as CSSProperties} /><strong>{team.name}</strong><span>вычёркивает тему</span></> : 'Ведущий определяет порядок команд'}</div>
  </section>;
}

function Ranking({ view }: { view: PublicView }) {
  const [now, setNow] = useState(Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [view.rankingStartedAt]);
  const ranking = [...(view.ranking || [])].sort((a, b) => a.place - b.place);
  const places = [...new Set(ranking.map(team => team.place))].sort((a, b) => b - a);
  const count = view.rankingShowAll || reducedMotion ? places.length : Math.max(0, Math.floor((now - (view.rankingStartedAt || now)) / 1200) + 1);
  const visible = new Set(places.slice(0, count));
  const allShown = count >= places.length;
  const winner = ranking.filter(team => team.place === 1);
  return <section className={`screen-ranking${allShown ? ' all-revealed' : ''}`}>
    <div className="ranking-title"><span className="eyebrow">{view.round === 2 ? 'Игра окончена. Это было красиво.' : `Раунд ${view.round + 1} завершён`}</span><h1>{allShown && view.round === 2 ? 'Знаем наших героев' : 'Всё решают очки'}</h1><p>{allShown && view.round === 2 ? winner.length > 1 ? 'Победа, которую разделили вместе' : 'Аплодисменты победителям!' : 'От последнего места — к первому'}</p></div>
    <div className="public-ranking-list">{ranking.map((team: RankingEntry) => <div key={team.teamId} className={`public-ranking-row${visible.has(team.place) ? ' is-visible' : ''}${team.place === 1 ? ' is-winner' : ''}`} style={{ '--team-color': team.color } as CSSProperties} aria-hidden={!visible.has(team.place)}>
      <span className="ranking-place">{team.place === 1 ? <span aria-label="Первое место">♛</span> : String(team.place).padStart(2, '0')}</span><span className="team-color-dot" /><span className="ranking-name">{team.name}</span>{team.place === 1 && <span className="winner-label">{view.round === 2 ? 'Победители' : 'Лидеры'}</span>}<span className="ranking-score">{team.score.toLocaleString('ru-RU')}<small>очков</small></span>
    </div>)}</div>
    <div className="ranking-progress" aria-hidden="true">{places.map(place => <i className={visible.has(place) ? 'active' : ''} key={place} />)}</div>
  </section>;
}

export default function Screen({ view, connected }: Props) {
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Fullscreen can be unavailable in an embedded browser. */ }
  };
  return <div className="projector-screen">
    <div className="screen-ambient ambient-one" aria-hidden="true" /><div className="screen-ambient ambient-two" aria-hidden="true" />
    <button className="screen-fullscreen screen-fullscreen-floating" title={fullscreen ? 'Выйти из полного экрана' : 'На весь экран'} aria-label={fullscreen ? 'Выйти из полного экрана' : 'На весь экран'} onClick={toggleFullscreen}>{fullscreen ? '⊡' : '⛶'}</button>
    <main className="screen-stage">{!view ? <div className="screen-wait-card"><span className="waiting-orbit">✦</span><span className="eyebrow">Большая игра начинается здесь</span><h1>Ну что, сыграем?</h1><p>Откройте пульт ведущего и начните игру</p><span className="screen-connection"><span className="live-dot" />Подключаемся к пульту</span></div> : view.round === 2 && view.phase === 'setup' ? <FinalTopics view={view} /> : view.phase === 'setup' || view.phase === 'board' ? <Board view={view} /> : view.phase === 'special' ? <Special view={view} /> : view.phase === 'ranking' || view.phase === 'finished' ? <Ranking view={view} /> : view.phase === 'finalElimination' || view.phase === 'finalBets' ? <FinalTopics view={view} /> : <QuestionView view={view} />}</main>
    {view && !['ranking', 'finished'].includes(view.phase) && <TeamStrip view={view} />}
    {!connected && view && <div className="screen-disconnected"><span className="live-dot" />Ожидаем подключения ведущего</div>}
  </div>;
}
