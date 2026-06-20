<script lang="ts">
  import { fly } from 'svelte/transition';

  interface LoadFeature {
    icon: string;
    color: string;
    title: string;
    text: string;
  }

  interface Props {
    features: LoadFeature[];
    activeIndex: number;
    step: string;
  }

  let { features, activeIndex, step }: Props = $props();
  let feature = $derived(features[activeIndex] ?? features[0]);
</script>

{#if feature}
<div class="loading-overlay">
  {#key activeIndex}
  <div class="load-feature" in:fly={{ y: 16, duration: 320 }}>
    <div class="load-feature-icon" style="background:{feature.color}1A; color:{feature.color}">
      <i class="ti {feature.icon}"></i>
    </div>
    <h2 class="load-feature-title">{feature.title}</h2>
    <p class="load-feature-text">{feature.text}</p>
  </div>
  {/key}

  <div class="load-dots">
    {#each features as _, i}
    <span class="load-dot {i === activeIndex ? 'on' : ''}"></span>
    {/each}
  </div>

  <div class="load-spinner-row">
    <span class="load-ring"></span>
    <span class="load-step">{step}</span>
  </div>
</div>
{/if}
