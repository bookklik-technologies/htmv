import { h } from 'vue';
import DefaultTheme from 'vitepress/theme-without-fonts';
import HomeIntroduction from './HomeIntroduction.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'home-hero-after': () => h(HomeIntroduction)
  })
};
