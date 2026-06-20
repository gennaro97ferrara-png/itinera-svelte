<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    tone?: 'default' | 'danger';
    onCancel: () => void;
    onConfirm: () => void;
  }

  let {
    open,
    title,
    message,
    confirmText = 'Conferma',
    tone = 'default',
    onCancel,
    onConfirm
  }: Props = $props();
</script>

{#if open}
<div class="modal-backdrop" role="presentation"
     onclick={e => { if (e.target === e.currentTarget) onCancel(); }}
     onkeydown={e => {
       if (e.key === 'Escape') onCancel();
       if (e.key === 'Enter') onConfirm();
     }}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       onclick={e => e.stopPropagation()}
       onkeydown={e => {
         e.stopPropagation();
         if (e.key === 'Escape') onCancel();
         if (e.key === 'Enter') onConfirm();
       }}>
    <div class="modal-title">
      <i class="ti {tone === 'danger' ? 'ti-trash' : 'ti-circle-check'}"></i> {title}
    </div>
    <p class="modal-hint">{message}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick={onCancel}>Annulla</button>
      <button class="btn {tone === 'danger' ? 'btn-danger' : 'btn-primary'}" onclick={onConfirm}>
        <i class="ti ti-check"></i> {confirmText}
      </button>
    </div>
  </div>
</div>
{/if}
