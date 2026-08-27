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

/* ---------- installable on a phone (D137) ----------
   Registered from here so every page gets it without repeating the snippet.

   The worker caches THE SHELL ONLY and never a Supabase response -- read the
   header of sw.js before changing it. Registration is best-effort: on
   file://, in a private window, or anywhere the browser refuses, the portal
   works exactly as it did before. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------- auth ---------- */

/** Redirect to the login page unless signed in. Returns {session, profile}. */
export async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    // Remember where they were headed so login can send them back — INCLUDING
    // the query string, or a link to one brand or one activity comes back as a
    // bare page with no id. login.html validates the filename half against its
    // own allowlist, so the round trip can still only land inside the portal.
    const here = (location.pathname.split('/').pop() || 'index.html') + location.search;
    location.replace(`login.html?next=${encodeURIComponent(here)}`);
    return null;
  }
  const { data: profile, error } = await db
    .from('profiles')
    .select('full_name, role, brand_id, contractor_id, brands(name, slug)')
    .eq('user_id', session.user.id)
    .single();

  // THE CONTRACTOR'S NAME COMES FROM v_contractor_names, NOT FROM AN EMBED.
  // `contractors` is staff-only -- its `note` column is internal writing about
  // a person (D88) -- so `contractors(name)` embedded above came back null for
  // the very people it was fetched for, and the rail read a flat "Contractor"
  // while the venue page announced "Owned by: nobody yet" on accounts that
  // plainly had an owner. Shaped as `profile.contractors` so every caller reads
  // it the same way whichever query filled it.
  if (profile && profile.role === 'contractor' && profile.contractor_id) {
    const { data: me } = await db.from('v_contractor_names')
      .select('name').eq('id', profile.contractor_id).maybeSingle();
    if (me) profile.contractors = me;
  }

  if (error || !profile) {
    // A login with no profile row can see nothing — RLS matches on the profile.
    // Say so plainly instead of rendering five empty pages.
    document.body.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="err">This account is not linked to a brand or a contractor yet.
      Contact iHospitality and we will finish setting it up.</div>
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

/* Staff-only pages. Hiding the link is convenience, not security — these show
   money, and the money comes from rate_card and the retainer tables, whose RLS
   policies are staff-only. A brand user who typed the URL would get a page of
   nulls, which is the real lock. */
const ADMIN_NAV = [
  ['brands.html', 'Brands'],
  ['business.html', 'Business'],
  ['rate-card.html', 'Rate card'],
  ['pay.html', 'Contractor pay'],
];

/* A contractor's portal (D137). Three groups, because the split between them
   IS the design and a flat list of eight would hide it:

     MY WORK   — scoped to them. Their accounts, their earnings.
     LOOK UP   — every venue and every activity, for walking into an account
                 they do not own. No money on any of it.
     REFERENCE — brand information and training. Stubs until V2.

   `venues.html` appears in both worlds and renders differently in each: for a
   contractor it drops the money and the quiet-day columns, because those are a
   judgement about a colleague's account (see the note on that page). */
const CONTRACTOR_NAV_MINE = [
  ['index.html', 'Dashboard'],
  ['my-venues.html', 'My accounts'],
  ['my-pay.html', 'My pay'],
];

const CONTRACTOR_NAV_LOOKUP = [
  ['venues.html', 'All accounts'],
  ['activity.html', 'Activity'],
  ['photos.html', 'Photos'],
];

const CONTRACTOR_NAV_REFERENCE = [
  ['brands-info.html', 'Brands'],
  ['training.html', 'Training'],
];

/* Pages a contractor must never land on. RLS already makes every one of them a
   page of nulls, which is the real lock — this is so it reads as "not yours"
   instead of "broken". Hiding a link is convenience; the redirect is courtesy;
   neither is the security. */
const STAFF_ONLY_PAGES = new Set([
  'brands.html', 'brand.html', 'business.html', 'rate-card.html',
  'pay.html', 'activity-detail.html',
]);

/** The one place the admin/brand distinction is decided in the client.
    `is_staff()` in Postgres tests this same string; a mismatch there returns
    zero rows with no error, so the two must stay spelled the same way. */
export const isStaff = (profile) => profile?.role === 'staff';

/** A field rep (D137). Spelled exactly as `profile_role_enum` and as
    `is_contractor()` in Postgres spell it — a mismatch in any of the three
    returns zero rows with no error, on a page that renders perfectly (D120). */
export const isContractor = (profile) => profile?.role === 'contractor';

/** Someone who works here. The line for data that is internal but not
    financial; NOT the line for money. */
export const isInternal = (profile) => isStaff(profile) || isContractor(profile);

/**
 * Send a contractor away from a staff page. `await` it right after
 * requireAuth() on any page in STAFF_ONLY_PAGES.
 *
 * When it redirects it never resolves, so the rest of the module simply does
 * not run. A `throw` would do the same job and leave an uncaught error in the
 * console of a page that behaved perfectly correctly -- which is exactly the
 * kind of noise that trains people to ignore the console.
 */
export async function guardStaffPage(profile) {
  const here = location.pathname.split('/').pop() || 'index.html';
  if (isContractor(profile) && STAFF_ONLY_PAGES.has(here)) {
    location.replace('index.html');
    await new Promise(() => {});
  }
}

/**
 * Render the sidebar, the mobile top bar and the footer.
 *
 * A LEFT RAIL rather than the public site's top bar, because the admin nav is
 * eight items and a horizontal bar stops working somewhere around six. The
 * public site keeps its top nav: every class name here is portal-only and
 * `css/site.css` is untouched, so index.html and gallery.html are unaffected.
 *
 * `active` is the filename whose link should be lit. Detail pages (brand.html,
 * activity-detail.html) are not nav entries, so they pass their parent's
 * filename instead of their own.
 */
export function renderShell(active, profile) {
  const brand = profile.brands?.name || 'All brands';
  const staff = isStaff(profile);
  const contractor = isContractor(profile);
  // What the footer and the rail call this person. A contractor is named, not
  // labelled: "Eric Anderson", because the whole portal is scoped around who
  // they are and a generic word would be less informative, not more.
  const who = staff ? 'Admin' : contractor ? (profile.contractors?.name || 'Contractor') : brand;
  // The rail says WHO you are, the footer says WHAT you are. For a contractor
  // those were both the name, so the footer read "Nick Fatta · Nick Fatta".
  const roleLabel = staff ? 'Admin' : contractor ? 'Contractor' : brand;

  const group = (label, items) => `
    ${label ? `<p class="side-group-label">${esc(label)}</p>` : ''}
    <ul class="side-links">${items.map(([href, text]) =>
      `<li><a href="${href}"${href === active ? ' class="current"' : ''}>${esc(text)}</a></li>`
    ).join('')}</ul>`;

  // Group headings only earn their space when there is more than one group.
  // ADMIN IS A SUPERSET OF CONTRACTOR (operator, 27 Aug 2026): "an admin
  // should do everything a contractor can plus what it already could".
  // Nicholas and Phil run the business and also work accounts, so the staff
  // rail carries My accounts and My pay as well -- scoped to whoever the
  // profile's contractor_id names, exactly as it is for a contractor.
  const links = staff
    ? group('My work', CONTRACTOR_NAV_MINE) + group('Portal', NAV.slice(1))
      + group('Admin', ADMIN_NAV)
    : contractor
      ? group('My work', CONTRACTOR_NAV_MINE)
        + group('Look up', CONTRACTOR_NAV_LOOKUP)
        + group('Reference', CONTRACTOR_NAV_REFERENCE)
      : group('', NAV);

  const logo = (cls) => `
    <a href="index.html" class="${cls}">
      <img src="../images/ih_logo.png" alt="iHospitality" width="444" height="394" decoding="async"/>
      <span class="side-logo-text">i<span>Hospitality</span></span>
    </a>`;

  const rail = document.getElementById('shell-nav');
  rail.className = 'portal-sidebar';
  rail.innerHTML = `
    ${logo('side-logo')}
    <div class="side-scroll">${links}</div>
    <div class="side-foot">
      <span class="side-who">${esc(who)}</span>
      ${profile.full_name ? `<span class="side-name">${esc(profile.full_name)}</span>` : ''}
      <button class="link-btn" id="signout">Sign out</button>
    </div>`;

  // The same div the pages already carry, restyled: below 1100px it is a slim
  // top bar whose only job is to open the rail.
  const top = document.getElementById('shell-mobile');
  top.className = 'portal-topbar';
  top.innerHTML = `
    <button class="side-toggle" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="shell-nav">
      <span></span><span></span><span></span>
    </button>
    ${logo('top-logo')}`;

  const foot = document.getElementById('shell-footer');
  foot.className = 'portal-footer';
  foot.innerHTML = `
    <div class="footer-bottom">
      <p>&copy; ${new Date().getFullYear()} iHospitality. Private brand portal.</p>
      <p>Signed in as ${esc(profile.full_name || who)} &middot; ${esc(roleLabel)}</p>
    </div>`;

  // A tap target covering the page while the rail is out, so the next tap
  // anywhere closes it rather than hitting a control behind the overlay.
  let scrim = document.getElementById('portal-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.id = 'portal-scrim';
    scrim.className = 'portal-scrim';
    document.body.appendChild(scrim);
  }

  const burger = document.getElementById('burger');
  const setOpen = (open) => {
    rail.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    // Only lock the page behind the rail; on desktop the rail is always out and
    // this never runs.
    document.body.style.overflow = open ? 'hidden' : '';
  };

  document.getElementById('signout').onclick = signOut;
  burger.onclick = () => setOpen(!rail.classList.contains('open'));
  scrim.onclick = () => setOpen(false);
  rail.querySelectorAll('.side-links a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rail.classList.contains('open')) setOpen(false);
  });
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

/** Money, always to the cent. The reconciliation is fought at the cent (D107),
    so a figure that rounds to the dollar on screen cannot be checked. */
export function money(value) {
  return '$' + Number(value || 0).toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Read one query-string parameter. Everything a page reads from the URL is an
    id or a slug that goes into a WHERE clause, never into HTML — RLS decides
    what a lookup returns, so a guessed id is not a way in. */
export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

/**
 * A from/to month pair, populated from the months the data actually has.
 *
 * The month list is queried rather than generated so it can never offer a month
 * with nothing in it (D60 — no business fact compiled into a page). Defaults to
 * the last twelve months, matching the Streamlit Analysis page.
 *
 * `months` is a sorted-descending array of 'YYYY-MM'. Calls `onChange(from, to)`
 * once immediately and again on every change.
 */
export function monthRange(fromId, toId, months, onChange) {
  const from = document.getElementById(fromId);
  const to = document.getElementById(toId);
  if (!months.length) {
    from.style.display = to.style.display = 'none';
    onChange(null, null);
    return;
  }
  // OLDEST AT THE TOP, NEWEST AT THE BOTTOM. Asked for on 26 Aug 2026. The
  // caller hands `months` newest-first (it is the same array the page uses to
  // pick defaults), so the reversal happens HERE, on a copy, at render time.
  //
  // The two `.value` assignments below still index the ORIGINAL descending
  // array, and that is what keeps the opening range unchanged: a <select>'s
  // value is set by value, not by position, so reordering the options moves
  // nothing. From still opens on the 12th-newest month and To on the newest.
  const options = [...months].reverse().map(m =>
    `<option value="${esc(m)}">${esc(fmtMonth(m + '-01'))}</option>`).join('');
  from.innerHTML = options;
  to.innerHTML = options;
  from.value = months[Math.min(11, months.length - 1)];
  to.value = months[0];

  const fire = () => {
    // A backwards range would silently return nothing. Swap rather than scold.
    let a = from.value, b = to.value;
    if (a > b) [a, b] = [b, a];
    onChange(a, b);
  };
  from.addEventListener('change', fire);
  to.addEventListener('change', fire);
  fire();
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

/**
 * A sortable table, rendered into `el`.
 *
 * Same column definitions as table(), plus:
 *   sortValue(row) — what to order by, when it differs from what is displayed.
 *                    Dates need this: 'Aug 11, 2026' sorts alphabetically and
 *                    lands nowhere near August, so the raw ISO date is used.
 *   sortable: false — opt a column out.
 *
 * opts: { sort: <column head to sort by>, dir: 'asc'|'desc', onRowClick(row) }
 *
 * Sorting happens here rather than in SQL on purpose. A view per sort order
 * would be a dozen views that all say the same thing, and at these row counts
 * (about 1,100 activities) the browser reorders instantly. The aggregates stay
 * in SQL, where they are correctness-critical; ordering is presentation.
 */
export function sortableTable(el, rows, columns, opts = {}) {
  const live = columns.filter(c => c.always || rows.some(r => {
    const v = c.value ? c.value(r) : c.get(r);
    return v !== null && v !== undefined && v !== '' && v !== 0;
  }));

  let sortHead = opts.sort ?? null;
  let dir = opts.dir === 'asc' ? 1 : -1;

  const keyOf = (col, row) =>
    col.sortValue ? col.sortValue(row) : (col.value ? col.value(row) : col.get(row));

  function sorted() {
    const col = live.find(c => c.head === sortHead);
    if (!col) return rows;
    // Copy first: sort() mutates, and the caller's array is reused by the
    // filter controls on every redraw.
    return [...rows].sort((a, b) => {
      const x = keyOf(col, a), y = keyOf(col, b);
      // Blanks always sink to the bottom, whichever way the column is sorted —
      // a column of em-dashes at the top is never what someone wanted to see.
      const xe = x === null || x === undefined || x === '';
      const ye = y === null || y === undefined || y === '';
      if (xe && ye) return 0;
      if (xe) return 1;
      if (ye) return -1;
      const bothNumeric = typeof x !== 'object' && typeof y !== 'object'
        && x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y));
      if (bothNumeric) return (Number(x) - Number(y)) * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    });
  }

  function draw() {
    const body = sorted();
    const arrow = (c) => c.head !== sortHead ? '' : (dir === 1 ? ' ↑' : ' ↓');
    el.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>${live.map(c => c.sortable === false
        ? `<th class="${c.cls || ''}">${esc(c.head)}</th>`
        : `<th class="${c.cls || ''} sortable${c.head === sortHead ? ' sorted' : ''}"
             data-head="${esc(c.head)}" role="button" tabindex="0"
             aria-label="Sort by ${esc(c.head)}">${esc(c.head)}${arrow(c)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((r, i) => `<tr${opts.onRowClick ? ` class="clickable" data-i="${i}"` : ''}>${
        live.map(c => `<td class="${c.cls || ''}${c.nowrap ? ' nowrap' : ''}">${c.get(r) ?? ''}</td>`).join('')
      }</tr>`).join('')}</tbody></table></div>`;

    el.querySelectorAll('th.sortable').forEach(th => {
      const go = () => {
        const head = th.dataset.head;
        // Re-clicking the active column flips it; a new column starts descending,
        // which is what you want for dates and counts alike.
        if (head === sortHead) dir = -dir; else { sortHead = head; dir = -1; }
        draw();
      };
      th.onclick = go;
      th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });

    if (opts.onRowClick) {
      el.querySelectorAll('tr.clickable').forEach(tr => {
        tr.onclick = () => opts.onRowClick(body[Number(tr.dataset.i)]);
      });
    }
  }

  draw();
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
