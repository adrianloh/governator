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

var watching = {};
var emitter = new events.EventEmitter();

function watchFolder(fsPath) {
	fs.watch(fsPath, function (event, filename) {
		if (!filename.match(/\.exr$/)) { return; }
		var filepath = fsPath + "/" + filename;
		fs.stat(filepath, function (err, stat) {
			var file;
			if (err) {
				// When stat-ing a file that's gone, we get this err
				// which means, it was most likely deleted
				file = {
					name: filename
				};
				event = 'deleted';
				if (watching.hasOwnProperty(filepath)) {
					delete watching[filepath];
				}
			} else {
				if (stat.isDirectory()) { return; }
				file = makeStatObject(filename, stat);
				var elapsed_since_ctime = moment(file.ctime).fromNow();
				if (event==='rename' && elapsed_since_ctime.match(/seconds/)) {
					event = 'created';
				} else {
					event = 'modified';
				}
			}
			file.event = event;
			emitter.emit("update", file);
			if (!watching.hasOwnProperty(filepath)) {
				watching[filepath] = 1;
				fs.watchFile(filepath, function(_stat) {
					/* watchFile returns a stat object *irregardless* of what
					happened. We have to stat it again to find out if it was deleted.*/
					fs.stat(filepath, function (err, stat) {
						var file;
						if (!err) {
							if (stat.isDirectory()) { return; }
							file = makeStatObject(filename, stat);
							file.event = "created";
							emitter.emit("update", file);
						}
					});
				});
			}
		});
	});
	return emitter;
}

module.exports = {
	makeStat: makeStatObject,
	watch: watchFolder
};