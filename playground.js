var $scope = {
	sequences:{}
};

function findSequence(filename) {
	if (filename.match(/.+\.(\d{3,})\.exr$/)) {
		var tt = filename.split("."),
			t = tt[tt.length-2];
		var frame = parseInt(t, 10),
			p = Array.apply(null, new Array(t.length)).map(function() {
				return "#";
			}).join("");
		tt[tt.length-2] = p;
		var stem = tt.join(".");
		if ($scope.sequences.hasOwnProperty(stem)) {
			if (frame < $scope.sequences[stem].first) {
				$scope.sequences[stem].first = frame;
			} else if (frame > $scope.sequences[stem].last) {
				$scope.sequences[stem].last = frame;
			}
		} else {
			$scope.sequences[stem] = {
				first: frame,
				last: frame
			};
		}
		return {
			stem: stem,
			frame: frame
		};
	}
}


findSequence("hello_sc34.0015.exr");
findSequence("hello_sc33.0016.exr");
console.log($scope.sequences);