/* ============================================================
   Field logging — shared client for Log activity and My activity
   ============================================================
   docs/FIELD_LOGGING_PLAN.md, Phase 3. Everything a contractor WRITES goes
   through the `field_*` database functions (schema.sql Section 14), which check
   the login first and take who did the work from the login, never from here.
   Nothing in this file is security: a tampered copy of it can still only call
   those functions, and they refuse what is not the caller's to do.

   THREE JOBS, kept in one file so both pages behave identically:

   1. WHERE AND WHEN. The phone's location on save and per photo, never tracked
      in the background, never blocking a save when refused or unavailable.

   2. PHOTOS. Read the photo's own time and GPS BEFORE shrinking it (shrinking
      erases metadata), shrink to about 1600px, upload once under
      field/<my login id>/, copy inside storage for each extra brand line so
      every line has its own row and its own "brand can see" switch.

   3. NO SIGNAL. Every submission is written to an outbox on the phone FIRST,
      then sent. Each step carries an id made on the phone, so a retry after a
      dropped connection finds the work already done and does not duplicate
      it. The outbox lives in IndexedDB as app data; sw.js still never caches a
      database response.
   ============================================================ */

import { db, esc } from './portal.js';

export const BUCKET = 'activation-photos';

/* ---------- ids ---------- */

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID()
   : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
       const r = Math.random() * 16 | 0;
       return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
     }));

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A database refusal, in the words the database used. The field_* functions
    raise sentences written for a person ("this month is closed for the brand;
    ask the office to change it"), so they are shown as they are. */
export function errorText(error) {
  if (!error) return '';
  return String(error.message || error).replace(/^.*?ERROR:\s*/, '');
}

/* ---------- 1. where and when ---------- */

/**
 * The phone's position, or the reason there is none. Always resolves.
 *
 * A refusal is a FACT the database records ('denied'), not an error: the save
 * goes ahead and the office sees a "no location" flag. Ten seconds is the most
 * a person standing at a bar should wait for a satellite fix.
 */
export function getLocation() {
  const device_time = new Date().toISOString();
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ status: 'unavailable', device_time });
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        status: 'ok', source: 'device', device_time,
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy_m: Math.round(pos.coords.accuracy),
      }),
      err => resolve({
        status: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable',
        device_time,
      }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

/* ---------- 2. photos ---------- */

let exifModule = null;
async function exif() {
  // Loaded on first use, not with the page: most visits to My activity never
  // touch a photo, and the portal has no build step to split it for us.
  if (!exifModule) {
    exifModule = await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs');
  }
  return exifModule;
}

/**
 * Read what the photo says about itself, BEFORE it is shrunk.
 *
 * GPS is usually missing: iPhones strip location from photos handed to a
 * website, Android's picker increasingly does, and a photo taken through the
 * browser's camera often carries none. The time usually survives. Whatever is
 * missing is simply absent; the caller falls back to the phone's position.
 */
export async function readPhotoMeta(file) {
  try {
    const { parse } = await exif();
    const tags = await parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate'] }) || {};
    const taken = tags.DateTimeOriginal || tags.CreateDate || null;
    const hasGps = Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude);
    return {
      taken_at: taken instanceof Date && !isNaN(taken) ? taken.toISOString() : null,
      lat: hasGps ? tags.latitude : null,
      lng: hasGps ? tags.longitude : null,
    };
  } catch {
    return { taken_at: null, lat: null, lng: null };
  }
}

/**
 * Shrink to at most `max` pixels on the long side, as JPEG. Only the shrunk
 * version is ever kept (operator ruling).
 *
 * If this browser cannot decode the file (an HEIC on a desktop, say), the
 * original is sent as it is rather than refusing the photo, as long as it is a
 * sensible size.
 */
export async function shrinkPhoto(file, max = 1600, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob) return { blob, type: 'image/jpeg', ext: 'jpg' };
  } catch { /* fall through */ }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('This photo could not be read and is too large to send as it is.');
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return { blob: file, type: file.type || 'application/octet-stream', ext };
}

/**
 * Turn picked files into outbox-ready photos: metadata read, shrunk, and the
 * phone's position captured now for any photo that carried no GPS of its own.
 */
export async function preparePhotos(files) {
  const out = [];
  let here = null;
  for (const file of files) {
    const meta = await readPhotoMeta(file);
    const shrunk = await shrinkPhoto(file);
    let location;
    if (meta.lat !== null) {
      location = { source: 'photo_exif', status: 'ok', lat: meta.lat, lng: meta.lng,
                   taken_at: meta.taken_at, device_time: new Date().toISOString() };
    } else {
      here = here || await getLocation();
      location = { ...here, taken_at: meta.taken_at };
    }
    out.push({ id: newId(), blob: shrunk.blob, type: shrunk.type, ext: shrunk.ext,
               taken_at: meta.taken_at, location, consent: false,
               // brand ids that must NOT see this photo; empty = every brand sees it
               hiddenFor: [] });
  }
  return out;
}

/** Upload a file once. An already-existing object is the same upload retried. */
async function uploadOnce(path, blob, type) {
  const { error } = await db.storage.from(BUCKET).upload(path, blob,
    { contentType: type, upsert: false });
  if (error && !/exist|duplicate/i.test(error.message || '')) throw error;
}

async function copyOnce(from, to) {
  const { error } = await db.storage.from(BUCKET).copy(from, to);
  if (error && !/exist|duplicate/i.test(error.message || '')) throw error;
}

/**
 * Put one prepared photo on every brand line of a group.
 * `lines` is [{activity_id, brand_id}]. Paths are derived from the photo id,
 * so every step is safe to repeat.
 */
export async function attachPhoto(userId, groupId, photo, lines) {
  const base = `field/${userId}/${groupId}/${photo.id}`;
  const first = `${base}.${photo.ext}`;
  await uploadOnce(first, photo.blob, photo.type);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const path = i === 0 ? first : `${base}-${i}.${photo.ext}`;
    if (i > 0) await copyOnce(first, path);
    const { error } = await db.rpc('field_attach_photo', {
      p_activity: line.activity_id,
      p_storage_path: path,
      p_consent: !!photo.consent,
      p_brand_visible: !(photo.hiddenFor || []).includes(line.brand_id),
      p_taken_at: photo.taken_at,
      p_location: photo.location,
    });
    if (error) throw error;
  }
}

/* ---------- 3. no signal: the outbox ---------- */

const DB_NAME = 'ih-field';
const STORE = 'outbox';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.result.createObjectStore('drafts', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const conn = await idb();
  return new Promise((resolve, reject) => {
    const t = conn.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const outboxAll = () => tx(STORE, 'readonly', s => s.getAll());
export const outboxPut = (item) => tx(STORE, 'readwrite', s => s.put(item));
export const outboxDelete = (id) => tx(STORE, 'readwrite', s => s.delete(id));

export const draftGet = (key) => tx('drafts', 'readonly', s => s.get(key));
export const draftPut = (key, value) => tx('drafts', 'readwrite', s => s.put({ key, value, at: Date.now() }));
export const draftDelete = (key) => tx('drafts', 'readwrite', s => s.delete(key));

/**
 * Send one outbox item. Every call below is idempotent on an id the phone
 * made, so an item that half-sent before the signal dropped finishes here
 * without duplicating what already landed.
 *
 * Item shapes:
 *   { kind:'checkin',  id, venue:{id}|{new...}, note, location }
 *   { kind:'activity', id, venue:{id}|{new...}, close_date, name, lines:[...],
 *     checkin_id, location, photos:[...] }
 *   { kind:'photos',   id, group_id, photos:[...] }
 */
export async function sendItem(item, userId) {
  const wasNew = item.venue && !item.venue.id;
  const venueId = await ensureVenue(item.venue);
  // The new venue's id and its saved contacts are written back BEFORE the next
  // step, so a failure after this point never creates the contacts twice.
  if (wasNew) await outboxPut(item);

  if (item.kind === 'checkin') {
    const { error } = await db.rpc('field_check_in', {
      p_client_ref: item.id, p_venue_id: venueId, p_note: item.note || null,
      p_location: item.location, p_device_time: item.location?.device_time || null });
    if (error) throw error;
    return;
  }

  let groupId = item.group_id || null;
  if (item.kind === 'activity') {
    const { data, error } = await db.rpc('field_log_activity', {
      p_client_ref: item.id, p_venue_id: venueId, p_close_date: item.close_date,
      p_name: item.name, p_lines: item.lines, p_location: item.location,
      p_device_time: item.location?.device_time || null,
      p_checkin_id: item.checkin_id || null });
    if (error) throw error;
    groupId = data;
    // Remember the group so a retry of the photo half does not re-log.
    item.group_id = groupId;
    await outboxPut(item);
  }

  if (item.photos?.length) {
    const { data: lines, error } = await db.from('v_internal_activity')
      .select('activity_id, brand_id, month_released').eq('activity_group_id', groupId)
      .order('activity_id');
    if (error) throw error;
    // A line whose brand's month is already closed cannot take a photo (the
    // database refuses it), so it is skipped rather than failing the others.
    const open = (lines || []).filter(l => !l.month_released);
    for (const photo of item.photos) {
      if (photo.done) continue;
      await attachPhoto(userId, groupId, photo, open);
      photo.done = true;
      await outboxPut(item);
    }
  }
}

/** A venue picked from the list is an id; a new one is created first, once. */
async function ensureVenue(venue) {
  if (!venue) return null;
  if (venue.id) return venue.id;
  const { data, error } = await db.rpc('field_create_venue', {
    p_client_ref: venue.client_ref, p_name: venue.name, p_city: venue.city || null,
    p_note: venue.note || null, p_location: venue.location || null });
  if (error) throw error;
  for (const c of venue.contacts || []) {
    // A contact is saved at most once: its outbox copy is marked as it lands.
    if (c.saved) continue;
    const { error: ce } = await db.rpc('field_save_contact', {
      p_venue_id: data, p_contact_id: null,
      p_first_name: c.first_name || null, p_last_name: c.last_name || null,
      p_job_title: c.job_title || null, p_phone: c.phone || null,
      p_email: c.email || null, p_best_time: c.best_time || null,
      p_notes: c.notes || null });
    if (ce) throw ce;
    c.saved = true;
  }
  venue.id = data;
  return data;
}

/**
 * Send everything waiting. Returns {sent, failed}. A failure keeps the item and
 * records why, so the page can show "Not sent yet" with the reason; a refusal
 * from the database (not a lost connection) is marked so it stops retrying on
 * its own and waits for the person to fix or discard it.
 */
let flushing = null;
export function flushOutbox(userId) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0, failed = 0;
    for (const item of await outboxAll()) {
      if (item.blocked) { failed++; continue; }
      try {
        await sendItem(item, userId);
        await outboxDelete(item.id);
        sent++;
      } catch (e) {
        failed++;
        item.error = errorText(e);
        // A network failure has no Postgres code; a refusal does. Only the
        // network kind retries by itself.
        item.blocked = !!(e && (e.code || e.status === 400));
        await outboxPut(item);
      }
    }
    return { sent, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Retry whenever the phone says it is back online, and on a timer while open. */
export function keepFlushing(userId, onChange) {
  const run = async () => {
    const r = await flushOutbox(userId);
    if (onChange && (r.sent || r.failed)) onChange(r);
  };
  window.addEventListener('online', run);
  setInterval(run, 60000);
  return run;
}

/* ---------- small shared UI ---------- */

/**
 * A venue picker: type to search every venue, or create a new one with name,
 * city, contacts and a note. Calls onPick({id,name,city}) or onPick({new:true,...}).
 *
 * "Did you mean…?" is the search itself: typing a name shows the venues that
 * already contain those words BEFORE the create button is reachable, so the
 * duplicate is seen first. It suggests; the person decides (D163).
 */
export function venuePicker(el, onPick, initial = null) {
  el.innerHTML = `
    <div class="fx-venue">
      <input type="search" class="fx-input" placeholder="Search venues…" autocomplete="off">
      <div class="fx-venue-results"></div>
      <div class="fx-venue-picked" hidden></div>
    </div>`;
  const input = el.querySelector('input');
  const results = el.querySelector('.fx-venue-results');
  const picked = el.querySelector('.fx-venue-picked');
  let timer = null;

  const showPicked = (v) => {
    input.hidden = true; results.innerHTML = '';
    picked.hidden = false;
    picked.innerHTML = `<div class="fx-chip">
        <span><strong>${esc(v.name)}</strong>${v.city ? ` · ${esc(v.city)}` : ''}${v.new ? ' <em>(new)</em>' : ''}</span>
        <button type="button" class="link-btn">Change</button></div>`;
    picked.querySelector('button').onclick = () => {
      picked.hidden = true; input.hidden = false; input.value = ''; input.focus();
      onPick(null);
    };
    onPick(v);
  };

  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    // Every word must appear, in any order: "napoli bella" finds Bella Napoli.
    let query = db.from('venues').select('id, name, city').order('name').limit(12);
    for (const word of q.split(/\s+/).filter(Boolean)) query = query.ilike('name', `%${word}%`);
    const { data, error } = await query;
    if (error) { results.innerHTML = `<div class="err">${esc(errorText(error))}</div>`; return; }
    results.innerHTML = (data || []).map((v, i) =>
      `<button type="button" class="fx-result" data-i="${i}"><strong>${esc(v.name)}</strong>${v.city ? ` · ${esc(v.city)}` : ''}</button>`).join('')
      + `<button type="button" class="fx-result fx-create">+ Create new venue “${esc(q)}”</button>`;
    results.querySelectorAll('.fx-result[data-i]').forEach(b =>
      b.onclick = () => showPicked(data[Number(b.dataset.i)]));
    results.querySelector('.fx-create').onclick = () => openCreate(q, (data || []).length);
  };

  const openCreate = (name, similar) => {
    results.innerHTML = `
      <div class="fx-card">
        ${similar ? `<p class="hint">${similar} existing venue${similar === 1 ? '' : 's'} above match what you typed. Make sure this is not one of them.</p>` : ''}
        <label class="fx-label">Venue name<input class="fx-input" name="name" value="${esc(name)}"></label>
        <label class="fx-label">City<input class="fx-input" name="city"></label>
        <label class="fx-label">Notes<textarea class="fx-input" name="note" rows="2"></textarea></label>
        <p class="fx-label">Manager / owner</p>
        <div class="fx-contact">
          <input class="fx-input" name="first_name" placeholder="First name">
          <input class="fx-input" name="last_name" placeholder="Last name">
          <input class="fx-input" name="job_title" placeholder="Role (manager, owner, buyer)">
          <input class="fx-input" name="phone" placeholder="Phone" type="tel">
          <input class="fx-input" name="email" placeholder="Email" type="email">
          <input class="fx-input" name="best_time" placeholder="Best time to reach (e.g. Tue–Thu after 2pm)">
        </div>
        <div class="fx-row">
          <button type="button" class="btn-full fx-go">Use this new venue</button>
          <button type="button" class="link-btn fx-cancel">Cancel</button>
        </div>
      </div>`;
    const card = results.querySelector('.fx-card');
    const val = (n) => card.querySelector(`[name="${n}"]`).value.trim();
    card.querySelector('.fx-cancel').onclick = () => { results.innerHTML = ''; };
    card.querySelector('.fx-go').onclick = async () => {
      if (!val('name')) { card.querySelector('[name="name"]').focus(); return; }
      const contact = { first_name: val('first_name'), last_name: val('last_name'),
        job_title: val('job_title'), phone: val('phone'), email: val('email'),
        best_time: val('best_time') };
      const hasContact = contact.first_name || contact.last_name;
      showPicked({ new: true, client_ref: newId(), name: val('name'), city: val('city'),
                   note: val('note'), contacts: hasContact ? [contact] : [],
                   location: await getLocation() });
    };
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  if (initial) showPicked(initial);
}
