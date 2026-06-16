// document_start で登録。ページスクリプトより先に window capture に入る。
// click + touch/pointer: 東カレはモバイルSPAでtouchstartでナビゲートするため
//   ボタン要素に限定してtouchstart/pointerdownをstopPropagation + preventDefault。
//   パネル全体へのスクロールは殺さないようbutton/a/input/labelのみ対象。
const HG_SEL = '#hg-match-panel, #hg-send-now, #hg-float-stop, #hg-reply-panel';
const BTN_SEL = 'button, a, input, label, .hg-track-badge';

['click', 'mousedown', 'touchstart', 'touchend', 'pointerdown'].forEach(function (type) {
  window.addEventListener(type, function (e) {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest(HG_SEL)) return;
    e.stopPropagation();
    // touchstart/pointerdown のみ合成click抑止（スクロールはbutton要素限定で殺す）
    if ((type === 'touchstart' || type === 'pointerdown') && t.closest(BTN_SEL)) {
      e.preventDefault();
    }
  }, true);
});
