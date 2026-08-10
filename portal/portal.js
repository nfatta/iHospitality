/* ============================================================
   Brand portal — shared client
   ============================================================
   The key below is the Supabase PUBLISHABLE key. It is meant to
   ship in client HTML: on its own it grants nothing, because the
   `anon` role has no privileges in this database and every table
   is behind row-level security. What a person can read is decided
   by their login, in Postgres, not by this file.

   Never put the SECRET key here.
   ============================================================ */

const SUPABASE_URL = 'https://yjhvqpfdmohfkvsrmshi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zz1ZYVLSXdrdTLX6LIQTZw_T5y_VUAE';

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/* ---------- auth ---------- */

/** Redirect to the login page unless signed in. Returns {session, profile}. */
export async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    // Remember where they were headed so login can send them back.
    const here = location.pathname.split('/').pop() || 'index.html';
    location.replace(`login.html?next=${encodeURIComponent(here)}`);
    return null;
  }
  const { data: profile, error } = await db
    .from('profiles')
    .select('full_name, role, brand_id, brands(name, slug)')
    .eq('user_id', session.user.id)
    .single();

  if (error || !profile) {
    // A login with no profile row can see nothing — RLS matches on the profile.
    // Say so plainly instead of rendering five empty pages.
    document.body.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="err">This account is not linked to a brand yet. Contact
      iHospitality and we will finish setting it up.</div>
      <button class="btn-full" id="so">Sign out</button></div></div>`;
    document.getElementById('so').onclick = signOut;
    return null;
  }
  return { session, profile };
}

export async function signOut() {
  await db.auth.signOut();
  location.replace('login.html');
}

/* ---------- shell ---------- */

const NAV = [
  ['index.html', 'Dashboard'],
  ['activity.html', 'Activity'],
  ['venues.html', 'Venues'],
  ['photos.html', 'Photos'],
];

/** Render the nav and footer. Kept in JS so five pages share one copy —
    the duplication problem the public site already has. */
export function renderShell(active, profile) {
  const brand = profile.brands?.name || 'Your brand';
  const links = NAV.map(([href, label]) =>
    `<li><a href="${href}"${href === active ? ' class="current"' : ''}>${label}</a></li>`).join('');

  document.getElementById('shell-nav').innerHTML = `
    <a href="index.html" class="nav-logo">
      <img src="../images/ih_logo.png" alt="iHospitality" width="444" height="394" decoding="async"/>
      <span class="nav-logo-text">i<span>Hospitality</span></span>
    </a>
    <ul class="nav-links">${links}</ul>
    <div class="nav-user">
      <span class="who">${esc(brand)}</span>
      <button class="link-btn" id="signout">Sign out</button>
    </div>
    <button class="hamburger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>`;

  document.getElementById('shell-mobile').innerHTML =
    NAV.map(([href, label]) =>
      `<a href="${href}"${href === active ? ' class="current"' : ''}>${label}</a>`).join('') +
    `<a href="#" id="signout-m">Sign out</a>`;

  document.getElementById('shell-footer').innerHTML = `
    <div class="footer-bottom">
      <p>&copy; ${new Date().getFullYear()} iHospitality. Private brand portal.</p>
      <p>Signed in as ${esc(profile.full_name || '')} &middot; ${esc(brand)}</p>
    </div>`;

  document.getElementById('signout').onclick = signOut;
  document.getElementById('signout-m').onclick = (e) => { e.preventDefault(); signOut(); };
  document.getElementById('burger').onclick = () =>
    document.getElementById('shell-mobile').classList.toggle('open');
}

/* ---------- helpers ---------- */

/** Escape before inserting anything from the database into HTML. Venue names
    and captions are user-entered upstream in HubSpot; treat them as untrusted. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonth(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function fmtNum(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const MARKET_LABEL = {
  central_florida: 'Central Florida',
  palm_beach_county: 'Palm Beach County',
};

/**
 * Build a table from column definitions, dropping any column with no data.
 *
 * The HubSpot exports carry no city, market, or brand-facing summary, so those
 * columns would otherwise render as a wall of em-dashes on every row — which
 * reads as a broken page rather than as "not captured yet". A column appears
 * when it has something to say and stays out of the way when it does not; as
 * the admin starts filling those fields in, the columns appear on their own.
 *
 * Each column: { head, get(row), cls?, nowrap?, always? }
 */
export function table(rows, columns) {
  const live = columns.filter(c => c.always || rows.some(r => {
    const v = c.value ? c.value(r) : c.get(r);
    return v !== null && v !== undefined && v !== '' && v !== 0;
  }));
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${live.map(c => `<th class="${c.cls || ''}">${esc(c.head)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${live.map(c =>
      `<td class="${c.cls || ''}${c.nowrap ? ' nowrap' : ''}">${c.get(r) ?? ''}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/** Hide a filter that has fewer than two real choices. */
export function fillSelect(id, values, label) {
  const el = document.getElementById(id);
  if (values.length < 2) { el.style.display = 'none'; return; }
  el.insertAdjacentHTML('beforeend',
    values.map(v => `<option value="${esc(v[0])}">${esc(v[1])}</option>`).join(''));
}

/** Render into a container, handling the three states every page has. */
export function render(el, { error, empty, html }) {
  if (error) {
    el.innerHTML = `<div class="err">Could not load this. ${esc(error.message || error)}</div>`;
    return false;
  }
  if (empty) {
    el.innerHTML = `<div class="state"><strong>${esc(empty.title)}</strong>${esc(empty.body)}</div>`;
    return false;
  }
  el.innerHTML = html;
  return true;
}
