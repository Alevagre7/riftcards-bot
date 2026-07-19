// escapeHtml is used by send-card-preview to build Telegram HTML
// captions. The price formatter that used to live here was removed
// when the prices feature was disabled (see ADR scope).
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
