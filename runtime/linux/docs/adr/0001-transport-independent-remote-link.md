# Transport-independent remote link

The CM5 Display Shell owns page state and communicates with a standalone Node.js Remote Bridge through a mode-0600 Unix domain socket. The bridge owns a replaceable Remote Link adapter: the first wired adapter uses USB HID for S3-to-Shell navigation and USB CDC for state feedback, while a future adapter carries the same versioned JSON Lines records over CM5 UART, C6 Gateway, and ESP-NOW. This keeps transport and device I/O out of Electron while avoiding a USB-only design that would have to be replaced for the planned C6 wireless path.
