import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./test',testMatch:'planet-ui.spec.js',workers:1,timeout:60000,
  use:{baseURL:'http://localhost:5178',channel:'chrome',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
  outputDir:'../artifacts/planet-ui/test-results',reporter:'list'});
