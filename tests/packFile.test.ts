import { describe, expect, it } from 'vitest';
import { createBlankPack, createDemoPack } from '../src/data/packs';
import { parsePackFile, validatePack } from '../src/lib/packFile';

describe('quiz packs and portable files', () => {
  it('creates complete, independent 59-question packs with fixed values', () => {
    const demo = createDemoPack();
    const blank = createBlankPack();
    expect(validatePack(demo)).toEqual(demo);
    expect(validatePack(blank)).toEqual(blank);
    expect(demo.rounds.flatMap(round => round.categories.flatMap(category => category.questions))).toHaveLength(50);
    expect(demo.final).toHaveLength(9);
    expect(demo.rounds[1].categories[0].questions.map(question => question.value)).toEqual([200, 400, 600, 800, 1000]);
    expect(demo.rounds.every(round => round.categories.every(category => category.questions.every(question => question.prompt.text && question.answer.text)))).toBe(true);
    expect(demo.final.every(topic => topic.prompt.text && topic.answer.text)).toBe(true);
    expect(blank.rounds.every(round => round.categories.every(category => category.questions.every(question => question.kind === 'normal' && question.prompt.text === '')))).toBe(true);
    demo.title = 'Изменено';
    expect(createDemoPack().title).not.toBe('Изменено');
  });

  it('round-trips the canonical wrapper and preserves embedded raster images', () => {
    const pack = createDemoPack();
    pack.rounds[0].categories[0].questions[0].prompt.image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
    const text = JSON.stringify({ format: 'svoya-igra', version: 1, pack });
    expect(parsePackFile(text)).toEqual(pack);
    expect(parsePackFile(JSON.stringify(pack))).toEqual(pack);
    expect(validatePack(pack)).not.toBe(pack);
  });

  it('rejects malformed JSON and unsupported wrapper versions', () => {
    expect(() => parsePackFile('{')).toThrow(/JSON/);
    expect(() => validatePack({ format: 'svoya-igra', version: 2, pack: createDemoPack() })).toThrow(/версия|верси/);
    expect(() => validatePack({ format: 'unknown', version: 1, pack: createDemoPack() })).toThrow(/формат/);
  });

  it('rejects wrong dimensions, duplicate identifiers and edited nominal values', () => {
    const dimensions = createDemoPack();
    dimensions.final.pop();
    expect(() => validatePack(dimensions)).toThrow(/ровно 9/);
    const questions = createDemoPack();
    questions.rounds[0].categories[0].questions.pop();
    expect(() => validatePack(questions)).toThrow(/ровно 5/);
    const duplicate = createDemoPack();
    duplicate.final[0].id = duplicate.rounds[0].categories[0].questions[0].id;
    expect(() => validatePack(duplicate)).toThrow(/идентификатор/);
    const nominal = createDemoPack();
    nominal.rounds[0].categories[0].questions[0].value = 999;
    expect(() => validatePack(nominal)).toThrow(/стоимость/);
  });

  it('rejects unknown fields, kinds, overlong text and empty titles', () => {
    const extra = { ...createDemoPack(), injected: true };
    expect(() => validatePack(extra)).toThrow(/неизвестные поля/);
    const wrongKind = createDemoPack();
    Object.assign(wrongKind.rounds[0].categories[0].questions[0], { kind: 'freeMoney' });
    expect(() => validatePack(wrongKind)).toThrow(/Неизвестный тип/);
    const longText = createDemoPack();
    longText.final[0].prompt.text = 'а'.repeat(12001);
    expect(() => validatePack(longText)).toThrow(/12000/);
    const empty = createDemoPack();
    empty.rounds[0].categories[0].title = '  ';
    expect(() => validatePack(empty)).toThrow(/не пустой/);
  });

  it.each([
    'https://example.com/image.png',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,INVALID!',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])('rejects unsafe or incorrectly labelled image %s', image => {
    const pack = createDemoPack();
    pack.final[0].prompt.image = image;
    expect(() => validatePack(pack)).toThrow(/изображени|формату/);
  });

  it('requires disjoint special and bonus types between the two rounds', () => {
    const pack = createBlankPack();
    pack.rounds[0].categories[0].questions[0].kind = 'shield';
    pack.rounds[1].categories[0].questions[0].kind = 'shield';
    expect(() => validatePack(pack)).toThrow(/обоих раундах/);
    pack.rounds[1].categories[0].questions[0].kind = 'doubleReward';
    expect(() => validatePack(pack)).not.toThrow();
    pack.rounds[0].categories[1].questions[1].kind = 'shield';
    expect(() => validatePack(pack)).not.toThrow();
  });
});
