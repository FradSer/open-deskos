const { app } = require('electron')
const path = require('node:path')

if (process.platform === 'darwin') app.dock.hide()
app.setPath('userData', path.resolve(process.argv[2]))
app.setPath('sessionData', path.resolve(process.argv[2]))
require(path.resolve(process.argv[3]))
