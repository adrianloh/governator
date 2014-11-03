"use strict";

var fs = require("fs");
var Q = require("q");
var uuid = require('node-uuid');
var moment = require('moment');
var events = require('events');

function makeStatObject(filename, stat) {
	var o = {};
	o.name = filename;
	o.size = stat.size;
	o.ctime = stat.ctime;
	o.atime = stat.atime;
	o.mtime = stat.mtime;
	return o;
}

var emitters = {};
var watching = {};

function watchFolder(fsPath) {

	if (emitters.hasOwnProperty(fsPath)) {
		return emitters[fsPath];
	} else {
		emitters[fsPath] = new events.EventEmitter();
	}

	var emitter = emitters[fsPath];

	fs.watch(fsPath, function (event, filename) {
		if (!filename.match(/\.exr$/)) {
			return;
		}
		var filepath = fsPath + "/" + filename;
		console.log("Folder event: " + event + " - " + filename);
		fs.stat(filepath, function (err, stat) {
			if (err) {
				if (watching.hasOwnProperty(filepath)) {
					delete watching[filepath];
					fs.unwatchFile(filepath);
				}
				emitter.emit("update", {
					name: filename,
					event: 'deleted'
				});
			} else if (stat.isDirectory()) {
				// Do nothing
			} else {
				if (!watching.hasOwnProperty(filepath)) {

					watching[filepath] = makeStatObject(filename, stat);
					watching[filepath].event = "created";

					emitter.emit("update", watching[filepath]);

					fs.watchFile(filepath, function(_stat) {
						/* watchFile returns a stat object *irregardless* of what
						 happened. We have to stat it again to find out if it was deleted.*/
						fs.stat(filepath, function (err, stat) {
							var file;
							if (!err) {
								if (stat.isDirectory()) { return; }
								file = makeStatObject(filename, stat);
								file.event = "modified";
								emitter.emit("update", file);
							}
						});
					});
				}
			}
		});
	});
	return emitter;
}

module.exports = {
	makeStat: makeStatObject,
	watch: watchFolder
};