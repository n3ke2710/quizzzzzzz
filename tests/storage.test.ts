import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDemoPack } from '../src/data/packs';
import { createSession, reduceGame, toPublicView } from '../src/game/engine';
import type { PublicView, SavedGame } from '../src/game/types';
import { loadPublicView, loadSavedGame, saveGame } from '../src/lib/storage';

describe('durable game and public projection', () => {
  it('restores the committed session and its matching public revision', async () => {
    const pack = createDemoPack();
    let session = createSession();
    session = reduceGame(session, { type: 'ADD_TEAM', name: 'Тестовая команда' }, pack);
    session = reduceGame(session, { type: 'START_ROUND' }, pack);
    const game: SavedGame = { pack, session, history: [] };
    const publicView = toPublicView(session, pack);
    await saveGame(game, publicView);
    expect(await loadSavedGame()).toEqual(game);
    expect(await loadPublicView()).toEqual(publicView);
    expect(JSON.stringify(await loadPublicView())).not.toContain(pack.rounds[0].categories[0].questions[0].answer.text);
  });

  it('aborts both writes if public projection fails to clone after the private write', async () => {
    const pack = createDemoPack();
    const original: SavedGame = { pack, session: createSession(), history: [] };
    const originalView = toPublicView(original.session, pack);
    await saveGame(original, originalView);
    const changed = { ...original, session: { ...original.session, revision: 42 } };
    const malformedView = { ...originalView, revision: 42, uncloneable: () => {} } as unknown as PublicView;
    await expect(saveGame(changed, malformedView)).rejects.toThrow('Действие не применено');
    expect(await loadSavedGame()).toEqual(original);
    expect(await loadPublicView()).toEqual(originalView);
  });
});
