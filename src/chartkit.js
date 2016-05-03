(function(angular, Highcharts) {
  'use strict';
  var origModule = angular.module;
  angular.module = function() {
    var module = origModule.apply(angular, arguments);
    module.chart = function(name, factory) {
      return module.directive(name + 'Chart', wrapChart(name + 'Chart', factory));
    };
    return module;
  }

  var orig = Highcharts.SVGRenderer.prototype.html;
  Highcharts.SVGRenderer.prototype.html = function() {
    var wrapper = orig.apply(this, arguments);
    var origSetter = wrapper.textSetter;
    wrapper.textSetter = function(text) {
      if (text.linkFn) {
        delete wrapper.bBox;
        if (!wrapper.scope) {
          text.linkFn(text.scope.$new(), function(element, scope) {
            wrapper.scope = scope;
            angular.extend(wrapper.scope, text.data);
            while (wrapper.element.firstChild) {
              wrapper.element.removeChild(wrapper.element.firstChild);
            }
            wrapper.element.appendChild(element[0]);
            wrapper.textStr = element[0].innerHTML;
            wrapper.htmlUpdateTransform();
          });
        } else {
          angular.extend(wrapper.scope, text.data);
          text.scope.$applyAsync(function() {
            wrapper.textStr = wrapper.element.innerHTML;
            wrapper.htmlUpdateTransform();
          });
        }
      } else {
        origSetter.apply(this, arguments);
      }
    }
    if (arguments.length && arguments[0]) {
      wrapper.attr({text: arguments[0]});
    }
    return wrapper;
  }

  function removeProps(obj, props) {
    var result = {};
    angular.forEach(props, function(prop) {
      if (obj[prop] != null) {
        result[prop] = obj[prop];
        delete obj[prop];
      }
    });
    return result;
  }

  function walkTree(obj, cb) {
    angular.forEach(obj, function(val, key) {
      cb(obj, key, val);
      if (angular.isArray(val)) {
        val.forEach(function(member) {
          walkTree(member, cb);
        });
      } else if (angular.isObject(val)) {
        walkTree(val, cb);
      }
    });
  };

  function wrapChart(chartName, chartFactory) {
    return ['$injector', 'Highcharts', '$compile', '$rootScope', '$templateRequest', '$q', function($injector, Highcharts, $compile, $rootScope, $templateRequest, $q) {
      var chartSettings = $injector.invoke(chartFactory);
      var def = removeProps(chartSettings, ['scope', 'link', 'require', 'transform']);
      var promises = [];
      walkTree(chartSettings, function(obj, key, value) {
        if (key === 'formatter' && value.templateUrl) {
          promises.push($templateRequest(value.templateUrl).then(function(contents) {
            delete value.templateUrl;
            value.template = contents;
          }));
        }
      });
      var definition = {
        restrict: 'E',
        scope: def.scope || {
          data: '='
        },
        compile: function(tElement) {
          var chartDeferred = $q.defer();
          tElement.data('$' + chartName + 'Controller', chartDeferred.promise);
          return function(scope, element, attrs, ctrls) {
            $q.all(promises).then(function() {
              walkTree(chartSettings, function(obj, key, value) {
                if (key === 'events') {
                  angular.forEach(value, function(cb, eventName) {
                    value[eventName] = function() {
                      var self = this,
                        args = [].slice.call(arguments);
                      scope.$apply(function() {
                        cb.apply(self, args.concat([scope]));
                      });
                    };
                  });
                }
                if (key === 'formatter' && value.template) {
                  if (!obj.useHTML) {
                    throw new Error('A formatter.template or formatter.templateUrl value must specify useHTML as true');
                  }
                  var template = value.template;
                  var linkFn = $compile(template);
                  obj.formatter = function() {
                    return {
                      linkFn: linkFn,
                      scope: scope,
                      data: this
                    };
                  };
                }
              });
              var chart = Highcharts.chart(element[0], chartSettings);
              chartDeferred.resolve(chart);
              if (chartSettings.loading) {
                chart.showLoading();
              }
              function indexById(arr) {
                var result = {};
                arr.forEach(function(item) {
                  if (item.id && !result[item.id]) {
                    result[item.id] = item;
                  } else if (!item.id) {
                    throw new Error('Series without an explicit id are not supported in transform');
                  } else {
                    throw new Error('Duplicate ids are not supported in transform');
                  }
                });
                return result;
              }

              if ((!def.scope || def.scope.data) && def.transform) {
                var previousSeries = chartSettings.series || [];
                scope.$watch('data', function(data) {
                  if (data && ((angular.isArray(data) && data.length > 0) || !angular.isArray(data))) {
                    if (chartSettings.loading) {
                      chart.hideLoading();
                    }
                    var currentSeries = indexById(def.transform(data, chart, scope));
                    angular.forEach(currentSeries, function(series, id) {
                      if (previousSeries[id]) {
                      	var data = series.data,
                        		previousData = previousSeries[id].data,
                            target = chart.get(id);
                        delete series.data;
                        delete previousSeries[id].data;
                        if (angular.equals(series, previousSeries[id])) {
                        	if (!angular.equals(data, previousData)) {
                          	target.setData(angular.copy(data), false);
                          }
                          series.data = data;
                        } else {
                        	series.data = data;
                          target.update(angular.copy(series), false);
                        }
                      } else {
                        chart.addSeries(angular.copy(series), false);
                      }
                    });
                    angular.forEach(previousSeries, function(series, id) {
                      if (!currentSeries[id]) {
                        chart.get(id).remove(false);
                      }
                    });
                    chart.redraw();
                    previousSeries = currentSeries;
                  }
                });
              }
              if (def.link) {
                if (ctrls) {
                  if (!angular.isArray(ctrls)) {
                    ctrls = [ctrls];
                  }
                  ctrls.unshift(chart);
                } else {
                  ctrls = chart;
                }
                def.link(scope, element, attrs, ctrls);
              }
            });
          }
        }
      };

      if (def.require) {
        definition.require = def.require;
      }

      return definition;
    }];
  }
  angular.module('chartkit', []).constant('Highcharts', Highcharts);
})(window.angular, window.Highcharts);
