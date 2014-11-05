"use strict";

var fs = require("fs");
var os = require('os');
var popen = require('child_process').exec;
var uuid = require('node-uuid');
var Q = require("q");
var clc = require('cli-color');

var TEMP = process.env["TEMP"] + "/";
var nproc = os.cpus().length;

var queue = [];
var threads = {};

var chanColors = {
	R: clc.whiteBright.bgRed,
	G: clc.whiteBright.bgGreen,
	B: clc.whiteBright.bgBlue,
	A: clc.black.bgWhiteBright
};

function convert(threadId, promise, params) {
	var fsPath = params.source,
		target_f = TEMP + params.channelId + "_" + params.name.replace(/\.exr/, "_f.jpg"),
		target_a = TEMP + params.channelId + "_" + params.name.replace(/\.exr/, "_@.jpg"),
		target_s = TEMP + params.channelId + "_" + params.name.replace(/\.exr/, "_s.jpg"),
		cmd_base = 'rvio "#SOURCE#" -outres #DIMENSION# -outgamma 2.2 -o "#TARGET#"',
		cmd1 = cmd_base.replace(/#SOURCE#/, fsPath).replace(/#TARGET#/, target_f).replace(/#DIMENSION#/, "1000 600"),
		cmd2 = cmd_base.replace(/#SOURCE#/, target_f).replace(/-outgamma 2.2 /,"").replace(/#TARGET#/, target_s).replace(/#DIMENSION#/, "180 180"),
		cmd3 = cmd_base.replace(/ -o /," -inchannelmap @ @ @ -o ").replace(/#SOURCE#/, fsPath).replace(/#TARGET#/, target_a).replace(/#DIMENSION#/, "1000 600");
	console.log(clc.xterm(154).bold("SPAWN: " + Object.keys(threads).length));
	popen(cmd1, function(err) {
		if (!err && fs.existsSync(target_f)) {
			popen(cmd2, function(err) {
				if (!err && fs.existsSync(target_s)) {
					Q.all(["A","R","G","B"].map(function(chan) {
						var q = Q.defer(),
							_cmd = cmd3.replace(/@/g, chan);
						popen(_cmd, function(err) {
							if (!err) {
								console.log(chanColors[chan](params.name));
							}
							q.resolve();
						});
						return q.promise;
					})).then(function() {
						delete threads[threadId];
						console.log(clc.xterm(124).bold("DIE: " + Object.keys(threads).length));
						promise.resolve(target_s);
					});
				} else {
					delete threads[threadId];
					console.log(clc.xterm(124).bold("DIE: " + Object.keys(threads).length));
					promise.reject();
				}
			});
		}
	});
}

setInterval(function() {
	if (queue.length>0 && Object.keys(threads).length < nproc) {
		var args = queue.shift();
		var promise = args.promise;
		var params = args.params;
		var threadId = uuid.v4();
		threads[threadId] = null;
		convert(threadId, promise, params);
	}
}, 50);

module.exports = {
	add: function(params) {
		var q = Q.defer();
		queue.push({
			promise: q,
			params: params
		});
		return q.promise;
	}
};