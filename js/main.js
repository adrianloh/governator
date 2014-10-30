"use strict";

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
		$http.get("/@watch/:" + fsPath).success(function(channelData, status, headers) {
			self.channelId = channelData.channelId;
			if (headers().hasOwnProperty("x-kickbutt")) {
				channelData.loadNow = true;
			}
			console.log(channelData);
			$rootScope.$broadcast("loadFiles", channelData);
			subscription = startSubscription();
		});
	});

	return self;

});

Governator.directive('viewport', function ($rootScope, $timeout, fileWatcher) {
	return {
		restrict: 'E',
		template: '<div class="viewport"><img class="heroImg" src="{{hero.src}}" /></div>',
		replace: true,
		link: function(scope, element, attrs) {

			var loader = "/images/loader_f.gif";

			function getSrc(filename) {
				var sName = filename.replace(/\.exr$/, "_f.jpg");
				return "/preview/" + fileWatcher.channelId + "_" + sName + "?now=" + Date.now();
			}

			function s(e, fileStat) {
				if (fileStat.name===scope.hero.filename) {
					$timeout(function() {
						scope.hero.src = getSrc(fileStat.name);
					});
				}
			}

			scope.hero = {
				filename: null,
				src: loader
			};

			scope.$watch(function() {
				return scope.hero.filename;
			}, function(filename) {
				if (filename===null) {
					scope.hero.src = loader;
				} else {
					scope.hero.src = getSrc(filename);
				}
			});

			$rootScope.$on("modified", s);
			$rootScope.$on("created", s);
			$rootScope.$on("deleted", function(e, fileStat) {
				if (fileStat.name===scope.hero.filename) {
					$timeout(function() {
						scope.hero.filename = null;
					});
				}
			});

		}
	};
});

Governator.controller("ButtController", function($scope, $rootScope, $timeout, fileWatcher) {

	$scope.files = {};
	$scope.sort = {
		predicate: "name",
		reverse: false
	};

	$scope.setHero = function(filename) {
		$timeout(function() {
			$scope.hero.filename = filename;
		});
	};

	function getSrc(filename) {
		var sName = filename.replace(/\.exr$/, "_s.jpg");
		return "/preview/" + fileWatcher.channelId + "_" + sName + "?now=" + Date.now();
	}

	$rootScope.$on("loadFiles", function(e, channelData) {
		var loadNow = channelData.hasOwnProperty("loadNow");
		$timeout(function() {
			channelData.files.forEach(function(filename) {
				var src = loadNow ? getSrc(filename) : "/images/loader.gif";
				$scope.files[filename] = {
					name: filename,
					src: src
				};
			});
			if (loadNow && Object.keys($scope.files).length>0) {
				$scope.hero.filename = Object.keys($scope.files)[0];
			}
		});
	});

	function s(e, fileStat) {
		var filename = fileStat.name,
			src = getSrc(filename);
		if ($scope.files.hasOwnProperty(filename)) {
			$timeout(function() {
				$scope.files[filename].src = src;
			});
		} else {
			$timeout(function() {
				$scope.files[filename] = {
					name: filename,
					src: src
				};
			});
		}
	}

	// This will _only_ happen when the thumbnails have
	// already been rendered on the server
	$rootScope.$on("modified", s);
	$rootScope.$on("created", s);
	$rootScope.$on("deleted", function(e, fileStat) {
		if ($scope.files.hasOwnProperty(fileStat.name)) {
			$timeout(function() {
				delete $scope.files[fileStat.name];
			});
		}
	});

});