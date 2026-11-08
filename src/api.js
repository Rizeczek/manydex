// Komunikace se Supabase. Publishable klíč je veřejný a smí být v kódu.
// Zápisy a čtení probíhají jen přes databázové funkce (RPC), tabulky nejsou přímo přístupné.
const SUPABASE_URL = 'https://ggnlyihaergducrnxlbl.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_YmSrk0Qg62Ps_JXkcGddDA_AJbEf65u';

export async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const error = new Error(data?.message || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
