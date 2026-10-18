<script setup lang="ts">
import videoUrl from '../../../examples/product-intro/htmv-product-introduction.mp4?url';
import posterUrl from '../../../examples/shared/posters/product-intro.png?url';
</script>

<template>
  <section class="home-introduction" aria-labelledby="product-introduction-title">
    <div class="container">
      <h2 id="product-introduction-title">Meet HTMV in 60 seconds</h2>
      <video
        controls
        playsinline
        preload="none"
        width="1920"
        height="1080"
        :src="videoUrl"
        :poster="posterUrl"
        aria-label="HTMV product introduction"
      >
        <a :href="videoUrl">Download the HTMV product introduction video.</a>
      </video>
    </div>
  </section>
</template>

<style scoped>
.home-introduction {
  padding: 0 24px 48px;
}

.container {
  max-width: 1152px;
  margin: 0 auto;
}

h2 {
  margin-bottom: 20px;
  color: var(--vp-c-text-1);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.4;
}

video {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #000;
}

@media (min-width: 640px) {
  .home-introduction {
    padding: 0 48px 64px;
  }
}

@media (min-width: 960px) {
  .home-introduction {
    padding-right: 64px;
    padding-left: 64px;
  }
}
</style>
