import { useCallback, useEffect, useRef, useState } from 'react';
import { commandLabel, createSession, reduceGame, toPublicView } from '../game/engine';
import type { Command, PublicView, QuizPack, SavedGame } from '../game/types';
import { createDemoPack } from '../data/packs';
import { loadPublicView, loadSavedGame, saveGame } from './storage';
import { appNamespace } from './routes';

const CHANNEL = `svoya-igra:public:v1${appNamespace()}`;
const HOST_LOCK = `svoya-igra:host${appNamespace()}`;
type Message = { type: 'VIEW'; view: PublicView } | { type: 'HELLO' | 'HEARTBEAT' | 'SCREEN_ALIVE' };
function newGame(pack: QuizPack, previous?: SavedGame): SavedGame {
  let session = createSession();
  const teams = previous?.session.teams.length ? previous.session.teams : [
    { name: 'Космонавты', color: '#d8fa72' },
    { name: 'Эрудиты', color: '#b8a0ff' },
    { name: 'Дикие карты', color: '#7eddd3' },
  ];
  for (const team of teams) session = reduceGame(session, { type: 'ADD_TEAM', name: team.name, color: team.color }, pack);
  return { pack, session, history: [] };
}

export function useHostGame() {
  const [game, setGame] = useState<SavedGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [screenConnected, setScreenConnected] = useState(false);
  const current = useRef<SavedGame | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const locked = useRef(false);
  const changing = useRef(false);
  const screenLastSeen = useRef(0);

  useEffect(() => {
    let alive = true;
    let release = () => {};
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (event: MessageEvent<Message>) => {
      if (event.data.type === 'HELLO' || event.data.type === 'SCREEN_ALIVE') {
        screenLastSeen.current = Date.now();
        setScreenConnected(true);
        if (event.data.type === 'HELLO' && current.current && locked.current) bc.postMessage({ type: 'VIEW', view: toPublicView(current.current.session, current.current.pack) });
      }
    };
    const timer = window.setInterval(() => {
      if (locked.current) bc.postMessage({ type: 'HEARTBEAT' });
      setScreenConnected(Date.now() - screenLastSeen.current < 6500);
    }, 2000);
    async function boot() {
      try {
        if (!navigator.locks) throw new Error('Откройте игру в актуальном Chrome: требуется поддержка блокировки пульта.');
        await navigator.locks.request(HOST_LOCK, { ifAvailable: true }, async lock => {
          if (!alive) return;
          locked.current = !!lock;
          setReadOnly(!lock);
          const saved = await loadSavedGame();
          if (!alive) return;
          const initial = saved ?? newGame(createDemoPack());
          if (lock && !saved) await saveGame(initial, toPublicView(initial.session, initial.pack));
          current.current = initial;
          setGame(initial);
          setLoading(false);
          if (!lock) return;
          bc.postMessage({ type: 'VIEW', view: toPublicView(initial.session, initial.pack) });
          await new Promise<void>(resolve => { release = resolve; if (!alive) resolve(); });
          locked.current = false;
        });
      } catch (error) {
        if (alive) { setNotice(error instanceof Error ? error.message : 'Не удалось загрузить игру.'); setLoading(false); }
      }
    }
    void boot();
    return () => { alive = false; release(); window.clearInterval(timer); bc.close(); channel.current = null; };
  }, []);

  const commit = useCallback(async (build: (before: SavedGame) => SavedGame) => {
    if (!locked.current) { setNotice('Другой пульт уже управляет игрой. Закройте его и обновите эту страницу.'); return false; }
    if (changing.current || !current.current) return false;
    changing.current = true;
    setBusy(true);
    try {
      const next = build(current.current);
      const view = toPublicView(next.session, next.pack);
      await saveGame(next, view);
      current.current = next;
      setGame(next);
      channel.current?.postMessage({ type: 'VIEW', view });
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
      return false;
    } finally { changing.current = false; setBusy(false); }
  }, []);

  const act = useCallback(async (command: Command) => { await commit(before => {
    const session = reduceGame(before.session, command, before.pack);
    return { ...before, session, history: [...before.history.slice(-59), { id: crypto.randomUUID(), label: commandLabel(command), at: Date.now(), before: before.session }] };
  }); }, [commit]);
  const undo = useCallback(() => commit(before => {
    const last = before.history.at(-1);
    if (!last) throw new Error('Пока нечего отменять.');
    setNotice(`Отменено: ${last.label.toLowerCase()}`);
    return { ...before, session: { ...last.before, revision: before.session.revision + 1 }, history: before.history.slice(0, -1) };
  }), [commit]);
  const updatePack = useCallback(async (pack: QuizPack) => {
    const saved = await commit(before => ({ ...before, pack, session: { ...before.session, revision: before.session.revision + 1 } }));
    if (!saved) throw new Error('Набор не сохранён. Изменения остались в редакторе; попробуйте сохранить ещё раз.');
  }, [commit]);
  const reset = useCallback((pack: QuizPack) => commit(before => newGame(pack, before)), [commit]);
  return { game, loading, readOnly, busy, notice, setNotice, screenConnected, act, undo, updatePack, reset };
}

export function useProjector() {
  const [view, setView] = useState<PublicView | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    let lastSeen = 0;
    let receivedLive = false;
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (event: MessageEvent<Message>) => {
      if (event.data.type === 'HEARTBEAT' || event.data.type === 'VIEW') {
        lastSeen = Date.now();
        setConnected(true);
      }
      if (event.data.type === 'VIEW') {
        const next = event.data.view;
        receivedLive = true;
        setView(old => old?.sessionId === next.sessionId && old.revision > next.revision ? old : next);
      }
    };
    void loadPublicView().then(saved => { if (alive && saved && !receivedLive) setView(saved); }).catch(() => {});
    bc.postMessage({ type: 'HELLO' });
    const timer = window.setInterval(() => {
      bc.postMessage({ type: 'SCREEN_ALIVE' });
      if (Date.now() - lastSeen > 6500) { setConnected(false); bc.postMessage({ type: 'HELLO' }); }
    }, 2000);
    return () => { alive = false; bc.close(); window.clearInterval(timer); };
  }, []);
  return { view, connected };
}
