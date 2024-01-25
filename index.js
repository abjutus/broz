// @ts-check
const process = require('node:process')
const { clipboard, shell, app, BrowserWindow, Menu, MenuItem } = require('electron')
const createState = require('electron-window-state')
const yargs = require('yargs')

let main = null

yargs
  .scriptName('broz')
  .usage('$0 [url]')
  .showHelpOnFail(false)
  .alias('h', 'help')
  .alias('v', 'version')
  .command(
    '* [url]',
    'launch broz',
    args => args
      .positional('url', {
        type: 'string',
        default: 'https://github.com/antfu/broz#readme',
        desc: 'launch broz with url, the http:// protocol can be omitted',
      })
      .option('top', {
        type: 'boolean',
        default: false,
        desc: 'set window always on top',
      })
      .option('height', {
        type: 'number',
        default: undefined,
        desc: 'set initial window height',
      })
      .option('width', {
        type: 'number',
        default: undefined,
        desc: 'set initial window width',
      }),
    async (args) => {
      app.setName('Broz')
      app.on('window-all-closed', () => app.quit())

      try {
        await app.whenReady()
        main = createMainWindow(args)

        await main.loadURL(
          args.url.includes('://')
            ? args.url
            : `http://${args.url}`,
        )
      }
      catch (e) {
        console.error(e)
        process.exit(1)
      }
    },
  )
  .help()
  .parse()

const windowSizes = [
  { width: 1920, height: 1080, label: 'Presentation 16:9' }, // Presentation 16:9
  { width: 1728, height: 1117, label: 'Macbook Pro 16"' }, // MacBook Pro 16"
  { width: 1512, height: 982, label: 'Macbook Pro 14"' }, // MacBook Pro 14"
  { width: 1440, height: 1024, label: 'Desktop' }, // Desktop
  { width: 1280, height: 832, label: 'Macbook Air' }, // MacBook Air
  { width: 1024, height: 1366, label: 'iPad Pro 12.9"' }, // iPad Pro 12.9"
  { width: 744, height: 1133, label: 'iPad mini 8.3"' }, // iPad mini 8.3"
  { width: 430, height: 932, label: 'iPhone 14 \& 15 Pro Max' }, // iPhone 14 & 15 Pro Max
  { width: 320, height: 568, label: 'iPhone SE' }, // iPhone SE
]

function createMainWindow(args) {
  const state = createState({
    defaultWidth: 960,
    defaultHeight: 540,
  })

  const main = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: args.width ?? state.width,
    height: args.height ?? state.height,
    show: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    frame: false,
  })

  state.manage(main)
  const debouncedSaveWindowState = debounce(
    event => state.saveState(event.sender),
    500,
  )

  main.on('resize', debouncedSaveWindowState)
  main.on('move', debouncedSaveWindowState)

  const menu = Menu.getApplicationMenu()
  menu.insert(1, new MenuItem({
    label: 'Broz',
    submenu: [
      {
        label: 'Copy URL',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() || main
          clipboard.writeText(win.webContents.getURL())
        },
      },
      {
        label: 'Open in System Browser',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() || main
          shell.openExternal(win.webContents.getURL())
        },
      },
      {
        type: 'separator',
      },
      {
        label: 'Resize',
        submenu: windowSizes.map(({ width, height, label }) => ({
          label: `${width} x ${height} ( ${label} )`,
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || main
            win.setSize(width, height, true)
            state.saveState(win)
          },
        })),
      },
      {
        label: 'Flip Size',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() || main
          const [width, height] = win.getSize()
          main.setSize(height, width)
          state.saveState(win)
        },
      },
      {
        label: 'Center Window',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() || main
          main.center()
          state.saveState(win)
        },
      },
    ],
  }))
  Menu.setApplicationMenu(menu)

  configureWindow(main, args)

  return main
}

/**
 * @param {BrowserWindow} win
 */
function configureWindow(win, args) {
  // injecting a dragable area
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`;(() => {
const el = document.createElement('div')
el.id = 'injected-broz-drag'
const style = document.createElement('style')
style.innerHTML="#injected-broz-drag{position:fixed;left:10px;top:10px;width:40px;height:40px;border-radius:50%;cursor:grab;-webkit-app-region:drag;z-index:99999999;}#injected-broz-drag:hover{background:#8885;}"
document.body.appendChild(el)
document.body.appendChild(style)

const rootStyle = document.createElement('style')
rootStyle.innerHTML="::-webkit-scrollbar {display: none;}"
document.head.appendChild(rootStyle)

})()`)
  })

  win.webContents.setWindowOpenHandler(() => {
    const [x, y] = win.getPosition()
    const [width, height] = win.getSize()
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        x: x + 50,
        y: y + 50,
        width,
        height,
      },
    }
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key === ']') {
        win.webContents.goForward()
        event.preventDefault()
      }
      else if (input.key === '[') {
        win.webContents.goBack()
        event.preventDefault()
      }
      else if (input.key === '-') {
        win.webContents.emit('zoom-changed', event, 'out')
        event.preventDefault()
      }
      else if (input.key === '=') {
        win.webContents.emit('zoom-changed', event, 'in')
        event.preventDefault()
      }
    }
  })

  win.webContents.on('did-create-window', (win) => {
    configureWindow(win, args)
  })

  win.webContents.on('zoom-changed', (event, zoomDirection) => {
    const currentZoom = win.webContents.getZoomFactor()
    if (zoomDirection === 'in')
      win.webContents.zoomFactor = currentZoom + 0.15

    if (zoomDirection === 'out')
      win.webContents.zoomFactor = currentZoom - 0.15
  })

  if (args.top)
    win.setAlwaysOnTop(true, 'floating')

  return win
}

function debounce(fn, delay) {
  let timeoutID = null
  return function (...args) {
    clearTimeout(timeoutID)
    timeoutID = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}

function getRatio(width, height) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a
  const r = gcd(width, height)
  return `${width / r}:${height / r}`
}
