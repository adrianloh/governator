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

var watchtower = require('./watchtower.js');

var uuid = require('node-uuid');
var folderWatchers = {};

var PORT = 12141;

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

var TEMP = "/Users/adrianloh/Desktop/temp/";

// ============= FUNCS ==============//

function convert(params) {
	var q = Q.defer(),
		fsPath = params.source,
		target_f = TEMP + params.channelId + "_" + params.name.replace(/\.exr/, "_f.jpg"),
		target_s = TEMP + params.channelId + "_" + params.name.replace(/\.exr/, "_s.jpg"),
		cmd_base = 'rvio "#SOURCE#" -outres #DIMENSION# -outgamma 2.2 -o "#TARGET#"',
		cmd1 = cmd_base.replace(/#SOURCE#/, fsPath).replace(/#TARGET#/, target_f).replace(/#DIMENSION#/, "1000 600"),
		cmd2 = cmd_base.replace(/#SOURCE#/, target_f).replace(/#TARGET#/, target_s).replace(/#DIMENSION#/, "180 180");
		console.log(cmd1);
		popen(cmd1, function(err) {
			if (!err && fs.existsSync(target_f)) {
				popen(cmd2, function(err) {
					if (!err && fs.existsSync(target_s)) {
						q.resolve(target_s);
					} else {
						q.reject();
					}
				});
			}
		});
	return q.promise;
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
	var fsPath = req.params[0];
	console.log("WATCH: " + fsPath);
	if (fs.existsSync(fsPath)) {
		if (folderWatchers.hasOwnProperty(fsPath)) {
			folderWatchers[fsPath].listeners += 1;
			res.set("x-kickbutt", 1);
		} else {
			var channelId = uuid.v4().replace(/-/g,""),
				files = fs.readdirSync(fsPath).filter(function(filename) {
					return filename.match(/\.exr$/);
				});
			folderWatchers[fsPath] = {
				channelId: channelId,
				listeners: 1,
				files: files
			};
			var	emitter = watchtower.watch(fsPath);
			folderWatchers.emitter = emitter;
			emitter.on("update", function (fileStat) {
				var params = {
					source: fsPath + "/" + fileStat.name,
					name: fileStat.name,
					channelId: channelId
				};
				if (fileStat.event.match(/created|modified/)) {
					convert(params).then(function(target_s) {
						console.log("DONE: " + target_s);
						fayeClient.publish(fayeBase + '/watch/' + channelId, fileStat);
					}).fail(function() {
						console.log("Failed to convert: " + fileStat.name);
					});
				} else {
					fayeClient.publish(fayeBase + '/watch/' + channelId, fileStat);
				}
			});
			folderWatchers[fsPath].files.forEach(function(filename) {
				var filePath = fsPath + "/" + filename,
					stat = watchtower.makeStat(filename, fs.statSync(filePath));
				stat.event = "modified";
				emitter.emit("update", stat);
			});
		}
		res.send(folderWatchers[fsPath]);
		res.end();
	} else {
		res.status(404).end();
	}
});

App.get(/preview\/(.+)/, function(req, res) {
	var img = req.params[0],
		fsPath = TEMP + img;
	if (fs.existsSync(fsPath)) {
		res.sendFile(fsPath);
	} else {
		res.status(404).end();
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
	console.log("PID " + process.pid + " ==== Buttserver up" + " @ " + App.get('port'));
});