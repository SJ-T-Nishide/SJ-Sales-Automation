// MAINワールドで動作 - ページのJS関数にアクセス可能
window.addEventListener('hg-profile-open', (e) => {
  if (typeof profile_open === 'function') profile_open(e.detail.userId);
});

window.addEventListener('hg-profile-close', () => {
  if (typeof profile_close === 'function') profile_close();
});

// alert抑制トグル（content.jsからCustomEventで制御）
let __hgAlertSuppressed = false;
window.addEventListener('hg-alert-toggle', (e) => {
  if (e.detail.suppress && !__hgAlertSuppressed) {
    window.__hgOrigAlert = window.alert;
    window.alert = function(m) { console.log('[東カレ] alert suppressed:', m); };
    __hgAlertSuppressed = true;
  } else if (!e.detail.suppress && __hgAlertSuppressed) {
    if (window.__hgOrigAlert) window.alert = window.__hgOrigAlert;
    delete window.__hgOrigAlert;
    __hgAlertSuppressed = false;
  }
});
