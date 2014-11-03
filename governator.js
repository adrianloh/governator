"use strict";

var fs = require("fs"),
	popen = require('child_process').exec,
	path = require("path"),
	http = require('http');

var Q = require("q");
var request = require("request");
var sass = require("node-sass");
var express = require("express");
var faye = require('faye');
var clc = require('cli-color');

var processor = require('./processor.js');
var watchtower = require('./watchtower.js');

var uuid = require('node-uuid');
var folderWatchers = {};

var PORT = 14214;

var App = express();

App.set('port', PORT);

fs.readdirSync(__dirname).filter(function(f) {
	return fs.lstatSync(f).isDirectory() && !f.match(/^\.|node|css/);
}).forEach(function(p) {
	var fp = path.join(__dirname, p);
	App.use('/' + p, express.static(fp));
});

var fayeBase = "/fayewebsocket",
	bayeux = new faye.NodeAdapter({
		mount: fayeBase
	});

var fayeClient = new faye.Client('http://localhost:' + App.get("port") + fayeBase);

var C = {
	render: clc.black.bgYellowBright,
	bigfuckingerror: clc.bold.bgXterm(160),
	broadcast: clc.xterm(75)
};

if (typeof(process.env.TEMP)==='undefined') {
	console.log(C.bigfuckingerror("Environment TEMP folder not set"));
	process.exit(1);
}

var TEMP = process.env["TEMP"] + "/";

// ============= FUNCS ==============//

function info(fsPath) {
	var mainQ = Q.defer(),
		cmd1 = 'rvls -x "#SOURCE#"'.replace(/#SOURCE#/,fsPath),
		cmd2 = 'ffmpeg -i "#SOURCE#"'.replace(/#SOURCE#/,fsPath),
		channels = {},
		exrInfo = {
			pretty: [],
			width: 0,
			height: 0,
			channels: []
		};
	Q.all([(function() {
		var q = Q.defer(),
			re_resolution = /\s+Resolution\s+(.+)$/,
			re_compression = /\s+EXR\/compression\s+(.+)$/,
			re_color1 = /\s+ColorSpace\/Transfer\s+(.+)$/,
			re_color2 = /\s+ColorSpace\/Primaries\s+(.+)$/;
		popen(cmd1, function(err, stdout) {
			var m;
			stdout.split("\n").forEach(function(line) {
				if (m = line.match(re_resolution)) {
					var l = m[1],
						res = l.match(/(\d+)\s+?x\s+?(\d+)/);
					exrInfo.pretty.push(l);
					exrInfo.width = parseInt(res[1], 10);
					exrInfo.height = parseInt(res[2], 10);
				} else if (m = line.match(re_compression)) {
					exrInfo.pretty.push(m[1]);
				} else if (m = line.match(re_color1)) {
					exrInfo.pretty.push(m[1]);
				} else if (m = line.match(re_color2)) {
					exrInfo.pretty.push(m[1]);
				}
			});
			exrInfo.pretty = exrInfo.pretty.join(" ");
			q.resolve();
		});
		return q.promise;
	})(),
		(function() {
			var q = Q.defer();
			popen(cmd2, function(err, stdout, stderr) {
				var m, channel,
					re_chan = /.+Unsupported channel (\w+)\.(\w+)/i,
					re_pic = /.+Video: exr, (\w+)[,)]/;
				stderr.split("\n").forEach(function(line) {
					if (m = line.match(re_chan)) {
						channel = m[1];
						if (!channels.hasOwnProperty(channel)) {
							channels[channel] = null;
							exrInfo.channels.push(channel);
						}
					}
				});
				q.resolve();
			});
			return q.promise;
		})()
	]).then(function() {
		var m = exrInfo.pretty.split(",")[1],
			mc, n;
		if (mc = m.match(/ (\d+)ch/)) {
			n = parseInt(mc[1],10);
			if (n>=4) {
				exrInfo.channels.unshift("rgba");
			} else {
				exrInfo.channels.unshift("rgb");
			}
		} else {
			exrInfo.channels.unshift("rgb");
		}
		mainQ.resolve(exrInfo);
	});
	return mainQ.promise;
}

// ============ ROUTES ============= //

App.get("/css/:file", function(req, res) {
	var basename = req.params.file.split(".")[0],
		sassPath = path.join(__dirname, "css", basename + ".scss"),
		cssPath = path.join(__dirname, "css", basename + ".css");
	if (fs.existsSync(sassPath)) {
		sass.render({
			file: sassPath,
			//outputStyle: 'compressed',
			success: function(css) {
				res.set('Content-Type','text/css');
				res.write(css);
				res.end();
			},
			error: function() {
				res.status(500).end();
			}
		});
	} else if (fs.existsSync(cssPath)) {
		res.sendFile(cssPath);
	} else {
		res.status(404).end();
	}
});

App.get(/@watch\/:(.+)/, function(req, res) {
	var fsPath = req.params[0],
		afterSend = function() {};
	console.log("WATCH: " + fsPath);
	if (fs.existsSync(fsPath)) {
		if (folderWatchers.hasOwnProperty(fsPath)) {
			res.set("X-Cache-Hit", 1);
		} else {
			res.set("X-Cache-Miss", 1);
			var channelId = uuid.v4().replace(/-/g,""),
				files = fs.readdirSync(fsPath).filter(function(filename) {
					return filename.match(/\.exr$/);
				});
			folderWatchers[fsPath] = {
				channelId: channelId,
				files: files
			};
			var	emitter = watchtower.watch(fsPath);
			folderWatchers.emitter = emitter;
			emitter.on("update", function (fileStat) {
				var i,
					params = {
						source: fsPath + "/" + fileStat.name,
						name: fileStat.name,
						channelId: channelId,
						fileStat: fileStat
					};
				if (fileStat.event.match(/created|modified/)) {
					i = folderWatchers[fsPath].files.indexOf(fileStat.name);
					if (i<0) {
						folderWatchers[fsPath].files.push(fileStat.name);
					}
					processor.add(params).then(function(target_s) {
						console.log(C.render(params.name));
						console.log(C.broadcast(fileStat.event + " : " + fileStat.name));
						fayeClient.publish(fayeBase + '/watch/' + channelId, fileStat);
					}).fail(function() {
						console.log("Failed to convert: " + fileStat.name);
					});
				} else {
					if (fileStat.event==='deleted') {
						i = folderWatchers[fsPath].files.indexOf(fileStat.name);
						if (i>=0) {
							folderWatchers[fsPath].files.splice(i,1);
						}
					}
					console.log(C.broadcast(fileStat.event + " : " + fileStat.name));
					fayeClient.publish(fayeBase + '/watch/' + channelId, fileStat);
				}
			});
			afterSend = function() {
				folderWatchers[fsPath].files.forEach(function(filename) {
					var filePath = fsPath + "/" + filename,
						stat = watchtower.makeStat(filename, fs.statSync(filePath));
					stat.event = "created";
					emitter.emit("update", stat);
				});
			};
		}
		res.send(folderWatchers[fsPath]);
		afterSend();
	} else {
		res.status(404).end();
	}
});

App.get(/@info\/:(.+)/, function(req, res) {
	var fsPath = req.params[0];
	console.log("INFO: " + fsPath);
	if (fs.existsSync(fsPath)) {
		info(fsPath).then(function(exrInfo) {
			res.send(exrInfo).end();
		});
	} else {
		res.status(404).end();
	}
});

App.get(/preview\/(.+)/, function(req, res) {
	var img = req.params[0],
		img404_f = __dirname + "/images/loader_f.gif",
		img404_s = __dirname + "/images/loader_s.gif",
		fsPath = TEMP + img;
	if (fs.existsSync(fsPath)) {
		res.sendFile(fsPath);
	} else {
		if (img.match(/_f/)) {
			res.status(404).end(); // Canvas will draw this
		} else {
			res.sendFile(img404_s);
		}
	}
});

App.all("*", function(req, res) {
	fs.readFile(__dirname + '/index.html', {encoding:'utf8'}, function read(err, data) {
		res.write(data);
		res.end();
	});
});

// ============ RUN ============= //

var server = http.createServer(App);

bayeux.attach(server);

server.listen(App.get('port'), function () {
	console.log("PID " + process.pid + " ==== Governator up" + " @ " + App.get('port'));
});