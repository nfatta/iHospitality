/* ============================================================
   Venue page — the field tools (contacts, notes, report a problem)
   ============================================================
   docs/FIELD_LOGGING_PLAN.md section 3. Loaded by venue.html only for a login
   that can log field work. Every write is a field_* database function, which
   checks the login itself; nothing here is the lock.

   CONTACTS ARE NEVER MATCHED OR MERGED BY NAME (D152): four different people
   are called Dan. Each contact is edited through its own id.
   ============================================================ */

import { db, esc, fmtDate } from './portal.js';
import { errorText } from './field.js';

const FIELDS = [
  ['first_name', 'First name'], ['last_name', 'Last name'],
  ['job_title', 'Role (manager, owner, buyer)'], ['phone', 'Phone'],
  ['email', 'Email'], ['best_time_to_reach', 'Best time to reach'],
  ['notes', 'Notes about them'],
];

export async function drawFieldTools(el, venueId) {
  const { data: people, error } = await db.from('v_venue_contact')
    .select('contact_id, contact_name, first_name, last_name, job_title, phone, email, best_time_to_reach, notes, is_current')
    .eq('venue_id', venueId).order('is_current', { ascending: false });

  const contactForm = (c = {}) => `<div class="fx-card" data-form>
      <div class="fx-contact">${FIELDS.map(([k, label]) =>
        `<input class="fx-input" data-k="${k}" placeholder="${esc(label)}" value="${esc(c[k] || '')}">`).join('')}</div>
      ${c.contact_id ? `<label class="fx-label" style="flex-direction:row;gap:0.5rem;align-items:center">
        <input type="checkbox" data-current ${c.is_current === false ? '' : 'checked'}> Still works here</label>` : ''}
      <div class="fx-row"><button class="btn-full" data-save>Save contact</button>
        <button class="link-btn" data-cancel>Cancel</button></div></div>`;

  el.innerHTML = `
    <section class="fx-section">
      <h2>Contacts</h2>
      ${error ? `<div class="err">${esc(errorText(error))}</div>` : ''}
      <ul class="fx-list">${(people || []).map(p => `<li data-contact="${p.contact_id}">
          <span><strong>${esc(p.contact_name || 'No name recorded')}</strong>
            ${p.job_title ? `<span class="fx-muted"> · ${esc(p.job_title)}</span>` : ''}
            ${p.is_current === false ? '<span class="fx-lock"> · no longer there</span>' : ''}
            ${[p.phone, p.email].filter(Boolean).length ? `<br><span class="fx-muted">${esc([p.phone, p.email].filter(Boolean).join(' · '))}</span>` : ''}
            ${p.best_time_to_reach ? `<br><span class="fx-muted">Best time: ${esc(p.best_time_to_reach)}</span>` : ''}
            ${p.notes ? `<br><span class="fx-muted">${esc(p.notes)}</span>` : ''}</span>
          <button class="fx-btn" data-edit style="flex:0 0 auto">Edit</button>
          <div data-slot style="flex-basis:100%"></div></li>`).join('')}</ul>
      <div data-add-slot></div>
      <button class="fx-btn" data-add>+ Add a contact</button>
    </section>

    <section class="fx-section">
      <h2>Add a note</h2>
      <textarea class="fx-input" rows="2" data-note placeholder="e.g. closed Mondays; new GM starts in October"></textarea>
      <div class="fx-row" style="margin-top:0.6rem"><button class="fx-btn" data-note-save>Save note</button>
        <span class="fx-muted" data-note-msg></span></div>
    </section>

    <section class="fx-section">
      <h2>Report a problem with this venue</h2>
      <label class="fx-label">What is wrong
        <select data-kind>
          <option value="moved">It has moved</option>
          <option value="closed">It has closed</option>
          <option value="wrong_name">The name is wrong</option>
          <option value="duplicate">It is a duplicate of another venue</option>
          <option value="other">Something else</option>
        </select></label>
      <label class="fx-label">Details<textarea class="fx-input" rows="2" data-problem-note></textarea></label>
      <div class="fx-row"><button class="fx-btn" data-report>Send to the office</button>
        <span class="fx-muted" data-report-msg></span></div>
      <p class="fx-muted">For a duplicate, say which venue in the details; the office merges them.</p>
    </section>`;

  const saveContact = async (box, contactId) => {
    const val = (k) => box.querySelector(`[data-k="${k}"]`).value.trim();
    if (!contactId && !val('first_name') && !val('last_name')) {
      return alert('A contact needs a name.');
    }
    const current = box.querySelector('[data-current]');
    const { error } = await db.rpc('field_save_contact', {
      p_venue_id: venueId, p_contact_id: contactId || null,
      p_first_name: val('first_name'), p_last_name: val('last_name'),
      p_job_title: val('job_title'), p_phone: val('phone'), p_email: val('email'),
      p_best_time: val('best_time_to_reach'), p_notes: val('notes'),
      p_is_current: current ? current.checked : true,
    });
    if (error) return alert(errorText(error));
    drawFieldTools(el, venueId);
  };

  el.querySelectorAll('[data-contact]').forEach(li => {
    li.querySelector('[data-edit]').onclick = () => {
      const c = (people || []).find(p => String(p.contact_id) === li.dataset.contact);
      const slot = li.querySelector('[data-slot]');
      slot.innerHTML = contactForm(c);
      slot.querySelector('[data-cancel]').onclick = () => { slot.innerHTML = ''; };
      slot.querySelector('[data-save]').onclick = () => saveContact(slot, c.contact_id);
    };
  });

  el.querySelector('[data-add]').onclick = () => {
    const slot = el.querySelector('[data-add-slot]');
    slot.innerHTML = contactForm();
    slot.querySelector('[data-cancel]').onclick = () => { slot.innerHTML = ''; };
    slot.querySelector('[data-save]').onclick = () => saveContact(slot, null);
  };

  el.querySelector('[data-note-save]').onclick = async () => {
    const body = el.querySelector('[data-note]').value.trim();
    if (!body) return;
    const { error } = await db.rpc('field_add_venue_note', { p_venue_id: venueId, p_body: body });
    el.querySelector('[data-note-msg]').textContent = error ? errorText(error)
      : `Saved ${fmtDate(new Date().toISOString().slice(0, 10))}. Reload to see it in Notes.`;
    if (!error) el.querySelector('[data-note]').value = '';
  };

  el.querySelector('[data-report]').onclick = async () => {
    const kind = el.querySelector('[data-kind]').value;
    const note = el.querySelector('[data-problem-note]').value.trim();
    if (kind === 'duplicate' && !note) return alert('Say which venue it duplicates.');
    // A duplicate is reported by name in the note: the function's
    // duplicate_of id is for the admin, where the operator picks the venue.
    const { error } = await db.rpc('field_report_venue_problem', {
      p_venue_id: venueId, p_kind: kind === 'duplicate' ? 'other' : kind,
      p_note: kind === 'duplicate' ? `Duplicate of: ${note}` : note, p_duplicate_of: null });
    el.querySelector('[data-report-msg]').textContent = error ? errorText(error) : 'Sent. Thank you.';
    if (!error) el.querySelector('[data-problem-note]').value = '';
  };
}
