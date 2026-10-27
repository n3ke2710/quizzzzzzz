import type { PublicView, SavedGame } from '../game/types';
import { appNamespace } from './routes';

const DB_NAME = `svoya-igra-local-v1${appNamespace()}`;
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Не удалось открыть хранилище браузера. Разрешите сохранение данных для этого сайта.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Закройте старые окна игры и обновите страницу.')); };
  });
  return database;
}

async function read<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readonly');
    const request = transaction.objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(new Error('Не удалось прочитать сохранённую игру.'));
  });
}

export const loadSavedGame = () => read<SavedGame>('current');
export const loadPublicView = () => read<PublicView>('public');

/** A screen can only see the committed public projection of the same transaction. */
export async function saveGame(game: SavedGame, view: PublicView): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Игра не сохранена: проверьте свободное место и разрешение на хранение данных. Действие не применено.'));
    transaction.onabort = () => reject(new Error('Сохранение прервано. Действие не применено; попробуйте ещё раз.'));
    try {
      transaction.objectStore('state').put(game, 'current');
      transaction.objectStore('state').put(view, 'public');
    } catch {
      transaction.abort();
      reject(new Error('Не удалось сохранить данные. Действие не применено.'));
    }
  });
}
