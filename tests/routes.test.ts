import { describe, expect, it } from 'vitest';
import { appNamespace, appUrl, resolveAppRoute } from '../src/lib/routes';

describe('локальные адреса', () => {
  it('сохраняет существующие адреса и имена хранилища, канала и блокировки', () => {
    expect(appUrl('host', '/')).toBe('/host');
    expect(appUrl('screen', '/')).toBe('/screen');
    expect(resolveAppRoute('/host', '', '/')).toBe('host');
    expect(resolveAppRoute('/screen/', '', '/')).toBe('screen');
    expect(resolveAppRoute('/', '#/screen', '/')).toBe('host');
    const suffix = appNamespace('/');
    expect(`svoya-igra-local-v1${suffix}`).toBe('svoya-igra-local-v1');
    expect(`svoya-igra:public:v1${suffix}`).toBe('svoya-igra:public:v1');
    expect(`svoya-igra:host${suffix}`).toBe('svoya-igra:host');
  });
});

describe('статический сайт проекта', () => {
  const base = '/quizzzzzzz/';

  it('открывает оба экрана внутри базового пути и канонизирует старт без серверного маршрута', () => {
    expect(appUrl('host', base)).toBe('/quizzzzzzz/#/host');
    expect(appUrl('screen', base)).toBe('/quizzzzzzz/#/screen');
    const initial = resolveAppRoute('/quizzzzzzz/', '', base);
    expect(initial).toBe('host');
    expect(appUrl(initial, base)).toBe('/quizzzzzzz/#/host');
  });

  it('после обновления распознаёт экран по hash, не отправляя /screen на сервер', () => {
    const url = new URL(appUrl('screen', base), 'https://n3ke2710.github.io');
    expect(url.pathname).toBe('/quizzzzzzz/');
    expect(resolveAppRoute(url.pathname, url.hash, base)).toBe('screen');
    expect(resolveAppRoute('/quizzzzzzz/', '#/host', base)).toBe('host');
    expect(resolveAppRoute('/quizzzzzzz/', '#/screen/', base)).toBe('screen');
    expect(resolveAppRoute('/quizzzzzzz/', '#/unknown', base)).toBe('host');
  });

  it('разделяет данные, синхронизацию и блокировки разных проектов одного origin', () => {
    const first = appNamespace(base);
    const second = appNamespace('/another-quiz/');
    expect(first).toBe(':%2Fquizzzzzzz%2F');
    expect(first).not.toBe(second);
    expect(first).not.toBe(appNamespace('/'));
    for (const name of ['svoya-igra-local-v1', 'svoya-igra:public:v1', 'svoya-igra:host']) {
      expect(`${name}${first}`).not.toBe(`${name}${second}`);
    }
  });

  it('одинаково нормализует base с завершающим слешем и без него', () => {
    expect(appUrl('screen', '/quizzzzzzz')).toBe(appUrl('screen', base));
    expect(appNamespace('/quizzzzzzz')).toBe(appNamespace(base));
    expect(resolveAppRoute('/quizzzzzzz/', '#/screen', '/quizzzzzzz')).toBe('screen');
  });
});
