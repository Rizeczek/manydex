import { useEffect, useState } from 'preact/hooks';
import tests from '../data/tests.json';
import { rpc } from './api.js';

// Panel facilitátora (#/admin). Přístup chrání heslo, které kontroluje databáze.
// Data se obnovují každé 3 s; skóre se počítá podle správných klíčů v tests.json.

const PASS_KEY = 'manydex_admin_pass';
const POLL_MS = 3000;
const PRE = tests.pre_test.questions;
const POST = tests.post_test.questions;

const STATUS_CS = {
  lobby: 'Lobby – čekání na start',
  pairing: 'Párování',
  pairing_done: 'Párování hotovo',
  taboo_ready: 'Taboo – připravenost',
  taboo: 'Taboo',
  taboo_done: 'Taboo hotovo',
  scenarios_ready: 'Scénáře – připravenost',
  scenarios: 'Scénáře',
  scenarios_done: 'Scénáře hotové',
  defence_ready: 'Obhajoba – připravenost',
  defence: 'Obhajoba',
  defence_done: 'Obhajoba hotová',
};

const session = {
  get() {
    try { return sessionStorage.getItem(PASS_KEY); } catch { return null; }
  },
  set(v) {
    try {
      if (v) sessionStorage.setItem(PASS_KEY, v);
      else sessionStorage.removeItem(PASS_KEY);
    } catch { /* bez úložiště jen nezapamatuje heslo */ }
  },
};

function fmt(ts) {
  return ts
    ? new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '–';
}

function grade(list, answers) {
  const byQ = {};
  let score = 0;
  for (const q of list) {
    const answer = answers?.[q.id] ?? null;
    const ok = answer === q.correct_key;
    if (ok) score += 1;
    byQ[q.id] = { answer, correct: q.correct_key, ok };
  }
  return { score, total: list.length, byQ };
}

function buildAnswerMap(rows) {
  const map = {};
  for (const r of rows) {
    if (!map[r.pid]) map[r.pid] = { pre: {}, post: {} };
    map[r.pid][r.test][r.q] = r.a;
  }
  return map;
}

function toCsv(list, answers) {
  const cols = [
    'nickname', 'mode', 'created_at', 'pre_done', 'priming_done', 'post_unlocked', 'post_done',
    'pre_score', 'post_score',
    ...PRE.map((q) => `pre_${q.id}`),
    ...POST.map((q) => `post_${q.id}`),
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const p of list) {
    const a = answers[p.id] || { pre: {}, post: {} };
    const pre = grade(PRE, a.pre);
    const post = grade(POST, a.post);
    const hasPre = Object.keys(a.pre).length > 0;
    const hasPost = Object.keys(a.post).length > 0;
    const vals = [
      p.nickname, p.mode, p.created_at, p.pre_done, p.priming_done, p.post_unlocked, p.post_done,
      hasPre ? pre.score : '', hasPost ? post.score : '',
      ...PRE.map((q) => a.pre[q.id] ?? ''),
      ...POST.map((q) => a.post[q.id] ?? ''),
    ];
    lines.push(vals.map(esc).join(','));
  }
  return '﻿' + lines.join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Login({ onLogin, error }) {
  const [value, setValue] = useState('');
  return (
    <div class="admin admin-login">
      <span class="eyebrow">Facilitátor</span>
      <h1>Panel</h1>
      <form class="stack gap-xs" onSubmit={(e) => { e.preventDefault(); onLogin(value.trim()); }}>
        <label class="room-label">
          Heslo
          <input
            type="password"
            class="admin-input"
            value={value}
            autocomplete="current-password"
            onInput={(e) => setValue(e.currentTarget.value)}
          />
        </label>
        {error && <div class="room-alert" role="alert"><b>{error}</b></div>}
        <button type="submit" class="btn primary" disabled={!value}>Vstoupit</button>
      </form>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div class="admin-stat">
      <span class="small muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function RoomCard({ r, busy, open, word, onAskRemove, onWord, onConfirm, onCancel }) {
  const progress = r.status === 'defence' ? ` · ${(r.def_i ?? 0) + 1} / ${r.def_count}` : '';
  return (
    <div class="admin-room">
      <div class="admin-room-head">
        <b>Místnost {r.code}</b>
        <span class="admin-tag">{STATUS_CS[r.status] || r.status}{progress}</span>
      </div>
      {r.players.length === 0 && <p class="small muted">Nikdo tu není.</p>}
      {r.players.map((p) => (
        <div class="admin-row" key={p.seat}>
          <span class={`admin-dot${p.connected ? ' on' : ''}`} title={p.connected ? 'připojen' : 'odpojen'} />
          <span class="admin-name">{p.nickname}</span>
          <span class="small muted">
            {p.matched} / 3 párů{p.ready ? ' · připraven' : ''}
          </span>
        </div>
      ))}
      {!open && (
        <button type="button" class="btn outline danger admin-room-btn" disabled={busy} onClick={onAskRemove}>
          Odebrat místnost
        </button>
      )}
      {open && (
        <div class="admin-confirm">
          <p>
            Odebere se místnost {r.code}.
            {r.players.length > 0 ? ` Její ${r.players.length} hráči o ni přijdou.` : ''}
            {' '}Pro potvrzení napiš <b>SMAZAT</b>.
          </p>
          <div class="admin-confirm-row">
            <input class="admin-input" value={word} aria-label={`Potvrzení odebrání místnosti ${r.code}`} onInput={(e) => onWord(e.currentTarget.value)} />
            <button type="button" class="btn primary danger" disabled={busy || word !== 'SMAZAT'} onClick={onConfirm}>Odebrat</button>
            <button type="button" class="admin-link" onClick={onCancel}>Zrušit</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionList({ list, result }) {
  return (
    <div class="admin-qgrid">
      {list.map((q) => {
        const r = result.byQ[q.id];
        return (
          <div class={`admin-q ${r.ok ? 'ok' : 'bad'}`} key={q.id}>
            <span class="admin-q-id">{q.id}</span>
            <span>{r.answer ?? '–'} <span class="muted">(správně {r.correct})</span></span>
          </div>
        );
      })}
    </div>
  );
}

function ParticipantCard({ p, a, checked, open, onToggle, onOpen }) {
  const pre = grade(PRE, a?.pre || {});
  const post = grade(POST, a?.post || {});
  const hasPre = Object.keys(a?.pre || {}).length > 0;
  const hasPost = Object.keys(a?.post || {}).length > 0;
  const preText = p.pre_done ? (hasPre ? `${pre.score} / ${pre.total}` : 'hotov') : 'nehotov';
  const postText = p.post_done
    ? (hasPost ? `${post.score} / ${post.total}` : 'hotov')
    : p.post_unlocked ? 'odemčen' : 'zamčen';
  return (
    <div class={`admin-part${checked ? ' sel' : ''}`}>
      <div class="admin-part-top">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Vybrat ${p.nickname}`} />
        <button type="button" class="admin-part-name" onClick={onOpen} aria-expanded={open}>
          <b>{p.nickname}</b>
          <span class="small muted">{p.mode === 'online' ? 'online' : 'solo'} · {fmt(p.created_at)}</span>
        </button>
      </div>
      <div class="admin-chips">
        <span class={`admin-chip${p.pre_done ? ' ok' : ''}`}>Pre: {preText}</span>
        <span class={`admin-chip${p.priming_done ? ' ok' : ''}`}>Priming: {p.priming_done ? 'hotov' : '–'}</span>
        <span class={`admin-chip${p.post_done ? ' ok' : ''}`}>Post: {postText}</span>
      </div>
      {open && (
        <div class="admin-detail">
          <h3>Pre-test</h3>
          {hasPre ? <QuestionList list={PRE} result={pre} /> : <p class="small muted">Bez odpovědí.</p>}
          <h3>Post-test</h3>
          {hasPost ? <QuestionList list={POST} result={post} /> : <p class="small muted">Bez odpovědí.</p>}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const [pass, setPass] = useState(session.get());
  const [authErr, setAuthErr] = useState('');
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [settings, setSettings] = useState({ skip_enabled: true });
  const [updated, setUpdated] = useState(null);
  const [selected, setSelected] = useState({});
  const [openPid, setOpenPid] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [newCode, setNewCode] = useState('');
  const [roomOpen, setRoomOpen] = useState(null);
  const [roomWord, setRoomWord] = useState('');

  function logout() {
    session.set(null);
    setPass(null);
    setData(null);
    setSelected({});
  }

  async function load(p) {
    try {
      const [ov, ans] = await Promise.all([
        rpc('admin_overview', { p_pass: p }),
        rpc('admin_answers', { p_pass: p }),
      ]);
      setData(ov);
      setAnswers(buildAnswerMap(ans));
      setUpdated(new Date());
      setErr('');
    } catch (e) {
      if (e.message === 'forbidden') {
        setAuthErr('Heslo nesouhlasí.');
        logout();
      } else {
        setErr('Spojení selhalo, zkouším znovu…');
      }
    }
  }

  useEffect(() => {
    if (!pass) return undefined;
    load(pass);
    rpc('get_settings').then((s) => setSettings(s || {})).catch(() => {});
    const t = setInterval(() => load(pass), POLL_MS);
    return () => clearInterval(t);
  }, [pass]);

  if (!pass) {
    return (
      <Login
        error={authErr}
        onLogin={(v) => {
          session.set(v);
          setAuthErr('');
          setPass(v);
        }}
      />
    );
  }

  if (!data) {
    return (
      <div class="admin">
        <p class="muted">Načítání…</p>
        {err && <div class="room-alert" role="alert"><b>{err}</b></div>}
      </div>
    );
  }

  async function run(fn, args, okText) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await rpc(fn, { p_pass: pass, ...args });
      setMsg(okText(r));
      await load(pass);
      return r;
    } catch (e) {
      const known = {
        forbidden: 'Heslo už neplatí. Přihlas se znovu.',
        room_exists: 'Místnost s tímto číslem už existuje.',
        bad_code: 'Číslo místnosti musí být 1 až 99.',
      };
      setErr(known[e.message] || `Akce se nepovedla: ${e.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const parts = data.participants || [];
  const rooms = data.rooms || [];
  const ids = Object.keys(selected).filter((k) => selected[k]);
  const skipOn = settings.skip_enabled !== false;
  const eligible = parts.filter((p) => p.priming_done && !p.post_done && !p.post_unlocked).length;
  const allSelected = parts.length > 0 && ids.length === parts.length;

  function unlock(list) {
    run('admin_unlock_post', { p_ids: list }, (n) => `Výstupní test odemčen u ${n} účastníků.`);
  }

  async function toggleSkip() {
    const next = !skipOn;
    const r = await run('admin_set_setting', { p_key: 'skip_enabled', p_value: next }, () =>
      next ? 'SKIP je zapnutý.' : 'SKIP je skrytý.');
    if (r !== null) {
      setSettings({ ...settings, skip_enabled: next });
      document.body.classList.toggle('no-skip', !next);
    }
  }

  async function removeSelected() {
    const r = await run('admin_delete', { p_ids: ids }, (n) => `Smazáno ${n} účastníků.`);
    if (r !== null) {
      setSelected({});
      setConfirm(null);
      setWord('');
    }
  }

  async function removeAll() {
    const r = await run('admin_delete', { p_ids: null }, (n) => `Smazáno všech ${n} účastníků a místností.`);
    if (r !== null) {
      setSelected({});
      setConfirm(null);
      setWord('');
    }
  }

  const usedCodes = new Set(rooms.map((r) => r.code));
  const freeCode = Array.from({ length: 99 }, (_, i) => i + 1).find((c) => !usedCodes.has(c));

  async function addRoom() {
    const code = Number(newCode || freeCode);
    const r = await run('admin_room_add', { p_code: code }, () => `Místnost ${code} přidána.`);
    if (r !== null) setNewCode('');
  }

  async function removeRoom(room) {
    const r = await run('admin_room_remove', { p_room: room.id }, () => `Místnost ${room.code} odebrána.`);
    if (r !== null) {
      setRoomOpen(null);
      setRoomWord('');
    }
  }

  return (
    <div class="admin">
      <header class="admin-head">
        <div>
          <span class="eyebrow">Facilitátor</span>
          <h1>Panel</h1>
        </div>
        <div class="admin-head-side">
          <span class="small muted">Aktualizováno {updated?.toLocaleTimeString('cs-CZ')}</span>
          <button type="button" class="admin-link" onClick={logout}>Odhlásit</button>
        </div>
      </header>

      {err && <div class="room-alert" role="alert"><b>{err}</b></div>}
      {msg && <div class="admin-ok" role="status">{msg}</div>}

      <section class="admin-stats">
        <Stat label="Účastníci" value={parts.length} />
        <Stat label="Místnosti" value={rooms.length} />
        <Stat label="Pre-test hotov" value={parts.filter((p) => p.pre_done).length} />
        <Stat label="Post-test hotov" value={parts.filter((p) => p.post_done).length} />
      </section>

      <section class="admin-card">
        <h2>Ovládání</h2>
        <label class="admin-switch">
          <input type="checkbox" checked={skipOn} disabled={busy} onChange={toggleSkip} />
          <span>Tlačítko SKIP (pro testování)</span>
        </label>
        <div class="admin-actions">
          <button type="button" class="btn secondary" disabled={busy || eligible === 0} onClick={() => unlock(null)}>
            Odemknout výstupní test všem ({eligible})
          </button>
          <button type="button" class="btn outline" disabled={busy || ids.length === 0} onClick={() => unlock(ids)}>
            Odemknout vybrané ({ids.length})
          </button>
          <button type="button" class="btn outline" disabled={busy || parts.length === 0} onClick={() => download(`manydex-${new Date().toISOString().slice(0, 16)}.csv`, toCsv(parts, answers))}>
            Export CSV – všichni
          </button>
          <button type="button" class="btn outline" disabled={busy || ids.length === 0} onClick={() => download(`manydex-vybrane-${new Date().toISOString().slice(0, 16)}.csv`, toCsv(parts.filter((p) => selected[p.id]), answers))}>
            Export CSV – vybrané
          </button>
        </div>
        <div class="admin-actions">
          <button type="button" class="btn outline danger" disabled={busy || ids.length === 0} onClick={() => { setConfirm('selected'); setWord(''); }}>
            Smazat vybrané ({ids.length})
          </button>
          <button type="button" class="btn outline danger" disabled={busy || parts.length === 0} onClick={() => { setConfirm('all'); setWord(''); }}>
            Smazat všechny sessions ({parts.length})
          </button>
        </div>
        {confirm && (
          <div class="admin-confirm">
            <p>
              {confirm === 'all'
                ? `Smaže se všech ${parts.length} účastníků a všechny odpovědi. Místnosti zůstanou, jen se vyprázdní. Nelze vrátit.`
                : `Smaže se ${ids.length} vybraných účastníků a jejich odpovědi. Nelze vrátit.`}
              {' '}Pro potvrzení napiš <b>SMAZAT</b>.
            </p>
            <div class="admin-confirm-row">
              <input class="admin-input" value={word} aria-label="Potvrzení smazání" onInput={(e) => setWord(e.currentTarget.value)} />
              <button type="button" class="btn primary danger" disabled={busy || word !== 'SMAZAT'} onClick={() => (confirm === 'all' ? removeAll() : removeSelected())}>
                Smazat
              </button>
              <button type="button" class="admin-link" onClick={() => { setConfirm(null); setWord(''); }}>Zrušit</button>
            </div>
          </div>
        )}
      </section>

      <section>
        <div class="admin-h-row">
          <h2 class="admin-h">Místnosti ({rooms.length})</h2>
        </div>
        <div class="admin-add">
          <input
            class="admin-input admin-code"
            type="number"
            inputMode="numeric"
            min="1"
            max="99"
            value={newCode}
            placeholder={freeCode ? String(freeCode) : ''}
            aria-label="Číslo nové místnosti"
            onInput={(e) => setNewCode(e.currentTarget.value)}
          />
          <button type="button" class="btn outline" disabled={busy || !freeCode} onClick={addRoom}>
            Přidat místnost
          </button>
        </div>
        {rooms.length === 0
          ? <p class="muted">Zatím žádné místnosti.</p>
          : (
            <div class="admin-grid">
              {rooms.map((r) => (
                <RoomCard
                  key={r.id}
                  r={r}
                  busy={busy}
                  open={roomOpen === r.id}
                  word={roomOpen === r.id ? roomWord : ''}
                  onAskRemove={() => { setRoomOpen(r.id); setRoomWord(''); }}
                  onWord={setRoomWord}
                  onConfirm={() => removeRoom(r)}
                  onCancel={() => { setRoomOpen(null); setRoomWord(''); }}
                />
              ))}
            </div>
          )}
      </section>

      <section>
        <div class="admin-h-row">
          <h2 class="admin-h">Účastníci ({parts.length})</h2>
          <button
            type="button"
            class="admin-link"
            disabled={parts.length === 0}
            onClick={() => setSelected(allSelected ? {} : Object.fromEntries(parts.map((p) => [p.id, true])))}
          >
            {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
          </button>
        </div>
        {parts.length === 0
          ? <p class="muted">Zatím nikdo.</p>
          : (
            <div class="admin-grid">
              {parts.map((p) => (
                <ParticipantCard
                  key={p.id}
                  p={p}
                  a={answers[p.id]}
                  checked={!!selected[p.id]}
                  open={openPid === p.id}
                  onToggle={() => setSelected({ ...selected, [p.id]: !selected[p.id] })}
                  onOpen={() => setOpenPid(openPid === p.id ? null : p.id)}
                />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
