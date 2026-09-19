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
    'brand-google': '<path d="M8 4h8v2H8zm-4 4h2V6h2v2H6v8h2v2H6v-2H4zm4 10h8v2H8zm8-12h2v2h-2zm0 10h2v2h-2zm-4-6h10v2h-2v4h-2v-4h-6z"/>',
    // Four planar corner brackets on the 24 grid: the same viewfinder the
    // camera tile draws with stroked paths in the Instrument theme.
    'camera-viewfinder': '<path d="M3 3h6v2H5v4H3zM15 3h6v6h-2V5h-4zM21 15v6h-6v-2h4v-4zM3 15h2v4h4v2H3z"/>',
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
    'sparkles': '<path d="M5 2h2v3h3v2H7v3H5V7H2V5h3zm10 8h2v3h3v2h-3v3h-2v-3h-3v-2h3zm-6 7h2v2h2v2h-2v2H9v-2H7v-2h2z"/>',
    'terminal-2': '<path d="M2 3h20v18H2zm2 2v14h16V5zm3 3h2v2H7zm2 2h2v2H9zm-2 2h2v2H7zm6 2h4v2h-4z"/>',
    'user-off': '<path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm16 2h2v2h-2zM8 14h6v2H8zm-2 2h2v2H6zm10 0h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm-4 4h2v2h-2z"/>',
    'user-scan': '<path d="M9 11h2v2H9zm4 0h2v2h-2zM7 7h10v2H7zM5 9h2v6H5zm2 6h10v2H7zm10-6h2v6h-2zm-6-4h2v2h-2zM4 2h4v2H4zm0 18h4v2H4zM16 2h4v2h-4zm0 18h4v2h-4zM2 4h2v4H2zm0 12h2v4H2zM20 4h2v4h-2zm0 12h2v4h-2z"/>',
    'wifi': '<path d="M11 19h2v2h-2zm-4-3h2v2H7zm8 0h2v2h-2zm-6-2h6v2H9zm-5-1h2v2H4zm2-2h2v2H6zm2-2h8v2H8zm-7 1h2v2H1zm20 0h2v2h-2zM3 8h2v2H3zm2-2h2v2H5zm2-2h10v2H7zm12 4h2v2h-2zm-2-2h2v2h-2zm1 7h2v2h-2zm-2-2h2v2h-2z"/>',
    'wifi-off': '<path d="M11 19h2v2h-2zm-4-3h2v2H7zm8 0h2v2h-2zm-6-2h6v2H9zm-5-1h2v2H4zm2-2h2v2H6zm2-2h8v2H8zm-7 1h2v2H1zm20 0h2v2h-2zM3 8h2v2H3zm2-2h2v2H5zm2-2h10v2H7zm12 4h2v2h-2zm-2-2h2v2h-2zm1 7h2v2h-2zm-2-2h2v2h-2z"/><path d="M2 2h2v2H2zm2 2h2v2H4zm2 2h2v2H6zm2 2h2v2H8zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z"/>',
    // Weather tile sky glyphs: the same shapes the tile strokes in the Instrument
    // theme, drawn as filled pixel runs on the 24 grid.
    'weather-sun': '<path d="M13 22h-2v-3h2v3Zm-6-3H5v-2h2v2Zm12 0h-2v-2h2v2Zm-4-2H9v-2h6v2Zm-6-2H7V9h2v6Zm8 0h-2V9h2v6ZM5 13H2v-2h3v2Zm17 0h-3v-2h3v2Zm-7-4H9V7h6v2ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Zm-6-2h-2V2h2v3Z"/>',
    'weather-cloud': '<path d="M22 10h-4v2h4v-2Zm2 2h-2v6h2v-6Zm-2 6H2v2h20v-2ZM2 12H0v6h2v-6Zm2-2H2v2h2v-2Zm4-2H4v2h4V8Zm8-4h-6v2h6V4Zm-6 2H8v2h2V6Zm0 4H8v2h2v-2Zm8-4h-2v2h2V6ZM20 8h-2v4h2V8Zm-2 4h-2v2h2v-2Z"/>',
    'weather-snow': '<path d="M13 24h-2v-2h2v2Zm-2-2H9v-2H7v2H2v-5h2v3h3v-2h2v-2h2v6Zm4-4h2v2h-2v2h-2v-6h2v2Zm7 4h-5v-2h3v-3h2v5ZM4 15H2v-2h6v2H6v2H4v-2Zm18 0h-2v2h-2v-2h-2v-2h6v2ZM2 13H0v-2h2v2Zm22 0h-2v-2h2v2ZM6 9h2v2H2V9h2V7h2v2Zm14 0h2v2h-6V9h2V7h2v2Zm-9-1H9V6H7V4h2V2h2v6Zm4-4h2V2h5v5h-2V4h-3v2h-2v2h-2V2h2v2ZM7 4H4v3H2V2h5v2Zm6-2h-2V0h2v2Z"/>',
    'weather-thunder': '<path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/>',
    'weather-unavailable': '<path d="M4 2h16v2H4zm0 18h16v2H4zM20 4h2v16h-2zM2 4h2v16H2zm9 2h2v8h-2zm0 10h2v2h-2z"/>',
    'weather-rain': '<path d="M22 10h-4v2h4v-2Zm2 2h-2v6h2v-6Zm-2 6H2v2h20v-2ZM2 12H0v6h2v-6Zm2-2H2v2h2v-2Zm4-2H4v2h4V8Zm8-4h-6v2h6V4Zm-6 2H8v2h2V6Zm0 4H8v2h2v-2Zm8-4h-2v2h2V6ZM20 8h-2v4h2V8Zm-2 4h-2v2h2v-2ZM7 20h2v3H7zM11 20h2v3h-2zM15 20h2v3h-2z"/>',


  }
})(typeof window !== 'undefined' ? window : globalThis)
