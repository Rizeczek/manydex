import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import terms from '../data/terms.json';
import tests from '../data/tests.json';
import { rpc } from './api.js';
import './styles.css';

const PID_KEY = 'manydex_pid';
const TIMER_MS = 7 * 60 * 1000;
const POLL_MS = 8000;

const MODE_LABEL = { onsite: 'Na místě', online: 'Online' };

function progressLabel(s) {
  if (!s.pre_done) return 'pre-test';
  if (!s.priming_done) return 'karty pojmů';
  if (s.post_done) return 'hotovo';
  return 'post-test';
}

// Kam má student jít podle uloženého stavu
function nextView(s) {
  if (!s.pre_done) return 'pretestIntro';
  if (!s.priming_done) return 'primingIntro';
  if (s.post_done) return 'done';
  return s.post_unlocked ? 'post' : 'waiting';
}

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ---------- Kořenová komponenta ----------

function App() {
  const [view, setView] = useState('loading');
  const [pid, setPid] = useState(localStorage.getItem(PID_KEY));
  const [st, setSt] = useState(null);
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
      setError('Připojení se nepovedlo. Zkuste to znovu.');
    }
  }

  async function startWith(id) {
    localStorage.setItem(PID_KEY, id);
    setPid(id);
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
          setError('Připojení se nepovedlo. Obnovte stránku.');
          setView('intro');
        }
      });
  }, []);

  return (
    <main class="screen">
      {error && <p class="error">{error}</p>}

      {view === 'loading' && <p class="muted">Připojování…</p>}

      {view === 'intro' && (
        <Intro onStart={startWith} onRecover={() => setView('recover')} />
      )}

      {view === 'recover' && (
        <Recover onPick={startWith} onBack={() => setView('intro')} />
      )}

      {view === 'pretestIntro' && (
        <Card
          title="Pre-test"
          text="Nejdřív odpovězte na 12 otázek. Uvidíte definici a vyberete pojem, který k ní patří. Správnost vám neukážeme."
          button="Začít pre-test"
          onNext={async () => {
            setView('pretest');
          }}
        />
      )}

      {view === 'pretest' && (
        <QuizScreen
          kind="pre"
          questions={tests.pre_test.questions}
          onDone={async (answers) => {
            setError('');
            try {
              await rpc('save_test_answers', { p_id: pid, p_test: 'pre', p_answers: answers });
              await rpc('save_progress', { p_id: pid, p_step: 'pre_done' });
              await advance();
            } catch (e) {
              setError('Odpovědi se nepodařilo uložit. Zkuste to znovu.');
            }
          }}
        />
      )}

      {view === 'primingIntro' && (
        <Card
          title="Karty pojmů"
          text="Projdete 12 karet: pojem, definici a příklad z praxe. Na jednu kartu máte 7 minut. Listujte přejetím prstem, nebo tlačítky Zpět a Další. Až budete hotovi, klepněte na Mám hotovo."
          button="Začít"
          onNext={async () => {
            setError('');
            try {
              await rpc('save_progress', { p_id: pid, p_step: 'priming_started' });
              const s = await refresh(pid);
              setView('priming');
            } catch (e) {
              setError('Nepodařilo se spustit časovač. Zkuste to znovu.');
            }
          }}
        />
      )}

      {view === 'priming' && st?.priming_started_at && (
        <Priming
          startedAt={st.priming_started_at}
          onTimeUp={() => setView('timeup')}
          onDone={async () => {
            setError('');
            try {
              await rpc('save_progress', { p_id: pid, p_step: 'priming_done' });
              await advance();
            } catch (e) {
              setError('Nepodařilo se uložit. Zkuste to znovu.');
            }
          }}
        />
      )}

      {view === 'timeup' && (
        <Card
          title="Čas vypršel"
          text="Čas na karty pojmů skončil. Pokračujte dál."
          button="Pokračovat"
          onNext={async () => {
            setError('');
            try {
              await rpc('save_progress', { p_id: pid, p_step: 'priming_done' });
              await advance();
            } catch (e) {
              setError('Nepodařilo se uložit. Zkuste to znovu.');
            }
          }}
        />
      )}

      {view === 'waiting' && (
        <Waiting
          mode={st?.mode}
          onUnlock={() => advance()}
        />
      )}

      {view === 'post' && (
        <QuizScreen
          kind="post"
          questions={tests.post_test.questions}
          onDone={async (answers) => {
            setError('');
            try {
              await rpc('save_test_answers', { p_id: pid, p_test: 'post', p_answers: answers });
              await rpc('save_progress', { p_id: pid, p_step: 'post_done' });
              await advance();
            } catch (e) {
              setError('Odpovědi se nepodařilo uložit. Zkuste to znovu.');
            }
          }}
        />
      )}

      {view === 'done' && (
        <Card
          title="Hotovo"
          text="Děkujeme za účast. Můžete zavřít stránku."
        />
      )}
    </main>
  );
}

// ---------- Úvod a obnova ----------

function Intro({ onStart, onRecover }) {
  const [nick, setNick] = useState('');
  const [mode, setMode] = useState('onsite');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(ev) {
    ev.preventDefault();
    if (!nick.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const id = await rpc('create_participant', { p_nickname: nick.trim(), p_mode: mode });
      await onStart(id);
    } catch (e) {
      setErr('Něco se nepovedlo. Zkuste to znovu.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Vítejte v Manydexu</h1>
      <p>Aplikace vás provede výukovou session krok za krokem. Nejdřív si zvolte přezdívku a způsob účasti.</p>

      <label class="field">
        <span>Přezdívka</span>
        <input
          type="text"
          maxLength={40}
          value={nick}
          onInput={(e) => setNick(e.currentTarget.value)}
          placeholder="Libovolná přezdívka"
          autocomplete="off"
        />
        <small class="muted">Může být libovolná. Duplicity jsou povolené.</small>
      </label>

      <fieldset class="choice">
        <legend>Jak se účastníte?</legend>
        <label>
          <input type="radio" name="mode" value="onsite" checked={mode === 'onsite'} onChange={() => setMode('onsite')} />
          Jsem na místě
        </label>
        <label>
          <input type="radio" name="mode" value="online" checked={mode === 'online'} onChange={() => setMode('online')} />
          Jsem online (Teams)
        </label>
      </fieldset>

      {err && <p class="error">{err}</p>}

      <button type="submit" class="primary" disabled={busy || !nick.trim()}>
        {busy ? 'Ukládám…' : 'Potvrdit'}
      </button>
      <p class="consent">
        Potvrzením souhlasíte s použitím přezdívky a vašich odpovědí pro analýzu dat.
      </p>

      <p class="center">
        <button type="button" class="link" onClick={onRecover}>
          Už jsem tu byl/a. Obnovit účast
        </button>
      </p>
    </form>
  );
}

function Recover({ onPick, onBack }) {
  const [nick, setNick] = useState('');
  const [matches, setMatches] = useState(null);
  const [err, setErr] = useState('');

  async function search(ev) {
    ev.preventDefault();
    setErr('');
    try {
      const rows = await rpc('find_participants', { p_nickname: nick.trim() });
      setMatches(rows || []);
    } catch (e) {
      setErr('Hledání se nepovedlo. Zkuste to znovu.');
    }
  }

  return (
    <div>
      <h1>Obnovit účast</h1>
      <form onSubmit={search}>
        <label class="field">
          <span>Vaše přezdívka</span>
          <input type="text" maxLength={40} value={nick} onInput={(e) => setNick(e.currentTarget.value)} autocomplete="off" />
        </label>
        <button type="submit" class="primary" disabled={!nick.trim()}>Najít</button>
      </form>

      {err && <p class="error">{err}</p>}

      {matches && matches.length === 0 && (
        <p class="muted">S touto přezdívkou jsme nic nenašli.</p>
      )}

      {matches && matches.length > 0 && (
        <>
          <p>Vyberte sebe:</p>
          <ul class="list">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" class="option" onClick={() => onPick(m.id)}>
                  {MODE_LABEL[m.mode]} · fáze: {progressLabel(m)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p class="center">
        <button type="button" class="link" onClick={onBack}>Zpět</button>
      </p>
    </div>
  );
}

// ---------- Obecná karta ----------

function Card({ title, text, button, onNext }) {
  const [busy, setBusy] = useState(false);
  return (
    <div class="card-screen">
      <h1>{title}</h1>
      <p>{text}</p>
      {button && onNext && (
        <button
          type="button"
          class="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onNext();
            setBusy(false);
          }}
        >
          {button}
        </button>
      )}
    </div>
  );
}

// ---------- Testy (pre i post) ----------

function QuizScreen({ kind, questions, onDone }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);

  const q = questions[index];
  const isPre = kind === 'pre';
  const hint = isPre
    ? 'Vyberte pojem, který odpovídá definici.'
    : 'Vyberte definici, která odpovídá pojmu.';

  async function choose(key) {
    if (saving) return;
    const next = { ...answers, [q.id]: key };
    setAnswers(next);
    if (index < questions.length - 1) {
      setIndex(index + 1);
    } else {
      setSaving(true);
      await onDone(next);
      setSaving(false);
    }
  }

  return (
    <div class="quiz">
      <p class="muted">Otázka {index + 1} z {questions.length}</p>
      <p class="hint">{hint}</p>
      <h2 class="prompt">{q.prompt}</h2>
      <ul class="list">
        {q.options.map((opt) => (
          <li key={opt.key}>
            <button type="button" class="option" disabled={saving} onClick={() => choose(opt.key)}>
              <strong>{opt.key}</strong> {opt.text}
            </button>
          </li>
        ))}
      </ul>
      {saving && <p class="muted">Ukládám…</p>}
    </div>
  );
}

// ---------- Karty pojmů (priming) ----------

function Priming({ startedAt, onTimeUp, onDone }) {
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [touchX, setTouchX] = useState(null);

  const left = Math.max(0, TIMER_MS - (now - new Date(startedAt).getTime()));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onTimeUp();
  }, [left === 0]);

  const card = terms[index];
  const last = index === terms.length - 1;

  return (
    <div class="priming">
      <div class="timer">Zbývá {formatTime(left)}</div>
      <p class="muted">Karta {index + 1} z {terms.length}</p>

      <article
        class="term-card"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (dx < -50 && index < terms.length - 1) setIndex(index + 1);
          if (dx > 50 && index > 0) setIndex(index - 1);
          setTouchX(null);
        }}
      >
        <div class="term-code">{card.grid}</div>
        <h2>{card.czName}</h2>
        <p class="en">{card.enName}</p>
        <p class="definition">{card.definition}</p>
        <p class="example"><strong>Příklad:</strong> {card.example}</p>
        <p class="meta">{card.field} · {card.type}</p>
      </article>

      <div class="nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>Zpět</button>
        <button type="button" disabled={last} onClick={() => setIndex(index + 1)}>Další</button>
      </div>

      <button
        type="button"
        class="primary"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await onDone();
          setSaving(false);
        }}
      >
        Mám hotovo
      </button>
    </div>
  );
}

// ---------- Čekání na odemknutí post-testu ----------

function Waiting({ mode, onUnlock }) {
  useEffect(() => {
    const t = setInterval(async () => {
      // Odemknutí dělá facilitátor; kontrolujeme stav na serveru
      onUnlock();
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div class="card-screen">
      <h1>Čekejte</h1>
      {mode === 'online' ? (
        <p>Budete rozděleni do skupin na Teams. Počkejte na pokyn facilitátora.</p>
      ) : (
        <p>Dostanete instrukce k fyzické hře od facilitátora. Počkejte, až vás vyzve k post-testu.</p>
      )}
      <p class="muted">Tato stránka se sama obnoví, až bude post-test otevřený.</p>
    </div>
  );
}

render(<App />, document.getElementById('app'));
