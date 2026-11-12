import { useEffect, useRef, useState } from 'preact/hooks';
import evaluation from '../data/game_evaluation.json';

// Hodnocení hry po 12 otázkách výstupního testu (data/game_evaluation.json).
// Jedna otázka na obrazovku. Škála a výběr posouvají dál samy, text potvrzuje tlačítko.

const AUTO_NEXT_MS = 320;
const SCALE = ['1', '2', '3', '4', '5'];

// Otázky v pořadí, s textem podle varianty (online / na místě)
export function evalItems(mode) {
  const variant = mode === 'online' ? 'online' : 'onsite';
  return evaluation.sections.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      prompt: item.prompt_by_variant ? item.prompt_by_variant[variant] : item.prompt,
      section,
    })),
  );
}

export const EVAL_IDS = evaluation.sections.flatMap((s) => s.items.map((i) => i.id));

function Likert({ item, value, onPick }) {
  const reversed = item.section.id === 'N';
  return (
    <div class={`likert${reversed ? ' likert-strong' : ''}`}>
      <div class="likert-row" role="radiogroup" aria-label={item.prompt}>
        {SCALE.map((n) => {
          const end = n === '1' ? item.min_label : n === '5' ? item.max_label : '';
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={end ? `${n} – ${end}` : n}
              class={`likert-btn${value === n ? ' selected' : ''}`}
              onClick={() => onPick(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div class="likert-labels" aria-hidden="true">
        <span>{item.min_label}</span>
        <span>{item.max_label}</span>
      </div>
      {reversed && (
        <p class="likert-note">Pozor: tady 5 neznamená lepší hodnocení, ale nejvíc úsilí.</p>
      )}
    </div>
  );
}

function Choice({ item, value, onPick }) {
  return (
    <div class="stack gap-sm" role="radiogroup" aria-label={item.prompt}>
      {item.options.map((opt, i) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={value === opt.key}
          class={`option ${value === opt.key ? 'selected' : ''}`}
          onClick={() => onPick(opt.key)}
        >
          <span class="key">{String.fromCharCode(65 + i)}</span>
          <span>{opt.text}</span>
        </button>
      ))}
    </div>
  );
}

export default function Evaluation({ mode, topBar, onDone, skippable = false }) {
  const items = evalItems(mode);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const q = items[index];
  const last = index === items.length - 1;
  const value = answers[q.id] ?? '';
  const canGo = !q.required || value !== '';

  function cleaned(all) {
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      const t = String(v).trim();
      if (t) out[k] = t;
    }
    return out;
  }

  function pick(v) {
    setAnswers({ ...answers, [q.id]: v });
    clearTimeout(timer.current);
    if (!last) {
      timer.current = setTimeout(() => setIndex((i) => Math.min(i + 1, items.length - 1)), AUTO_NEXT_MS);
    }
  }

  async function next() {
    clearTimeout(timer.current);
    if (!canGo || busy) return;
    if (!last) {
      setIndex(index + 1);
      return;
    }
    setBusy(true);
    await onDone(cleaned(answers));
    setBusy(false);
  }

  function back() {
    clearTimeout(timer.current);
    if (index === 0 || busy) return;
    setIndex(index - 1);
  }

  // Dočasně pro testování: odešle, co je vyplněné, a hodnocení ukončí
  async function skip() {
    clearTimeout(timer.current);
    if (busy) return;
    setBusy(true);
    await onDone(cleaned(answers));
    setBusy(false);
  }

  return (
    <div class="stack page eval">
      {topBar}

      <div class="stack gap-xs">
        <div class="row between small strong">
          <span>Otázka {index + 1} z {items.length}</span>
          <span>{q.required ? '' : 'Nepovinné'}</span>
        </div>
        <div class="progress"><div class="progress-fill" style={{ width: `${((index + 1) / items.length) * 100}%` }} /></div>
      </div>

      <div class="question-card eval-card" key={q.id}>
        <span class="eyebrow small">{q.section.title}</span>
        {q.section.intro && q.phase && <span class="small strong muted">{q.section.intro}</span>}
        <h1 class="prompt eval-prompt">{q.prompt}</h1>
      </div>

      <div class="stack grow eval-answer">
        {q.type === 'likert5' && <Likert item={q} value={value} onPick={pick} />}
        {q.type === 'single_choice' && <Choice item={q} value={value} onPick={pick} />}
        {(q.type === 'text_short' || q.type === 'text_long') && (
          <textarea
            key={q.id}
            class="eval-text"
            rows={q.type === 'text_long' ? 6 : 3}
            maxLength={2000}
            placeholder="Napiš odpověď, nebo pokračuj bez ní"
            aria-label={q.prompt}
            value={value}
            onInput={(e) => setAnswers({ ...answers, [q.id]: e.currentTarget.value })}
          />
        )}
      </div>

      <div class="row gap-sm">
        <button type="button" class="btn outline grow-1" disabled={index === 0 || busy} onClick={back}>Zpět</button>
        <button type="button" class="btn primary grow-2" disabled={!canGo || busy} onClick={next}>
          {last ? 'Dokončit' : 'Další otázka'}
        </button>
      </div>
      {skippable && (
        <button type="button" class="skip-btn" disabled={busy} onClick={skip}>SKIP</button>
      )}
    </div>
  );
}
