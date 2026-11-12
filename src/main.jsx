import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import terms from '../data/terms.json';
import tests from '../data/tests.json';
import { rpc } from './api.js';
import Room from './room.jsx';
import Admin from './admin.jsx';
import Evaluation, { evalItems } from './evaluation.jsx';
import './styles.css';

const PID_KEY = 'manydex_pid';
const NICK_KEY = 'manydex_nick';
const TIMER_MS = 7 * 60 * 1000;
const POLL_MS = 8000;
const UNKNOWN = '?';

const MODE_LABEL = { onsite: 'Na místě', online: 'Online' };

function progressLabel(s) {
  if (!s.pre_done) return 'vstupní test';
  if (!s.priming_done) return 'karty pojmů';
  if (s.post_done) return 'hotovo';
  return 'výstupní test';
}

// Kam má student jít podle uloženého stavu
function nextView(s) {
  if (!s.pre_done) return 'pretestIntro';
  if (!s.priming_done) return 'primingIntro';
  if (s.post_done) return 'done';
  if (s.post_answered) return 'evalIntro';
  if (s.post_unlocked) return 'postIntro';
  return s.mode === 'online' ? 'room' : 'waiting';
}

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function initial(nick) {
  return (nick || '?').trim().charAt(0).toUpperCase();
}

// ---------- Kořenová komponenta ----------

function App() {
  const [view, setView] = useState('loading');
  const [pid, setPid] = useState(localStorage.getItem(PID_KEY));
  const [nick, setNick] = useState(localStorage.getItem(NICK_KEY) || '');
  const [st, setSt] = useState(null);
  const [viewed, setViewed] = useState(0);
  const [error, setError] = useState('');

  async function refresh(id) {
    const rows = await rpc('get_state', { p_id: id });
    if (!rows || !rows.length) {
      const e = new Error('unknown');
      e.unknown = true;
      throw e;
    }
    setSt(rows[0]);
    return rows[0];
  }

  // Po každém kroku načti stav ze serveru a přepni obrazovku
  async function advance(id = pid) {
    setError('');
    try {
      const s = await refresh(id);
      setView(nextView(s));
    } catch (e) {
      setError('Připojení se nepovedlo. Zkus to znovu.');
    }
  }

  async function startWith(id, name) {
    localStorage.setItem(PID_KEY, id);
    localStorage.setItem(NICK_KEY, name);
    setPid(id);
    setNick(name);
    await advance(id);
  }

  useEffect(() => {
    if (!pid) {
      setView('intro');
      return;
    }
    refresh(pid)
      .then((s) => setView(nextView(s)))
      .catch((e) => {
        if (e.unknown) {
          localStorage.removeItem(PID_KEY);
          setPid(null);
          setView('intro');
        } else {
          setError('Připojení se nepovedlo. Obnov stránku.');
          setView('intro');
        }
      });
  }, []);

  const bar = (label) => <TopBar nick={nick} label={label} />;

  return (
    <main class="app">
      {error && <p class="error">{error}</p>}

      {view === 'loading' && <p class="muted pad">Připojování…</p>}

      {view === 'intro' && (
        <Main onStart={() => setView('mode')} />
      )}

      {view === 'mode' && (
        <Mode
          onConfirm={async (name, mode) => {
            setError('');
            try {
              const id = await rpc('create_participant', { p_nickname: name, p_mode: mode });
              await startWith(id, name);
            } catch (e) {
              setError('Něco se nepovedlo. Zkus to znovu.');
            }
          }}
          onRecover={() => setView('recover')}
        />
      )}

      {view === 'recover' && (
        <Recover onPick={startWith} onBack={() => setView('mode')} />
      )}

      {view === 'pretestIntro' && (
        <div class="page stack">
          {bar('Vstupní test')}
          <div class="stack grow">
            <span class="eyebrow">Než začneme</span>
            <h1>12 otázek, žádné známkování</h1>
            <ul class="tips">
              <li><Icon name="chart" /><span>Měříme, co víš teď, ještě před hrou. Nejde o tvoje hodnocení.</span></li>
              <li><Icon name="help" /><span>Když odpověď neznáš, zvol <b>Nevím / Neznám</b>. Hádání zkresluje výsledky.</span></li>
              <li><Icon name="eye" /><span>Správné odpovědi se během testu nezobrazují.</span></li>
            </ul>
          </div>
          <button type="button" class="btn secondary" onClick={() => setView('pretest')}>Začít test</button>
        </div>
      )}

      {view === 'pretest' && (
        <Quiz
          kind="pre"
          skippable
          label="Vstupní test"
          questions={tests.pre_test.questions}
          nick={nick}
          onDone={async (answers) => {
            setError('');
            try {
              await rpc('save_test_answers', { p_id: pid, p_test: 'pre', p_answers: answers });
              await rpc('save_progress', { p_id: pid, p_step: 'pre_done' });
              await advance();
            } catch (e) {
              setError('Odpovědi se nepodařilo uložit. Zkus to znovu.');
            }
          }}
        />
      )}

      {view === 'primingIntro' && (
        <div class="page stack">
          {bar('Karty pojmů')}
          <div class="stack grow">
            <span class="eyebrow">Seznam se s pojmy</span>
            <h1>12 karet, 7 minut</h1>
            <p>Projdeš karty s pojmy a jejich definicemi. Listuj přejetím prstem nebo tlačítky Zpět a Další. Až budeš hotový, klepni na Mám hotovo.</p>
          </div>
          <button
            type="button"
            class="btn secondary"
            onClick={async () => {
              setError('');
              try {
                await rpc('save_progress', { p_id: pid, p_step: 'priming_started' });
                await refresh(pid);
                setView('priming');
              } catch (e) {
                setError('Nepodařilo se spustit časovač. Zkus to znovu.');
              }
            }}
          >
            Začít
          </button>
        </div>
      )}

      {view === 'priming' && st?.priming_started_at && (
        <Priming
          nick={nick}
          startedAt={st.priming_started_at}
          onTimeUp={(n) => {
            setViewed(n);
            setView('timeup');
          }}
          onDone={() => finishPriming(setError, pid, advance)}
        />
      )}

      {view === 'timeup' && (
        <TimeUp
          count={viewed}
          nick={nick}
          onNext={() => finishPriming(setError, pid, advance)}
        />
      )}

      {view === 'waiting' && (
        <Waiting mode={st?.mode} onCheck={() => advance()} nick={nick} />
      )}

      {view === 'room' && (
        <Room pid={pid} nick={nick} onFinished={() => setView('postIntro')} />
      )}

      {view === 'postIntro' && (
        <div class="page stack">
          {bar('Výstupní test')}
          <div class="stack grow">
            <span class="eyebrow">Hra dokončena</span>
            <h1>Poslední krok: výstupní test</h1>
            <p>12 otázek, stejných jako na začátku. Odpovídej podle toho, co víš teď. Když si nejsi jistý(á), zvol Nevím.</p>
          </div>
          <button type="button" class="btn secondary" onClick={() => setView('post')}>Začít test</button>
        </div>
      )}

      {view === 'post' && (
        <Quiz
          kind="post"
          label="Výstupní test"
          questions={tests.post_test.questions}
          nick={nick}
          onDone={async (answers) => {
            setError('');
            try {
              await rpc('save_test_answers', { p_id: pid, p_test: 'post', p_answers: answers });
              setView('evalIntro');
            } catch (e) {
              setError('Odpovědi se nepodařilo uložit. Zkus to znovu.');
            }
          }}
        />
      )}

      {view === 'evalIntro' && (
        <div class="page stack">
          {bar('Hodnocení hry')}
          <div class="stack grow">
            <span class="eyebrow">Výstupní test hotový</span>
            <h1>Ještě krátké hodnocení hry</h1>
            <p>{evalItems(st?.mode).length} otázek, zabere to asi 4 minuty. Většinou odpovídáš na škále 1 až 5. Poslední tři otázky jsou nepovinné.</p>
          </div>
          <button type="button" class="btn secondary" onClick={() => setView('eval')}>Začít hodnocení</button>
        </div>
      )}

      {view === 'eval' && (
        <Evaluation
          mode={st?.mode}
          topBar={bar('Hodnocení hry')}
          skippable
          onDone={async (answers) => {
            setError('');
            try {
              await rpc('save_test_answers', { p_id: pid, p_test: 'eval', p_answers: answers });
              await rpc('save_progress', { p_id: pid, p_step: 'post_done' });
              await advance();
            } catch (e) {
              setError('Odpovědi se nepodařilo uložit. Zkus to znovu.');
            }
          }}
        />
      )}

      {view === 'done' && (
        <div class="teal full">
          <div class="center-col grow">
            <img src="assets/logomark.svg" alt="" class="logomark-big" />
            <h1 class="light">Hotovo, díky!</h1>
            <p class="light-soft">Tvoje odpovědi jsou uložené. Můžeš zavřít stránku.</p>
          </div>
          <img src="assets/logotyp.svg" alt="Manydex" class="logotyp-small" />
        </div>
      )}
    </main>
  );
}

async function finishPriming(setError, pid, advance) {
  setError('');
  try {
    await rpc('save_progress', { p_id: pid, p_step: 'priming_done' });
    await advance();
  } catch (e) {
    setError('Nepodařilo se uložit. Zkus to znovu.');
  }
}

// ---------- Drobné komponenty ----------

function Icon({ name }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  if (name === 'chart') return <svg {...common}><path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" /></svg>;
  if (name === 'help') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17.5h.01" /></svg>;
  if (name === 'eye') return <svg {...common}><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><path d="M4 4l16 16" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>;
  if (name === 'back') return <svg {...common}><path d="M15 6l-6 6 6 6" /></svg>;
  if (name === 'phone') return <svg {...common}><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>;
  if (name === 'desk') return <svg {...common}><rect x="3" y="4" width="8" height="11" rx="1.5" /><rect x="13" y="9" width="8" height="11" rx="1.5" /></svg>;
  return null;
}

function TopBar({ nick, label }) {
  return (
    <div class="topbar">
      <div class="who"><span class="avatar">{initial(nick)}</span>{nick}</div>
      <span class="tag">{label}</span>
    </div>
  );
}

// ---------- Úvod ----------

function Main({ onStart }) {
  return (
    <div class="teal full">
      <div class="center-col grow">
        <img src="assets/logo.svg" alt="Manydex" class="logo-big" />
        <p class="subtitle">Hra o pojmech z UX designu</p>
        <p class="light-soft narrow">Na začátku si zvolíš přezdívku. Pod ní tě uvidí spoluhráči a propojí se tvoje testy.</p>
      </div>
      <div class="stack">
        <button type="button" class="btn cream" onClick={onStart}>Start</button>
      </div>
    </div>
  );
}

// ---------- Přezdívka a režim ----------

function Mode({ onConfirm, onRecover }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('onsite');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    await onConfirm(name.trim(), mode);
    setBusy(false);
  }

  return (
    <form class="stack page" onSubmit={submit}>
      <div class="stack gap-sm">
        <h1>Jak ti máme říkat?</h1>
        <label class="field">
          <span class="field-label">Přezdívka</span>
          <input
            type="text"
            maxLength={16}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Např. Míša"
            autocomplete="off"
          />
        </label>
        <p class="small muted">Uvidí ji spoluhráči ve hře. Může to být jméno i cokoli jiného.</p>
      </div>

      <div class="stack gap-sm grow">
        <h2>Kde dnes hraješ?</h2>
        <ModeCard active={mode === 'onsite'} icon="desk" title="Na místě" text="Hraju u stolu s fyzickými kartami" onClick={() => setMode('onsite')} />
        <ModeCard active={mode === 'online'} icon="phone" title="Online" text="Připojím se přes Teams a hraju v aplikaci" onClick={() => setMode('online')} />
      </div>

      <div class="stack center-items">
        <button type="submit" class="btn primary" disabled={!name.trim() || busy}>Potvrdit</button>
        <p class="fine center muted">Pokračováním souhlasíš s použitím své přezdívky a odpovědí při analýze dat pro diplomovou práci.</p>
        <button type="button" class="link" onClick={onRecover}>Stránka se mi zavřela – navázat</button>
      </div>
    </form>
  );
}

function ModeCard({ active, icon, title, text, onClick }) {
  return (
    <button type="button" class={`mode-card ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      <Icon name={icon} />
      <span class="mode-text">
        <span class="mode-title">{title}</span>
        <span class="small muted">{text}</span>
      </span>
    </button>
  );
}

// ---------- Obnova účasti ----------

function Recover({ onPick, onBack }) {
  const [nick, setNick] = useState('');
  const [matches, setMatches] = useState(null);
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState('');

  async function search(ev) {
    ev.preventDefault();
    setErr('');
    setPicked(null);
    try {
      const rows = await rpc('find_participants', { p_nickname: nick.trim() });
      setMatches(rows || []);
    } catch (e) {
      setErr('Hledání se nepovedlo. Zkus to znovu.');
    }
  }

  return (
    <div class="stack page">
      <div class="row">
        <button type="button" class="icon-btn" aria-label="Zpět" onClick={onBack}><Icon name="back" /></button>
        <h1 class="inline">Navázat na hru</h1>
      </div>

      <form class="stack gap-sm" onSubmit={search}>
        <label class="field">
          <span class="field-label">Tvoje přezdívka</span>
          <input type="text" maxLength={16} value={nick} onInput={(e) => setNick(e.currentTarget.value)} autocomplete="off" />
        </label>
        <button type="submit" class="btn secondary" disabled={!nick.trim()}>Najít</button>
      </form>

      {err && <p class="error">{err}</p>}

      {matches && matches.length === 0 && (
        <p class="muted">S touto přezdívkou jsme nic nenašli.</p>
      )}

      {matches && matches.length > 0 && (
        <div class="stack gap-sm grow">
          <span class="small muted">Našli jsme {matches.length} {matches.length === 1 ? 'hráče' : 'hráče'} s touto přezdívkou. Který jsi ty?</span>
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              class={`match ${picked === m.id ? 'active' : ''}`}
              onClick={() => setPicked(m.id)}
              aria-pressed={picked === m.id}
            >
              <span class="avatar">{initial(nick)}</span>
              <span class="stack gap-xs">
                <span class="mode-title">{nick.trim()}</span>
                <span class="small muted">{MODE_LABEL[m.mode]} · {progressLabel(m)}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            class="btn primary"
            disabled={!picked}
            onClick={() => onPick(picked, nick.trim())}
          >
            Pokračovat
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Testy (vstupní i výstupní) ----------

function Quiz({ kind, label, questions, nick, onDone, skippable = false }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);

  const q = questions[index];
  const last = index === questions.length - 1;
  const options = [...q.options, { key: UNKNOWN, text: 'Nevím / Neznám', unknown: true }];
  const heading = kind === 'pre' ? 'Definice' : 'Pojem';
  const question = kind === 'pre' ? 'Který pojem to je?' : 'Která definice je správná?';
  const prompt = kind === 'pre' ? q.prompt : q.prompt;

  // Přejde na otázku i s odpovědí, kterou na ní student zvolil dříve
  function goTo(i, current) {
    setIndex(i);
    setSelected(current[questions[i].id] ?? null);
  }

  async function next() {
    if (!selected || busy) return;
    const updated = { ...answers, [q.id]: selected };
    setAnswers(updated);
    if (!last) {
      goTo(index + 1, updated);
      return;
    }
    setBusy(true);
    await onDone(updated);
    setBusy(false);
  }

  // Dočasně pro testování: přeskočí celý test. Co je vyplněné, se uloží, zbytek jako Nevím
  async function skip() {
    if (busy) return;
    const filled = { ...answers };
    if (selected) filled[q.id] = selected;
    for (const question of questions) {
      if (!filled[question.id]) filled[question.id] = UNKNOWN;
    }
    setAnswers(filled);
    setBusy(true);
    await onDone(filled);
    setBusy(false);
  }

  function back() {
    if (index === 0 || busy) return;
    const updated = selected ? { ...answers, [q.id]: selected } : answers;
    setAnswers(updated);
    goTo(index - 1, updated);
  }

  return (
    <div class="stack page">
      <TopBar nick={nick} label={label} />

      <div class="stack gap-xs">
        <div class="row between small strong">
          <span>Otázka {index + 1} z {questions.length}</span>
          <span>Bez nápověd</span>
        </div>
        <div class="progress"><div class="progress-fill" style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
      </div>

      <div class="question-card">
        <span class="eyebrow small">{heading}</span>
        <h1 class="prompt">{prompt}</h1>
        <span class="small strong muted">{question}</span>
      </div>

      <div class="stack gap-sm grow">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            class={`option ${selected === opt.key ? 'selected' : ''} ${opt.unknown ? 'unknown' : ''}`}
            onClick={() => setSelected(opt.key)}
            aria-pressed={selected === opt.key}
          >
            <span class="key">{opt.unknown ? '?' : opt.key}</span>
            <span>{opt.text}</span>
          </button>
        ))}
      </div>

      <div class="row gap-sm">
        <button type="button" class="btn outline grow-1" disabled={index === 0 || busy} onClick={back}>Zpět</button>
        <button type="button" class="btn primary grow-2" disabled={!selected || busy} onClick={next}>
          {last ? 'Dokončit' : 'Další otázka'}
        </button>
      </div>
      {skippable && (
        <button type="button" class="skip-btn" disabled={busy} onClick={skip}>SKIP</button>
      )}
    </div>
  );
}

// ---------- Karty pojmů ----------

const ANIM_MS = 420;

function TermCard({ term, className }) {
  return (
    <article class={`term-card ${className}`}>
      <div class="card-head">
        <span class="term-code">{term.code}</span>
        <img src="assets/logomark.svg" alt="" class="card-mark" />
      </div>
      <div class="illu">
        <img src={`assets/${term.code}.svg`} alt={term.czName} />
      </div>
      <h2 class="term-name">{term.czName}</h2>
      <p class="term-def">{term.definition}</p>
    </article>
  );
}

function Priming({ nick, startedAt, onTimeUp, onDone }) {
  const [index, setIndex] = useState(0);
  // Probíhající přechod: dir 1 = Další (karta odskočí doleva), -1 = Zpět (karta přijede zprava)
  const [anim, setAnim] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [touchX, setTouchX] = useState(null);

  const left = Math.max(0, TIMER_MS - (now - new Date(startedAt).getTime()));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onTimeUp(index + 1);
  }, [left === 0]);

  function go(dir) {
    if (anim) return;
    const to = index + dir;
    if (to < 0 || to >= terms.length) return;
    setAnim({ dir, from: index, to });
    setTimeout(() => {
      setIndex(to);
      setAnim(null);
    }, ANIM_MS);
  }

  // Který obrázek je nahoře a který pod ní, včetně průběhu animace
  let top = index;
  let topClass = '';
  let under = index + 1 < terms.length ? index + 1 : null;
  let underClass = 'behind';
  if (anim && anim.dir === 1) {
    top = anim.from;
    topClass = 'fly-right';
    under = anim.to;
    underClass = 'promote';
  } else if (anim && anim.dir === -1) {
    top = anim.to;
    topClass = 'enter-right';
    under = anim.from;
    underClass = 'shrink';
  }

  const last = index === terms.length - 1;

  return (
    <div class="stack page">
      <div class="topbar">
        <div class="who"><span class="avatar">{initial(nick)}</span>{nick}</div>
        <span class="timer"><Icon name="clock" />{formatTime(left)}</span>
      </div>

      <div class="row between baseline">
        <h1 class="inline">Seznam se s pojmy</h1>
        <span class="small strong muted">{index + 1} / {terms.length}</span>
      </div>

      <div
        class="deck-stage"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (dx < -50) go(1);
          if (dx > 50) go(-1);
          setTouchX(null);
        }}
      >
        {under !== null && <TermCard key={`card-${under}`} term={terms[under]} className={underClass} />}
        <TermCard key={`card-${top}`} term={terms[top]} className={topClass} />
      </div>

      <div class="row gap-sm">
        <button type="button" class="btn outline grow-1" disabled={index === 0 || !!anim} onClick={() => go(-1)}>Zpět</button>
        <button type="button" class="btn secondary grow-2" disabled={last || !!anim} onClick={() => go(1)}>Další</button>
      </div>

      <button
        type="button"
        class="link center"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await onDone();
          setSaving(false);
        }}
      >
        Mám hotovo, pokračovat
      </button>
    </div>
  );
}

function TimeUp({ count, nick, onNext }) {
  useEffect(() => {
    const t = setTimeout(() => onNext(), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div class="teal full">
      <div class="topbar light">
        <div class="who light"><span class="avatar cream">{initial(nick)}</span>{nick}</div>
        <span class="tag light-soft">Priming</span>
      </div>
      <div class="center-col grow">
        <div class="ring"><Icon name="clock" /></div>
        <h1 class="light">Čas vypršel</h1>
        <p class="light-soft narrow">Prošel(a) jsi {count} z {terms.length} pojmů. Ostatní uvidíš během hry.</p>
        <span class="small light-soft">Pokračujeme za 3 s…</span>
      </div>
      <button type="button" class="btn cream" onClick={onNext}>Pokračovat</button>
    </div>
  );
}

// ---------- Čekání na odemknutí výstupního testu ----------

function Waiting({ mode, nick, onCheck }) {
  useEffect(() => {
    const t = setInterval(() => onCheck(), POLL_MS);
    return () => clearInterval(t);
  }, []);

  const onsite = mode !== 'online';
  return (
    <div class="stack page">
      <TopBar nick={nick} label={onsite ? 'Na místě' : 'Online'} />
      {onsite ? (
        <>
          <div class="stack gap-xs">
            <span class="eyebrow">Teď hrajete u stolu</span>
            <h1>Hra u stolu</h1>
          </div>
          <ol class="steps">
            <li><span class="step-num">1</span><span>Rozložte všechny karty <b>textem nahoru</b>: pojmy do jedné řady, definice do druhé.</span></li>
            <li><span class="step-num">2</span><span>Po řadě vyberte pojem a definici. Otočte obě karty: shodný kód znamená pár. Chybný pár vraťte na stůl.</span></li>
            <li><span class="step-num">3</span><span>Každý získá <b>3 páry</b>. Pak pokračujte podle facilitátora: Taboo, scénáře a obhajoba.</span></li>
          </ol>
          <div class="note">
            <span class="dot" />
            <span class="small">Telefon teď nepotřebuješ. Výstupní test se odemkne, až facilitátor ukončí hru.</span>
          </div>
        </>
      ) : (
        <>
          <div class="stack gap-xs">
            <span class="eyebrow">Teď hraješ online</span>
            <h1>Čekej na skupinu</h1>
          </div>
          <div class="note">
            <span class="dot" />
            <span class="small">Budeš rozdělen(a) do skupin na Teams. Výstupní test se odemkne, až facilitátor ukončí hru.</span>
          </div>
        </>
      )}
    </div>
  );
}

// Nastavení z facilitátorského panelu: skrytí SKIP tlačítek (pro ostrý běh)
rpc('get_settings')
  .then((s) => document.body.classList.toggle('no-skip', s?.skip_enabled === false))
  .catch(() => {});

// Panel facilitátora je na adrese .../#/admin; přepnutí adresy v otevřené stránce načte znovu
window.addEventListener('hashchange', () => location.reload());

render(location.hash === '#/admin' ? <Admin /> : <App />, document.getElementById('app'));
