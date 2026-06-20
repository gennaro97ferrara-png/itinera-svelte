<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    label: string;
    value?: string;
    placeholder?: string;
    confirmText?: string;
    onCancel: () => void;
    onConfirm: (value: string) => void;
  }

  let {
    open,
    title,
    label,
    value = '',
    placeholder = '',
    confirmText = 'Salva',
    onCancel,
    onConfirm
  }: Props = $props();

  let draft = $state('');

  $effect(() => {
    if (open) draft = value;
  });

  function submit() {
    const name = draft.trim();
    if (!name) return;
    onConfirm(name);
  }
</script>

{#if open}
<div class="modal-backdrop" role="presentation"
     onclick={e => { if (e.target === e.currentTarget) onCancel(); }}
     onkeydown={e => {
       if (e.key === 'Escape') onCancel();
       if (e.key === 'Enter') submit();
     }}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       onclick={e => e.stopPropagation()}
       onkeydown={e => {
         e.stopPropagation();
         if (e.key === 'Escape') onCancel();
       }}>
    <div class="modal-title"><i class="ti ti-pencil"></i> {title}</div>
    <label class="modal-field">
      <span>{label}</span>
      <input
        type="text"
        bind:value={draft}
        {placeholder}
        onkeydown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </label>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick={onCancel}>Annulla</button>
      <button class="btn btn-primary" onclick={submit} disabled={!draft.trim()}>
        <i class="ti ti-check"></i> {confirmText}
      </button>
    </div>
  </div>
</div>
{/if}
