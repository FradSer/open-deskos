;
(function (root) {
  'use strict'

  /*
   * Pixelarticons (https://github.com/halfmage/pixelarticons, MIT) path data
   * keyed by the shell's svg[data-tabler] icon names, for the Pixel theme's
   * icon swap (core/icons.js). Pure data. See PIXELARTICONS-NOTICE.md.
   */
  root.PIXELARTICON_PATHS = {
    'book-open': '<path d="M11 5h2v14h-2zM3 4h5a4 4 0 0 1 4 4v11a4 4 0 0 0-4-4H3zm18 0h-5a4 4 0 0 0-4 4v11a4 4 0 0 1 4-4h5z"/>',
    'bolt': '<path d="M4 6h7v2H4zm0 10h7v2H4zM2 8h2v8H2zm18-2h-7v2h7zm0 10h-7v2h7zm2-8h-2v8h2zM7 11h10v2H7z"/>',
    'chevron-down': '<path d="M13 16h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 10H5V8h2v2Zm12 0h-2V8h2v2Z"/>',
    'chevron-left': '<path d="M8 13v-2h2v2H8Zm2-2V9h2v2h-2Zm0 4v-2h2v2h-2Zm2-6V7h2v2h-2Zm0 8v-2h2v2h-2Zm2-10V5h2v2h-2Zm0 12v-2h2v2h-2Z"/>',
    'device-desktop': '<path d="M6 1h12v2H6zm0 8h12v2H6zM4 3h2v6H4zm14 0h2v6h-2zM4 13h16v2H4zm0 8h16v2H4zm-2-6h2v6H2zm18 0h2v6h-2zM6 17h2v2H6zm4 0h8v2h-8zm-2-6h2v2H8zm6 0h2v2h-2z"/>',
    'file-code': '<path d="M11 18H9v-4h2v4Zm-4-1H5v-2h2v2Zm12-2v2h-2v-2h2ZM5 15H3v-2h2v2Zm16 0h-2v-2h2v2Zm-8-1h-2v-4h2v4ZM3 13H1v-2h2v2Zm20 0h-2v-2h2v2ZM5 11H3V9h2v2Zm16 0h-2V9h2v2Zm-6-1h-2V6h2v4ZM7 9H5V7h2v2Zm12 0h-2V7h2v2Z"/>',
    'folder': '<path d="M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z"/>',
    'leaf': '<path d="M1 18h2v4H1zm2-2h2v2H3zm2-2h6v2H5zm6-2h2v2h-2zm-6 6h4v2H5zm4 2h4v2H9zm4-2h4v2h-4zm4-2h2v2h-2zm2-8h2v8h-2zm0-4h2v4h-2zm-2-2h2v2h-2zm-4 2h4v2h-4zM7 6h6v2H7zM5 8h2v2H5zm-2 2h2v4H3z"/>',
    'message': '<path d="M20 2H4v2h16zm0 14H6v2h14zm2-12h-2v12h2zM4 4H2v18h2zm2 14H4v2h2z"/>',
    'mood-smile': '<path d="M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM7 13h2v2H7zm2 2h6v2H9zm6-2h2v2h-2zM8 8h2v2H8zm6 0h2v2h-2z"/>',
    'refresh': '<path d="M13 20H9V18H13V20ZM19 16H21V18H19V20H17V18H15V16H17V8H19V16ZM9 18H7V16H9V18ZM7 6H9V8H7V16H5V8H3V6H5V4H7V6ZM15 16H13V14H15V16ZM23 16H21V14H23V16ZM3 10H1V8H3V10ZM11 10H9V8H11V10ZM17 8H15V6H17V8ZM15 6H11V4H15V6Z"/>',
    'settings': '<path d="M4 14h2v6H4zm6 0h2v6h-2zm-4-2h4v2H6zm0 8h4v2H6zm-4-4h2v2H2zm20-8h-4V6h4z"/><path d="M10 16h12v2H10zm4-8H2V6h12zm6-4v2h-2V4zm0 6V8h-2v2zm-6-8h4v2h-4zm0 10h4v-2h-4zm-2-8h2v2h-2zm0 6h2V8h-2z"/>',
    'user-off': '<path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm16 2h2v2h-2zM8 14h6v2H8zm-2 2h2v2H6zm10 0h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm-4 4h2v2h-2z"/>',
    'user-scan': '<path d="M9 11h2v2H9zm4 0h2v2h-2zM7 7h10v2H7zM5 9h2v6H5zm2 6h10v2H7zm10-6h2v6h-2zm-6-4h2v2h-2zM4 2h4v2H4zm0 18h4v2H4zM16 2h4v2h-4zm0 18h4v2h-4zM2 4h2v4H2zm0 12h2v4H2zM20 4h2v4h-2zm0 12h2v4h-2z"/>',
  }
})(typeof window !== 'undefined' ? window : globalThis)
