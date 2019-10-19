const server = require('./core/server.js');
const browser = require('./core/browser.js');
const electron = require('electron');
const request = require('request');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const uuid = require('uuidv4').default;

const Store = require('electron-store');
const store = new Store();

var clientId = "";

if(store.get("useUuidv4", false)){
	var t = store.get("lastUse", 0);
	if(Date.now() - t > 60*1000*60){
	  clientId = uuid();
	  store.set("clientId", clientId);
	  store.set("lastUse", Date.now());
	  console.log("new client id " + clientId);
	}else{
	  clientId = store.get("clientId");
	  console.log("client id " + clientId);
	}
}else{
	store.set("useUuidv4", true);
	clientId = uuid();
	store.set("clientId", clientId);
	store.set("lastUse", Date.now());
	console.log("new client id " + clientId);
}



server.start(() => {
	let win

	function createWindow() {
		let screenSize = electron.screen.getPrimaryDisplay().size;
		win = new BrowserWindow({
			width: (screenSize.width / 3.5 < 150) ? 150 : screenSize.width / 3,
       		height: (screenSize.height - 100 < 200) ? 200 : screenSize.height - 100,
			webPreferences: {
				nodeIntegration: true
			},
			resizable: false 
		})
		
		win.setMenuBarVisibility(false)

		win.loadFile('core/views/index.html')

		win.on('closed', () => {
			win = null
		})
	}

	const ipc = electron.ipcMain;

	ipc.on('set-on-top', function (event, arg) {
		win.setAlwaysOnTop(true, "floating", 1);
		win.setVisibleOnAllWorkspaces(true);
	})

	ipc.on('unset-on-top', function (event, arg) {
		win.setAlwaysOnTop(false);
		win.setVisibleOnAllWorkspaces(false);
	})
	
	app.on('ready', createWindow)

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit()
		}
	})

	app.on('activate', () => {
		if (win === null) {
			createWindow()
		}
	})
	
	process.on("uncaughtException", (err) => {
		const messageBoxOptions = {
			type: "error",
			title: "An error occured",
			message: "Oops something went wrong. Please contact admins, and send this code : #" + clientId
		};
		
		electron.dialog.showMessageBox(messageBoxOptions, option => {
			var date = new Date();
			var prefix = "[" + date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds() + "] ";
			request.post("http://sentry.srv4.blackpink-access.com/debug/send-logs-mp-" + clientId, {form:{ message: prefix + " " + err.toString(), stacktace: err.stack, level: "SEVERE" }}, function (err, res, body) {
				app.quit();
			});
		});
	});
});