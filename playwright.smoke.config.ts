import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/smoke',testMatch:'*.spec.ts',workers:1,retries:0,timeout:30000,use:{baseURL:'https://mendocean.fyi',browserName:'chromium',trace:'off',screenshot:'off'}});
