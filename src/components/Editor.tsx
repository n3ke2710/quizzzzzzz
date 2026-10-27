import { useEffect, useRef, useState } from 'react';
import type { CellKind, Content, QuizPack } from '../game/types';
import { MAX_IMAGE_BYTES, validatePack } from '../lib/packFile';

type Props = { pack: QuizPack; onSave: (pack: QuizPack) => Promise<void> | void; onClose: () => void };
type Side = 'prompt' | 'answer';

const kindOptions: { value: CellKind; title: string; description: string }[] = [
  { value: 'normal', title: 'Обычный вопрос', description: 'Верный ответ приносит стоимость клетки, неверный — снимает её.' },
  { value: 'cat', title: 'Кот в мешке', description: 'Выбравшая команда передаёт вопрос сопернику. Только он сможет ответить.' },
  { value: 'flip', title: '+ на −', description: 'Меняет знак всего счёта выбравшей команды. Заменяет вопрос.' },
  { value: 'swap', title: 'Обмен очками', description: 'Выбравшая команда меняется всем счётом с соперником. Заменяет вопрос.' },
  { value: 'double', title: '×2', description: 'Умножает весь счёт выбравшей команды на два, включая отрицательный. Заменяет вопрос.' },
  { value: 'approx', title: 'И так сойдёт', description: 'До конца раунда команде можно засчитывать приблизительные ответы по смыслу. Затем играется вопрос.' },
  { value: 'shield', title: 'Бронежилет', description: 'Команда получает защиту от одной итоговой ошибки. Затем играется вопрос.' },
  { value: 'retry', title: 'Вторая жизнь', description: 'Команда получает одну дополнительную попытку после ошибки. Затем играется вопрос.' },
  { value: 'doubleReward', title: 'Двойной куш', description: 'Команда получает один бонус удвоения награды за правильный ответ. Затем играется вопрос.' },
];

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
}

export default function Editor({ pack, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<QuizPack>(() => structuredClone(pack));
  const [roundIndex, setRoundIndex] = useState(0);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [finalIndex, setFinalIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function close() {
    if (!dirty || window.confirm('Закрыть редактор без сохранения изменений?')) onClose();
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!dirtyRef.current || window.confirm('Закрыть редактор без сохранения изменений?')) onCloseRef.current();
      }
      if (event.key === 'Tab') {
        const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
          .filter(element => element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);

  function change(update: (current: QuizPack) => QuizPack) {
    setDraft(update);
    setDirty(true);
    setSaved(false);
    setError('');
  }

  const final = roundIndex === 2;
  const round = draft.rounds[Math.min(roundIndex, 1)];
  const category = round.categories[categoryIndex];
  const selected = final ? draft.final[finalIndex] : category.questions[questionIndex];
  const kind = 'kind' in selected ? selected.kind : 'normal';
  const otherRoundIndex = roundIndex === 0 ? 1 : 0;
  const otherRoundKinds = new Set<CellKind>(draft.rounds[otherRoundIndex].categories.flatMap(group => group.questions.map(question => question.kind)).filter(item => item !== 'normal'));

  function changeContent(targetId: string, side: Side, content: Content) {
    change(current => ({
      ...current,
      rounds: current.rounds.map(item => ({ ...item, categories: item.categories.map(group => ({ ...group, questions: group.questions.map(question => question.id === targetId ? { ...question, [side]: content } : question) })) })) as QuizPack['rounds'],
      final: current.final.map(topic => topic.id === targetId ? { ...topic, [side]: content } : topic),
    }));
  }

  async function upload(file: File | undefined, side: Side) {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setError('Выберите изображение PNG, JPEG, WebP или GIF.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError('Изображение должно весить не больше 6 МБ.'); return; }
    const targetId = selected.id;
    const content = selected[side];
    setUploading(true);
    try {
      const image = await readImage(file);
      const candidate = structuredClone(draft);
      const target = candidate.final.find(topic => topic.id === targetId)
        ?? candidate.rounds.flatMap(item => item.categories.flatMap(group => group.questions)).find(question => question.id === targetId);
      if (!target) throw new Error('Вопрос не найден.');
      target[side] = { ...content, image };
      validatePack(candidate);
      changeContent(targetId, side, { ...content, image });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение.'); }
    finally { setUploading(false); }
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      const validated = validatePack(draft);
      await onSave(validated);
      setDraft(validated);
      setDirty(false);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить игру.'); }
    finally { setSaving(false); }
  }

  function renderContent(side: Side, title: string) {
    const content = selected[side];
    return <section className="editor-content-fields" aria-label={title}>
      <label className="field">
        <span>{title}</span>
        <textarea rows={6} maxLength={12000} value={content.text} disabled={saving || uploading}
          placeholder={side === 'prompt' ? 'Напишите вопрос для игроков…' : 'Правильный ответ и заметки для ведущего…'}
          onChange={event => changeContent(selected.id, side, { ...content, text: event.target.value })} />
      </label>
      {content.image && <div className="editor-image-preview">
        <img src={content.image} alt={side === 'prompt' ? 'Изображение к вопросу' : 'Изображение к ответу'} />
        <button className="button button-secondary" type="button" disabled={saving || uploading}
          onClick={() => changeContent(selected.id, side, { text: content.text })}>Убрать картинку</button>
      </div>}
      <label className="field editor-upload">
        <span>{content.image ? 'Заменить картинку' : 'Добавить картинку'} <small>PNG, JPEG, WebP, GIF · до 6 МБ</small></span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={saving || uploading}
          onChange={event => { void upload(event.target.files?.[0], side); event.target.value = ''; }} />
      </label>
    </section>;
  }

  return <div className="editor-overlay">
    <div className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title" ref={dialogRef}>
      <header className="editor-header">
        <div><p className="eyebrow">МАСТЕРСКАЯ ВОПРОСОВ</p><h2 id="editor-title">Редактор игры</h2></div>
        <button className="button button-secondary" type="button" disabled={saving} onClick={close} aria-label="Закрыть редактор">Закрыть ×</button>
      </header>
      <div className="editor-pack-title">
        <label className="field"><span>Название игры</span><input value={draft.title} maxLength={120} disabled={saving || uploading}
          onChange={event => change(current => ({ ...current, title: event.target.value }))} /></label>
      </div>
      <nav className="tabs editor-tabs" aria-label="Раунды редактора">
        {['1-й раунд', '2-й раунд', 'Финал'].map((title, index) => <button type="button" key={title}
          className={`button ${roundIndex === index ? 'button-primary' : 'button-secondary'}`} aria-pressed={roundIndex === index}
          onClick={() => setRoundIndex(index)}>{title}</button>)}
      </nav>
      <div className="editor-layout">
        <aside className="editor-sidebar">
          <p className="eyebrow">{final ? '9 ТЕМ · 1 ОСТАНЕТСЯ' : '5 КАТЕГОРИЙ · 25 ВОПРОСОВ'}</p>
          {final ? <div className="editor-question-list">{draft.final.map((topic, index) => <button type="button" key={topic.id}
            className={`editor-question-button ${finalIndex === index ? 'editor-selected' : ''}`} aria-pressed={finalIndex === index}
            onClick={() => setFinalIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span> {topic.title || 'Без названия'}</button>)}</div>
            : round.categories.map((group, index) => <div className="editor-category" key={group.id}>
              <button className={`editor-category-name ${categoryIndex === index ? 'editor-selected' : ''}`} type="button"
                onClick={() => { setCategoryIndex(index); setQuestionIndex(0); }}>{group.title || 'Без названия'}</button>
              <div className="editor-question-list">{group.questions.map((question, position) => <button type="button" key={question.id}
                className={`editor-question-button ${categoryIndex === index && questionIndex === position ? 'editor-selected' : ''}`}
                aria-pressed={categoryIndex === index && questionIndex === position}
                title={kindOptions.find(option => option.value === question.kind)?.title}
                onClick={() => { setCategoryIndex(index); setQuestionIndex(position); }}>
                <span>{question.value}</span>{question.kind !== 'normal' && <span aria-label="Особая клетка">✦</span>}
              </button>)}</div>
            </div>)}
        </aside>
        <main className="editor-content">
          <div className="editor-form-grid">
            <label className="field"><span>{final ? 'Название темы' : 'Название категории'}</span>
              <input value={final ? selected && 'title' in selected ? selected.title : '' : category.title} maxLength={120} disabled={saving || uploading}
                onChange={event => {
                  const title = event.target.value;
                  change(current => final
                    ? { ...current, final: current.final.map(topic => topic.id === selected.id ? { ...topic, title } : topic) }
                    : { ...current, rounds: current.rounds.map(item => item.id === round.id ? { ...item, categories: item.categories.map(group => group.id === category.id ? { ...group, title } : group) } : item) as QuizPack['rounds'] });
                }} />
            </label>
            {!final && <label className="field"><span>Название раунда</span><input value={round.title} maxLength={120} disabled={saving || uploading}
              onChange={event => change(current => ({ ...current, rounds: current.rounds.map(item => item.id === round.id ? { ...item, title: event.target.value } : item) as QuizPack['rounds'] }))} /></label>}
            {!final && <label className="field"><span>Тип клетки · {'value' in selected ? selected.value : ''} очков</span>
              <select value={kind} disabled={saving || uploading} onChange={event => {
                const nextKind = event.target.value as CellKind;
                change(current => ({ ...current, rounds: current.rounds.map(item => ({ ...item, categories: item.categories.map(group => ({ ...group, questions: group.questions.map(question => question.id === selected.id ? { ...question, kind: nextKind } : question) })) })) as QuizPack['rounds'] }));
              }}>{kindOptions.map(option => <option key={option.value} value={option.value} disabled={otherRoundKinds.has(option.value)}>{option.title}{otherRoundKinds.has(option.value) ? ` — уже в раунде ${otherRoundIndex + 1}` : ''}</option>)}</select>
            </label>}
          </div>
          {!final && <p className="editor-kind-hint">{kindOptions.find(option => option.value === kind)?.description}</p>}
          {!final && <p className="editor-note">В каждом раунде свой набор бонусов и особых клеток. Чтобы перенести тип в другой раунд, сначала уберите все его назначения в текущем.</p>}
          <div className="editor-form-grid editor-text-grid">
            {renderContent('prompt', 'Вопрос · видят игроки')}
            {renderContent('answer', 'Ответ · для ведущего')}
          </div>
          <p className="editor-note">Правки текущего вопроса появятся на проекторе после кнопки «Обновить на экране» в пульте. Текст ответа остаётся скрытым до его раскрытия.</p>
        </main>
      </div>
      <footer className="editor-footer">
        <div aria-live="polite">
          {error ? <p className="error" role="alert">{error}</p> : <span className="editor-unsaved">{uploading ? 'Загружаю картинку…' : dirty ? 'Есть несохранённые изменения' : saved ? 'Изменения сохранены' : 'Редактор открыт. Изменения сохраняются кнопкой справа.'}</span>}
        </div>
        <button className="button button-primary" type="button" disabled={saving || uploading || !dirty} onClick={() => void save()}>{saving ? 'Сохраняю…' : 'Сохранить изменения'}</button>
      </footer>
    </div>
  </div>;
}
