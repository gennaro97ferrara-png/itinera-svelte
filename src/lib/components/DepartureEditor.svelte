<script lang="ts">
  import { app } from '$lib/stores/app.svelte';

  // Editor data+ora di partenza con input nativi VISIBILI: si aprono in modo
  // affidabile su iOS, Android e desktop (niente overlay opacity:0).

  function pad2(n: number): string { return String(n).padStart(2, '0'); }
  function iso(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function setNow() { const d = new Date(); d.setSeconds(0, 0); app.departureAt = iso(d); }
  function setAt(dayOffset: number, hour: number, minute = 0) {
    const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, minute, 0, 0);
    app.departureAt = iso(d);
  }

  let datePart = $derived(app.departureAt ? app.departureAt.slice(0, 10) : '');
  let timePart = $derived(app.departureAt ? app.departureAt.slice(11, 16) : '');

  function onDate(v: string) {
    if (!v) { app.departureAt = ''; return; }
    app.departureAt = `${v}T${timePart || '09:00'}`;
  }
  function onTime(v: string) {
    if (!v) return;
    const d = datePart || (() => { const n = new Date(); return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; })();
    app.departureAt = `${d}T${v}`;
  }
</script>

<div class="dep-edit">
  <div class="dep-edit-presets">
    <button type="button" class="plan-chip" onclick={setNow}>Adesso</button>
    <button type="button" class="plan-chip" onclick={() => setAt(0, 9)}>Oggi 9:00</button>
    <button type="button" class="plan-chip" onclick={() => setAt(1, 9)}>Domani 9:00</button>
    {#if app.departureAt}
    <button type="button" class="plan-chip plan-chip--clear" aria-label="rimuovi orario"
            onclick={() => app.departureAt = ''}><i class="ti ti-x"></i></button>
    {/if}
  </div>
  <div class="dep-edit-fields">
    <label class="dep-edit-field">
      <i class="ti ti-calendar"></i>
      <input type="date" value={datePart}
             oninput={e => onDate((e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="dep-edit-field">
      <i class="ti ti-clock"></i>
      <input type="time" value={timePart}
             oninput={e => onTime((e.currentTarget as HTMLInputElement).value)} />
    </label>
  </div>
</div>

<style>
  .dep-edit { display: flex; flex-direction: column; gap: 10px; }
  .dep-edit-presets { display: flex; gap: 6px; flex-wrap: wrap; }
  .dep-edit-fields { display: flex; gap: 8px; }
  .dep-edit-field {
    flex: 1; display: flex; align-items: center; gap: 8px;
    border: 1.5px solid var(--line); border-radius: var(--r-lg);
    padding: 10px 12px; background: var(--surface); transition: border-color .15s;
    min-width: 0;
  }
  .dep-edit-field:focus-within { border-color: var(--accent); }
  .dep-edit-field > .ti { font-size: 16px; color: var(--accent); flex-shrink: 0; }
  .dep-edit-field input {
    flex: 1; min-width: 0; border: none; background: transparent; outline: none;
    font-family: inherit; font-size: 16px; font-weight: 600; color: var(--ink);
  }
  /* iOS: normalizza l'aspetto degli input nativi */
  .dep-edit-field input::-webkit-date-and-time-value { text-align: left; }
  .dep-edit-field input::-webkit-calendar-picker-indicator { cursor: pointer; opacity: .6; }
</style>
