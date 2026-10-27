import type { CellKind, Content, QuizPack } from '../game/types';

const KINDS = new Set<CellKind>(['normal', 'cat', 'flip', 'swap', 'double', 'approx', 'shield', 'retry', 'doubleReward']);
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_IMAGE_CHARACTERS = 48 * 1024 * 1024;

function fail(message: string): never { throw new Error(message); }

function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Неверная структура файла игры.');
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.prototype.hasOwnProperty.call(record, key)) || Object.keys(record).some(key => !allowed.has(key))) {
    fail('В файле игры отсутствуют обязательные поля или есть неизвестные поля.');
  }
  return record;
}

function string(value: unknown, label: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    fail(`${label}: ожидается текст длиной до ${max} символов${allowEmpty ? '' : ', не пустой'}.`);
  }
  return value;
}

function array(value: unknown, length: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${label}: должно быть ровно ${length}.`);
  return value;
}

export function validatePack(value: unknown): QuizPack {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'format' in value) {
    const wrapper = object(value, ['format', 'version', 'pack']);
    if (wrapper.format !== 'svoya-igra' || wrapper.version !== 1) fail('Неподдерживаемый формат или версия файла игры.');
    value = wrapper.pack;
  }
  const pack = object(value, ['version', 'id', 'title', 'rounds', 'final']);
  if (pack.version !== 1) fail('Неподдерживаемая версия набора вопросов.');
  const usedIds = new Set<string>();
  let imageCharacters = 0;
  const id = (candidate: unknown) => {
    const result = string(candidate, 'Идентификатор', 120, false);
    if (usedIds.has(result)) fail(`Повторяющийся идентификатор: ${result}.`);
    usedIds.add(result);
    return result;
  };
  const content = (candidate: unknown): Content => {
    const data = object(candidate, ['text'], ['image']);
    const result: Content = { text: string(data.text, 'Текст вопроса или ответа', 12000) };
    if (data.image !== undefined) {
      if (typeof data.image !== 'string') fail('Изображение должно быть встроено в файл игры.');
      const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.image);
      if (!match || match[2].length % 4 !== 0) fail('Допустимы только встроенные изображения PNG, JPEG, WebP и GIF.');
      if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) fail('Изображение превышает ограничение 6 МБ.');
      // Check the binary signature as well as the MIME label. SVG and remote URLs are never accepted.
      let signature: string;
      try { signature = atob(match[2].slice(0, 24)); } catch { fail('Повреждённые данные изображения.'); }
      const validSignature = match[1] === 'png' ? signature.startsWith('\x89PNG\r\n\x1a\n')
        : match[1] === 'jpeg' ? signature.startsWith('\xff\xd8\xff')
          : match[1] === 'gif' ? /^GIF8[79]a/.test(signature)
            : signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP';
      if (!validSignature) fail('Содержимое изображения не соответствует его формату.');
      imageCharacters += data.image.length;
      if (imageCharacters > MAX_TOTAL_IMAGE_CHARACTERS) fail('Суммарный размер изображений в игре слишком большой (до 36 МБ).');
      result.image = data.image;
    }
    return result;
  };
  const result: QuizPack = {
    version: 1,
    id: id(pack.id),
    title: string(pack.title, 'Название игры', 120, false),
    rounds: array(pack.rounds, 2, 'Обычных раундов').map((roundValue, roundIndex) => {
      const round = object(roundValue, ['id', 'title', 'categories']);
      return {
        id: id(round.id),
        title: string(round.title, 'Название раунда', 120, false),
        categories: array(round.categories, 5, 'Категорий в раунде').map(categoryValue => {
          const category = object(categoryValue, ['id', 'title', 'questions']);
          return {
            id: id(category.id),
            title: string(category.title, 'Название категории', 120, false),
            questions: array(category.questions, 5, 'Вопросов в категории').map((questionValue, questionIndex) => {
              const question = object(questionValue, ['id', 'value', 'kind', 'prompt', 'answer']);
              const expectedValue = (roundIndex + 1) * (questionIndex + 1) * 100;
              if (question.value !== expectedValue) fail(`Неверная стоимость вопроса: ожидается ${expectedValue}.`);
              if (typeof question.kind !== 'string' || !KINDS.has(question.kind as CellKind)) fail('Неизвестный тип особой клетки или бонуса.');
              return { id: id(question.id), value: expectedValue, kind: question.kind as CellKind, prompt: content(question.prompt), answer: content(question.answer) };
            }),
          };
        }),
      };
    }) as QuizPack['rounds'],
    final: array(pack.final, 9, 'Тем в финале').map(topicValue => {
      const topic = object(topicValue, ['id', 'title', 'prompt', 'answer']);
      return { id: id(topic.id), title: string(topic.title, 'Название темы финала', 120, false), prompt: content(topic.prompt), answer: content(topic.answer) };
    }),
  };
  const kindsByRound = result.rounds.map(round => new Set(round.categories.flatMap(category => category.questions.map(question => question.kind)).filter(kind => kind !== 'normal')));
  if ([...kindsByRound[0]].some(kind => kindsByRound[1].has(kind))) {
    fail('Один и тот же бонус или особая клетка не может встречаться в обоих раундах. Сначала уберите все его назначения из одного раунда.');
  }
  return result;
}

export function parsePackFile(text: string): QuizPack {
  if (text.length > MAX_FILE_BYTES) fail('Файл слишком большой. Максимум — 64 МБ.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('Не удалось прочитать JSON. Выберите файл с расширением .quiz.json.'); }
  return validatePack(value);
}

export async function readPackFile(file: File): Promise<QuizPack> {
  if (file.size > MAX_FILE_BYTES) fail('Файл слишком большой. Максимум — 64 МБ.');
  return parsePackFile(await file.text());
}

export function exportPack(pack: QuizPack): void {
  const validated = validatePack(pack);
  const blob = new Blob([JSON.stringify({ format: 'svoya-igra', version: 1, pack: validated }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const name = pack.title.trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'svoya-igra';
  anchor.download = `${name}.quiz.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
