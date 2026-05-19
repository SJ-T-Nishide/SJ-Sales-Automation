// login-save.js — 初回手動ログイン → airdna-auth.json 保存
// 実行: npm run login
// ※ 初回またはCookieが切れたときのみ実行
//
// 注意: .env の HEADLESS=false にしてから実行してください
//       HEADLESS=true だとブラウザが表示されず手動ログインできません

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const readline     = require('readline');
const path         = require('path');

async function waitForEnter() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('AirDNAへのログインが完了したら Enter を押してください...\n', () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const headless = process.env.HEADLESS === 'true';

  if (headless) {
    console.warn('[warn] HEADLESS=true になっています。手動ログインのため .env で HEADLESS=false に変更してください。');
    process.exit(1);
  }

  const authPath = path.join(__dirname, 'airdna-auth.json');

  console.log('ブラウザを起動します...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto('https://app.airdna.co');
  console.log('AirDNA を開きました。ブラウザ画面で手動ログインしてください。');
  console.log('（ログイン後、このターミナルに戻って Enter を押してください）');

  await waitForEnter();

  await context.storageState({ path: authPath });
  console.log('✅ airdna-auth.json に認証情報を保存しました。');
  console.log('   次回からは playwright_airdna.js が自動でログイン状態を復元します。');

  await browser.close();
})();
