"use strict";

var DOM;

function pad(n, width, z) {
	z = z || '0';
	n = n + '';
	return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

var Governator = angular.module('Governator', []);

Governator.config(function($locationProvider) {
	$locationProvider.html5Mode(true).hashPrefix('!');
});

Governator.filter('toArray', function () {
	return function (obj) {
		if (!(obj instanceof Object)) {
			return obj;
		}
		return Object.keys(obj).map(function (key) {
			return Object.defineProperty(obj[key], '$key', {__proto__: null, value: key});
		});
	};
});

Governator.run(function($rootScope, $location) {
	$rootScope.$watch(function() {
		return $location.path();
	}, function(url) {
		$rootScope.$broadcast("load", url);
	});
});

Governator.factory("fileWatcher", function($rootScope, $http) {

	var self = {
		channelId: null
	};

	var fayeBase = "/fayewebsocket",
		fayeClient = new Faye.Client(window.location.origin + fayeBase);

	var subscription = {cancel: angular.noop};

	function startSubscription() {
		subscription.cancel();
		return fayeClient.subscribe( fayeBase + "/watch/" + self.channelId, function (stat) {
			console.log(stat.event);
			console.log(stat);
			$rootScope.$broadcast(stat.event, stat);
		});
	}

	$rootScope.$on("load", function(e, fsPath) {
		$http.get("/@watch/:" + fsPath).success(function(channelData) {
			self.channelId = channelData.channelId;
			console.log(channelData);
			$rootScope.$broadcast("loadFiles", channelData);
			subscription = startSubscription();
		});
	});

	return self;

});

Governator.directive('keyboard', function ($rootScope, $timeout, $http, $location) {
	return {
		restrict: 'A',
		link: function(scope, element, attrs) {
			$(element).on("keydown", function(event) {
				switch (event.keyCode) {
					case 39:
						scope.scrub.direction = 1;
						scope.scrub.goNextFrame();
						break;
					case 37:
						scope.scrub.direction = -1;
						scope.scrub.goNextFrame();
						break;
				}
			});
		}
	};
});

Governator.directive('colorbar', function () {
	return {
		restrict: "E",
		template: '<div class="colorChips" ng-click="colorBar.toggleChannel($event)">' +
						'<div id="chan_R" class="colorChip red" ng-class="{active:colorBar.active===\'R\'}"></div>' +
						'<div id="chan_G" class="colorChip green" ng-class="{active:colorBar.active===\'G\'}"></div>' +
						'<div id="chan_B" class="colorChip blue" ng-class="{active:colorBar.active===\'B\'}"></div>' +
						'<div id="chan_A" class="colorChip alpha" ng-class="{active:colorBar.active===\'A\'}"></div>' +
					'</div>',
		replace: true,
		link: function(scope, element, attrs) {
			scope.colorBar = {
				active: null,
				toggleChannel: function(event) {
					var self = this,
						t = $(event.target);
					if (t.hasClass("colorChip")) {
						var chan = t.attr("id").split("_")[1];
						self.active = (self.active===chan) ? "f" : chan;
						scope.hero.setChannel(self.active);
					}
				}
			};
		}
	};
});

Governator.directive('infoline', function ($rootScope, $timeout, $http, $location) {
	return {
		restrict: 'E',
		template: '<div class="infoline" ng-bind="infoLine.display"></div>',
		replace: true,
		link: function(scope, element, attrs) {

			scope.infoLine = {
				lookup: null,
				display: ""
			};

			scope.$watch(function() {
				return scope.infoLine.lookup;
			}, function() {
				if (scope.infoLine.lookup===null) {
					scope.infoLine.display = "";
					return;
				}
				var fsPath = "/@info/:" + [$location.path(), filename].join("/");
				$http.get(fsPath).success(function(exrInfo) {
					console.log("Loaded exrInfo");
					console.log(exrInfo);
					var displayLine = exrInfo.pretty;
					displayLine += " | CHANNELS: " + exrInfo.channels.join(",");
					$timeout(function() {
						scope.infoLine.display = displayLine;
					});
				}).error(function() {
					$timeout(function() {
						scope.infoLine.display = "";
					});
				});
			});
		}
	};
});

Governator.directive('frameIndicator', function () {
	return {
		restrict: 'E',
		template: '<div ng-style="{left:frameIndicator.left}" ng-cloak ng-show="frameIndicator.frame>=0" ng-bind="frameIndicator.frame"></div>',
		replace: true,
		link: function(scope, element, attrs) {
			scope.frameIndicator = {
				left: 0,
				frame: -1,
				show: function(frame) {
					this.frame = frame;
					this.left = $("li#tick_" + frame).offset().left;
				}
			};
		}
	};
});

Governator.directive('scrubBar', function ($rootScope, $timeout, $q) {
	return {
		restrict: 'E',
		template: '<div class="scrubbar" ng-cloak ng-show="scrub.activeSequence!==null">' +
						'<div class="bookend start" ng-bind="sequences[scrub.activeSequence].first"></div>' +
							'<ul class="tickContainer">' +
								'<li id="tick_{{frame.frame}}" class="scrubTicks" ng-click="scrub.jumpToFrame($index)" ng-mouseover="frameIndicator.show(frame.frame)" ng-mouseleave="frameIndicator.frame=-1" ng-style="{width:scrub.tickWidth}" ng-class="{cached:cache.hasOwnProperty(frame._src), error:!files.hasOwnProperty(frame.name), current:scrub.isCurrent(frame.frame,$index)}" ng-repeat="frame in scrub.frames"></li>' +
							'</ul>' +
						'<div class="bookend end" ng-bind="sequences[scrub.activeSequence].last"></div>' +
					'</div>',
		replace: true,
		link: function(scope, element, attrs) {

			scope.scrub = {
				activeSequence: null,
				currentFrame: -1,
				currentIndex: -1,
				direction: 1,
				mode: 0,
				markIn: -1,
				markOut: -1,
				frames: [],
				setImage: function(F) {
					$timeout(function() {
						// Trigger UI elements
						scope.scrub.currentFrame = F.frame; // This is -1 for non-sequence files
						scope.scrub.activeSequence = F.seq; // This is null for non-sequence files
						scope.hero.setImage(F);
					});
				},
				loadImageOnClickFileList: function(F) { // Called from fileList directive
					this.setImage(F);
				},
				tickWidth: 0,
				jumpToFrame: function(index) {
					var self = this;
					$timeout(function() {
						var F = self.frames[index];
						self.setImage(F);
					});
				},
				goNextFrame: function() {
					if (scope.scrub.currentFrame<0) { return; }
					var self = this,
						nextIndex = this.currentIndex + this.direction,
						goToIndex;
					if (nextIndex>=0 && nextIndex<this.frames.length) {
						goToIndex = nextIndex;
					} else if (nextIndex>=this.frames.length) {
						if (this.mode===0) {
							goToIndex = 0;
						} else {
							goToIndex = this.frames.length-1;
						}
					} else if (nextIndex<0) {
						if (this.mode===0) {
							goToIndex = this.frames.length-1;
						} else {
							goToIndex = 0;
						}
					}
					$timeout(function() {
						var F = self.frames[goToIndex];
						self.setImage(F);
					});
				},
				isCurrent: function(frame, index) {
					var isCurr = frame===this.currentFrame;
					if (isCurr) {
						this.currentIndex = index;
					}
					return isCurr;
				},
				tracker: {
					active: false,
					x1: 0,
					activate: function(event) {
						this.active = true;
						this.x1 = event.offsetX;
					},
					track: function(event) {
						var x2 = event.offsetX;
						if (this.active) {
							scope.scrub.direction = (x2 > this.x1) ? 1 : -1;
							scope.scrub.goNextFrame();
							this.x1 = x2;
						}
					}
				}
			};

			function setTickWidths() {
				var frames = scope.scrub.frames,
					max = $(window).width()*0.8,
					width = max;
				while ((width*frames.length)>max) {
					width-=1;
				}
				$timeout(function() {
					scope.scrub.tickWidth = (99/frames.length) + "%";
				});
			}

			function attachSourceAndCache(f) {
				f._src = f.sources[scope.hero.channel];
				if (!scope.cache.hasOwnProperty(f._src)) {
					scope.hero.refreshCache(f._src);
				}
			}

			function refreshSequence(seq) {
				var q = $q.defer(),
					i = scope.sequences[seq].first,
					last = scope.sequences[seq].last;
				var realFrames = Object.keys(scope.files).reduce(function(frames, filename) {
					var F = scope.files[filename];
					if (F.seq===seq) { // This is safe because we call #gatherSequence only when seq!==null
						frames[F.frame] = scope.files[filename];
					}
					return frames;
				}, []);

				$timeout(function() {
					var f, d = [];
					while (i<=last) {
						if (typeof(realFrames[i])==='undefined') {
							f = {
								name: null,
								_src: null,
								frame: i,
								seq: seq
							};
						} else {
							f = realFrames[i];
							attachSourceAndCache(f);
						}
						d.push(f);
						i+=1;
					}
					scope.scrub.frames = d;
					q.resolve(scope.scrub.frames);
				});
				return q.promise;
			}

			function getIndexOfFrameInCurrentSequence(n) {
				var t=scope.scrub.frames.length, i=0, found=false;
				while (i<t) {
					if (scope.scrub.frames[i].frame===n) {
						found = true;
						break;
					}
					i+=1;
				}
				if (found) {
					return i;
				} else {
					return -1;
				}
			}

			var deregisterSeq = angular.noop;

			// This also happens to initialize the very first load
			scope.$watch("scrub.activeSequence", function(seq) {
				if (scope.sequences.hasOwnProperty(seq)) {
					deregisterSeq();
					deregisterSeq = scope.$watch(function() {
						return scope.sequences[seq].first + scope.sequences[seq].last;
					}, function() {
						$timeout(function() {
							refreshSequence(seq).then(setTickWidths);
						});
					});
				}
			});

			// If the channel changes
			scope.$watch("hero.channel", function(chan) {
				var isRunning = false;
				if (scope.scrub.activeSequence!==null) { // And we're looking at a still
					$timeout(function() {
						scope.scrub.frames.forEach(function(F) {
							if (F._src!==null) {
								attachSourceAndCache(F);
							}
						});
						if (!isRunning) {
							scope.hero.refreshCurrentImage();
						}
					});
				} else {
					scope.hero.refreshCurrentImage();
				}
			});

			// Emitted from MainController *after* it has updated scope.files
			$rootScope.$on("file_update", function(e, F) {
				if (scope.scrub.activeSequence!==null && scope.scrub.activeSequence===F.seq) {
					var i = getIndexOfFrameInCurrentSequence(F.frame);
					if (i>=0) {
						$timeout(function() {
							attachSourceAndCache(F);
							scope.scrub.frames[i] = F;
						});
					}
				}
			});

			// Emitted from MainController *after* it has updated scope.files
			$rootScope.$on("file_delete", function(e, F) {
				if (scope.scrub.activeSequence!==null && scope.scrub.activeSequence===F.seq) {
					var i = getIndexOfFrameInCurrentSequence(F.frame);
					if (i>=0) {
						$timeout(function() {
							scope.scrub.frames[i] = {
								name: null,
								_src: null,
								frame: F.frame,
								seq: scope.scrub.activeSequence
							};
						});
					}
				}
			});

		}
	};
});

Governator.directive('viewportCanvas', function ($rootScope, $timeout, $q) {
	return {
		restrict: 'E',
		template: '<canvas id="heroImg"></canvas>',
		replace: true,
		link: function(scope, element, attrs) {

			var canvas = $(element)[0];
			var ctx = canvas.getContext('2d');

			canvas.width = 1000;
			canvas.height = 600;

			scope.cache = {};

			scope.hero = {
				filename: null,
				channel: "f",
				setImage: function (F) {
					try {
						var self = this,
							chan = scope.hero.channel,
							src = F.sources[chan];
						if (scope.cache.hasOwnProperty(src)) {
							render(src);
						} else {
							refreshCache(src).then(render);
						}
						$timeout(function() {
							self.filename = F.name;
						});
					} catch(e) {
						renderError(F);
					}
				},
				setChannel: function(chan) {
					this.channel = chan;
				},
				refreshCache: refreshCache,
				refreshCurrentImage: function() {
					if (scope.files.hasOwnProperty(this.filename)) {
						this.setImage(scope.files[this.filename]);
					}
				}
			};

			ctx.font="14px Coda";

			var regg = /#{3,}/,
				message1 = "FRAME MISSING";
			function renderError(F) {
				var message2 = "";
				try {
					message2 = " : " + F.seq.replace(/jpg$/,"exr").replace(regg, pad(F.frame, parseInt(F.seq.match(regg)[0].length, 10)));
				} catch(e) { }
				ctx.fillStyle="#9C0303";
				ctx.fillRect(0,0,canvas.width,canvas.height);
				ctx.fillStyle = 'white';
				ctx.fillText(message1 + message2, 300, 250);
			}

			function render(src) {
				if (scope.cache.hasOwnProperty(src)) {
					ctx.drawImage(scope.cache[src], 0,0);
					var currentFrame = scope.scrub.currentFrame;
					if (currentFrame>=0) {
						ctx.fillStyle = 'white';
						ctx.fillText(currentFrame, 10, 15);
					}
				} else {
					ctx.fillStyle="#FF0000";
					ctx.fillRect(0,0,1000,600);
				}
			}

			function refreshCache(src) {
				var q = $q.defer(),
					img = new Image();
				img.src = src + "?now=" + Date.now();
				img.onerror = q.reject;
				img.onload = function() {
					$timeout(function() {
						scope.cache[src] = img;
						q.resolve(src);
					});
				};
				return q.promise;
			}

			function externalChange(event, F) {
				var chans = ["f","R","G","B","A"];
				chans.forEach(function(chan) {
					var src = F.sources[chan];
					if (event==='deleted') {
						delete scope.cache[src];
					} else {
						if (scope.cache.hasOwnProperty(src)) {
							console.log("REFRESH: " + src);
							refreshCache(src).then(function() {
								// TODO: Which means, when the player is playing, you must null the name out
								if (scope.hero.filename===F.name &&
									scope.hero.channel===chan) {
									render(src);
								}
							});
						}
					}
				});
			}

			$rootScope.$on("file_update", function(e, F) { // Emitted from MainController *after* it has updated scope.files
				externalChange("update", F);
			});

			$rootScope.$on("file_delete", function(e, F) {
				externalChange("deleted", F);
			});

		}
	};
});

Governator.directive('fileList', function () {
	return {
		restrict: 'E',
		template: '<ul class="fileList">' +
					'<li class="fileItem" ng-class="{active:file.$key===hero.filename}" ng-click="fileList.open(file)" ng-repeat="file in files | toArray | orderBy: fileList.predicate:fileList.reverse">' +
						'<div><img class="fileThumb" src="{{file.sources.s}}" /></div>' +
						'<div class="filename" ng-bind="file.$key"></div>' +
					'</li>' +
				'</ul>',
		replace: true,
		link: function(scope, element, attrs) {
			scope.fileList = {
				open: function(F) {
					scope.scrub.loadImageOnClickFileList(F);
				},
				predicate: "name",
				reverse: false
			};
		}
	};
});

Governator.controller("MainController", function($scope, $rootScope, $timeout, $q, fileWatcher) {

	DOM = $scope;

	$scope.sequences = {};
	$scope.files = {};
	$scope.getSrc = function(F, frame, channel) {
		var src = F.cname,
			padF = pad(frame, F.pad);
		src = src.replace(/_@/, "_" + channel);
		src = src.replace(/#{3,}/, padF);
		return src;
	};

	function makeFrameObject(filename) {
		var F = {
				name: filename,
				cname: "",
				seq: null,
				pad: 0,
				frame: -1
			},
			components = filename.split(".");

		components[components.length-1] = "jpg";

		if (filename.match(/.+\.(\d{3,})\.exr$/)) {
			var paddedFrameN = components[components.length-2];
			var hashedFrame = Array.apply(null, new Array(paddedFrameN.length)).map(function() {
					return "#";
				}).join("");

			F.frame = parseInt(paddedFrameN, 10);
			F.pad = paddedFrameN.length;

			components[components.length-2] = hashedFrame;
			F.seq = components.join(".");

			components[components.length-2] += "_@";
			F.cname = "/preview/" + fileWatcher.channelId + "_" + components.join(".");

			if ($scope.sequences.hasOwnProperty(F.seq)) {
				if (F.frame < $scope.sequences[F.seq].first) {
					$scope.sequences[F.seq].first = F.frame;
				} else if (F.frame > $scope.sequences[F.seq].last) {
					$scope.sequences[F.seq].last = F.frame;
				}
			} else {
				$scope.sequences[F.seq] = {
					first: F.frame,
					last: F.frame
				};
			}

		} else {
			components[components.length-2] += "_@";
			F.cname = "/preview/" + fileWatcher.channelId + "_" + components.join(".");
		}
		F.sources = ["f", "s", "R", "G", "B", "A"].reduce(function(sources, chan) {
			sources[chan] = $scope.getSrc(F, F.frame, chan);
			return sources;
		}, {});
		return F;
	}

	function refreshFirstLast(seq) {
		if (!$scope.sequences.hasOwnProperty(seq)) { return; }
		var nums = Object.keys($scope.files).filter(function(key) {
				return $scope.files[key].seq===seq;
			}).map(function(key) {
				return $scope.files[key].frame;
			});
		if (nums.length>0) {
			$scope.sequences[seq].first = Math.min.apply(Math, nums);
			$scope.sequences[seq].last = Math.max.apply(Math, nums);
		} else {
			delete $scope.sequences[seq];
		}
	}

	function injectFile(filename) {
		var q = $q.defer(),
			F = makeFrameObject(filename);
		$timeout(function() {
			$scope.files[filename] = F;
			q.resolve(F);
		});
		return q.promise;
	}

	function updateFile(fileStat) {
		var q = $q.defer(),
			F = $scope.files[fileStat.name];
		$timeout(function() {
			F.size = fileStat.size;
			F.sources.s = F.sources.s.split("?")[0] + "?now=" + Date.now();
			q.resolve(F);
		});
		return q.promise;
	}

	$rootScope.$on("loadFiles", function(e, channelData) {
		channelData.files.sort().forEach(function(filename) {
			injectFile(filename);
		});
	});

	function update_the_rest(F) {
		$rootScope.$broadcast("file_update", F);
	}

	function external_change(fileStat) {
		var filename = fileStat.name;
		if ($scope.files.hasOwnProperty(filename)) {
			updateFile(fileStat).then(update_the_rest);
		} else {
			injectFile(filename).then(update_the_rest);
		}
	}

	// This will _only_ happen when the thumbnails have
	// already been rendered on the server
	$rootScope.$on("modified", function(e, fileStat) {
		external_change(fileStat);
	});

	$rootScope.$on("created", function(e, fileStat) {
		external_change(fileStat);
	});

	$rootScope.$on("deleted", function(e, fileStat) {
		if ($scope.files.hasOwnProperty(fileStat.name)) {
			$timeout(function() {
				var F = $scope.files[fileStat.name];
				delete $scope.files[fileStat.name];
				if (F.seq!==null) { refreshFirstLast(F.seq); }
				$rootScope.$broadcast("file_delete", F);
			});
		}
	});

});