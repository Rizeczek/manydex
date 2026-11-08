import { useEffect, useRef, useState } from 'preact/hooks';
import terms from '../data/terms.json';
import { rpc } from './api.js';

// Online část: místnost, lobby, odpočet a párování.
// Stav se načítá z databáze každé 2 s (get_room_state); akce jsou samostatné funkce v databázi.

const POLL_MS = 2000;
const CLOCK_MS = 100;
const UNLOCK_POLL_MS = 8000;
const RESULT_MS = 3500;
const COUNTDOWN_MS = 5000;
const SHEET_CLOSE_MS = 260;
const PAIRS_PER_PLAYER = 3;

const termByCode = Object.fromEntries(terms.map((t) => [t.code, t]));

const ERRORS = {
  room_not_found: 'Taková místnost neexistuje. Zkontroluj číslo na Teams.',
  room_full: 'Místnost je plná (4 / 4). Zkontroluj číslo na Teams, nebo napiš facilitátorovi.',
  room_started: 'Hra v této místnosti už začala. Napiš facilitátorovi.',
  already_in_other_room: 'Už jsi v jiné místnosti. Napiš facilitátorovi.',
  not_your_turn: 'Teď hraje někdo jiný.',
  term_not_available: 'Tenhle pojem už na stole není.',
  definition_not_available: 'Tahle definice už na stole není.',
  nothing_selected: 'Vyber pojem i definici.',
};

function errorText(e) {
  return ERRORS[e.message] || 'Něco se nepovedlo. Zkus to znovu.';
}

function initial(nick) {
  return (nick || '?').trim().charAt(0).toUpperCase();
}

function Shell({ nick, label, children }) {
  return (
    <div class="page stack room">
      <div class="topbar">
        <div class="who"><span class="avatar">{initial(nick)}</span>{nick}</div>
        <span class="tag">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Icon({ name }) {
  if (name === 'users') {
    return (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1B4F57" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14c2.4.2 4 1.7 4.5 4" />
      </svg>
    );
  }
  if (name === 'close') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    );
  }
  if (name === 'check') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4.5 4.5L19 7" /></svg>
    );
  }
  if (name === 'arrow') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    );
  }
  return null;
}

export default function Room({ pid, nick, onCheck }) {
  const [data, setData] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const shown = useRef({ init: false, key: null, at: 0 });
  const [sheetTerm, setSheetTerm] = useState(null);
  const [sheetClosing, setSheetClosing] = useState(false);

  async function load() {
    try {
      const d = await rpc('get_room_state', { p_participant: pid });
      setData({ ...d, fetchedAt: Date.now() });
      setOffline(false);
    } catch (e) {
      setOffline(true);
    }
  }

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  const room = data?.room || null;
  const finished = room?.status === 'pairing_done';
  const selTerm = room?.state?.sel_term ?? null;

  // Po skončení hry čekáme, až facilitátor odemkne výstupní test
  useEffect(() => {
    if (!finished) return undefined;
    const t = setInterval(() => onCheck(), UNLOCK_POLL_MS);
    return () => clearInterval(t);
  }, [finished]);

  // Panel s definicemi: při výběru vyjede, po zrušení se zavře (drží obsah, dokud se animace nedoběhne)
  useEffect(() => {
    if (selTerm) {
      setSheetTerm(selTerm);
      setSheetClosing(false);
      return undefined;
    }
    if (sheetTerm) {
      setSheetClosing(true);
      const t = setTimeout(() => {
        setSheetTerm(null);
        setSheetClosing(false);
      }, SHEET_CLOSE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [selTerm]);

  async function act(fn, args = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc(fn, { p_participant: pid, ...args });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function join(ev) {
    ev.preventDefault();
    const code = parseInt(joinCode, 10);
    if (!code || code < 1) {
      setError('Zadej číslo místnosti z Teams.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await rpc('join_room', { p_participant: pid, p_code: code });
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Shell key="loading" nick={nick} label="Online">
        <p class="muted">Připojování…</p>
      </Shell>
    );
  }

  const offlineBanner = offline && (
    <div class="room-banner dark" role="status">
      <span class="small">Připojování… Tvoje hra je uložená, o nic nepřijdeš.</span>
    </div>
  );

  // 1) Ještě nejsi v místnosti: zadání čísla
  if (!room) {
    return (
      <Shell key="join" nick={nick} label="Online">
        {offlineBanner}
        <div class="stack grow room-enter">
          <div class="room-intro">
            <Icon name="users" />
            <h1>Budete rozděleni do skupin na Teams.</h1>
            <p class="muted">Vyčkejte na rozdělení, pak zadejte číslo místnosti.</p>
          </div>
          <form class="stack gap-xs" onSubmit={join}>
            <label class="room-label">
              Číslo místnosti
              <input
                type="text"
                inputmode="numeric"
                class={`room-code${error ? ' bad' : ''}`}
                value={joinCode}
                aria-invalid={error ? 'true' : 'false'}
                onInput={(e) => setJoinCode(e.currentTarget.value)}
              />
            </label>
            {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
            <button type="submit" class="btn secondary" disabled={busy}>Připojit se</button>
          </form>
        </div>
      </Shell>
    );
  }

  const { players = [], me_seat: meSeat } = data;
  const me = players.find((p) => p.seat === meSeat);
  const st = room.state || {};

  // 2) Lobby a odpočet
  if (room.status === 'lobby') {
    if (room.countdown_ms != null) {
      const left = Math.max(0, room.countdown_ms - (now - data.fetchedAt));
      return (
        <Countdown
          key="countdown"
          nick={nick}
          code={room.code}
          players={players}
          left={left}
          busy={busy}
          onCancel={() => act('set_ready', { p_ready: false })}
          error={error}
        />
      );
    }
    const readyCount = players.filter((p) => p.ready).length;
    return (
      <Shell key="lobby" nick={nick} label={`Místnost ${room.code}`}>
        {offlineBanner}
        <div class="stack grow">
          <div class="stack gap-xs">
            <h1>Čekáme na připravenost</h1>
            <p class="muted">Hra začne, až budou připraveni všichni v místnosti (2–4 hráči).</p>
          </div>
          <div class="room-list">
            {players.map((p) => (
              <div class={`room-row${p.ready ? ' ready' : ''}`} key={p.seat}>
                <span class="room-avatar">{initial(p.nickname)}</span>
                <span class="room-who">
                  <span class="room-name">{p.nickname}</span>
                  <span class="room-sub">{p.me ? 'Ty' : 'Připojen/a'}</span>
                </span>
                <span class={`room-badge${p.ready ? ' ready' : ''}`}>{p.ready ? 'Připraven/a ✓' : 'Čeká'}</span>
              </div>
            ))}
          </div>
          <div class="room-count">
            <span class="muted">Připraveno</span>
            <b>{readyCount} / {players.length}</b>
          </div>
        </div>
        {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
        {me?.ready ? (
          <button type="button" class="btn outline" disabled={busy} onClick={() => act('set_ready', { p_ready: false })}>
            Zrušit připravenost
          </button>
        ) : (
          <button type="button" class="btn primary" disabled={busy} onClick={() => act('set_ready', { p_ready: true })}>
            Jsem připraven/a
          </button>
        )}
      </Shell>
    );
  }

  // 3) Hra skončila (konec části B1; Taboo a další části přijdou později)
  if (finished) {
    return (
      <Shell key="finished" nick={nick} label={`Místnost ${room.code}`}>
        <div class="stack grow">
          <div class="stack gap-xs">
            <span class="eyebrow">Párování hotové</span>
            <h1>Hra ve skupině je hotová</h1>
            <p class="muted">Každý má své 3 páry. Čekej na další část. Výstupní test se odemkne, až facilitátor ukončí hru.</p>
          </div>
          <div class="room-players">
            {players.map((p) => (
              <div class="room-player" key={p.seat}>
                <span class="room-name">{p.nickname}</span>
                <span class="room-dots">
                  {[0, 1, 2].map((i) => <span class={`room-dot${i < p.matched ? ' on' : ''}`} key={i} />)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div class="room-note">
          <span class="dot" />
          <span class="small">Telefon teď nepotřebuješ, dokud facilitátor nezačne další část.</span>
        </div>
      </Shell>
    );
  }

  // 4) Párování
  const myMatched = me?.matched ?? 0;
  const myPairs = st.matched.filter((m) => m.seat === meSeat);
  const turnSeat = st.turn_seat;
  const isMyTurn = turnSeat === meSeat;
  const turnPlayer = players.find((p) => p.seat === turnSeat);
  const offPlayers = players.filter((p) => !p.me && !p.connected);

  // Výsledek posledního tahu se ukáže na chvíli všem
  const last = st.last;
  if (!shown.current.init) {
    shown.current = { init: true, key: last?.at ?? null, at: 0 };
  }
  if (last?.kind === 'check' && last.at !== shown.current.key) {
    shown.current = { init: true, key: last.at, at: Date.now() };
  }
  const showResult = last?.kind === 'check' && shown.current.key === last.at && now - shown.current.at < RESULT_MS;

  const boardHeader = (
    <>
      <div class="room-players">
        {players.map((p) => (
          <div class={`room-player${p.seat === turnSeat ? ' turn' : ''}${p.connected ? '' : ' off'}`} key={p.seat}>
            <span class="room-name">{p.me ? `${p.nickname} (ty)` : p.nickname}</span>
            <span class="room-dots">
              {[0, 1, 2].map((i) => <span class={`room-dot${i < p.matched ? ' on' : ''}`} key={i} />)}
            </span>
          </div>
        ))}
      </div>
      {offPlayers.some((p) => p.seat === turnSeat) && (
        <p class="room-hint">{offPlayers.find((p) => p.seat === turnSeat).nickname} se odpojil/a. Když se nevrátí do minuty, jeho tah se přeskočí.</p>
      )}
    </>
  );

  if (showResult) {
    return (
      <Shell key="result" nick={nick} label="Kontrola páru">
        <ResultView last={last} players={players} st={st} />
      </Shell>
    );
  }

  if (myMatched >= PAIRS_PER_PLAYER) {
    return (
      <Shell key="pairdone" nick={nick} label={`Místnost ${room.code}`}>
        {offlineBanner}
        <div class="stack grow">
          <div class="stack gap-xs">
            <h1>Máš hotovo!</h1>
            <p class="muted">Tvoje {PAIRS_PER_PLAYER} páry. Ostatní ještě hrají.</p>
          </div>
          <div class="room-pairs">
            {myPairs.map((m) => (
              <div class="room-pair" key={m.term}>
                <span class="n">{termByCode[m.term].czName}</span>
                <span class="d">{termByCode[m.term].definition}</span>
              </div>
            ))}
          </div>
        </div>
        {boardHeader}
      </Shell>
    );
  }

  if (!isMyTurn) {
    return (
      <Shell key="watch" nick={nick} label={`Místnost ${room.code}`}>
        {offlineBanner}
        {boardHeader}
        <div class="room-banner dark">
          <span class="room-avatar light">{initial(turnPlayer?.nickname)}</span>
          <span class="stack gap-xs">
            <span class="room-banner-title">Hraje {turnPlayer?.nickname}</span>
            <span class="small">
              {st.sel_term
                ? <>Vybral/a <b>{termByCode[st.sel_term].czName}</b> a hledá definici…</>
                : 'Čekej na svůj tah.'}
            </span>
          </span>
        </div>
        <div class="room-tiles">
          {st.terms.map((code) => (
            <div class={`room-tile watch${st.sel_term === code ? ' on' : ''}`} key={code}>{termByCode[code].czName}</div>
          ))}
        </div>
        <p class="room-hint">Ostatní vidí tvůj výběr živě. Domlouvejte se na Teams.</p>
      </Shell>
    );
  }

  // Můj tah
  const sheetOpen = !!selTerm;
  const sheetShown = selTerm || sheetTerm;
  return (
    <Shell key="turn" nick={nick} label={`Místnost ${room.code}`}>
      {offlineBanner}
      {boardHeader}
      <div class="room-banner">
        <span class="room-arrow"><Icon name="arrow" /></span>
        <span class="stack gap-xs">
          <span class="room-banner-title">Tvůj tah</span>
          <span class="small">Vyber pojem, pak k němu definici.</span>
        </span>
      </div>
      <div class="room-tiles">
        {st.terms.map((code) => (
          <button
            type="button"
            class={`room-tile${st.sel_term === code ? ' on' : ''}`}
            key={code}
            disabled={busy}
            onClick={() => act('pick_term', { p_term: code })}
          >
            {termByCode[code].czName}
          </button>
        ))}
      </div>
      {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
      <p class="room-hint">Ostatní vidí tvůj výběr živě. Domlouvejte se na Teams.</p>

      {sheetShown && (
        <div class={`room-sheet-wrap${sheetOpen ? '' : ' closing'}`}>
          <div class="room-sheet" role="dialog" aria-label="Výběr definice">
            <span class="room-grip" />
            <div class="room-sheet-head">
              <span class="stack gap-xs">
                <span class="room-eyebrow">Vybraný pojem</span>
                <span class="room-term">{termByCode[sheetShown].czName}</span>
              </span>
              <button type="button" class="room-x" aria-label="Zrušit výběr" disabled={busy || !sheetOpen} onClick={() => act('clear_selection')}>
                <Icon name="close" />
              </button>
            </div>
            <h2 class="room-sheet-title">Které definici odpovídá?</h2>
            <div class="room-defs">
              {st.defs.map((code) => (
                <button
                  type="button"
                  class={`room-def${st.sel_def === code ? ' on' : ''}`}
                  key={code}
                  disabled={busy || !sheetOpen}
                  onClick={() => act('pick_definition', { p_def: code })}
                >
                  {termByCode[code].definition}
                </button>
              ))}
            </div>
            <button
              type="button"
              class="btn primary"
              disabled={busy || !st.sel_def}
              onClick={() => act('check_pair')}
            >
              Zkontrolovat pár
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Countdown({ nick, code, players, left, busy, onCancel, error }) {
  const secs = Math.max(1, Math.ceil(left / 1000));
  const fraction = Math.min(1, left / COUNTDOWN_MS);
  const dash = Math.round(fraction * 597);
  return (
    <div class="teal full room">
      <div class="topbar light">
        <div class="who light"><span class="avatar cream">{initial(nick)}</span>{nick}</div>
        <span class="tag light-soft">Místnost {code}</span>
      </div>
      <div class="center-col grow">
        <p class="light-soft">Všichni jsou připraveni</p>
        <div class="room-ring">
          <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
            <circle
              cx="100"
              cy="100"
              r="95"
              fill="none"
              stroke="#FDBE1E"
              stroke-width="10"
              stroke-linecap="round"
              style={{ strokeDasharray: `${dash} 597`, transition: 'stroke-dasharray 0.12s linear' }}
              transform="rotate(-90 100 100)"
            />
          </svg>
          <span key={secs} class="room-count-num">{secs}</span>
        </div>
        <h1 class="light">Hra začíná</h1>
        <div class="room-chips">
          {players.map((p) => <span class="room-chip" key={p.seat}>{p.nickname} ✓</span>)}
        </div>
        <p class="light-soft narrow small">Když někdo zruší připravenost nebo se připojí další hráč, odpočet se zastaví.</p>
      </div>
      {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
      <button type="button" class="btn ghost" disabled={busy} onClick={onCancel}>Zrušit připravenost</button>
    </div>
  );
}

function ResultView({ last, players, st }) {
  const ok = last.ok;
  const mover = players.find((p) => p.seat === last.seat);
  const next = players.find((p) => p.seat === st.turn_seat);
  const term = termByCode[last.term];
  const def = termByCode[last.def];
  const total = Math.max(1, st.matched.length + st.terms.length);
  return (
    <div class="stack grow room-result">
      <div class="room-cards">
        <div class="room-card-face">
          <div class="room-card">
            <span class="code">{last.term}</span>
            <span class="txt">{term.czName}</span>
          </div>
          <span class="small muted">Pojem</span>
        </div>
        <div class="room-card-face">
          <div class="room-card">
            <span class="code">{last.def}</span>
            <span class="room-card-def">{def.definition}</span>
          </div>
          <span class="small muted">Definice</span>
        </div>
      </div>
      <div class="stack gap-xs room-result-text">
        <span class={`room-chip-result ${ok ? 'ok' : 'bad'}`}>
          {ok ? <Icon name="check" /> : <span aria-hidden="true">✕</span>}
          {ok ? 'Identifikátory se shodují' : 'Identifikátory se liší'}
        </span>
        <h1>{ok ? 'Pár sedí!' : 'Pár nesedí'}</h1>
        <p class="muted">
          {ok
            ? `${mover?.nickname} má ${mover?.matched ?? 0} ze ${PAIRS_PER_PLAYER} párů.`
            : 'Obě karty se vrací na stůl.'}
        </p>
      </div>
      <div class="stack gap-xs">
        <div class="room-progress"><span style={{ width: `${(st.matched.length / total) * 100}%` }} /></div>
        <p class="room-hint">{next ? `Za chvíli hraje ${next.nickname}.` : 'Hra ve skupině je u konce.'}</p>
      </div>
    </div>
  );
}
