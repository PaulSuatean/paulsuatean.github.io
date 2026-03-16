import * as d3 from 'd3';
import * as topojson from 'topojson-client';

(function installD3Bridge(global) {
  global.d3 = d3;
  global.topojson = topojson;
})(window);
