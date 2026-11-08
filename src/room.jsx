import { useEffect, useRef, useState } from 'preact/hooks';
import terms from '../data/terms.json';
import scenarios from '../data/scenarios.json';
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
  slot_taken: 'Tenhle slot už někdo obsadil. Vyber jiný.',
  slot_not_available: 'Tenhle slot v této hře nepoužíváme.',
  not_your_card: 'Tuhle kartu nemáš v ruce.',
  already_placed: 'Tuhle kartu už máš umístěnou.',
  not_scenarios: 'Scénáře teď neběží.',
};

function errorText(e) {
  return ERRORS[e.message] || 'Něco se nepovedlo. Zkus to znovu.';
}

function initial(nick) {
  return (nick || '?').trim().charAt(0).toUpperCase();
}

function Shell({ nick, label, onSkip, children }) {
  return (
    <div class="page stack room">
      <div class="topbar">
        <div class="who"><span class="avatar">{initial(nick)}</span>{nick}</div>
        <span class="tag">{label}</span>
      </div>
      {children}
      {onSkip && (
        <button type="button" class="skip-btn" onClick={onSkip}>SKIP</button>
      )}
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
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [slotPick, setSlotPick] = useState(null);
  const [cardPick, setCardPick] = useState(null);

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
  const finished = room?.status === 'defence_done';
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

  // Dočasně pro testování: rozdá zbylé karty přítomným hráčům a ukončí párování
  function skipPairing() {
    act('skip_pairing');
  }

  // Dočasně pro testování: ukončí Taboo
  function skipTaboo() {
    act('skip_taboo');
  }

  // Dočasně pro testování: ukončí scénáře
  function skipScenarios() {
    act('skip_scenarios');
  }

  // Dočasně pro testování: ukončí obhajobu
  function skipDefence() {
    act('skip_defence');
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

  // 3) Taboo: příprava a vysvětlování
  if (room.status === 'taboo_ready') {
    const readyCount = players.filter((p) => p.ready).length;
    return (
      <Shell key="tabooReady" nick={nick} onSkip={skipTaboo} label={`Místnost ${room.code}`}>
        {offlineBanner}
        <div class="stack grow">
          <div class="stack gap-xs">
            <span class="eyebrow">Taboo</span>
            <h1>Pairing je hotový</h1>
            <p class="muted">Každý teď vysvětlí svoje 3 pojmy, aniž by řekl zakázaná slova. Začnete, až budou připraveni všichni.</p>
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
          <button type="button" class="btn outline" disabled={busy} onClick={() => act('set_taboo_ready', { p_ready: false })}>
            Zrušit připravenost
          </button>
        ) : (
          <button type="button" class="btn primary" disabled={busy} onClick={() => act('set_taboo_ready', { p_ready: true })}>
            Jsem připraven/a
          </button>
        )}
      </Shell>
    );
  }

  if (room.status === 'taboo') {
    const queue = st.queue || [];
    const i = st.taboo_i ?? 0;
    const cur = queue[i];
    const curSeat = cur?.seat;
    const explainer = players.find((p) => p.seat === curSeat);
    const mine = curSeat === meSeat;
    const total = queue.filter((q) => q.seat === curSeat).length;
    const idx = queue.slice(0, i + 1).filter((q) => q.seat === curSeat).length;
    const isLast = idx === total;
    const term = termByCode[cur.term];

    if (mine) {
      return (
        <Shell key="tabooExplain" nick={nick} onSkip={skipTaboo} label="Taboo">
          {offlineBanner}
          <div class="room-taboo-head">
            <div class="stack gap-xs">
              <span class="room-eyebrow room-eyebrow-teal">Vysvětluješ ty</span>
              <h1 class="room-taboo-title">Pojem {idx} ze {total}</h1>
            </div>
            <div class="room-segments">
              {Array.from({ length: total }, (_, j) => (
                <span key={j} class={`room-seg${j < idx - 1 ? ' done' : j === idx - 1 ? ' now' : ''}`} />
              ))}
            </div>
          </div>
          <div class="room-taboo-card">
            <h2>{term.czName}</h2>
            <p>{term.definition}</p>
          </div>
          <div class="stack gap-xs">
            <h3 class="room-sub-title">Nesmíš říct</h3>
            <div class="room-taboo-words">
              {term.taboo.map((w) => <span key={w}>{w}</span>)}
            </div>
          </div>
          <p class="room-hint">Vysvětli pojem vlastními slovy a přidej příklad z praxe. Ostatní ho vidí jen jako název.</p>
          {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
          <button type="button" class="btn primary" disabled={busy} onClick={() => act('taboo_next')}>
            {isLast ? 'Hotovo' : 'Další pojem'}
          </button>
        </Shell>
      );
    }

    const order = [];
    queue.forEach((q) => {
      if (!order.includes(q.seat)) order.push(q.seat);
    });
    const lastIdx = {};
    queue.forEach((q, k) => {
      lastIdx[q.seat] = k;
    });
    return (
      <Shell key="tabooListen" nick={nick} onSkip={skipTaboo} label="Taboo">
        {offlineBanner}
        <div class="room-listen">
          <span class="room-listen-avatar">{initial(explainer?.nickname)}</span>
          <h1 class="room-taboo-title">{explainer?.nickname} vysvětluje</h1>
          <p class="muted">pojem {idx} ze {total}</p>
          <span class="room-term room-term-big">{term.czName}</span>
          <p class="room-hint">Poslouchej na Teams. Nesedí ti vysvětlení? Zeptej se, dokud mu nerozumíte všichni.</p>
        </div>
        <div class="stack gap-xs">
          <h2 class="room-sub-title">Pořadí</h2>
          <div class="room-order">
            {order.map((seat) => {
              const p = players.find((x) => x.seat === seat);
              const stateName = seat === curSeat ? 'now' : lastIdx[seat] < i ? 'done' : 'next';
              const label = stateName === 'now' ? 'vysvětluje' : stateName === 'done' ? 'hotovo' : 'další';
              return (
                <div class={`room-order-item ${stateName}`} key={seat}>
                  <span class="room-name">{p?.nickname}</span>
                  <span class="room-sub">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Shell>
    );
  }

  // 4) Scénáře: příprava a umísťování karet do slotů
  if (room.status === 'scenarios_ready') {
    return (
      <ReadyScreen
        key="scenariosReady"
        nick={nick}
        label={`Místnost ${room.code}`}
        eyebrow="Scénáře"
        title="Taboo je za vámi"
        text="Teď umístíte své karty do scénářů. Každý má 3 karty a do jednoho slotu patří jen jedna. Začnete, až budou připraveni všichni."
        players={players}
        me={me}
        busy={busy}
        error={error}
        onReady={(v) => act('set_scenario_ready', { p_ready: v })}
        onSkip={skipScenarios}
        offlineBanner={offlineBanner}
      />
    );
  }

  if (room.status === 'scenarios') {
    return (
      <ScenarioPlay
        nick={nick}
        room={room}
        players={players}
        st={st}
        meSeat={meSeat}
        busy={busy}
        error={error}
        act={act}
        offlineBanner={offlineBanner}
        onSkip={skipScenarios}
        scenarioIdx={scenarioIdx}
        setScenarioIdx={setScenarioIdx}
        slotPick={slotPick}
        setSlotPick={setSlotPick}
        cardPick={cardPick}
        setCardPick={setCardPick}
      />
    );
  }

  // 5) Obhajoba: příprava a hlasování o umístěných kartách
  if (room.status === 'defence_ready') {
    return (
      <ReadyScreen
        key="defenceReady"
        nick={nick}
        label={`Místnost ${room.code}`}
        eyebrow="Obhajoba"
        title="Scénáře jsou hotové"
        text="Každý z vás obhájí své umístění. Ostatní hlasují, jestli karta sedí. Začnete, až budou připraveni všichni."
        players={players}
        me={me}
        busy={busy}
        error={error}
        onReady={(v) => act('set_defence_ready', { p_ready: v })}
        onSkip={skipDefence}
        offlineBanner={offlineBanner}
      />
    );
  }

  if (room.status === 'defence') {
    return (
      <DefenceView
        nick={nick}
        room={room}
        players={players}
        st={st}
        votes={data.votes || []}
        meSeat={meSeat}
        busy={busy}
        error={error}
        act={act}
        offlineBanner={offlineBanner}
        onSkip={skipDefence}
      />
    );
  }

  // 6) Obhajoba hotová (konec zatím hotové části; další části přijdou později)
  if (finished) {
    return (
      <Shell key="finished" nick={nick} label={`Místnost ${room.code}`}>
        <div class="stack grow">
          <div class="stack gap-xs">
            <span class="eyebrow">Obhajoba hotová</span>
            <h1>Skvělá práce</h1>
            <p class="muted">Další část připravujeme. Výstupní test se odemkne, až facilitátor ukončí hru.</p>
          </div>
        </div>
        <div class="room-note">
          <span class="dot" />
          <span class="small">Telefon teď nepotřebuješ, dokud facilitátor nezačne další část.</span>
        </div>
      </Shell>
    );
  }

  if (room.status !== 'pairing') {
    return (
      <Shell key="wait" nick={nick} label={`Místnost ${room.code}`}>
        <p class="muted">Připojování…</p>
      </Shell>
    );
  }

  // 6) Párování
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

  // Ostatní hráči vidí jen krátké hlášení o výsledku, velkou obrazovku má jen ten, kdo pár zkontroloval
  const mover = last ? players.find((p) => p.seat === last.seat) : null;
  const flash = showResult && last.seat !== meSeat ? (
    <div class={`room-flash ${last.ok ? 'ok' : 'bad'}`} role="status">
      <span class="room-flash-icon">{last.ok ? <Icon name="check" /> : '✕'}</span>
      <span>{mover?.nickname}: {last.ok ? 'správný pár.' : 'špatný pár, karty se vracejí na stůl.'}</span>
    </div>
  ) : null;

  const boardHeader = (
    <>
      {flash}
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

  if (showResult && last.seat === meSeat) {
    return (
      <Shell key="result" nick={nick} onSkip={skipPairing} label="Kontrola páru">
        <ResultView last={last} players={players} st={st} />
      </Shell>
    );
  }

  if (myMatched >= PAIRS_PER_PLAYER) {
    return (
      <Shell key="pairdone" nick={nick} onSkip={skipPairing} label={`Místnost ${room.code}`}>
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
      <Shell key="watch" nick={nick} onSkip={skipPairing} label={`Místnost ${room.code}`}>
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
    <Shell key="turn" nick={nick} onSkip={skipPairing} label={`Místnost ${room.code}`}>
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

// ---------- Scénáře ----------

const POS_LABEL = { left: 'vlevo', middle: 'uprostřed', right: 'vpravo' };

function slotsFor(code) {
  const sc = scenarios.scenarios.find((x) => x.code === code);
  return ['left', 'middle', 'right'].map((pos) => ({ pos, key: `${code}:${pos}`, term: sc.slots[pos] }));
}

function ReadyScreen({ nick, label, eyebrow, title, text, players, me, busy, error, onReady, onSkip, offlineBanner }) {
  const readyCount = players.filter((p) => p.ready).length;
  return (
    <Shell key="ready" nick={nick} onSkip={onSkip} label={label}>
      {offlineBanner}
      <div class="stack grow">
        <div class="stack gap-xs">
          <span class="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p class="muted">{text}</p>
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
        <button type="button" class="btn outline" disabled={busy} onClick={() => onReady(false)}>Zrušit připravenost</button>
      ) : (
        <button type="button" class="btn primary" disabled={busy} onClick={() => onReady(true)}>Jsem připraven/a</button>
      )}
    </Shell>
  );
}

function ScenarioPlay({
  nick, room, players, st, meSeat, busy, error, act, offlineBanner, onSkip,
  scenarioIdx, setScenarioIdx, slotPick, setSlotPick, cardPick, setCardPick,
}) {
  const pack = st.pack || [];
  const placements = st.placements || {};
  const sc = scenarios.scenarios[scenarioIdx];
  const slots = slotsFor(sc.code);
  const placedTotal = Object.keys(placements).length;
  const myMatched = st.matched.filter((m) => m.seat === meSeat).map((m) => m.term);
  const myPlaced = Object.entries(placements).filter(([, p]) => p.seat === meSeat);
  const hand = myMatched.filter((t) => !myPlaced.some(([, p]) => p.term === t));
  const doneCount = players.filter((p) => Object.values(placements).filter((x) => x.seat === p.seat).length >= p.matched).length;

  function closePick() {
    setSlotPick(null);
    setCardPick(null);
  }

  function placeHere() {
    const key = slotPick;
    const term = cardPick;
    closePick();
    act('scenario_place', { p_slot: key, p_term: term });
  }

  return (
    <Shell key="scenarioPlay" nick={nick} onSkip={onSkip} label={`Scénáře · ${placedTotal} / ${pack.length} umístěno`}>
      {offlineBanner}
      <div class="room-tabs">
        {scenarios.scenarios.map((s, j) => {
          const sl = slotsFor(s.code);
          const present = sl.filter((x) => pack.includes(x.term)).length;
          const placed = sl.filter((x) => placements[x.key]).length;
          return (
            <button type="button" key={s.code} class={`room-tab${j === scenarioIdx ? ' on' : ''}`} onClick={() => setScenarioIdx(j)}>
              <span class="room-tab-num">{j + 1}</span>
              <span class="room-tab-count">{placed} / {present}</span>
            </button>
          );
        })}
      </div>

      <div class="stack gap-xs">
        <span class="eyebrow">Scénář {scenarioIdx + 1}</span>
        <h1 class="room-scenario-title">{sc.name_cs}</h1>
      </div>

      <div class="room-scenario-art">
        <img class="room-scenario-img" src={`assets/scenario-${sc.code}.svg`} alt={sc.name_cs} />
        <div class="room-slots">
          {slots.map((s) => {
            if (!pack.includes(s.term)) {
              return <div class="room-slot off" key={s.key}><span class="room-slot-note">Nepoužito</span></div>;
            }
            const p = placements[s.key];
            if (p) {
              const owner = p.seat === meSeat ? 'Ty' : players.find((x) => x.seat === p.seat)?.nickname;
              return (
                <div class={`room-slot taken${p.seat === meSeat ? ' mine' : ''}`} key={s.key}>
                  <span class="room-slot-who">{owner}</span>
                  <span class="room-slot-term">{termByCode[p.term].czName}</span>
                </div>
              );
            }
            return (
              <button
                type="button"
                class="room-slot free"
                key={s.key}
                disabled={busy || hand.length === 0}
                onClick={() => {
                  setSlotPick(s.key);
                  setCardPick(null);
                }}
              >
                <span class="room-slot-plus">+ Vybrat kartu</span>
              </button>
            );
          })}
        </div>
      </div>

      {myPlaced.filter(([k]) => k.startsWith(`${sc.code}:`)).map(([k, p]) => (
        <button type="button" class="room-takeback" key={k} disabled={busy} onClick={() => act('scenario_take', { p_slot: k })}>
          Vzít „{termByCode[p.term].czName}“ zpět do ruky
        </button>
      ))}

      {error && <div class="room-alert" role="alert"><b>{error}</b></div>}

      <div class="room-note">
        <span class="dot" />
        <span class="small">
          {hand.length > 0
            ? `Umístil(a) jsi ${myPlaced.length} z ${myMatched.length} karet. Klepni na volný slot.`
            : `Všechny tvoje karty jsou umístěné. Čekáme na ostatní (${doneCount} / ${players.length}). Do té doby můžeš karty přesouvat.`}
        </span>
      </div>

      {slotPick && (
        <div class="room-sheet-wrap">
          <div class="room-sheet" role="dialog" aria-label="Výběr karty do slotu">
            <span class="room-grip" />
            <div class="room-sheet-head">
              <span class="stack gap-xs">
                <span class="room-eyebrow">{sc.name_cs} · {POS_LABEL[slotPick.split(':')[1]]}</span>
                <h2 class="room-sheet-title">Kterou kartu sem dáš?</h2>
              </span>
              <button type="button" class="room-x" aria-label="Zavřít" onClick={closePick}>
                <Icon name="close" />
              </button>
            </div>
            <div class="room-defs">
              {hand.map((t) => (
                <button type="button" key={t} class={`room-def${cardPick === t ? ' on' : ''}`} onClick={() => setCardPick(t)}>
                  <span class="room-def-name">{termByCode[t].czName}</span>
                  <span class="room-def-text">{termByCode[t].definition}</span>
                </button>
              ))}
            </div>
            <button type="button" class="btn primary" disabled={busy || !cardPick} onClick={placeHere}>
              Umístit sem
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// Obhajoba: obhajující hráč vysvětlí umístění, ostatní hlasují, pak se ukáže správné místo
function DefenceView({ nick, players, st, votes, meSeat, busy, error, act, offlineBanner, onSkip }) {
  const items = st.def_items || [];
  const i = st.def_i ?? 0;
  const item = items[i];
  const phase = st.def_phase;
  const pack = st.pack || [];
  const placements = st.placements || {};
  const owner = players.find((p) => p.seat === item.seat);
  const amOwner = item.seat === meSeat;
  const code = item.key.split(':')[0];
  const slots = slotsFor(code);
  const correct = slots.find((s) => s.term === item.term);
  const isCorrect = correct?.key === item.key;
  const voters = players.filter((p) => p.seat !== item.seat);
  const myVote = votes.find((v) => v.seat === meSeat);
  const agree = votes.filter((v) => v.agree).length;
  const disagree = votes.length - agree;
  const nextItem = items[i + 1];
  const nextOwner = nextItem ? players.find((p) => p.seat === nextItem.seat) : null;
  const sc = scenarios.scenarios.find((x) => x.code === code);

  function renderSlot(s) {
    if (!pack.includes(s.term)) {
      return <div class="room-slot off" key={s.key}><span class="room-slot-note">Nepoužito</span></div>;
    }
    if (phase === 'defend' && s.key === item.key) {
      return (
        <div class="room-slot target" key={s.key}>
          <span class="room-slot-who">{owner?.nickname}</span>
          <span class="room-slot-term">?</span>
        </div>
      );
    }
    if (phase === 'reveal' && correct && s.key === correct.key) {
      return (
        <div class="room-slot correct" key={s.key}>
          <span class="room-slot-who">{isCorrect ? 'Správně' : 'Patří sem'}</span>
          <span class="room-slot-term">{termByCode[item.term].czName}</span>
        </div>
      );
    }
    const p = placements[s.key];
    if (p) {
      const who = p.seat === meSeat ? 'Ty' : players.find((x) => x.seat === p.seat)?.nickname;
      return (
        <div class="room-slot taken" key={s.key}>
          <span class="room-slot-who">{who}</span>
          <span class="room-slot-term">{termByCode[p.term].czName}</span>
        </div>
      );
    }
    return <div class="room-slot off" key={s.key}><span class="room-slot-note">Volný</span></div>;
  }

  return (
    <Shell key={`def-${i}-${phase}`} nick={nick} onSkip={onSkip} label={`Obhajoba · ${i + 1} / ${items.length}`}>
      {offlineBanner}
      <div class="room-banner">
        <span class="room-avatar">{initial(owner?.nickname)}</span>
        <span class="stack gap-xs">
          <span class="room-banner-title">{amOwner ? 'Obhajuješ ty' : `Obhajuje ${owner?.nickname}`}</span>
          <span class="small">Pojem: <b>{termByCode[item.term].czName}</b></span>
        </span>
      </div>

      {phase === 'defend' ? (
        <h2 class="room-sheet-title">Proč patří {termByCode[item.term].czName} právě sem?</h2>
      ) : (
        <div class="room-pair">
          <span class="n">{isCorrect ? 'Správně umístěno' : 'Patří jinam'}</span>
          <span class="d">{termByCode[item.term].czName}. Skupina souhlasila {agree} : {disagree}.</span>
        </div>
      )}

      <div class="room-scenario-art">
        <img class="room-scenario-img" src={`assets/scenario-${code}.svg`} alt={sc.name_cs} />
        <div class="room-slots">{slots.map(renderSlot)}</div>
      </div>

      {error && <div class="room-alert" role="alert"><b>{error}</b></div>}

      {phase === 'defend' && !amOwner && (
        <>
          <div class="room-defs">
            <button
              type="button"
              class={`room-def${myVote && !myVote.agree ? ' on' : ''}`}
              disabled={busy}
              onClick={() => act('defence_vote', { p_agree: false })}
            >
              <span class="room-def-name">Nesouhlasím</span>
            </button>
            <button
              type="button"
              class={`room-def${myVote && myVote.agree ? ' on' : ''}`}
              disabled={busy}
              onClick={() => act('defence_vote', { p_agree: true })}
            >
              <span class="room-def-name">Souhlasím</span>
            </button>
          </div>
          <p class="room-hint">Hlasovali {votes.length} ze {voters.length} · pak se ukáže správné umístění</p>
        </>
      )}

      {phase === 'defend' && amOwner && (
        <p class="room-hint">Vysvětli nahlas na Teams, proč karta patří sem. Ostatní hlasují. Hlasovali {votes.length} ze {voters.length}.</p>
      )}

      {phase === 'reveal' && (
        <>
          {amOwner ? (
            <button type="button" class="btn primary" disabled={busy} onClick={() => act('defence_next')}>
              {nextItem
                ? (nextOwner?.seat === meSeat ? 'Další: obhajuješ ty' : `Další: obhajuje ${nextOwner?.nickname}`)
                : 'Dokončit obhajobu'}
            </button>
          ) : null}
          <p class="room-hint">
            {amOwner ? 'Pokračuje se automaticky za 5 s, když nic nestiskneš.' : 'Pokračuje se automaticky za 5 s.'}
          </p>
        </>
      )}
    </Shell>
  );
}
