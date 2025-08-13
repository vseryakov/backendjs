
/**
 * @popperjs/core v2.11.8 - MIT License
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Popper = {}));
}(this, (function (exports) { 'use strict';

  function getWindow(node) {
    if (node == null) {
      return window;
    }

    if (node.toString() !== '[object Window]') {
      var ownerDocument = node.ownerDocument;
      return ownerDocument ? ownerDocument.defaultView || window : window;
    }

    return node;
  }

  function isElement(node) {
    var OwnElement = getWindow(node).Element;
    return node instanceof OwnElement || node instanceof Element;
  }

  function isHTMLElement(node) {
    var OwnElement = getWindow(node).HTMLElement;
    return node instanceof OwnElement || node instanceof HTMLElement;
  }

  function isShadowRoot(node) {
    // IE 11 has no ShadowRoot
    if (typeof ShadowRoot === 'undefined') {
      return false;
    }

    var OwnElement = getWindow(node).ShadowRoot;
    return node instanceof OwnElement || node instanceof ShadowRoot;
  }

  var max = Math.max;
  var min = Math.min;
  var round = Math.round;

  function getUAString() {
    var uaData = navigator.userAgentData;

    if (uaData != null && uaData.brands && Array.isArray(uaData.brands)) {
      return uaData.brands.map(function (item) {
        return item.brand + "/" + item.version;
      }).join(' ');
    }

    return navigator.userAgent;
  }

  function isLayoutViewport() {
    return !/^((?!chrome|android).)*safari/i.test(getUAString());
  }

  function getBoundingClientRect(element, includeScale, isFixedStrategy) {
    if (includeScale === void 0) {
      includeScale = false;
    }

    if (isFixedStrategy === void 0) {
      isFixedStrategy = false;
    }

    var clientRect = element.getBoundingClientRect();
    var scaleX = 1;
    var scaleY = 1;

    if (includeScale && isHTMLElement(element)) {
      scaleX = element.offsetWidth > 0 ? round(clientRect.width) / element.offsetWidth || 1 : 1;
      scaleY = element.offsetHeight > 0 ? round(clientRect.height) / element.offsetHeight || 1 : 1;
    }

    var _ref = isElement(element) ? getWindow(element) : window,
        visualViewport = _ref.visualViewport;

    var addVisualOffsets = !isLayoutViewport() && isFixedStrategy;
    var x = (clientRect.left + (addVisualOffsets && visualViewport ? visualViewport.offsetLeft : 0)) / scaleX;
    var y = (clientRect.top + (addVisualOffsets && visualViewport ? visualViewport.offsetTop : 0)) / scaleY;
    var width = clientRect.width / scaleX;
    var height = clientRect.height / scaleY;
    return {
      width: width,
      height: height,
      top: y,
      right: x + width,
      bottom: y + height,
      left: x,
      x: x,
      y: y
    };
  }

  function getWindowScroll(node) {
    var win = getWindow(node);
    var scrollLeft = win.pageXOffset;
    var scrollTop = win.pageYOffset;
    return {
      scrollLeft: scrollLeft,
      scrollTop: scrollTop
    };
  }

  function getHTMLElementScroll(element) {
    return {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop
    };
  }

  function getNodeScroll(node) {
    if (node === getWindow(node) || !isHTMLElement(node)) {
      return getWindowScroll(node);
    } else {
      return getHTMLElementScroll(node);
    }
  }

  function getNodeName(element) {
    return element ? (element.nodeName || '').toLowerCase() : null;
  }

  function getDocumentElement(element) {
    // $FlowFixMe[incompatible-return]: assume body is always available
    return ((isElement(element) ? element.ownerDocument : // $FlowFixMe[prop-missing]
    element.document) || window.document).documentElement;
  }

  function getWindowScrollBarX(element) {
    // If <html> has a CSS width greater than the viewport, then this will be
    // incorrect for RTL.
    // Popper 1 is broken in this case and never had a bug report so let's assume
    // it's not an issue. I don't think anyone ever specifies width on <html>
    // anyway.
    // Browsers where the left scrollbar doesn't cause an issue report `0` for
    // this (e.g. Edge 2019, IE11, Safari)
    return getBoundingClientRect(getDocumentElement(element)).left + getWindowScroll(element).scrollLeft;
  }

  function getComputedStyle(element) {
    return getWindow(element).getComputedStyle(element);
  }

  function isScrollParent(element) {
    // Firefox wants us to check `-x` and `-y` variations as well
    var _getComputedStyle = getComputedStyle(element),
        overflow = _getComputedStyle.overflow,
        overflowX = _getComputedStyle.overflowX,
        overflowY = _getComputedStyle.overflowY;

    return /auto|scroll|overlay|hidden/.test(overflow + overflowY + overflowX);
  }

  function isElementScaled(element) {
    var rect = element.getBoundingClientRect();
    var scaleX = round(rect.width) / element.offsetWidth || 1;
    var scaleY = round(rect.height) / element.offsetHeight || 1;
    return scaleX !== 1 || scaleY !== 1;
  } // Returns the composite rect of an element relative to its offsetParent.
  // Composite means it takes into account transforms as well as layout.


  function getCompositeRect(elementOrVirtualElement, offsetParent, isFixed) {
    if (isFixed === void 0) {
      isFixed = false;
    }

    var isOffsetParentAnElement = isHTMLElement(offsetParent);
    var offsetParentIsScaled = isHTMLElement(offsetParent) && isElementScaled(offsetParent);
    var documentElement = getDocumentElement(offsetParent);
    var rect = getBoundingClientRect(elementOrVirtualElement, offsetParentIsScaled, isFixed);
    var scroll = {
      scrollLeft: 0,
      scrollTop: 0
    };
    var offsets = {
      x: 0,
      y: 0
    };

    if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
      if (getNodeName(offsetParent) !== 'body' || // https://github.com/popperjs/popper-core/issues/1078
      isScrollParent(documentElement)) {
        scroll = getNodeScroll(offsetParent);
      }

      if (isHTMLElement(offsetParent)) {
        offsets = getBoundingClientRect(offsetParent, true);
        offsets.x += offsetParent.clientLeft;
        offsets.y += offsetParent.clientTop;
      } else if (documentElement) {
        offsets.x = getWindowScrollBarX(documentElement);
      }
    }

    return {
      x: rect.left + scroll.scrollLeft - offsets.x,
      y: rect.top + scroll.scrollTop - offsets.y,
      width: rect.width,
      height: rect.height
    };
  }

  // means it doesn't take into account transforms.

  function getLayoutRect(element) {
    var clientRect = getBoundingClientRect(element); // Use the clientRect sizes if it's not been transformed.
    // Fixes https://github.com/popperjs/popper-core/issues/1223

    var width = element.offsetWidth;
    var height = element.offsetHeight;

    if (Math.abs(clientRect.width - width) <= 1) {
      width = clientRect.width;
    }

    if (Math.abs(clientRect.height - height) <= 1) {
      height = clientRect.height;
    }

    return {
      x: element.offsetLeft,
      y: element.offsetTop,
      width: width,
      height: height
    };
  }

  function getParentNode(element) {
    if (getNodeName(element) === 'html') {
      return element;
    }

    return (// this is a quicker (but less type safe) way to save quite some bytes from the bundle
      // $FlowFixMe[incompatible-return]
      // $FlowFixMe[prop-missing]
      element.assignedSlot || // step into the shadow DOM of the parent of a slotted node
      element.parentNode || ( // DOM Element detected
      isShadowRoot(element) ? element.host : null) || // ShadowRoot detected
      // $FlowFixMe[incompatible-call]: HTMLElement is a Node
      getDocumentElement(element) // fallback

    );
  }

  function getScrollParent(node) {
    if (['html', 'body', '#document'].indexOf(getNodeName(node)) >= 0) {
      // $FlowFixMe[incompatible-return]: assume body is always available
      return node.ownerDocument.body;
    }

    if (isHTMLElement(node) && isScrollParent(node)) {
      return node;
    }

    return getScrollParent(getParentNode(node));
  }

  /*
  given a DOM element, return the list of all scroll parents, up the list of ancesors
  until we get to the top window object. This list is what we attach scroll listeners
  to, because if any of these parent elements scroll, we'll need to re-calculate the
  reference element's position.
  */

  function listScrollParents(element, list) {
    var _element$ownerDocumen;

    if (list === void 0) {
      list = [];
    }

    var scrollParent = getScrollParent(element);
    var isBody = scrollParent === ((_element$ownerDocumen = element.ownerDocument) == null ? void 0 : _element$ownerDocumen.body);
    var win = getWindow(scrollParent);
    var target = isBody ? [win].concat(win.visualViewport || [], isScrollParent(scrollParent) ? scrollParent : []) : scrollParent;
    var updatedList = list.concat(target);
    return isBody ? updatedList : // $FlowFixMe[incompatible-call]: isBody tells us target will be an HTMLElement here
    updatedList.concat(listScrollParents(getParentNode(target)));
  }

  function isTableElement(element) {
    return ['table', 'td', 'th'].indexOf(getNodeName(element)) >= 0;
  }

  function getTrueOffsetParent(element) {
    if (!isHTMLElement(element) || // https://github.com/popperjs/popper-core/issues/837
    getComputedStyle(element).position === 'fixed') {
      return null;
    }

    return element.offsetParent;
  } // `.offsetParent` reports `null` for fixed elements, while absolute elements
  // return the containing block


  function getContainingBlock(element) {
    var isFirefox = /firefox/i.test(getUAString());
    var isIE = /Trident/i.test(getUAString());

    if (isIE && isHTMLElement(element)) {
      // In IE 9, 10 and 11 fixed elements containing block is always established by the viewport
      var elementCss = getComputedStyle(element);

      if (elementCss.position === 'fixed') {
        return null;
      }
    }

    var currentNode = getParentNode(element);

    if (isShadowRoot(currentNode)) {
      currentNode = currentNode.host;
    }

    while (isHTMLElement(currentNode) && ['html', 'body'].indexOf(getNodeName(currentNode)) < 0) {
      var css = getComputedStyle(currentNode); // This is non-exhaustive but covers the most common CSS properties that
      // create a containing block.
      // https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block

      if (css.transform !== 'none' || css.perspective !== 'none' || css.contain === 'paint' || ['transform', 'perspective'].indexOf(css.willChange) !== -1 || isFirefox && css.willChange === 'filter' || isFirefox && css.filter && css.filter !== 'none') {
        return currentNode;
      } else {
        currentNode = currentNode.parentNode;
      }
    }

    return null;
  } // Gets the closest ancestor positioned element. Handles some edge cases,
  // such as table ancestors and cross browser bugs.


  function getOffsetParent(element) {
    var window = getWindow(element);
    var offsetParent = getTrueOffsetParent(element);

    while (offsetParent && isTableElement(offsetParent) && getComputedStyle(offsetParent).position === 'static') {
      offsetParent = getTrueOffsetParent(offsetParent);
    }

    if (offsetParent && (getNodeName(offsetParent) === 'html' || getNodeName(offsetParent) === 'body' && getComputedStyle(offsetParent).position === 'static')) {
      return window;
    }

    return offsetParent || getContainingBlock(element) || window;
  }

  var top = 'top';
  var bottom = 'bottom';
  var right = 'right';
  var left = 'left';
  var auto = 'auto';
  var basePlacements = [top, bottom, right, left];
  var start = 'start';
  var end = 'end';
  var clippingParents = 'clippingParents';
  var viewport = 'viewport';
  var popper = 'popper';
  var reference = 'reference';
  var variationPlacements = /*#__PURE__*/basePlacements.reduce(function (acc, placement) {
    return acc.concat([placement + "-" + start, placement + "-" + end]);
  }, []);
  var placements = /*#__PURE__*/[].concat(basePlacements, [auto]).reduce(function (acc, placement) {
    return acc.concat([placement, placement + "-" + start, placement + "-" + end]);
  }, []); // modifiers that need to read the DOM

  var beforeRead = 'beforeRead';
  var read = 'read';
  var afterRead = 'afterRead'; // pure-logic modifiers

  var beforeMain = 'beforeMain';
  var main = 'main';
  var afterMain = 'afterMain'; // modifier with the purpose to write to the DOM (or write into a framework state)

  var beforeWrite = 'beforeWrite';
  var write = 'write';
  var afterWrite = 'afterWrite';
  var modifierPhases = [beforeRead, read, afterRead, beforeMain, main, afterMain, beforeWrite, write, afterWrite];

  function order(modifiers) {
    var map = new Map();
    var visited = new Set();
    var result = [];
    modifiers.forEach(function (modifier) {
      map.set(modifier.name, modifier);
    }); // On visiting object, check for its dependencies and visit them recursively

    function sort(modifier) {
      visited.add(modifier.name);
      var requires = [].concat(modifier.requires || [], modifier.requiresIfExists || []);
      requires.forEach(function (dep) {
        if (!visited.has(dep)) {
          var depModifier = map.get(dep);

          if (depModifier) {
            sort(depModifier);
          }
        }
      });
      result.push(modifier);
    }

    modifiers.forEach(function (modifier) {
      if (!visited.has(modifier.name)) {
        // check for visited object
        sort(modifier);
      }
    });
    return result;
  }

  function orderModifiers(modifiers) {
    // order based on dependencies
    var orderedModifiers = order(modifiers); // order based on phase

    return modifierPhases.reduce(function (acc, phase) {
      return acc.concat(orderedModifiers.filter(function (modifier) {
        return modifier.phase === phase;
      }));
    }, []);
  }

  function debounce(fn) {
    var pending;
    return function () {
      if (!pending) {
        pending = new Promise(function (resolve) {
          Promise.resolve().then(function () {
            pending = undefined;
            resolve(fn());
          });
        });
      }

      return pending;
    };
  }

  function mergeByName(modifiers) {
    var merged = modifiers.reduce(function (merged, current) {
      var existing = merged[current.name];
      merged[current.name] = existing ? Object.assign({}, existing, current, {
        options: Object.assign({}, existing.options, current.options),
        data: Object.assign({}, existing.data, current.data)
      }) : current;
      return merged;
    }, {}); // IE11 does not support Object.values

    return Object.keys(merged).map(function (key) {
      return merged[key];
    });
  }

  function getViewportRect(element, strategy) {
    var win = getWindow(element);
    var html = getDocumentElement(element);
    var visualViewport = win.visualViewport;
    var width = html.clientWidth;
    var height = html.clientHeight;
    var x = 0;
    var y = 0;

    if (visualViewport) {
      width = visualViewport.width;
      height = visualViewport.height;
      var layoutViewport = isLayoutViewport();

      if (layoutViewport || !layoutViewport && strategy === 'fixed') {
        x = visualViewport.offsetLeft;
        y = visualViewport.offsetTop;
      }
    }

    return {
      width: width,
      height: height,
      x: x + getWindowScrollBarX(element),
      y: y
    };
  }

  // of the `<html>` and `<body>` rect bounds if horizontally scrollable

  function getDocumentRect(element) {
    var _element$ownerDocumen;

    var html = getDocumentElement(element);
    var winScroll = getWindowScroll(element);
    var body = (_element$ownerDocumen = element.ownerDocument) == null ? void 0 : _element$ownerDocumen.body;
    var width = max(html.scrollWidth, html.clientWidth, body ? body.scrollWidth : 0, body ? body.clientWidth : 0);
    var height = max(html.scrollHeight, html.clientHeight, body ? body.scrollHeight : 0, body ? body.clientHeight : 0);
    var x = -winScroll.scrollLeft + getWindowScrollBarX(element);
    var y = -winScroll.scrollTop;

    if (getComputedStyle(body || html).direction === 'rtl') {
      x += max(html.clientWidth, body ? body.clientWidth : 0) - width;
    }

    return {
      width: width,
      height: height,
      x: x,
      y: y
    };
  }

  function contains(parent, child) {
    var rootNode = child.getRootNode && child.getRootNode(); // First, attempt with faster native method

    if (parent.contains(child)) {
      return true;
    } // then fallback to custom implementation with Shadow DOM support
    else if (rootNode && isShadowRoot(rootNode)) {
        var next = child;

        do {
          if (next && parent.isSameNode(next)) {
            return true;
          } // $FlowFixMe[prop-missing]: need a better way to handle this...


          next = next.parentNode || next.host;
        } while (next);
      } // Give up, the result is false


    return false;
  }

  function rectToClientRect(rect) {
    return Object.assign({}, rect, {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height
    });
  }

  function getInnerBoundingClientRect(element, strategy) {
    var rect = getBoundingClientRect(element, false, strategy === 'fixed');
    rect.top = rect.top + element.clientTop;
    rect.left = rect.left + element.clientLeft;
    rect.bottom = rect.top + element.clientHeight;
    rect.right = rect.left + element.clientWidth;
    rect.width = element.clientWidth;
    rect.height = element.clientHeight;
    rect.x = rect.left;
    rect.y = rect.top;
    return rect;
  }

  function getClientRectFromMixedType(element, clippingParent, strategy) {
    return clippingParent === viewport ? rectToClientRect(getViewportRect(element, strategy)) : isElement(clippingParent) ? getInnerBoundingClientRect(clippingParent, strategy) : rectToClientRect(getDocumentRect(getDocumentElement(element)));
  } // A "clipping parent" is an overflowable container with the characteristic of
  // clipping (or hiding) overflowing elements with a position different from
  // `initial`


  function getClippingParents(element) {
    var clippingParents = listScrollParents(getParentNode(element));
    var canEscapeClipping = ['absolute', 'fixed'].indexOf(getComputedStyle(element).position) >= 0;
    var clipperElement = canEscapeClipping && isHTMLElement(element) ? getOffsetParent(element) : element;

    if (!isElement(clipperElement)) {
      return [];
    } // $FlowFixMe[incompatible-return]: https://github.com/facebook/flow/issues/1414


    return clippingParents.filter(function (clippingParent) {
      return isElement(clippingParent) && contains(clippingParent, clipperElement) && getNodeName(clippingParent) !== 'body';
    });
  } // Gets the maximum area that the element is visible in due to any number of
  // clipping parents


  function getClippingRect(element, boundary, rootBoundary, strategy) {
    var mainClippingParents = boundary === 'clippingParents' ? getClippingParents(element) : [].concat(boundary);
    var clippingParents = [].concat(mainClippingParents, [rootBoundary]);
    var firstClippingParent = clippingParents[0];
    var clippingRect = clippingParents.reduce(function (accRect, clippingParent) {
      var rect = getClientRectFromMixedType(element, clippingParent, strategy);
      accRect.top = max(rect.top, accRect.top);
      accRect.right = min(rect.right, accRect.right);
      accRect.bottom = min(rect.bottom, accRect.bottom);
      accRect.left = max(rect.left, accRect.left);
      return accRect;
    }, getClientRectFromMixedType(element, firstClippingParent, strategy));
    clippingRect.width = clippingRect.right - clippingRect.left;
    clippingRect.height = clippingRect.bottom - clippingRect.top;
    clippingRect.x = clippingRect.left;
    clippingRect.y = clippingRect.top;
    return clippingRect;
  }

  function getBasePlacement(placement) {
    return placement.split('-')[0];
  }

  function getVariation(placement) {
    return placement.split('-')[1];
  }

  function getMainAxisFromPlacement(placement) {
    return ['top', 'bottom'].indexOf(placement) >= 0 ? 'x' : 'y';
  }

  function computeOffsets(_ref) {
    var reference = _ref.reference,
        element = _ref.element,
        placement = _ref.placement;
    var basePlacement = placement ? getBasePlacement(placement) : null;
    var variation = placement ? getVariation(placement) : null;
    var commonX = reference.x + reference.width / 2 - element.width / 2;
    var commonY = reference.y + reference.height / 2 - element.height / 2;
    var offsets;

    switch (basePlacement) {
      case top:
        offsets = {
          x: commonX,
          y: reference.y - element.height
        };
        break;

      case bottom:
        offsets = {
          x: commonX,
          y: reference.y + reference.height
        };
        break;

      case right:
        offsets = {
          x: reference.x + reference.width,
          y: commonY
        };
        break;

      case left:
        offsets = {
          x: reference.x - element.width,
          y: commonY
        };
        break;

      default:
        offsets = {
          x: reference.x,
          y: reference.y
        };
    }

    var mainAxis = basePlacement ? getMainAxisFromPlacement(basePlacement) : null;

    if (mainAxis != null) {
      var len = mainAxis === 'y' ? 'height' : 'width';

      switch (variation) {
        case start:
          offsets[mainAxis] = offsets[mainAxis] - (reference[len] / 2 - element[len] / 2);
          break;

        case end:
          offsets[mainAxis] = offsets[mainAxis] + (reference[len] / 2 - element[len] / 2);
          break;
      }
    }

    return offsets;
  }

  function getFreshSideObject() {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    };
  }

  function mergePaddingObject(paddingObject) {
    return Object.assign({}, getFreshSideObject(), paddingObject);
  }

  function expandToHashMap(value, keys) {
    return keys.reduce(function (hashMap, key) {
      hashMap[key] = value;
      return hashMap;
    }, {});
  }

  function detectOverflow(state, options) {
    if (options === void 0) {
      options = {};
    }

    var _options = options,
        _options$placement = _options.placement,
        placement = _options$placement === void 0 ? state.placement : _options$placement,
        _options$strategy = _options.strategy,
        strategy = _options$strategy === void 0 ? state.strategy : _options$strategy,
        _options$boundary = _options.boundary,
        boundary = _options$boundary === void 0 ? clippingParents : _options$boundary,
        _options$rootBoundary = _options.rootBoundary,
        rootBoundary = _options$rootBoundary === void 0 ? viewport : _options$rootBoundary,
        _options$elementConte = _options.elementContext,
        elementContext = _options$elementConte === void 0 ? popper : _options$elementConte,
        _options$altBoundary = _options.altBoundary,
        altBoundary = _options$altBoundary === void 0 ? false : _options$altBoundary,
        _options$padding = _options.padding,
        padding = _options$padding === void 0 ? 0 : _options$padding;
    var paddingObject = mergePaddingObject(typeof padding !== 'number' ? padding : expandToHashMap(padding, basePlacements));
    var altContext = elementContext === popper ? reference : popper;
    var popperRect = state.rects.popper;
    var element = state.elements[altBoundary ? altContext : elementContext];
    var clippingClientRect = getClippingRect(isElement(element) ? element : element.contextElement || getDocumentElement(state.elements.popper), boundary, rootBoundary, strategy);
    var referenceClientRect = getBoundingClientRect(state.elements.reference);
    var popperOffsets = computeOffsets({
      reference: referenceClientRect,
      element: popperRect,
      strategy: 'absolute',
      placement: placement
    });
    var popperClientRect = rectToClientRect(Object.assign({}, popperRect, popperOffsets));
    var elementClientRect = elementContext === popper ? popperClientRect : referenceClientRect; // positive = overflowing the clipping rect
    // 0 or negative = within the clipping rect

    var overflowOffsets = {
      top: clippingClientRect.top - elementClientRect.top + paddingObject.top,
      bottom: elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom,
      left: clippingClientRect.left - elementClientRect.left + paddingObject.left,
      right: elementClientRect.right - clippingClientRect.right + paddingObject.right
    };
    var offsetData = state.modifiersData.offset; // Offsets can be applied only to the popper element

    if (elementContext === popper && offsetData) {
      var offset = offsetData[placement];
      Object.keys(overflowOffsets).forEach(function (key) {
        var multiply = [right, bottom].indexOf(key) >= 0 ? 1 : -1;
        var axis = [top, bottom].indexOf(key) >= 0 ? 'y' : 'x';
        overflowOffsets[key] += offset[axis] * multiply;
      });
    }

    return overflowOffsets;
  }

  var DEFAULT_OPTIONS = {
    placement: 'bottom',
    modifiers: [],
    strategy: 'absolute'
  };

  function areValidElements() {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return !args.some(function (element) {
      return !(element && typeof element.getBoundingClientRect === 'function');
    });
  }

  function popperGenerator(generatorOptions) {
    if (generatorOptions === void 0) {
      generatorOptions = {};
    }

    var _generatorOptions = generatorOptions,
        _generatorOptions$def = _generatorOptions.defaultModifiers,
        defaultModifiers = _generatorOptions$def === void 0 ? [] : _generatorOptions$def,
        _generatorOptions$def2 = _generatorOptions.defaultOptions,
        defaultOptions = _generatorOptions$def2 === void 0 ? DEFAULT_OPTIONS : _generatorOptions$def2;
    return function createPopper(reference, popper, options) {
      if (options === void 0) {
        options = defaultOptions;
      }

      var state = {
        placement: 'bottom',
        orderedModifiers: [],
        options: Object.assign({}, DEFAULT_OPTIONS, defaultOptions),
        modifiersData: {},
        elements: {
          reference: reference,
          popper: popper
        },
        attributes: {},
        styles: {}
      };
      var effectCleanupFns = [];
      var isDestroyed = false;
      var instance = {
        state: state,
        setOptions: function setOptions(setOptionsAction) {
          var options = typeof setOptionsAction === 'function' ? setOptionsAction(state.options) : setOptionsAction;
          cleanupModifierEffects();
          state.options = Object.assign({}, defaultOptions, state.options, options);
          state.scrollParents = {
            reference: isElement(reference) ? listScrollParents(reference) : reference.contextElement ? listScrollParents(reference.contextElement) : [],
            popper: listScrollParents(popper)
          }; // Orders the modifiers based on their dependencies and `phase`
          // properties

          var orderedModifiers = orderModifiers(mergeByName([].concat(defaultModifiers, state.options.modifiers))); // Strip out disabled modifiers

          state.orderedModifiers = orderedModifiers.filter(function (m) {
            return m.enabled;
          });
          runModifierEffects();
          return instance.update();
        },
        // Sync update – it will always be executed, even if not necessary. This
        // is useful for low frequency updates where sync behavior simplifies the
        // logic.
        // For high frequency updates (e.g. `resize` and `scroll` events), always
        // prefer the async Popper#update method
        forceUpdate: function forceUpdate() {
          if (isDestroyed) {
            return;
          }

          var _state$elements = state.elements,
              reference = _state$elements.reference,
              popper = _state$elements.popper; // Don't proceed if `reference` or `popper` are not valid elements
          // anymore

          if (!areValidElements(reference, popper)) {
            return;
          } // Store the reference and popper rects to be read by modifiers


          state.rects = {
            reference: getCompositeRect(reference, getOffsetParent(popper), state.options.strategy === 'fixed'),
            popper: getLayoutRect(popper)
          }; // Modifiers have the ability to reset the current update cycle. The
          // most common use case for this is the `flip` modifier changing the
          // placement, which then needs to re-run all the modifiers, because the
          // logic was previously ran for the previous placement and is therefore
          // stale/incorrect

          state.reset = false;
          state.placement = state.options.placement; // On each update cycle, the `modifiersData` property for each modifier
          // is filled with the initial data specified by the modifier. This means
          // it doesn't persist and is fresh on each update.
          // To ensure persistent data, use `${name}#persistent`

          state.orderedModifiers.forEach(function (modifier) {
            return state.modifiersData[modifier.name] = Object.assign({}, modifier.data);
          });

          for (var index = 0; index < state.orderedModifiers.length; index++) {
            if (state.reset === true) {
              state.reset = false;
              index = -1;
              continue;
            }

            var _state$orderedModifie = state.orderedModifiers[index],
                fn = _state$orderedModifie.fn,
                _state$orderedModifie2 = _state$orderedModifie.options,
                _options = _state$orderedModifie2 === void 0 ? {} : _state$orderedModifie2,
                name = _state$orderedModifie.name;

            if (typeof fn === 'function') {
              state = fn({
                state: state,
                options: _options,
                name: name,
                instance: instance
              }) || state;
            }
          }
        },
        // Async and optimistically optimized update – it will not be executed if
        // not necessary (debounced to run at most once-per-tick)
        update: debounce(function () {
          return new Promise(function (resolve) {
            instance.forceUpdate();
            resolve(state);
          });
        }),
        destroy: function destroy() {
          cleanupModifierEffects();
          isDestroyed = true;
        }
      };

      if (!areValidElements(reference, popper)) {
        return instance;
      }

      instance.setOptions(options).then(function (state) {
        if (!isDestroyed && options.onFirstUpdate) {
          options.onFirstUpdate(state);
        }
      }); // Modifiers have the ability to execute arbitrary code before the first
      // update cycle runs. They will be executed in the same order as the update
      // cycle. This is useful when a modifier adds some persistent data that
      // other modifiers need to use, but the modifier is run after the dependent
      // one.

      function runModifierEffects() {
        state.orderedModifiers.forEach(function (_ref) {
          var name = _ref.name,
              _ref$options = _ref.options,
              options = _ref$options === void 0 ? {} : _ref$options,
              effect = _ref.effect;

          if (typeof effect === 'function') {
            var cleanupFn = effect({
              state: state,
              name: name,
              instance: instance,
              options: options
            });

            var noopFn = function noopFn() {};

            effectCleanupFns.push(cleanupFn || noopFn);
          }
        });
      }

      function cleanupModifierEffects() {
        effectCleanupFns.forEach(function (fn) {
          return fn();
        });
        effectCleanupFns = [];
      }

      return instance;
    };
  }

  var passive = {
    passive: true
  };

  function effect$2(_ref) {
    var state = _ref.state,
        instance = _ref.instance,
        options = _ref.options;
    var _options$scroll = options.scroll,
        scroll = _options$scroll === void 0 ? true : _options$scroll,
        _options$resize = options.resize,
        resize = _options$resize === void 0 ? true : _options$resize;
    var window = getWindow(state.elements.popper);
    var scrollParents = [].concat(state.scrollParents.reference, state.scrollParents.popper);

    if (scroll) {
      scrollParents.forEach(function (scrollParent) {
        scrollParent.addEventListener('scroll', instance.update, passive);
      });
    }

    if (resize) {
      window.addEventListener('resize', instance.update, passive);
    }

    return function () {
      if (scroll) {
        scrollParents.forEach(function (scrollParent) {
          scrollParent.removeEventListener('scroll', instance.update, passive);
        });
      }

      if (resize) {
        window.removeEventListener('resize', instance.update, passive);
      }
    };
  } // eslint-disable-next-line import/no-unused-modules


  var eventListeners = {
    name: 'eventListeners',
    enabled: true,
    phase: 'write',
    fn: function fn() {},
    effect: effect$2,
    data: {}
  };

  function popperOffsets(_ref) {
    var state = _ref.state,
        name = _ref.name;
    // Offsets are the actual position the popper needs to have to be
    // properly positioned near its reference element
    // This is the most basic placement, and will be adjusted by
    // the modifiers in the next step
    state.modifiersData[name] = computeOffsets({
      reference: state.rects.reference,
      element: state.rects.popper,
      strategy: 'absolute',
      placement: state.placement
    });
  } // eslint-disable-next-line import/no-unused-modules


  var popperOffsets$1 = {
    name: 'popperOffsets',
    enabled: true,
    phase: 'read',
    fn: popperOffsets,
    data: {}
  };

  var unsetSides = {
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    left: 'auto'
  }; // Round the offsets to the nearest suitable subpixel based on the DPR.
  // Zooming can change the DPR, but it seems to report a value that will
  // cleanly divide the values into the appropriate subpixels.

  function roundOffsetsByDPR(_ref, win) {
    var x = _ref.x,
        y = _ref.y;
    var dpr = win.devicePixelRatio || 1;
    return {
      x: round(x * dpr) / dpr || 0,
      y: round(y * dpr) / dpr || 0
    };
  }

  function mapToStyles(_ref2) {
    var _Object$assign2;

    var popper = _ref2.popper,
        popperRect = _ref2.popperRect,
        placement = _ref2.placement,
        variation = _ref2.variation,
        offsets = _ref2.offsets,
        position = _ref2.position,
        gpuAcceleration = _ref2.gpuAcceleration,
        adaptive = _ref2.adaptive,
        roundOffsets = _ref2.roundOffsets,
        isFixed = _ref2.isFixed;
    var _offsets$x = offsets.x,
        x = _offsets$x === void 0 ? 0 : _offsets$x,
        _offsets$y = offsets.y,
        y = _offsets$y === void 0 ? 0 : _offsets$y;

    var _ref3 = typeof roundOffsets === 'function' ? roundOffsets({
      x: x,
      y: y
    }) : {
      x: x,
      y: y
    };

    x = _ref3.x;
    y = _ref3.y;
    var hasX = offsets.hasOwnProperty('x');
    var hasY = offsets.hasOwnProperty('y');
    var sideX = left;
    var sideY = top;
    var win = window;

    if (adaptive) {
      var offsetParent = getOffsetParent(popper);
      var heightProp = 'clientHeight';
      var widthProp = 'clientWidth';

      if (offsetParent === getWindow(popper)) {
        offsetParent = getDocumentElement(popper);

        if (getComputedStyle(offsetParent).position !== 'static' && position === 'absolute') {
          heightProp = 'scrollHeight';
          widthProp = 'scrollWidth';
        }
      } // $FlowFixMe[incompatible-cast]: force type refinement, we compare offsetParent with window above, but Flow doesn't detect it


      offsetParent = offsetParent;

      if (placement === top || (placement === left || placement === right) && variation === end) {
        sideY = bottom;
        var offsetY = isFixed && offsetParent === win && win.visualViewport ? win.visualViewport.height : // $FlowFixMe[prop-missing]
        offsetParent[heightProp];
        y -= offsetY - popperRect.height;
        y *= gpuAcceleration ? 1 : -1;
      }

      if (placement === left || (placement === top || placement === bottom) && variation === end) {
        sideX = right;
        var offsetX = isFixed && offsetParent === win && win.visualViewport ? win.visualViewport.width : // $FlowFixMe[prop-missing]
        offsetParent[widthProp];
        x -= offsetX - popperRect.width;
        x *= gpuAcceleration ? 1 : -1;
      }
    }

    var commonStyles = Object.assign({
      position: position
    }, adaptive && unsetSides);

    var _ref4 = roundOffsets === true ? roundOffsetsByDPR({
      x: x,
      y: y
    }, getWindow(popper)) : {
      x: x,
      y: y
    };

    x = _ref4.x;
    y = _ref4.y;

    if (gpuAcceleration) {
      var _Object$assign;

      return Object.assign({}, commonStyles, (_Object$assign = {}, _Object$assign[sideY] = hasY ? '0' : '', _Object$assign[sideX] = hasX ? '0' : '', _Object$assign.transform = (win.devicePixelRatio || 1) <= 1 ? "translate(" + x + "px, " + y + "px)" : "translate3d(" + x + "px, " + y + "px, 0)", _Object$assign));
    }

    return Object.assign({}, commonStyles, (_Object$assign2 = {}, _Object$assign2[sideY] = hasY ? y + "px" : '', _Object$assign2[sideX] = hasX ? x + "px" : '', _Object$assign2.transform = '', _Object$assign2));
  }

  function computeStyles(_ref5) {
    var state = _ref5.state,
        options = _ref5.options;
    var _options$gpuAccelerat = options.gpuAcceleration,
        gpuAcceleration = _options$gpuAccelerat === void 0 ? true : _options$gpuAccelerat,
        _options$adaptive = options.adaptive,
        adaptive = _options$adaptive === void 0 ? true : _options$adaptive,
        _options$roundOffsets = options.roundOffsets,
        roundOffsets = _options$roundOffsets === void 0 ? true : _options$roundOffsets;
    var commonStyles = {
      placement: getBasePlacement(state.placement),
      variation: getVariation(state.placement),
      popper: state.elements.popper,
      popperRect: state.rects.popper,
      gpuAcceleration: gpuAcceleration,
      isFixed: state.options.strategy === 'fixed'
    };

    if (state.modifiersData.popperOffsets != null) {
      state.styles.popper = Object.assign({}, state.styles.popper, mapToStyles(Object.assign({}, commonStyles, {
        offsets: state.modifiersData.popperOffsets,
        position: state.options.strategy,
        adaptive: adaptive,
        roundOffsets: roundOffsets
      })));
    }

    if (state.modifiersData.arrow != null) {
      state.styles.arrow = Object.assign({}, state.styles.arrow, mapToStyles(Object.assign({}, commonStyles, {
        offsets: state.modifiersData.arrow,
        position: 'absolute',
        adaptive: false,
        roundOffsets: roundOffsets
      })));
    }

    state.attributes.popper = Object.assign({}, state.attributes.popper, {
      'data-popper-placement': state.placement
    });
  } // eslint-disable-next-line import/no-unused-modules


  var computeStyles$1 = {
    name: 'computeStyles',
    enabled: true,
    phase: 'beforeWrite',
    fn: computeStyles,
    data: {}
  };

  // and applies them to the HTMLElements such as popper and arrow

  function applyStyles(_ref) {
    var state = _ref.state;
    Object.keys(state.elements).forEach(function (name) {
      var style = state.styles[name] || {};
      var attributes = state.attributes[name] || {};
      var element = state.elements[name]; // arrow is optional + virtual elements

      if (!isHTMLElement(element) || !getNodeName(element)) {
        return;
      } // Flow doesn't support to extend this property, but it's the most
      // effective way to apply styles to an HTMLElement
      // $FlowFixMe[cannot-write]


      Object.assign(element.style, style);
      Object.keys(attributes).forEach(function (name) {
        var value = attributes[name];

        if (value === false) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, value === true ? '' : value);
        }
      });
    });
  }

  function effect$1(_ref2) {
    var state = _ref2.state;
    var initialStyles = {
      popper: {
        position: state.options.strategy,
        left: '0',
        top: '0',
        margin: '0'
      },
      arrow: {
        position: 'absolute'
      },
      reference: {}
    };
    Object.assign(state.elements.popper.style, initialStyles.popper);
    state.styles = initialStyles;

    if (state.elements.arrow) {
      Object.assign(state.elements.arrow.style, initialStyles.arrow);
    }

    return function () {
      Object.keys(state.elements).forEach(function (name) {
        var element = state.elements[name];
        var attributes = state.attributes[name] || {};
        var styleProperties = Object.keys(state.styles.hasOwnProperty(name) ? state.styles[name] : initialStyles[name]); // Set all values to an empty string to unset them

        var style = styleProperties.reduce(function (style, property) {
          style[property] = '';
          return style;
        }, {}); // arrow is optional + virtual elements

        if (!isHTMLElement(element) || !getNodeName(element)) {
          return;
        }

        Object.assign(element.style, style);
        Object.keys(attributes).forEach(function (attribute) {
          element.removeAttribute(attribute);
        });
      });
    };
  } // eslint-disable-next-line import/no-unused-modules


  var applyStyles$1 = {
    name: 'applyStyles',
    enabled: true,
    phase: 'write',
    fn: applyStyles,
    effect: effect$1,
    requires: ['computeStyles']
  };

  function distanceAndSkiddingToXY(placement, rects, offset) {
    var basePlacement = getBasePlacement(placement);
    var invertDistance = [left, top].indexOf(basePlacement) >= 0 ? -1 : 1;

    var _ref = typeof offset === 'function' ? offset(Object.assign({}, rects, {
      placement: placement
    })) : offset,
        skidding = _ref[0],
        distance = _ref[1];

    skidding = skidding || 0;
    distance = (distance || 0) * invertDistance;
    return [left, right].indexOf(basePlacement) >= 0 ? {
      x: distance,
      y: skidding
    } : {
      x: skidding,
      y: distance
    };
  }

  function offset(_ref2) {
    var state = _ref2.state,
        options = _ref2.options,
        name = _ref2.name;
    var _options$offset = options.offset,
        offset = _options$offset === void 0 ? [0, 0] : _options$offset;
    var data = placements.reduce(function (acc, placement) {
      acc[placement] = distanceAndSkiddingToXY(placement, state.rects, offset);
      return acc;
    }, {});
    var _data$state$placement = data[state.placement],
        x = _data$state$placement.x,
        y = _data$state$placement.y;

    if (state.modifiersData.popperOffsets != null) {
      state.modifiersData.popperOffsets.x += x;
      state.modifiersData.popperOffsets.y += y;
    }

    state.modifiersData[name] = data;
  } // eslint-disable-next-line import/no-unused-modules


  var offset$1 = {
    name: 'offset',
    enabled: true,
    phase: 'main',
    requires: ['popperOffsets'],
    fn: offset
  };

  var hash$1 = {
    left: 'right',
    right: 'left',
    bottom: 'top',
    top: 'bottom'
  };
  function getOppositePlacement(placement) {
    return placement.replace(/left|right|bottom|top/g, function (matched) {
      return hash$1[matched];
    });
  }

  var hash = {
    start: 'end',
    end: 'start'
  };
  function getOppositeVariationPlacement(placement) {
    return placement.replace(/start|end/g, function (matched) {
      return hash[matched];
    });
  }

  function computeAutoPlacement(state, options) {
    if (options === void 0) {
      options = {};
    }

    var _options = options,
        placement = _options.placement,
        boundary = _options.boundary,
        rootBoundary = _options.rootBoundary,
        padding = _options.padding,
        flipVariations = _options.flipVariations,
        _options$allowedAutoP = _options.allowedAutoPlacements,
        allowedAutoPlacements = _options$allowedAutoP === void 0 ? placements : _options$allowedAutoP;
    var variation = getVariation(placement);
    var placements$1 = variation ? flipVariations ? variationPlacements : variationPlacements.filter(function (placement) {
      return getVariation(placement) === variation;
    }) : basePlacements;
    var allowedPlacements = placements$1.filter(function (placement) {
      return allowedAutoPlacements.indexOf(placement) >= 0;
    });

    if (allowedPlacements.length === 0) {
      allowedPlacements = placements$1;
    } // $FlowFixMe[incompatible-type]: Flow seems to have problems with two array unions...


    var overflows = allowedPlacements.reduce(function (acc, placement) {
      acc[placement] = detectOverflow(state, {
        placement: placement,
        boundary: boundary,
        rootBoundary: rootBoundary,
        padding: padding
      })[getBasePlacement(placement)];
      return acc;
    }, {});
    return Object.keys(overflows).sort(function (a, b) {
      return overflows[a] - overflows[b];
    });
  }

  function getExpandedFallbackPlacements(placement) {
    if (getBasePlacement(placement) === auto) {
      return [];
    }

    var oppositePlacement = getOppositePlacement(placement);
    return [getOppositeVariationPlacement(placement), oppositePlacement, getOppositeVariationPlacement(oppositePlacement)];
  }

  function flip(_ref) {
    var state = _ref.state,
        options = _ref.options,
        name = _ref.name;

    if (state.modifiersData[name]._skip) {
      return;
    }

    var _options$mainAxis = options.mainAxis,
        checkMainAxis = _options$mainAxis === void 0 ? true : _options$mainAxis,
        _options$altAxis = options.altAxis,
        checkAltAxis = _options$altAxis === void 0 ? true : _options$altAxis,
        specifiedFallbackPlacements = options.fallbackPlacements,
        padding = options.padding,
        boundary = options.boundary,
        rootBoundary = options.rootBoundary,
        altBoundary = options.altBoundary,
        _options$flipVariatio = options.flipVariations,
        flipVariations = _options$flipVariatio === void 0 ? true : _options$flipVariatio,
        allowedAutoPlacements = options.allowedAutoPlacements;
    var preferredPlacement = state.options.placement;
    var basePlacement = getBasePlacement(preferredPlacement);
    var isBasePlacement = basePlacement === preferredPlacement;
    var fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipVariations ? [getOppositePlacement(preferredPlacement)] : getExpandedFallbackPlacements(preferredPlacement));
    var placements = [preferredPlacement].concat(fallbackPlacements).reduce(function (acc, placement) {
      return acc.concat(getBasePlacement(placement) === auto ? computeAutoPlacement(state, {
        placement: placement,
        boundary: boundary,
        rootBoundary: rootBoundary,
        padding: padding,
        flipVariations: flipVariations,
        allowedAutoPlacements: allowedAutoPlacements
      }) : placement);
    }, []);
    var referenceRect = state.rects.reference;
    var popperRect = state.rects.popper;
    var checksMap = new Map();
    var makeFallbackChecks = true;
    var firstFittingPlacement = placements[0];

    for (var i = 0; i < placements.length; i++) {
      var placement = placements[i];

      var _basePlacement = getBasePlacement(placement);

      var isStartVariation = getVariation(placement) === start;
      var isVertical = [top, bottom].indexOf(_basePlacement) >= 0;
      var len = isVertical ? 'width' : 'height';
      var overflow = detectOverflow(state, {
        placement: placement,
        boundary: boundary,
        rootBoundary: rootBoundary,
        altBoundary: altBoundary,
        padding: padding
      });
      var mainVariationSide = isVertical ? isStartVariation ? right : left : isStartVariation ? bottom : top;

      if (referenceRect[len] > popperRect[len]) {
        mainVariationSide = getOppositePlacement(mainVariationSide);
      }

      var altVariationSide = getOppositePlacement(mainVariationSide);
      var checks = [];

      if (checkMainAxis) {
        checks.push(overflow[_basePlacement] <= 0);
      }

      if (checkAltAxis) {
        checks.push(overflow[mainVariationSide] <= 0, overflow[altVariationSide] <= 0);
      }

      if (checks.every(function (check) {
        return check;
      })) {
        firstFittingPlacement = placement;
        makeFallbackChecks = false;
        break;
      }

      checksMap.set(placement, checks);
    }

    if (makeFallbackChecks) {
      // `2` may be desired in some cases – research later
      var numberOfChecks = flipVariations ? 3 : 1;

      var _loop = function _loop(_i) {
        var fittingPlacement = placements.find(function (placement) {
          var checks = checksMap.get(placement);

          if (checks) {
            return checks.slice(0, _i).every(function (check) {
              return check;
            });
          }
        });

        if (fittingPlacement) {
          firstFittingPlacement = fittingPlacement;
          return "break";
        }
      };

      for (var _i = numberOfChecks; _i > 0; _i--) {
        var _ret = _loop(_i);

        if (_ret === "break") break;
      }
    }

    if (state.placement !== firstFittingPlacement) {
      state.modifiersData[name]._skip = true;
      state.placement = firstFittingPlacement;
      state.reset = true;
    }
  } // eslint-disable-next-line import/no-unused-modules


  var flip$1 = {
    name: 'flip',
    enabled: true,
    phase: 'main',
    fn: flip,
    requiresIfExists: ['offset'],
    data: {
      _skip: false
    }
  };

  function getAltAxis(axis) {
    return axis === 'x' ? 'y' : 'x';
  }

  function within(min$1, value, max$1) {
    return max(min$1, min(value, max$1));
  }
  function withinMaxClamp(min, value, max) {
    var v = within(min, value, max);
    return v > max ? max : v;
  }

  function preventOverflow(_ref) {
    var state = _ref.state,
        options = _ref.options,
        name = _ref.name;
    var _options$mainAxis = options.mainAxis,
        checkMainAxis = _options$mainAxis === void 0 ? true : _options$mainAxis,
        _options$altAxis = options.altAxis,
        checkAltAxis = _options$altAxis === void 0 ? false : _options$altAxis,
        boundary = options.boundary,
        rootBoundary = options.rootBoundary,
        altBoundary = options.altBoundary,
        padding = options.padding,
        _options$tether = options.tether,
        tether = _options$tether === void 0 ? true : _options$tether,
        _options$tetherOffset = options.tetherOffset,
        tetherOffset = _options$tetherOffset === void 0 ? 0 : _options$tetherOffset;
    var overflow = detectOverflow(state, {
      boundary: boundary,
      rootBoundary: rootBoundary,
      padding: padding,
      altBoundary: altBoundary
    });
    var basePlacement = getBasePlacement(state.placement);
    var variation = getVariation(state.placement);
    var isBasePlacement = !variation;
    var mainAxis = getMainAxisFromPlacement(basePlacement);
    var altAxis = getAltAxis(mainAxis);
    var popperOffsets = state.modifiersData.popperOffsets;
    var referenceRect = state.rects.reference;
    var popperRect = state.rects.popper;
    var tetherOffsetValue = typeof tetherOffset === 'function' ? tetherOffset(Object.assign({}, state.rects, {
      placement: state.placement
    })) : tetherOffset;
    var normalizedTetherOffsetValue = typeof tetherOffsetValue === 'number' ? {
      mainAxis: tetherOffsetValue,
      altAxis: tetherOffsetValue
    } : Object.assign({
      mainAxis: 0,
      altAxis: 0
    }, tetherOffsetValue);
    var offsetModifierState = state.modifiersData.offset ? state.modifiersData.offset[state.placement] : null;
    var data = {
      x: 0,
      y: 0
    };

    if (!popperOffsets) {
      return;
    }

    if (checkMainAxis) {
      var _offsetModifierState$;

      var mainSide = mainAxis === 'y' ? top : left;
      var altSide = mainAxis === 'y' ? bottom : right;
      var len = mainAxis === 'y' ? 'height' : 'width';
      var offset = popperOffsets[mainAxis];
      var min$1 = offset + overflow[mainSide];
      var max$1 = offset - overflow[altSide];
      var additive = tether ? -popperRect[len] / 2 : 0;
      var minLen = variation === start ? referenceRect[len] : popperRect[len];
      var maxLen = variation === start ? -popperRect[len] : -referenceRect[len]; // We need to include the arrow in the calculation so the arrow doesn't go
      // outside the reference bounds

      var arrowElement = state.elements.arrow;
      var arrowRect = tether && arrowElement ? getLayoutRect(arrowElement) : {
        width: 0,
        height: 0
      };
      var arrowPaddingObject = state.modifiersData['arrow#persistent'] ? state.modifiersData['arrow#persistent'].padding : getFreshSideObject();
      var arrowPaddingMin = arrowPaddingObject[mainSide];
      var arrowPaddingMax = arrowPaddingObject[altSide]; // If the reference length is smaller than the arrow length, we don't want
      // to include its full size in the calculation. If the reference is small
      // and near the edge of a boundary, the popper can overflow even if the
      // reference is not overflowing as well (e.g. virtual elements with no
      // width or height)

      var arrowLen = within(0, referenceRect[len], arrowRect[len]);
      var minOffset = isBasePlacement ? referenceRect[len] / 2 - additive - arrowLen - arrowPaddingMin - normalizedTetherOffsetValue.mainAxis : minLen - arrowLen - arrowPaddingMin - normalizedTetherOffsetValue.mainAxis;
      var maxOffset = isBasePlacement ? -referenceRect[len] / 2 + additive + arrowLen + arrowPaddingMax + normalizedTetherOffsetValue.mainAxis : maxLen + arrowLen + arrowPaddingMax + normalizedTetherOffsetValue.mainAxis;
      var arrowOffsetParent = state.elements.arrow && getOffsetParent(state.elements.arrow);
      var clientOffset = arrowOffsetParent ? mainAxis === 'y' ? arrowOffsetParent.clientTop || 0 : arrowOffsetParent.clientLeft || 0 : 0;
      var offsetModifierValue = (_offsetModifierState$ = offsetModifierState == null ? void 0 : offsetModifierState[mainAxis]) != null ? _offsetModifierState$ : 0;
      var tetherMin = offset + minOffset - offsetModifierValue - clientOffset;
      var tetherMax = offset + maxOffset - offsetModifierValue;
      var preventedOffset = within(tether ? min(min$1, tetherMin) : min$1, offset, tether ? max(max$1, tetherMax) : max$1);
      popperOffsets[mainAxis] = preventedOffset;
      data[mainAxis] = preventedOffset - offset;
    }

    if (checkAltAxis) {
      var _offsetModifierState$2;

      var _mainSide = mainAxis === 'x' ? top : left;

      var _altSide = mainAxis === 'x' ? bottom : right;

      var _offset = popperOffsets[altAxis];

      var _len = altAxis === 'y' ? 'height' : 'width';

      var _min = _offset + overflow[_mainSide];

      var _max = _offset - overflow[_altSide];

      var isOriginSide = [top, left].indexOf(basePlacement) !== -1;

      var _offsetModifierValue = (_offsetModifierState$2 = offsetModifierState == null ? void 0 : offsetModifierState[altAxis]) != null ? _offsetModifierState$2 : 0;

      var _tetherMin = isOriginSide ? _min : _offset - referenceRect[_len] - popperRect[_len] - _offsetModifierValue + normalizedTetherOffsetValue.altAxis;

      var _tetherMax = isOriginSide ? _offset + referenceRect[_len] + popperRect[_len] - _offsetModifierValue - normalizedTetherOffsetValue.altAxis : _max;

      var _preventedOffset = tether && isOriginSide ? withinMaxClamp(_tetherMin, _offset, _tetherMax) : within(tether ? _tetherMin : _min, _offset, tether ? _tetherMax : _max);

      popperOffsets[altAxis] = _preventedOffset;
      data[altAxis] = _preventedOffset - _offset;
    }

    state.modifiersData[name] = data;
  } // eslint-disable-next-line import/no-unused-modules


  var preventOverflow$1 = {
    name: 'preventOverflow',
    enabled: true,
    phase: 'main',
    fn: preventOverflow,
    requiresIfExists: ['offset']
  };

  var toPaddingObject = function toPaddingObject(padding, state) {
    padding = typeof padding === 'function' ? padding(Object.assign({}, state.rects, {
      placement: state.placement
    })) : padding;
    return mergePaddingObject(typeof padding !== 'number' ? padding : expandToHashMap(padding, basePlacements));
  };

  function arrow(_ref) {
    var _state$modifiersData$;

    var state = _ref.state,
        name = _ref.name,
        options = _ref.options;
    var arrowElement = state.elements.arrow;
    var popperOffsets = state.modifiersData.popperOffsets;
    var basePlacement = getBasePlacement(state.placement);
    var axis = getMainAxisFromPlacement(basePlacement);
    var isVertical = [left, right].indexOf(basePlacement) >= 0;
    var len = isVertical ? 'height' : 'width';

    if (!arrowElement || !popperOffsets) {
      return;
    }

    var paddingObject = toPaddingObject(options.padding, state);
    var arrowRect = getLayoutRect(arrowElement);
    var minProp = axis === 'y' ? top : left;
    var maxProp = axis === 'y' ? bottom : right;
    var endDiff = state.rects.reference[len] + state.rects.reference[axis] - popperOffsets[axis] - state.rects.popper[len];
    var startDiff = popperOffsets[axis] - state.rects.reference[axis];
    var arrowOffsetParent = getOffsetParent(arrowElement);
    var clientSize = arrowOffsetParent ? axis === 'y' ? arrowOffsetParent.clientHeight || 0 : arrowOffsetParent.clientWidth || 0 : 0;
    var centerToReference = endDiff / 2 - startDiff / 2; // Make sure the arrow doesn't overflow the popper if the center point is
    // outside of the popper bounds

    var min = paddingObject[minProp];
    var max = clientSize - arrowRect[len] - paddingObject[maxProp];
    var center = clientSize / 2 - arrowRect[len] / 2 + centerToReference;
    var offset = within(min, center, max); // Prevents breaking syntax highlighting...

    var axisProp = axis;
    state.modifiersData[name] = (_state$modifiersData$ = {}, _state$modifiersData$[axisProp] = offset, _state$modifiersData$.centerOffset = offset - center, _state$modifiersData$);
  }

  function effect(_ref2) {
    var state = _ref2.state,
        options = _ref2.options;
    var _options$element = options.element,
        arrowElement = _options$element === void 0 ? '[data-popper-arrow]' : _options$element;

    if (arrowElement == null) {
      return;
    } // CSS selector


    if (typeof arrowElement === 'string') {
      arrowElement = state.elements.popper.querySelector(arrowElement);

      if (!arrowElement) {
        return;
      }
    }

    if (!contains(state.elements.popper, arrowElement)) {
      return;
    }

    state.elements.arrow = arrowElement;
  } // eslint-disable-next-line import/no-unused-modules


  var arrow$1 = {
    name: 'arrow',
    enabled: true,
    phase: 'main',
    fn: arrow,
    effect: effect,
    requires: ['popperOffsets'],
    requiresIfExists: ['preventOverflow']
  };

  function getSideOffsets(overflow, rect, preventedOffsets) {
    if (preventedOffsets === void 0) {
      preventedOffsets = {
        x: 0,
        y: 0
      };
    }

    return {
      top: overflow.top - rect.height - preventedOffsets.y,
      right: overflow.right - rect.width + preventedOffsets.x,
      bottom: overflow.bottom - rect.height + preventedOffsets.y,
      left: overflow.left - rect.width - preventedOffsets.x
    };
  }

  function isAnySideFullyClipped(overflow) {
    return [top, right, bottom, left].some(function (side) {
      return overflow[side] >= 0;
    });
  }

  function hide(_ref) {
    var state = _ref.state,
        name = _ref.name;
    var referenceRect = state.rects.reference;
    var popperRect = state.rects.popper;
    var preventedOffsets = state.modifiersData.preventOverflow;
    var referenceOverflow = detectOverflow(state, {
      elementContext: 'reference'
    });
    var popperAltOverflow = detectOverflow(state, {
      altBoundary: true
    });
    var referenceClippingOffsets = getSideOffsets(referenceOverflow, referenceRect);
    var popperEscapeOffsets = getSideOffsets(popperAltOverflow, popperRect, preventedOffsets);
    var isReferenceHidden = isAnySideFullyClipped(referenceClippingOffsets);
    var hasPopperEscaped = isAnySideFullyClipped(popperEscapeOffsets);
    state.modifiersData[name] = {
      referenceClippingOffsets: referenceClippingOffsets,
      popperEscapeOffsets: popperEscapeOffsets,
      isReferenceHidden: isReferenceHidden,
      hasPopperEscaped: hasPopperEscaped
    };
    state.attributes.popper = Object.assign({}, state.attributes.popper, {
      'data-popper-reference-hidden': isReferenceHidden,
      'data-popper-escaped': hasPopperEscaped
    });
  } // eslint-disable-next-line import/no-unused-modules


  var hide$1 = {
    name: 'hide',
    enabled: true,
    phase: 'main',
    requiresIfExists: ['preventOverflow'],
    fn: hide
  };

  var defaultModifiers$1 = [eventListeners, popperOffsets$1, computeStyles$1, applyStyles$1];
  var createPopper$1 = /*#__PURE__*/popperGenerator({
    defaultModifiers: defaultModifiers$1
  }); // eslint-disable-next-line import/no-unused-modules

  var defaultModifiers = [eventListeners, popperOffsets$1, computeStyles$1, applyStyles$1, offset$1, flip$1, preventOverflow$1, arrow$1, hide$1];
  var createPopper = /*#__PURE__*/popperGenerator({
    defaultModifiers: defaultModifiers
  }); // eslint-disable-next-line import/no-unused-modules

  exports.applyStyles = applyStyles$1;
  exports.arrow = arrow$1;
  exports.computeStyles = computeStyles$1;
  exports.createPopper = createPopper;
  exports.createPopperLite = createPopper$1;
  exports.defaultModifiers = defaultModifiers;
  exports.detectOverflow = detectOverflow;
  exports.eventListeners = eventListeners;
  exports.flip = flip$1;
  exports.hide = hide$1;
  exports.offset = offset$1;
  exports.popperGenerator = popperGenerator;
  exports.popperOffsets = popperOffsets$1;
  exports.preventOverflow = preventOverflow$1;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
/*!
  * Bootstrap v5.3.3 (https://getbootstrap.com/)
  * Copyright 2011-2024 The Bootstrap Authors (https://github.com/twbs/bootstrap/graphs/contributors)
  * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
  */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('@popperjs/core')) :
  typeof define === 'function' && define.amd ? define(['@popperjs/core'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.bootstrap = factory(global.Popper));
})(this, (function (Popper) { 'use strict';

  function _interopNamespaceDefault(e) {
    const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
    if (e) {
      for (const k in e) {
        if (k !== 'default') {
          const d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    }
    n.default = e;
    return Object.freeze(n);
  }

  const Popper__namespace = /*#__PURE__*/_interopNamespaceDefault(Popper);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap dom/data.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  /**
   * Constants
   */

  const elementMap = new Map();
  const Data = {
    set(element, key, instance) {
      if (!elementMap.has(element)) {
        elementMap.set(element, new Map());
      }
      const instanceMap = elementMap.get(element);

      // make it clear we only want one instance per element
      // can be removed later when multiple key/instances are fine to be used
      if (!instanceMap.has(key) && instanceMap.size !== 0) {
        // eslint-disable-next-line no-console
        console.error(`Bootstrap doesn't allow more than one instance per element. Bound instance: ${Array.from(instanceMap.keys())[0]}.`);
        return;
      }
      instanceMap.set(key, instance);
    },
    get(element, key) {
      if (elementMap.has(element)) {
        return elementMap.get(element).get(key) || null;
      }
      return null;
    },
    remove(element, key) {
      if (!elementMap.has(element)) {
        return;
      }
      const instanceMap = elementMap.get(element);
      instanceMap.delete(key);

      // free up element references if there are no instances left for an element
      if (instanceMap.size === 0) {
        elementMap.delete(element);
      }
    }
  };

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/index.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  const MAX_UID = 1000000;
  const MILLISECONDS_MULTIPLIER = 1000;
  const TRANSITION_END = 'transitionend';

  /**
   * Properly escape IDs selectors to handle weird IDs
   * @param {string} selector
   * @returns {string}
   */
  const parseSelector = selector => {
    if (selector && window.CSS && window.CSS.escape) {
      // document.querySelector needs escaping to handle IDs (html5+) containing for instance /
      selector = selector.replace(/#([^\s"#']+)/g, (match, id) => `#${CSS.escape(id)}`);
    }
    return selector;
  };

  // Shout-out Angus Croll (https://goo.gl/pxwQGp)
  const toType = object => {
    if (object === null || object === undefined) {
      return `${object}`;
    }
    return Object.prototype.toString.call(object).match(/\s([a-z]+)/i)[1].toLowerCase();
  };

  /**
   * Public Util API
   */

  const getUID = prefix => {
    do {
      prefix += Math.floor(Math.random() * MAX_UID);
    } while (document.getElementById(prefix));
    return prefix;
  };
  const getTransitionDurationFromElement = element => {
    if (!element) {
      return 0;
    }

    // Get transition-duration of the element
    let {
      transitionDuration,
      transitionDelay
    } = window.getComputedStyle(element);
    const floatTransitionDuration = Number.parseFloat(transitionDuration);
    const floatTransitionDelay = Number.parseFloat(transitionDelay);

    // Return 0 if element or transition duration is not found
    if (!floatTransitionDuration && !floatTransitionDelay) {
      return 0;
    }

    // If multiple durations are defined, take the first
    transitionDuration = transitionDuration.split(',')[0];
    transitionDelay = transitionDelay.split(',')[0];
    return (Number.parseFloat(transitionDuration) + Number.parseFloat(transitionDelay)) * MILLISECONDS_MULTIPLIER;
  };
  const triggerTransitionEnd = element => {
    element.dispatchEvent(new Event(TRANSITION_END));
  };
  const isElement = object => {
    if (!object || typeof object !== 'object') {
      return false;
    }
    if (typeof object.jquery !== 'undefined') {
      object = object[0];
    }
    return typeof object.nodeType !== 'undefined';
  };
  const getElement = object => {
    // it's a jQuery object or a node element
    if (isElement(object)) {
      return object.jquery ? object[0] : object;
    }
    if (typeof object === 'string' && object.length > 0) {
      return document.querySelector(parseSelector(object));
    }
    return null;
  };
  const isVisible = element => {
    if (!isElement(element) || element.getClientRects().length === 0) {
      return false;
    }
    const elementIsVisible = getComputedStyle(element).getPropertyValue('visibility') === 'visible';
    // Handle `details` element as its content may falsie appear visible when it is closed
    const closedDetails = element.closest('details:not([open])');
    if (!closedDetails) {
      return elementIsVisible;
    }
    if (closedDetails !== element) {
      const summary = element.closest('summary');
      if (summary && summary.parentNode !== closedDetails) {
        return false;
      }
      if (summary === null) {
        return false;
      }
    }
    return elementIsVisible;
  };
  const isDisabled = element => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    if (element.classList.contains('disabled')) {
      return true;
    }
    if (typeof element.disabled !== 'undefined') {
      return element.disabled;
    }
    return element.hasAttribute('disabled') && element.getAttribute('disabled') !== 'false';
  };
  const findShadowRoot = element => {
    if (!document.documentElement.attachShadow) {
      return null;
    }

    // Can find the shadow root otherwise it'll return the document
    if (typeof element.getRootNode === 'function') {
      const root = element.getRootNode();
      return root instanceof ShadowRoot ? root : null;
    }
    if (element instanceof ShadowRoot) {
      return element;
    }

    // when we don't find a shadow root
    if (!element.parentNode) {
      return null;
    }
    return findShadowRoot(element.parentNode);
  };
  const noop = () => {};

  /**
   * Trick to restart an element's animation
   *
   * @param {HTMLElement} element
   * @return void
   *
   * @see https://www.charistheo.io/blog/2021/02/restart-a-css-animation-with-javascript/#restarting-a-css-animation
   */
  const reflow = element => {
    element.offsetHeight; // eslint-disable-line no-unused-expressions
  };
  const getjQuery = () => {
    if (window.jQuery && !document.body.hasAttribute('data-bs-no-jquery')) {
      return window.jQuery;
    }
    return null;
  };
  const DOMContentLoadedCallbacks = [];
  const onDOMContentLoaded = callback => {
    if (document.readyState === 'loading') {
      // add listener on the first call when the document is in loading state
      if (!DOMContentLoadedCallbacks.length) {
        document.addEventListener('DOMContentLoaded', () => {
          for (const callback of DOMContentLoadedCallbacks) {
            callback();
          }
        });
      }
      DOMContentLoadedCallbacks.push(callback);
    } else {
      callback();
    }
  };
  const isRTL = () => document.documentElement.dir === 'rtl';
  const defineJQueryPlugin = plugin => {
    onDOMContentLoaded(() => {
      const $ = getjQuery();
      /* istanbul ignore if */
      if ($) {
        const name = plugin.NAME;
        const JQUERY_NO_CONFLICT = $.fn[name];
        $.fn[name] = plugin.jQueryInterface;
        $.fn[name].Constructor = plugin;
        $.fn[name].noConflict = () => {
          $.fn[name] = JQUERY_NO_CONFLICT;
          return plugin.jQueryInterface;
        };
      }
    });
  };
  const execute = (possibleCallback, args = [], defaultValue = possibleCallback) => {
    return typeof possibleCallback === 'function' ? possibleCallback(...args) : defaultValue;
  };
  const executeAfterTransition = (callback, transitionElement, waitForTransition = true) => {
    if (!waitForTransition) {
      execute(callback);
      return;
    }
    const durationPadding = 5;
    const emulatedDuration = getTransitionDurationFromElement(transitionElement) + durationPadding;
    let called = false;
    const handler = ({
      target
    }) => {
      if (target !== transitionElement) {
        return;
      }
      called = true;
      transitionElement.removeEventListener(TRANSITION_END, handler);
      execute(callback);
    };
    transitionElement.addEventListener(TRANSITION_END, handler);
    setTimeout(() => {
      if (!called) {
        triggerTransitionEnd(transitionElement);
      }
    }, emulatedDuration);
  };

  /**
   * Return the previous/next element of a list.
   *
   * @param {array} list    The list of elements
   * @param activeElement   The active element
   * @param shouldGetNext   Choose to get next or previous element
   * @param isCycleAllowed
   * @return {Element|elem} The proper element
   */
  const getNextActiveElement = (list, activeElement, shouldGetNext, isCycleAllowed) => {
    const listLength = list.length;
    let index = list.indexOf(activeElement);

    // if the element does not exist in the list return an element
    // depending on the direction and if cycle is allowed
    if (index === -1) {
      return !shouldGetNext && isCycleAllowed ? list[listLength - 1] : list[0];
    }
    index += shouldGetNext ? 1 : -1;
    if (isCycleAllowed) {
      index = (index + listLength) % listLength;
    }
    return list[Math.max(0, Math.min(index, listLength - 1))];
  };

  /**
   * --------------------------------------------------------------------------
   * Bootstrap dom/event-handler.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const namespaceRegex = /[^.]*(?=\..*)\.|.*/;
  const stripNameRegex = /\..*/;
  const stripUidRegex = /::\d+$/;
  const eventRegistry = {}; // Events storage
  let uidEvent = 1;
  const customEvents = {
    mouseenter: 'mouseover',
    mouseleave: 'mouseout'
  };
  const nativeEvents = new Set(['click', 'dblclick', 'mouseup', 'mousedown', 'contextmenu', 'mousewheel', 'DOMMouseScroll', 'mouseover', 'mouseout', 'mousemove', 'selectstart', 'selectend', 'keydown', 'keypress', 'keyup', 'orientationchange', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'pointercancel', 'gesturestart', 'gesturechange', 'gestureend', 'focus', 'blur', 'change', 'reset', 'select', 'submit', 'focusin', 'focusout', 'load', 'unload', 'beforeunload', 'resize', 'move', 'DOMContentLoaded', 'readystatechange', 'error', 'abort', 'scroll']);

  /**
   * Private methods
   */

  function makeEventUid(element, uid) {
    return uid && `${uid}::${uidEvent++}` || element.uidEvent || uidEvent++;
  }
  function getElementEvents(element) {
    const uid = makeEventUid(element);
    element.uidEvent = uid;
    eventRegistry[uid] = eventRegistry[uid] || {};
    return eventRegistry[uid];
  }
  function bootstrapHandler(element, fn) {
    return function handler(event) {
      hydrateObj(event, {
        delegateTarget: element
      });
      if (handler.oneOff) {
        EventHandler.off(element, event.type, fn);
      }
      return fn.apply(element, [event]);
    };
  }
  function bootstrapDelegationHandler(element, selector, fn) {
    return function handler(event) {
      const domElements = element.querySelectorAll(selector);
      for (let {
        target
      } = event; target && target !== this; target = target.parentNode) {
        for (const domElement of domElements) {
          if (domElement !== target) {
            continue;
          }
          hydrateObj(event, {
            delegateTarget: target
          });
          if (handler.oneOff) {
            EventHandler.off(element, event.type, selector, fn);
          }
          return fn.apply(target, [event]);
        }
      }
    };
  }
  function findHandler(events, callable, delegationSelector = null) {
    return Object.values(events).find(event => event.callable === callable && event.delegationSelector === delegationSelector);
  }
  function normalizeParameters(originalTypeEvent, handler, delegationFunction) {
    const isDelegated = typeof handler === 'string';
    // TODO: tooltip passes `false` instead of selector, so we need to check
    const callable = isDelegated ? delegationFunction : handler || delegationFunction;
    let typeEvent = getTypeEvent(originalTypeEvent);
    if (!nativeEvents.has(typeEvent)) {
      typeEvent = originalTypeEvent;
    }
    return [isDelegated, callable, typeEvent];
  }
  function addHandler(element, originalTypeEvent, handler, delegationFunction, oneOff) {
    if (typeof originalTypeEvent !== 'string' || !element) {
      return;
    }
    let [isDelegated, callable, typeEvent] = normalizeParameters(originalTypeEvent, handler, delegationFunction);

    // in case of mouseenter or mouseleave wrap the handler within a function that checks for its DOM position
    // this prevents the handler from being dispatched the same way as mouseover or mouseout does
    if (originalTypeEvent in customEvents) {
      const wrapFunction = fn => {
        return function (event) {
          if (!event.relatedTarget || event.relatedTarget !== event.delegateTarget && !event.delegateTarget.contains(event.relatedTarget)) {
            return fn.call(this, event);
          }
        };
      };
      callable = wrapFunction(callable);
    }
    const events = getElementEvents(element);
    const handlers = events[typeEvent] || (events[typeEvent] = {});
    const previousFunction = findHandler(handlers, callable, isDelegated ? handler : null);
    if (previousFunction) {
      previousFunction.oneOff = previousFunction.oneOff && oneOff;
      return;
    }
    const uid = makeEventUid(callable, originalTypeEvent.replace(namespaceRegex, ''));
    const fn = isDelegated ? bootstrapDelegationHandler(element, handler, callable) : bootstrapHandler(element, callable);
    fn.delegationSelector = isDelegated ? handler : null;
    fn.callable = callable;
    fn.oneOff = oneOff;
    fn.uidEvent = uid;
    handlers[uid] = fn;
    element.addEventListener(typeEvent, fn, isDelegated);
  }
  function removeHandler(element, events, typeEvent, handler, delegationSelector) {
    const fn = findHandler(events[typeEvent], handler, delegationSelector);
    if (!fn) {
      return;
    }
    element.removeEventListener(typeEvent, fn, Boolean(delegationSelector));
    delete events[typeEvent][fn.uidEvent];
  }
  function removeNamespacedHandlers(element, events, typeEvent, namespace) {
    const storeElementEvent = events[typeEvent] || {};
    for (const [handlerKey, event] of Object.entries(storeElementEvent)) {
      if (handlerKey.includes(namespace)) {
        removeHandler(element, events, typeEvent, event.callable, event.delegationSelector);
      }
    }
  }
  function getTypeEvent(event) {
    // allow to get the native events from namespaced events ('click.bs.button' --> 'click')
    event = event.replace(stripNameRegex, '');
    return customEvents[event] || event;
  }
  const EventHandler = {
    on(element, event, handler, delegationFunction) {
      addHandler(element, event, handler, delegationFunction, false);
    },
    one(element, event, handler, delegationFunction) {
      addHandler(element, event, handler, delegationFunction, true);
    },
    off(element, originalTypeEvent, handler, delegationFunction) {
      if (typeof originalTypeEvent !== 'string' || !element) {
        return;
      }
      const [isDelegated, callable, typeEvent] = normalizeParameters(originalTypeEvent, handler, delegationFunction);
      const inNamespace = typeEvent !== originalTypeEvent;
      const events = getElementEvents(element);
      const storeElementEvent = events[typeEvent] || {};
      const isNamespace = originalTypeEvent.startsWith('.');
      if (typeof callable !== 'undefined') {
        // Simplest case: handler is passed, remove that listener ONLY.
        if (!Object.keys(storeElementEvent).length) {
          return;
        }
        removeHandler(element, events, typeEvent, callable, isDelegated ? handler : null);
        return;
      }
      if (isNamespace) {
        for (const elementEvent of Object.keys(events)) {
          removeNamespacedHandlers(element, events, elementEvent, originalTypeEvent.slice(1));
        }
      }
      for (const [keyHandlers, event] of Object.entries(storeElementEvent)) {
        const handlerKey = keyHandlers.replace(stripUidRegex, '');
        if (!inNamespace || originalTypeEvent.includes(handlerKey)) {
          removeHandler(element, events, typeEvent, event.callable, event.delegationSelector);
        }
      }
    },
    trigger(element, event, args) {
      if (typeof event !== 'string' || !element) {
        return null;
      }
      const $ = getjQuery();
      const typeEvent = getTypeEvent(event);
      const inNamespace = event !== typeEvent;
      let jQueryEvent = null;
      let bubbles = true;
      let nativeDispatch = true;
      let defaultPrevented = false;
      if (inNamespace && $) {
        jQueryEvent = $.Event(event, args);
        $(element).trigger(jQueryEvent);
        bubbles = !jQueryEvent.isPropagationStopped();
        nativeDispatch = !jQueryEvent.isImmediatePropagationStopped();
        defaultPrevented = jQueryEvent.isDefaultPrevented();
      }
      const evt = hydrateObj(new Event(event, {
        bubbles,
        cancelable: true
      }), args);
      if (defaultPrevented) {
        evt.preventDefault();
      }
      if (nativeDispatch) {
        element.dispatchEvent(evt);
      }
      if (evt.defaultPrevented && jQueryEvent) {
        jQueryEvent.preventDefault();
      }
      return evt;
    }
  };
  function hydrateObj(obj, meta = {}) {
    for (const [key, value] of Object.entries(meta)) {
      try {
        obj[key] = value;
      } catch (_unused) {
        Object.defineProperty(obj, key, {
          configurable: true,
          get() {
            return value;
          }
        });
      }
    }
    return obj;
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap dom/manipulator.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  function normalizeData(value) {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (value === Number(value).toString()) {
      return Number(value);
    }
    if (value === '' || value === 'null') {
      return null;
    }
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch (_unused) {
      return value;
    }
  }
  function normalizeDataKey(key) {
    return key.replace(/[A-Z]/g, chr => `-${chr.toLowerCase()}`);
  }
  const Manipulator = {
    setDataAttribute(element, key, value) {
      element.setAttribute(`data-bs-${normalizeDataKey(key)}`, value);
    },
    removeDataAttribute(element, key) {
      element.removeAttribute(`data-bs-${normalizeDataKey(key)}`);
    },
    getDataAttributes(element) {
      if (!element) {
        return {};
      }
      const attributes = {};
      const bsKeys = Object.keys(element.dataset).filter(key => key.startsWith('bs') && !key.startsWith('bsConfig'));
      for (const key of bsKeys) {
        let pureKey = key.replace(/^bs/, '');
        pureKey = pureKey.charAt(0).toLowerCase() + pureKey.slice(1, pureKey.length);
        attributes[pureKey] = normalizeData(element.dataset[key]);
      }
      return attributes;
    },
    getDataAttribute(element, key) {
      return normalizeData(element.getAttribute(`data-bs-${normalizeDataKey(key)}`));
    }
  };

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/config.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Class definition
   */

  class Config {
    // Getters
    static get Default() {
      return {};
    }
    static get DefaultType() {
      return {};
    }
    static get NAME() {
      throw new Error('You have to implement the static method "NAME", for each component!');
    }
    _getConfig(config) {
      config = this._mergeConfigObj(config);
      config = this._configAfterMerge(config);
      this._typeCheckConfig(config);
      return config;
    }
    _configAfterMerge(config) {
      return config;
    }
    _mergeConfigObj(config, element) {
      const jsonConfig = isElement(element) ? Manipulator.getDataAttribute(element, 'config') : {}; // try to parse

      return {
        ...this.constructor.Default,
        ...(typeof jsonConfig === 'object' ? jsonConfig : {}),
        ...(isElement(element) ? Manipulator.getDataAttributes(element) : {}),
        ...(typeof config === 'object' ? config : {})
      };
    }
    _typeCheckConfig(config, configTypes = this.constructor.DefaultType) {
      for (const [property, expectedTypes] of Object.entries(configTypes)) {
        const value = config[property];
        const valueType = isElement(value) ? 'element' : toType(value);
        if (!new RegExp(expectedTypes).test(valueType)) {
          throw new TypeError(`${this.constructor.NAME.toUpperCase()}: Option "${property}" provided type "${valueType}" but expected type "${expectedTypes}".`);
        }
      }
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap base-component.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const VERSION = '5.3.3';

  /**
   * Class definition
   */

  class BaseComponent extends Config {
    constructor(element, config) {
      super();
      element = getElement(element);
      if (!element) {
        return;
      }
      this._element = element;
      this._config = this._getConfig(config);
      Data.set(this._element, this.constructor.DATA_KEY, this);
    }

    // Public
    dispose() {
      Data.remove(this._element, this.constructor.DATA_KEY);
      EventHandler.off(this._element, this.constructor.EVENT_KEY);
      for (const propertyName of Object.getOwnPropertyNames(this)) {
        this[propertyName] = null;
      }
    }
    _queueCallback(callback, element, isAnimated = true) {
      executeAfterTransition(callback, element, isAnimated);
    }
    _getConfig(config) {
      config = this._mergeConfigObj(config, this._element);
      config = this._configAfterMerge(config);
      this._typeCheckConfig(config);
      return config;
    }

    // Static
    static getInstance(element) {
      return Data.get(getElement(element), this.DATA_KEY);
    }
    static getOrCreateInstance(element, config = {}) {
      return this.getInstance(element) || new this(element, typeof config === 'object' ? config : null);
    }
    static get VERSION() {
      return VERSION;
    }
    static get DATA_KEY() {
      return `bs.${this.NAME}`;
    }
    static get EVENT_KEY() {
      return `.${this.DATA_KEY}`;
    }
    static eventName(name) {
      return `${name}${this.EVENT_KEY}`;
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap dom/selector-engine.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  const getSelector = element => {
    let selector = element.getAttribute('data-bs-target');
    if (!selector || selector === '#') {
      let hrefAttribute = element.getAttribute('href');

      // The only valid content that could double as a selector are IDs or classes,
      // so everything starting with `#` or `.`. If a "real" URL is used as the selector,
      // `document.querySelector` will rightfully complain it is invalid.
      // See https://github.com/twbs/bootstrap/issues/32273
      if (!hrefAttribute || !hrefAttribute.includes('#') && !hrefAttribute.startsWith('.')) {
        return null;
      }

      // Just in case some CMS puts out a full URL with the anchor appended
      if (hrefAttribute.includes('#') && !hrefAttribute.startsWith('#')) {
        hrefAttribute = `#${hrefAttribute.split('#')[1]}`;
      }
      selector = hrefAttribute && hrefAttribute !== '#' ? hrefAttribute.trim() : null;
    }
    return selector ? selector.split(',').map(sel => parseSelector(sel)).join(',') : null;
  };
  const SelectorEngine = {
    find(selector, element = document.documentElement) {
      return [].concat(...Element.prototype.querySelectorAll.call(element, selector));
    },
    findOne(selector, element = document.documentElement) {
      return Element.prototype.querySelector.call(element, selector);
    },
    children(element, selector) {
      return [].concat(...element.children).filter(child => child.matches(selector));
    },
    parents(element, selector) {
      const parents = [];
      let ancestor = element.parentNode.closest(selector);
      while (ancestor) {
        parents.push(ancestor);
        ancestor = ancestor.parentNode.closest(selector);
      }
      return parents;
    },
    prev(element, selector) {
      let previous = element.previousElementSibling;
      while (previous) {
        if (previous.matches(selector)) {
          return [previous];
        }
        previous = previous.previousElementSibling;
      }
      return [];
    },
    // TODO: this is now unused; remove later along with prev()
    next(element, selector) {
      let next = element.nextElementSibling;
      while (next) {
        if (next.matches(selector)) {
          return [next];
        }
        next = next.nextElementSibling;
      }
      return [];
    },
    focusableChildren(element) {
      const focusables = ['a', 'button', 'input', 'textarea', 'select', 'details', '[tabindex]', '[contenteditable="true"]'].map(selector => `${selector}:not([tabindex^="-"])`).join(',');
      return this.find(focusables, element).filter(el => !isDisabled(el) && isVisible(el));
    },
    getSelectorFromElement(element) {
      const selector = getSelector(element);
      if (selector) {
        return SelectorEngine.findOne(selector) ? selector : null;
      }
      return null;
    },
    getElementFromSelector(element) {
      const selector = getSelector(element);
      return selector ? SelectorEngine.findOne(selector) : null;
    },
    getMultipleElementsFromSelector(element) {
      const selector = getSelector(element);
      return selector ? SelectorEngine.find(selector) : [];
    }
  };

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/component-functions.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  const enableDismissTrigger = (component, method = 'hide') => {
    const clickEvent = `click.dismiss${component.EVENT_KEY}`;
    const name = component.NAME;
    EventHandler.on(document, clickEvent, `[data-bs-dismiss="${name}"]`, function (event) {
      if (['A', 'AREA'].includes(this.tagName)) {
        event.preventDefault();
      }
      if (isDisabled(this)) {
        return;
      }
      const target = SelectorEngine.getElementFromSelector(this) || this.closest(`.${name}`);
      const instance = component.getOrCreateInstance(target);

      // Method argument is left, for Alert and only, as it doesn't implement the 'hide' method
      instance[method]();
    });
  };

  /**
   * --------------------------------------------------------------------------
   * Bootstrap alert.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$f = 'alert';
  const DATA_KEY$a = 'bs.alert';
  const EVENT_KEY$b = `.${DATA_KEY$a}`;
  const EVENT_CLOSE = `close${EVENT_KEY$b}`;
  const EVENT_CLOSED = `closed${EVENT_KEY$b}`;
  const CLASS_NAME_FADE$5 = 'fade';
  const CLASS_NAME_SHOW$8 = 'show';

  /**
   * Class definition
   */

  class Alert extends BaseComponent {
    // Getters
    static get NAME() {
      return NAME$f;
    }

    // Public
    close() {
      const closeEvent = EventHandler.trigger(this._element, EVENT_CLOSE);
      if (closeEvent.defaultPrevented) {
        return;
      }
      this._element.classList.remove(CLASS_NAME_SHOW$8);
      const isAnimated = this._element.classList.contains(CLASS_NAME_FADE$5);
      this._queueCallback(() => this._destroyElement(), this._element, isAnimated);
    }

    // Private
    _destroyElement() {
      this._element.remove();
      EventHandler.trigger(this._element, EVENT_CLOSED);
      this.dispose();
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Alert.getOrCreateInstance(this);
        if (typeof config !== 'string') {
          return;
        }
        if (data[config] === undefined || config.startsWith('_') || config === 'constructor') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config](this);
      });
    }
  }

  /**
   * Data API implementation
   */

  enableDismissTrigger(Alert, 'close');

  /**
   * jQuery
   */

  defineJQueryPlugin(Alert);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap button.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$e = 'button';
  const DATA_KEY$9 = 'bs.button';
  const EVENT_KEY$a = `.${DATA_KEY$9}`;
  const DATA_API_KEY$6 = '.data-api';
  const CLASS_NAME_ACTIVE$3 = 'active';
  const SELECTOR_DATA_TOGGLE$5 = '[data-bs-toggle="button"]';
  const EVENT_CLICK_DATA_API$6 = `click${EVENT_KEY$a}${DATA_API_KEY$6}`;

  /**
   * Class definition
   */

  class Button extends BaseComponent {
    // Getters
    static get NAME() {
      return NAME$e;
    }

    // Public
    toggle() {
      // Toggle class and sync the `aria-pressed` attribute with the return value of the `.toggle()` method
      this._element.setAttribute('aria-pressed', this._element.classList.toggle(CLASS_NAME_ACTIVE$3));
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Button.getOrCreateInstance(this);
        if (config === 'toggle') {
          data[config]();
        }
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API$6, SELECTOR_DATA_TOGGLE$5, event => {
    event.preventDefault();
    const button = event.target.closest(SELECTOR_DATA_TOGGLE$5);
    const data = Button.getOrCreateInstance(button);
    data.toggle();
  });

  /**
   * jQuery
   */

  defineJQueryPlugin(Button);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/swipe.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$d = 'swipe';
  const EVENT_KEY$9 = '.bs.swipe';
  const EVENT_TOUCHSTART = `touchstart${EVENT_KEY$9}`;
  const EVENT_TOUCHMOVE = `touchmove${EVENT_KEY$9}`;
  const EVENT_TOUCHEND = `touchend${EVENT_KEY$9}`;
  const EVENT_POINTERDOWN = `pointerdown${EVENT_KEY$9}`;
  const EVENT_POINTERUP = `pointerup${EVENT_KEY$9}`;
  const POINTER_TYPE_TOUCH = 'touch';
  const POINTER_TYPE_PEN = 'pen';
  const CLASS_NAME_POINTER_EVENT = 'pointer-event';
  const SWIPE_THRESHOLD = 40;
  const Default$c = {
    endCallback: null,
    leftCallback: null,
    rightCallback: null
  };
  const DefaultType$c = {
    endCallback: '(function|null)',
    leftCallback: '(function|null)',
    rightCallback: '(function|null)'
  };

  /**
   * Class definition
   */

  class Swipe extends Config {
    constructor(element, config) {
      super();
      this._element = element;
      if (!element || !Swipe.isSupported()) {
        return;
      }
      this._config = this._getConfig(config);
      this._deltaX = 0;
      this._supportPointerEvents = Boolean(window.PointerEvent);
      this._initEvents();
    }

    // Getters
    static get Default() {
      return Default$c;
    }
    static get DefaultType() {
      return DefaultType$c;
    }
    static get NAME() {
      return NAME$d;
    }

    // Public
    dispose() {
      EventHandler.off(this._element, EVENT_KEY$9);
    }

    // Private
    _start(event) {
      if (!this._supportPointerEvents) {
        this._deltaX = event.touches[0].clientX;
        return;
      }
      if (this._eventIsPointerPenTouch(event)) {
        this._deltaX = event.clientX;
      }
    }
    _end(event) {
      if (this._eventIsPointerPenTouch(event)) {
        this._deltaX = event.clientX - this._deltaX;
      }
      this._handleSwipe();
      execute(this._config.endCallback);
    }
    _move(event) {
      this._deltaX = event.touches && event.touches.length > 1 ? 0 : event.touches[0].clientX - this._deltaX;
    }
    _handleSwipe() {
      const absDeltaX = Math.abs(this._deltaX);
      if (absDeltaX <= SWIPE_THRESHOLD) {
        return;
      }
      const direction = absDeltaX / this._deltaX;
      this._deltaX = 0;
      if (!direction) {
        return;
      }
      execute(direction > 0 ? this._config.rightCallback : this._config.leftCallback);
    }
    _initEvents() {
      if (this._supportPointerEvents) {
        EventHandler.on(this._element, EVENT_POINTERDOWN, event => this._start(event));
        EventHandler.on(this._element, EVENT_POINTERUP, event => this._end(event));
        this._element.classList.add(CLASS_NAME_POINTER_EVENT);
      } else {
        EventHandler.on(this._element, EVENT_TOUCHSTART, event => this._start(event));
        EventHandler.on(this._element, EVENT_TOUCHMOVE, event => this._move(event));
        EventHandler.on(this._element, EVENT_TOUCHEND, event => this._end(event));
      }
    }
    _eventIsPointerPenTouch(event) {
      return this._supportPointerEvents && (event.pointerType === POINTER_TYPE_PEN || event.pointerType === POINTER_TYPE_TOUCH);
    }

    // Static
    static isSupported() {
      return 'ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0;
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap carousel.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$c = 'carousel';
  const DATA_KEY$8 = 'bs.carousel';
  const EVENT_KEY$8 = `.${DATA_KEY$8}`;
  const DATA_API_KEY$5 = '.data-api';
  const ARROW_LEFT_KEY$1 = 'ArrowLeft';
  const ARROW_RIGHT_KEY$1 = 'ArrowRight';
  const TOUCHEVENT_COMPAT_WAIT = 500; // Time for mouse compat events to fire after touch

  const ORDER_NEXT = 'next';
  const ORDER_PREV = 'prev';
  const DIRECTION_LEFT = 'left';
  const DIRECTION_RIGHT = 'right';
  const EVENT_SLIDE = `slide${EVENT_KEY$8}`;
  const EVENT_SLID = `slid${EVENT_KEY$8}`;
  const EVENT_KEYDOWN$1 = `keydown${EVENT_KEY$8}`;
  const EVENT_MOUSEENTER$1 = `mouseenter${EVENT_KEY$8}`;
  const EVENT_MOUSELEAVE$1 = `mouseleave${EVENT_KEY$8}`;
  const EVENT_DRAG_START = `dragstart${EVENT_KEY$8}`;
  const EVENT_LOAD_DATA_API$3 = `load${EVENT_KEY$8}${DATA_API_KEY$5}`;
  const EVENT_CLICK_DATA_API$5 = `click${EVENT_KEY$8}${DATA_API_KEY$5}`;
  const CLASS_NAME_CAROUSEL = 'carousel';
  const CLASS_NAME_ACTIVE$2 = 'active';
  const CLASS_NAME_SLIDE = 'slide';
  const CLASS_NAME_END = 'carousel-item-end';
  const CLASS_NAME_START = 'carousel-item-start';
  const CLASS_NAME_NEXT = 'carousel-item-next';
  const CLASS_NAME_PREV = 'carousel-item-prev';
  const SELECTOR_ACTIVE = '.active';
  const SELECTOR_ITEM = '.carousel-item';
  const SELECTOR_ACTIVE_ITEM = SELECTOR_ACTIVE + SELECTOR_ITEM;
  const SELECTOR_ITEM_IMG = '.carousel-item img';
  const SELECTOR_INDICATORS = '.carousel-indicators';
  const SELECTOR_DATA_SLIDE = '[data-bs-slide], [data-bs-slide-to]';
  const SELECTOR_DATA_RIDE = '[data-bs-ride="carousel"]';
  const KEY_TO_DIRECTION = {
    [ARROW_LEFT_KEY$1]: DIRECTION_RIGHT,
    [ARROW_RIGHT_KEY$1]: DIRECTION_LEFT
  };
  const Default$b = {
    interval: 5000,
    keyboard: true,
    pause: 'hover',
    ride: false,
    touch: true,
    wrap: true
  };
  const DefaultType$b = {
    interval: '(number|boolean)',
    // TODO:v6 remove boolean support
    keyboard: 'boolean',
    pause: '(string|boolean)',
    ride: '(boolean|string)',
    touch: 'boolean',
    wrap: 'boolean'
  };

  /**
   * Class definition
   */

  class Carousel extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._interval = null;
      this._activeElement = null;
      this._isSliding = false;
      this.touchTimeout = null;
      this._swipeHelper = null;
      this._indicatorsElement = SelectorEngine.findOne(SELECTOR_INDICATORS, this._element);
      this._addEventListeners();
      if (this._config.ride === CLASS_NAME_CAROUSEL) {
        this.cycle();
      }
    }

    // Getters
    static get Default() {
      return Default$b;
    }
    static get DefaultType() {
      return DefaultType$b;
    }
    static get NAME() {
      return NAME$c;
    }

    // Public
    next() {
      this._slide(ORDER_NEXT);
    }
    nextWhenVisible() {
      // FIXME TODO use `document.visibilityState`
      // Don't call next when the page isn't visible
      // or the carousel or its parent isn't visible
      if (!document.hidden && isVisible(this._element)) {
        this.next();
      }
    }
    prev() {
      this._slide(ORDER_PREV);
    }
    pause() {
      if (this._isSliding) {
        triggerTransitionEnd(this._element);
      }
      this._clearInterval();
    }
    cycle() {
      this._clearInterval();
      this._updateInterval();
      this._interval = setInterval(() => this.nextWhenVisible(), this._config.interval);
    }
    _maybeEnableCycle() {
      if (!this._config.ride) {
        return;
      }
      if (this._isSliding) {
        EventHandler.one(this._element, EVENT_SLID, () => this.cycle());
        return;
      }
      this.cycle();
    }
    to(index) {
      const items = this._getItems();
      if (index > items.length - 1 || index < 0) {
        return;
      }
      if (this._isSliding) {
        EventHandler.one(this._element, EVENT_SLID, () => this.to(index));
        return;
      }
      const activeIndex = this._getItemIndex(this._getActive());
      if (activeIndex === index) {
        return;
      }
      const order = index > activeIndex ? ORDER_NEXT : ORDER_PREV;
      this._slide(order, items[index]);
    }
    dispose() {
      if (this._swipeHelper) {
        this._swipeHelper.dispose();
      }
      super.dispose();
    }

    // Private
    _configAfterMerge(config) {
      config.defaultInterval = config.interval;
      return config;
    }
    _addEventListeners() {
      if (this._config.keyboard) {
        EventHandler.on(this._element, EVENT_KEYDOWN$1, event => this._keydown(event));
      }
      if (this._config.pause === 'hover') {
        EventHandler.on(this._element, EVENT_MOUSEENTER$1, () => this.pause());
        EventHandler.on(this._element, EVENT_MOUSELEAVE$1, () => this._maybeEnableCycle());
      }
      if (this._config.touch && Swipe.isSupported()) {
        this._addTouchEventListeners();
      }
    }
    _addTouchEventListeners() {
      for (const img of SelectorEngine.find(SELECTOR_ITEM_IMG, this._element)) {
        EventHandler.on(img, EVENT_DRAG_START, event => event.preventDefault());
      }
      const endCallBack = () => {
        if (this._config.pause !== 'hover') {
          return;
        }

        // If it's a touch-enabled device, mouseenter/leave are fired as
        // part of the mouse compatibility events on first tap - the carousel
        // would stop cycling until user tapped out of it;
        // here, we listen for touchend, explicitly pause the carousel
        // (as if it's the second time we tap on it, mouseenter compat event
        // is NOT fired) and after a timeout (to allow for mouse compatibility
        // events to fire) we explicitly restart cycling

        this.pause();
        if (this.touchTimeout) {
          clearTimeout(this.touchTimeout);
        }
        this.touchTimeout = setTimeout(() => this._maybeEnableCycle(), TOUCHEVENT_COMPAT_WAIT + this._config.interval);
      };
      const swipeConfig = {
        leftCallback: () => this._slide(this._directionToOrder(DIRECTION_LEFT)),
        rightCallback: () => this._slide(this._directionToOrder(DIRECTION_RIGHT)),
        endCallback: endCallBack
      };
      this._swipeHelper = new Swipe(this._element, swipeConfig);
    }
    _keydown(event) {
      if (/input|textarea/i.test(event.target.tagName)) {
        return;
      }
      const direction = KEY_TO_DIRECTION[event.key];
      if (direction) {
        event.preventDefault();
        this._slide(this._directionToOrder(direction));
      }
    }
    _getItemIndex(element) {
      return this._getItems().indexOf(element);
    }
    _setActiveIndicatorElement(index) {
      if (!this._indicatorsElement) {
        return;
      }
      const activeIndicator = SelectorEngine.findOne(SELECTOR_ACTIVE, this._indicatorsElement);
      activeIndicator.classList.remove(CLASS_NAME_ACTIVE$2);
      activeIndicator.removeAttribute('aria-current');
      const newActiveIndicator = SelectorEngine.findOne(`[data-bs-slide-to="${index}"]`, this._indicatorsElement);
      if (newActiveIndicator) {
        newActiveIndicator.classList.add(CLASS_NAME_ACTIVE$2);
        newActiveIndicator.setAttribute('aria-current', 'true');
      }
    }
    _updateInterval() {
      const element = this._activeElement || this._getActive();
      if (!element) {
        return;
      }
      const elementInterval = Number.parseInt(element.getAttribute('data-bs-interval'), 10);
      this._config.interval = elementInterval || this._config.defaultInterval;
    }
    _slide(order, element = null) {
      if (this._isSliding) {
        return;
      }
      const activeElement = this._getActive();
      const isNext = order === ORDER_NEXT;
      const nextElement = element || getNextActiveElement(this._getItems(), activeElement, isNext, this._config.wrap);
      if (nextElement === activeElement) {
        return;
      }
      const nextElementIndex = this._getItemIndex(nextElement);
      const triggerEvent = eventName => {
        return EventHandler.trigger(this._element, eventName, {
          relatedTarget: nextElement,
          direction: this._orderToDirection(order),
          from: this._getItemIndex(activeElement),
          to: nextElementIndex
        });
      };
      const slideEvent = triggerEvent(EVENT_SLIDE);
      if (slideEvent.defaultPrevented) {
        return;
      }
      if (!activeElement || !nextElement) {
        // Some weirdness is happening, so we bail
        // TODO: change tests that use empty divs to avoid this check
        return;
      }
      const isCycling = Boolean(this._interval);
      this.pause();
      this._isSliding = true;
      this._setActiveIndicatorElement(nextElementIndex);
      this._activeElement = nextElement;
      const directionalClassName = isNext ? CLASS_NAME_START : CLASS_NAME_END;
      const orderClassName = isNext ? CLASS_NAME_NEXT : CLASS_NAME_PREV;
      nextElement.classList.add(orderClassName);
      reflow(nextElement);
      activeElement.classList.add(directionalClassName);
      nextElement.classList.add(directionalClassName);
      const completeCallBack = () => {
        nextElement.classList.remove(directionalClassName, orderClassName);
        nextElement.classList.add(CLASS_NAME_ACTIVE$2);
        activeElement.classList.remove(CLASS_NAME_ACTIVE$2, orderClassName, directionalClassName);
        this._isSliding = false;
        triggerEvent(EVENT_SLID);
      };
      this._queueCallback(completeCallBack, activeElement, this._isAnimated());
      if (isCycling) {
        this.cycle();
      }
    }
    _isAnimated() {
      return this._element.classList.contains(CLASS_NAME_SLIDE);
    }
    _getActive() {
      return SelectorEngine.findOne(SELECTOR_ACTIVE_ITEM, this._element);
    }
    _getItems() {
      return SelectorEngine.find(SELECTOR_ITEM, this._element);
    }
    _clearInterval() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    }
    _directionToOrder(direction) {
      if (isRTL()) {
        return direction === DIRECTION_LEFT ? ORDER_PREV : ORDER_NEXT;
      }
      return direction === DIRECTION_LEFT ? ORDER_NEXT : ORDER_PREV;
    }
    _orderToDirection(order) {
      if (isRTL()) {
        return order === ORDER_PREV ? DIRECTION_LEFT : DIRECTION_RIGHT;
      }
      return order === ORDER_PREV ? DIRECTION_RIGHT : DIRECTION_LEFT;
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Carousel.getOrCreateInstance(this, config);
        if (typeof config === 'number') {
          data.to(config);
          return;
        }
        if (typeof config === 'string') {
          if (data[config] === undefined || config.startsWith('_') || config === 'constructor') {
            throw new TypeError(`No method named "${config}"`);
          }
          data[config]();
        }
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API$5, SELECTOR_DATA_SLIDE, function (event) {
    const target = SelectorEngine.getElementFromSelector(this);
    if (!target || !target.classList.contains(CLASS_NAME_CAROUSEL)) {
      return;
    }
    event.preventDefault();
    const carousel = Carousel.getOrCreateInstance(target);
    const slideIndex = this.getAttribute('data-bs-slide-to');
    if (slideIndex) {
      carousel.to(slideIndex);
      carousel._maybeEnableCycle();
      return;
    }
    if (Manipulator.getDataAttribute(this, 'slide') === 'next') {
      carousel.next();
      carousel._maybeEnableCycle();
      return;
    }
    carousel.prev();
    carousel._maybeEnableCycle();
  });
  EventHandler.on(window, EVENT_LOAD_DATA_API$3, () => {
    const carousels = SelectorEngine.find(SELECTOR_DATA_RIDE);
    for (const carousel of carousels) {
      Carousel.getOrCreateInstance(carousel);
    }
  });

  /**
   * jQuery
   */

  defineJQueryPlugin(Carousel);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap collapse.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$b = 'collapse';
  const DATA_KEY$7 = 'bs.collapse';
  const EVENT_KEY$7 = `.${DATA_KEY$7}`;
  const DATA_API_KEY$4 = '.data-api';
  const EVENT_SHOW$6 = `show${EVENT_KEY$7}`;
  const EVENT_SHOWN$6 = `shown${EVENT_KEY$7}`;
  const EVENT_HIDE$6 = `hide${EVENT_KEY$7}`;
  const EVENT_HIDDEN$6 = `hidden${EVENT_KEY$7}`;
  const EVENT_CLICK_DATA_API$4 = `click${EVENT_KEY$7}${DATA_API_KEY$4}`;
  const CLASS_NAME_SHOW$7 = 'show';
  const CLASS_NAME_COLLAPSE = 'collapse';
  const CLASS_NAME_COLLAPSING = 'collapsing';
  const CLASS_NAME_COLLAPSED = 'collapsed';
  const CLASS_NAME_DEEPER_CHILDREN = `:scope .${CLASS_NAME_COLLAPSE} .${CLASS_NAME_COLLAPSE}`;
  const CLASS_NAME_HORIZONTAL = 'collapse-horizontal';
  const WIDTH = 'width';
  const HEIGHT = 'height';
  const SELECTOR_ACTIVES = '.collapse.show, .collapse.collapsing';
  const SELECTOR_DATA_TOGGLE$4 = '[data-bs-toggle="collapse"]';
  const Default$a = {
    parent: null,
    toggle: true
  };
  const DefaultType$a = {
    parent: '(null|element)',
    toggle: 'boolean'
  };

  /**
   * Class definition
   */

  class Collapse extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._isTransitioning = false;
      this._triggerArray = [];
      const toggleList = SelectorEngine.find(SELECTOR_DATA_TOGGLE$4);
      for (const elem of toggleList) {
        const selector = SelectorEngine.getSelectorFromElement(elem);
        const filterElement = SelectorEngine.find(selector).filter(foundElement => foundElement === this._element);
        if (selector !== null && filterElement.length) {
          this._triggerArray.push(elem);
        }
      }
      this._initializeChildren();
      if (!this._config.parent) {
        this._addAriaAndCollapsedClass(this._triggerArray, this._isShown());
      }
      if (this._config.toggle) {
        this.toggle();
      }
    }

    // Getters
    static get Default() {
      return Default$a;
    }
    static get DefaultType() {
      return DefaultType$a;
    }
    static get NAME() {
      return NAME$b;
    }

    // Public
    toggle() {
      if (this._isShown()) {
        this.hide();
      } else {
        this.show();
      }
    }
    show() {
      if (this._isTransitioning || this._isShown()) {
        return;
      }
      let activeChildren = [];

      // find active children
      if (this._config.parent) {
        activeChildren = this._getFirstLevelChildren(SELECTOR_ACTIVES).filter(element => element !== this._element).map(element => Collapse.getOrCreateInstance(element, {
          toggle: false
        }));
      }
      if (activeChildren.length && activeChildren[0]._isTransitioning) {
        return;
      }
      const startEvent = EventHandler.trigger(this._element, EVENT_SHOW$6);
      if (startEvent.defaultPrevented) {
        return;
      }
      for (const activeInstance of activeChildren) {
        activeInstance.hide();
      }
      const dimension = this._getDimension();
      this._element.classList.remove(CLASS_NAME_COLLAPSE);
      this._element.classList.add(CLASS_NAME_COLLAPSING);
      this._element.style[dimension] = 0;
      this._addAriaAndCollapsedClass(this._triggerArray, true);
      this._isTransitioning = true;
      const complete = () => {
        this._isTransitioning = false;
        this._element.classList.remove(CLASS_NAME_COLLAPSING);
        this._element.classList.add(CLASS_NAME_COLLAPSE, CLASS_NAME_SHOW$7);
        this._element.style[dimension] = '';
        EventHandler.trigger(this._element, EVENT_SHOWN$6);
      };
      const capitalizedDimension = dimension[0].toUpperCase() + dimension.slice(1);
      const scrollSize = `scroll${capitalizedDimension}`;
      this._queueCallback(complete, this._element, true);
      this._element.style[dimension] = `${this._element[scrollSize]}px`;
    }
    hide() {
      if (this._isTransitioning || !this._isShown()) {
        return;
      }
      const startEvent = EventHandler.trigger(this._element, EVENT_HIDE$6);
      if (startEvent.defaultPrevented) {
        return;
      }
      const dimension = this._getDimension();
      this._element.style[dimension] = `${this._element.getBoundingClientRect()[dimension]}px`;
      reflow(this._element);
      this._element.classList.add(CLASS_NAME_COLLAPSING);
      this._element.classList.remove(CLASS_NAME_COLLAPSE, CLASS_NAME_SHOW$7);
      for (const trigger of this._triggerArray) {
        const element = SelectorEngine.getElementFromSelector(trigger);
        if (element && !this._isShown(element)) {
          this._addAriaAndCollapsedClass([trigger], false);
        }
      }
      this._isTransitioning = true;
      const complete = () => {
        this._isTransitioning = false;
        this._element.classList.remove(CLASS_NAME_COLLAPSING);
        this._element.classList.add(CLASS_NAME_COLLAPSE);
        EventHandler.trigger(this._element, EVENT_HIDDEN$6);
      };
      this._element.style[dimension] = '';
      this._queueCallback(complete, this._element, true);
    }
    _isShown(element = this._element) {
      return element.classList.contains(CLASS_NAME_SHOW$7);
    }

    // Private
    _configAfterMerge(config) {
      config.toggle = Boolean(config.toggle); // Coerce string values
      config.parent = getElement(config.parent);
      return config;
    }
    _getDimension() {
      return this._element.classList.contains(CLASS_NAME_HORIZONTAL) ? WIDTH : HEIGHT;
    }
    _initializeChildren() {
      if (!this._config.parent) {
        return;
      }
      const children = this._getFirstLevelChildren(SELECTOR_DATA_TOGGLE$4);
      for (const element of children) {
        const selected = SelectorEngine.getElementFromSelector(element);
        if (selected) {
          this._addAriaAndCollapsedClass([element], this._isShown(selected));
        }
      }
    }
    _getFirstLevelChildren(selector) {
      const children = SelectorEngine.find(CLASS_NAME_DEEPER_CHILDREN, this._config.parent);
      // remove children if greater depth
      return SelectorEngine.find(selector, this._config.parent).filter(element => !children.includes(element));
    }
    _addAriaAndCollapsedClass(triggerArray, isOpen) {
      if (!triggerArray.length) {
        return;
      }
      for (const element of triggerArray) {
        element.classList.toggle(CLASS_NAME_COLLAPSED, !isOpen);
        element.setAttribute('aria-expanded', isOpen);
      }
    }

    // Static
    static jQueryInterface(config) {
      const _config = {};
      if (typeof config === 'string' && /show|hide/.test(config)) {
        _config.toggle = false;
      }
      return this.each(function () {
        const data = Collapse.getOrCreateInstance(this, _config);
        if (typeof config === 'string') {
          if (typeof data[config] === 'undefined') {
            throw new TypeError(`No method named "${config}"`);
          }
          data[config]();
        }
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API$4, SELECTOR_DATA_TOGGLE$4, function (event) {
    // preventDefault only for <a> elements (which change the URL) not inside the collapsible element
    if (event.target.tagName === 'A' || event.delegateTarget && event.delegateTarget.tagName === 'A') {
      event.preventDefault();
    }
    for (const element of SelectorEngine.getMultipleElementsFromSelector(this)) {
      Collapse.getOrCreateInstance(element, {
        toggle: false
      }).toggle();
    }
  });

  /**
   * jQuery
   */

  defineJQueryPlugin(Collapse);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap dropdown.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$a = 'dropdown';
  const DATA_KEY$6 = 'bs.dropdown';
  const EVENT_KEY$6 = `.${DATA_KEY$6}`;
  const DATA_API_KEY$3 = '.data-api';
  const ESCAPE_KEY$2 = 'Escape';
  const TAB_KEY$1 = 'Tab';
  const ARROW_UP_KEY$1 = 'ArrowUp';
  const ARROW_DOWN_KEY$1 = 'ArrowDown';
  const RIGHT_MOUSE_BUTTON = 2; // MouseEvent.button value for the secondary button, usually the right button

  const EVENT_HIDE$5 = `hide${EVENT_KEY$6}`;
  const EVENT_HIDDEN$5 = `hidden${EVENT_KEY$6}`;
  const EVENT_SHOW$5 = `show${EVENT_KEY$6}`;
  const EVENT_SHOWN$5 = `shown${EVENT_KEY$6}`;
  const EVENT_CLICK_DATA_API$3 = `click${EVENT_KEY$6}${DATA_API_KEY$3}`;
  const EVENT_KEYDOWN_DATA_API = `keydown${EVENT_KEY$6}${DATA_API_KEY$3}`;
  const EVENT_KEYUP_DATA_API = `keyup${EVENT_KEY$6}${DATA_API_KEY$3}`;
  const CLASS_NAME_SHOW$6 = 'show';
  const CLASS_NAME_DROPUP = 'dropup';
  const CLASS_NAME_DROPEND = 'dropend';
  const CLASS_NAME_DROPSTART = 'dropstart';
  const CLASS_NAME_DROPUP_CENTER = 'dropup-center';
  const CLASS_NAME_DROPDOWN_CENTER = 'dropdown-center';
  const SELECTOR_DATA_TOGGLE$3 = '[data-bs-toggle="dropdown"]:not(.disabled):not(:disabled)';
  const SELECTOR_DATA_TOGGLE_SHOWN = `${SELECTOR_DATA_TOGGLE$3}.${CLASS_NAME_SHOW$6}`;
  const SELECTOR_MENU = '.dropdown-menu';
  const SELECTOR_NAVBAR = '.navbar';
  const SELECTOR_NAVBAR_NAV = '.navbar-nav';
  const SELECTOR_VISIBLE_ITEMS = '.dropdown-menu .dropdown-item:not(.disabled):not(:disabled)';
  const PLACEMENT_TOP = isRTL() ? 'top-end' : 'top-start';
  const PLACEMENT_TOPEND = isRTL() ? 'top-start' : 'top-end';
  const PLACEMENT_BOTTOM = isRTL() ? 'bottom-end' : 'bottom-start';
  const PLACEMENT_BOTTOMEND = isRTL() ? 'bottom-start' : 'bottom-end';
  const PLACEMENT_RIGHT = isRTL() ? 'left-start' : 'right-start';
  const PLACEMENT_LEFT = isRTL() ? 'right-start' : 'left-start';
  const PLACEMENT_TOPCENTER = 'top';
  const PLACEMENT_BOTTOMCENTER = 'bottom';
  const Default$9 = {
    autoClose: true,
    boundary: 'clippingParents',
    display: 'dynamic',
    offset: [0, 2],
    popperConfig: null,
    reference: 'toggle'
  };
  const DefaultType$9 = {
    autoClose: '(boolean|string)',
    boundary: '(string|element)',
    display: 'string',
    offset: '(array|string|function)',
    popperConfig: '(null|object|function)',
    reference: '(string|element|object)'
  };

  /**
   * Class definition
   */

  class Dropdown extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._popper = null;
      this._parent = this._element.parentNode; // dropdown wrapper
      // TODO: v6 revert #37011 & change markup https://getbootstrap.com/docs/5.3/forms/input-group/
      this._menu = SelectorEngine.next(this._element, SELECTOR_MENU)[0] || SelectorEngine.prev(this._element, SELECTOR_MENU)[0] || SelectorEngine.findOne(SELECTOR_MENU, this._parent);
      this._inNavbar = this._detectNavbar();
    }

    // Getters
    static get Default() {
      return Default$9;
    }
    static get DefaultType() {
      return DefaultType$9;
    }
    static get NAME() {
      return NAME$a;
    }

    // Public
    toggle() {
      return this._isShown() ? this.hide() : this.show();
    }
    show() {
      if (isDisabled(this._element) || this._isShown()) {
        return;
      }
      const relatedTarget = {
        relatedTarget: this._element
      };
      const showEvent = EventHandler.trigger(this._element, EVENT_SHOW$5, relatedTarget);
      if (showEvent.defaultPrevented) {
        return;
      }
      this._createPopper();

      // If this is a touch-enabled device we add extra
      // empty mouseover listeners to the body's immediate children;
      // only needed because of broken event delegation on iOS
      // https://www.quirksmode.org/blog/archives/2014/02/mouse_event_bub.html
      if ('ontouchstart' in document.documentElement && !this._parent.closest(SELECTOR_NAVBAR_NAV)) {
        for (const element of [].concat(...document.body.children)) {
          EventHandler.on(element, 'mouseover', noop);
        }
      }
      this._element.focus();
      this._element.setAttribute('aria-expanded', true);
      this._menu.classList.add(CLASS_NAME_SHOW$6);
      this._element.classList.add(CLASS_NAME_SHOW$6);
      EventHandler.trigger(this._element, EVENT_SHOWN$5, relatedTarget);
    }
    hide() {
      if (isDisabled(this._element) || !this._isShown()) {
        return;
      }
      const relatedTarget = {
        relatedTarget: this._element
      };
      this._completeHide(relatedTarget);
    }
    dispose() {
      if (this._popper) {
        this._popper.destroy();
      }
      super.dispose();
    }
    update() {
      this._inNavbar = this._detectNavbar();
      if (this._popper) {
        this._popper.update();
      }
    }

    // Private
    _completeHide(relatedTarget) {
      const hideEvent = EventHandler.trigger(this._element, EVENT_HIDE$5, relatedTarget);
      if (hideEvent.defaultPrevented) {
        return;
      }

      // If this is a touch-enabled device we remove the extra
      // empty mouseover listeners we added for iOS support
      if ('ontouchstart' in document.documentElement) {
        for (const element of [].concat(...document.body.children)) {
          EventHandler.off(element, 'mouseover', noop);
        }
      }
      if (this._popper) {
        this._popper.destroy();
      }
      this._menu.classList.remove(CLASS_NAME_SHOW$6);
      this._element.classList.remove(CLASS_NAME_SHOW$6);
      this._element.setAttribute('aria-expanded', 'false');
      Manipulator.removeDataAttribute(this._menu, 'popper');
      EventHandler.trigger(this._element, EVENT_HIDDEN$5, relatedTarget);
    }
    _getConfig(config) {
      config = super._getConfig(config);
      if (typeof config.reference === 'object' && !isElement(config.reference) && typeof config.reference.getBoundingClientRect !== 'function') {
        // Popper virtual elements require a getBoundingClientRect method
        throw new TypeError(`${NAME$a.toUpperCase()}: Option "reference" provided type "object" without a required "getBoundingClientRect" method.`);
      }
      return config;
    }
    _createPopper() {
      if (typeof Popper__namespace === 'undefined') {
        throw new TypeError('Bootstrap\'s dropdowns require Popper (https://popper.js.org)');
      }
      let referenceElement = this._element;
      if (this._config.reference === 'parent') {
        referenceElement = this._parent;
      } else if (isElement(this._config.reference)) {
        referenceElement = getElement(this._config.reference);
      } else if (typeof this._config.reference === 'object') {
        referenceElement = this._config.reference;
      }
      const popperConfig = this._getPopperConfig();
      this._popper = Popper__namespace.createPopper(referenceElement, this._menu, popperConfig);
    }
    _isShown() {
      return this._menu.classList.contains(CLASS_NAME_SHOW$6);
    }
    _getPlacement() {
      const parentDropdown = this._parent;
      if (parentDropdown.classList.contains(CLASS_NAME_DROPEND)) {
        return PLACEMENT_RIGHT;
      }
      if (parentDropdown.classList.contains(CLASS_NAME_DROPSTART)) {
        return PLACEMENT_LEFT;
      }
      if (parentDropdown.classList.contains(CLASS_NAME_DROPUP_CENTER)) {
        return PLACEMENT_TOPCENTER;
      }
      if (parentDropdown.classList.contains(CLASS_NAME_DROPDOWN_CENTER)) {
        return PLACEMENT_BOTTOMCENTER;
      }

      // We need to trim the value because custom properties can also include spaces
      const isEnd = getComputedStyle(this._menu).getPropertyValue('--bs-position').trim() === 'end';
      if (parentDropdown.classList.contains(CLASS_NAME_DROPUP)) {
        return isEnd ? PLACEMENT_TOPEND : PLACEMENT_TOP;
      }
      return isEnd ? PLACEMENT_BOTTOMEND : PLACEMENT_BOTTOM;
    }
    _detectNavbar() {
      return this._element.closest(SELECTOR_NAVBAR) !== null;
    }
    _getOffset() {
      const {
        offset
      } = this._config;
      if (typeof offset === 'string') {
        return offset.split(',').map(value => Number.parseInt(value, 10));
      }
      if (typeof offset === 'function') {
        return popperData => offset(popperData, this._element);
      }
      return offset;
    }
    _getPopperConfig() {
      const defaultBsPopperConfig = {
        placement: this._getPlacement(),
        modifiers: [{
          name: 'preventOverflow',
          options: {
            boundary: this._config.boundary
          }
        }, {
          name: 'offset',
          options: {
            offset: this._getOffset()
          }
        }]
      };

      // Disable Popper if we have a static display or Dropdown is in Navbar
      if (this._inNavbar || this._config.display === 'static') {
        Manipulator.setDataAttribute(this._menu, 'popper', 'static'); // TODO: v6 remove
        defaultBsPopperConfig.modifiers = [{
          name: 'applyStyles',
          enabled: false
        }];
      }
      return {
        ...defaultBsPopperConfig,
        ...execute(this._config.popperConfig, [defaultBsPopperConfig])
      };
    }
    _selectMenuItem({
      key,
      target
    }) {
      const items = SelectorEngine.find(SELECTOR_VISIBLE_ITEMS, this._menu).filter(element => isVisible(element));
      if (!items.length) {
        return;
      }

      // if target isn't included in items (e.g. when expanding the dropdown)
      // allow cycling to get the last item in case key equals ARROW_UP_KEY
      getNextActiveElement(items, target, key === ARROW_DOWN_KEY$1, !items.includes(target)).focus();
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Dropdown.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (typeof data[config] === 'undefined') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config]();
      });
    }
    static clearMenus(event) {
      if (event.button === RIGHT_MOUSE_BUTTON || event.type === 'keyup' && event.key !== TAB_KEY$1) {
        return;
      }
      const openToggles = SelectorEngine.find(SELECTOR_DATA_TOGGLE_SHOWN);
      for (const toggle of openToggles) {
        const context = Dropdown.getInstance(toggle);
        if (!context || context._config.autoClose === false) {
          continue;
        }
        const composedPath = event.composedPath();
        const isMenuTarget = composedPath.includes(context._menu);
        if (composedPath.includes(context._element) || context._config.autoClose === 'inside' && !isMenuTarget || context._config.autoClose === 'outside' && isMenuTarget) {
          continue;
        }

        // Tab navigation through the dropdown menu or events from contained inputs shouldn't close the menu
        if (context._menu.contains(event.target) && (event.type === 'keyup' && event.key === TAB_KEY$1 || /input|select|option|textarea|form/i.test(event.target.tagName))) {
          continue;
        }
        const relatedTarget = {
          relatedTarget: context._element
        };
        if (event.type === 'click') {
          relatedTarget.clickEvent = event;
        }
        context._completeHide(relatedTarget);
      }
    }
    static dataApiKeydownHandler(event) {
      // If not an UP | DOWN | ESCAPE key => not a dropdown command
      // If input/textarea && if key is other than ESCAPE => not a dropdown command

      const isInput = /input|textarea/i.test(event.target.tagName);
      const isEscapeEvent = event.key === ESCAPE_KEY$2;
      const isUpOrDownEvent = [ARROW_UP_KEY$1, ARROW_DOWN_KEY$1].includes(event.key);
      if (!isUpOrDownEvent && !isEscapeEvent) {
        return;
      }
      if (isInput && !isEscapeEvent) {
        return;
      }
      event.preventDefault();

      // TODO: v6 revert #37011 & change markup https://getbootstrap.com/docs/5.3/forms/input-group/
      const getToggleButton = this.matches(SELECTOR_DATA_TOGGLE$3) ? this : SelectorEngine.prev(this, SELECTOR_DATA_TOGGLE$3)[0] || SelectorEngine.next(this, SELECTOR_DATA_TOGGLE$3)[0] || SelectorEngine.findOne(SELECTOR_DATA_TOGGLE$3, event.delegateTarget.parentNode);
      const instance = Dropdown.getOrCreateInstance(getToggleButton);
      if (isUpOrDownEvent) {
        event.stopPropagation();
        instance.show();
        instance._selectMenuItem(event);
        return;
      }
      if (instance._isShown()) {
        // else is escape and we check if it is shown
        event.stopPropagation();
        instance.hide();
        getToggleButton.focus();
      }
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_KEYDOWN_DATA_API, SELECTOR_DATA_TOGGLE$3, Dropdown.dataApiKeydownHandler);
  EventHandler.on(document, EVENT_KEYDOWN_DATA_API, SELECTOR_MENU, Dropdown.dataApiKeydownHandler);
  EventHandler.on(document, EVENT_CLICK_DATA_API$3, Dropdown.clearMenus);
  EventHandler.on(document, EVENT_KEYUP_DATA_API, Dropdown.clearMenus);
  EventHandler.on(document, EVENT_CLICK_DATA_API$3, SELECTOR_DATA_TOGGLE$3, function (event) {
    event.preventDefault();
    Dropdown.getOrCreateInstance(this).toggle();
  });

  /**
   * jQuery
   */

  defineJQueryPlugin(Dropdown);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/backdrop.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$9 = 'backdrop';
  const CLASS_NAME_FADE$4 = 'fade';
  const CLASS_NAME_SHOW$5 = 'show';
  const EVENT_MOUSEDOWN = `mousedown.bs.${NAME$9}`;
  const Default$8 = {
    className: 'modal-backdrop',
    clickCallback: null,
    isAnimated: false,
    isVisible: true,
    // if false, we use the backdrop helper without adding any element to the dom
    rootElement: 'body' // give the choice to place backdrop under different elements
  };
  const DefaultType$8 = {
    className: 'string',
    clickCallback: '(function|null)',
    isAnimated: 'boolean',
    isVisible: 'boolean',
    rootElement: '(element|string)'
  };

  /**
   * Class definition
   */

  class Backdrop extends Config {
    constructor(config) {
      super();
      this._config = this._getConfig(config);
      this._isAppended = false;
      this._element = null;
    }

    // Getters
    static get Default() {
      return Default$8;
    }
    static get DefaultType() {
      return DefaultType$8;
    }
    static get NAME() {
      return NAME$9;
    }

    // Public
    show(callback) {
      if (!this._config.isVisible) {
        execute(callback);
        return;
      }
      this._append();
      const element = this._getElement();
      if (this._config.isAnimated) {
        reflow(element);
      }
      element.classList.add(CLASS_NAME_SHOW$5);
      this._emulateAnimation(() => {
        execute(callback);
      });
    }
    hide(callback) {
      if (!this._config.isVisible) {
        execute(callback);
        return;
      }
      this._getElement().classList.remove(CLASS_NAME_SHOW$5);
      this._emulateAnimation(() => {
        this.dispose();
        execute(callback);
      });
    }
    dispose() {
      if (!this._isAppended) {
        return;
      }
      EventHandler.off(this._element, EVENT_MOUSEDOWN);
      this._element.remove();
      this._isAppended = false;
    }

    // Private
    _getElement() {
      if (!this._element) {
        const backdrop = document.createElement('div');
        backdrop.className = this._config.className;
        if (this._config.isAnimated) {
          backdrop.classList.add(CLASS_NAME_FADE$4);
        }
        this._element = backdrop;
      }
      return this._element;
    }
    _configAfterMerge(config) {
      // use getElement() with the default "body" to get a fresh Element on each instantiation
      config.rootElement = getElement(config.rootElement);
      return config;
    }
    _append() {
      if (this._isAppended) {
        return;
      }
      const element = this._getElement();
      this._config.rootElement.append(element);
      EventHandler.on(element, EVENT_MOUSEDOWN, () => {
        execute(this._config.clickCallback);
      });
      this._isAppended = true;
    }
    _emulateAnimation(callback) {
      executeAfterTransition(callback, this._getElement(), this._config.isAnimated);
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/focustrap.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$8 = 'focustrap';
  const DATA_KEY$5 = 'bs.focustrap';
  const EVENT_KEY$5 = `.${DATA_KEY$5}`;
  const EVENT_FOCUSIN$2 = `focusin${EVENT_KEY$5}`;
  const EVENT_KEYDOWN_TAB = `keydown.tab${EVENT_KEY$5}`;
  const TAB_KEY = 'Tab';
  const TAB_NAV_FORWARD = 'forward';
  const TAB_NAV_BACKWARD = 'backward';
  const Default$7 = {
    autofocus: true,
    trapElement: null // The element to trap focus inside of
  };
  const DefaultType$7 = {
    autofocus: 'boolean',
    trapElement: 'element'
  };

  /**
   * Class definition
   */

  class FocusTrap extends Config {
    constructor(config) {
      super();
      this._config = this._getConfig(config);
      this._isActive = false;
      this._lastTabNavDirection = null;
    }

    // Getters
    static get Default() {
      return Default$7;
    }
    static get DefaultType() {
      return DefaultType$7;
    }
    static get NAME() {
      return NAME$8;
    }

    // Public
    activate() {
      if (this._isActive) {
        return;
      }
      if (this._config.autofocus) {
        this._config.trapElement.focus();
      }
      EventHandler.off(document, EVENT_KEY$5); // guard against infinite focus loop
      EventHandler.on(document, EVENT_FOCUSIN$2, event => this._handleFocusin(event));
      EventHandler.on(document, EVENT_KEYDOWN_TAB, event => this._handleKeydown(event));
      this._isActive = true;
    }
    deactivate() {
      if (!this._isActive) {
        return;
      }
      this._isActive = false;
      EventHandler.off(document, EVENT_KEY$5);
    }

    // Private
    _handleFocusin(event) {
      const {
        trapElement
      } = this._config;
      if (event.target === document || event.target === trapElement || trapElement.contains(event.target)) {
        return;
      }
      const elements = SelectorEngine.focusableChildren(trapElement);
      if (elements.length === 0) {
        trapElement.focus();
      } else if (this._lastTabNavDirection === TAB_NAV_BACKWARD) {
        elements[elements.length - 1].focus();
      } else {
        elements[0].focus();
      }
    }
    _handleKeydown(event) {
      if (event.key !== TAB_KEY) {
        return;
      }
      this._lastTabNavDirection = event.shiftKey ? TAB_NAV_BACKWARD : TAB_NAV_FORWARD;
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/scrollBar.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const SELECTOR_FIXED_CONTENT = '.fixed-top, .fixed-bottom, .is-fixed, .sticky-top';
  const SELECTOR_STICKY_CONTENT = '.sticky-top';
  const PROPERTY_PADDING = 'padding-right';
  const PROPERTY_MARGIN = 'margin-right';

  /**
   * Class definition
   */

  class ScrollBarHelper {
    constructor() {
      this._element = document.body;
    }

    // Public
    getWidth() {
      // https://developer.mozilla.org/en-US/docs/Web/API/Window/innerWidth#usage_notes
      const documentWidth = document.documentElement.clientWidth;
      return Math.abs(window.innerWidth - documentWidth);
    }
    hide() {
      const width = this.getWidth();
      this._disableOverFlow();
      // give padding to element to balance the hidden scrollbar width
      this._setElementAttributes(this._element, PROPERTY_PADDING, calculatedValue => calculatedValue + width);
      // trick: We adjust positive paddingRight and negative marginRight to sticky-top elements to keep showing fullwidth
      this._setElementAttributes(SELECTOR_FIXED_CONTENT, PROPERTY_PADDING, calculatedValue => calculatedValue + width);
      this._setElementAttributes(SELECTOR_STICKY_CONTENT, PROPERTY_MARGIN, calculatedValue => calculatedValue - width);
    }
    reset() {
      this._resetElementAttributes(this._element, 'overflow');
      this._resetElementAttributes(this._element, PROPERTY_PADDING);
      this._resetElementAttributes(SELECTOR_FIXED_CONTENT, PROPERTY_PADDING);
      this._resetElementAttributes(SELECTOR_STICKY_CONTENT, PROPERTY_MARGIN);
    }
    isOverflowing() {
      return this.getWidth() > 0;
    }

    // Private
    _disableOverFlow() {
      this._saveInitialAttribute(this._element, 'overflow');
      this._element.style.overflow = 'hidden';
    }
    _setElementAttributes(selector, styleProperty, callback) {
      const scrollbarWidth = this.getWidth();
      const manipulationCallBack = element => {
        if (element !== this._element && window.innerWidth > element.clientWidth + scrollbarWidth) {
          return;
        }
        this._saveInitialAttribute(element, styleProperty);
        const calculatedValue = window.getComputedStyle(element).getPropertyValue(styleProperty);
        element.style.setProperty(styleProperty, `${callback(Number.parseFloat(calculatedValue))}px`);
      };
      this._applyManipulationCallback(selector, manipulationCallBack);
    }
    _saveInitialAttribute(element, styleProperty) {
      const actualValue = element.style.getPropertyValue(styleProperty);
      if (actualValue) {
        Manipulator.setDataAttribute(element, styleProperty, actualValue);
      }
    }
    _resetElementAttributes(selector, styleProperty) {
      const manipulationCallBack = element => {
        const value = Manipulator.getDataAttribute(element, styleProperty);
        // We only want to remove the property if the value is `null`; the value can also be zero
        if (value === null) {
          element.style.removeProperty(styleProperty);
          return;
        }
        Manipulator.removeDataAttribute(element, styleProperty);
        element.style.setProperty(styleProperty, value);
      };
      this._applyManipulationCallback(selector, manipulationCallBack);
    }
    _applyManipulationCallback(selector, callBack) {
      if (isElement(selector)) {
        callBack(selector);
        return;
      }
      for (const sel of SelectorEngine.find(selector, this._element)) {
        callBack(sel);
      }
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap modal.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$7 = 'modal';
  const DATA_KEY$4 = 'bs.modal';
  const EVENT_KEY$4 = `.${DATA_KEY$4}`;
  const DATA_API_KEY$2 = '.data-api';
  const ESCAPE_KEY$1 = 'Escape';
  const EVENT_HIDE$4 = `hide${EVENT_KEY$4}`;
  const EVENT_HIDE_PREVENTED$1 = `hidePrevented${EVENT_KEY$4}`;
  const EVENT_HIDDEN$4 = `hidden${EVENT_KEY$4}`;
  const EVENT_SHOW$4 = `show${EVENT_KEY$4}`;
  const EVENT_SHOWN$4 = `shown${EVENT_KEY$4}`;
  const EVENT_RESIZE$1 = `resize${EVENT_KEY$4}`;
  const EVENT_CLICK_DISMISS = `click.dismiss${EVENT_KEY$4}`;
  const EVENT_MOUSEDOWN_DISMISS = `mousedown.dismiss${EVENT_KEY$4}`;
  const EVENT_KEYDOWN_DISMISS$1 = `keydown.dismiss${EVENT_KEY$4}`;
  const EVENT_CLICK_DATA_API$2 = `click${EVENT_KEY$4}${DATA_API_KEY$2}`;
  const CLASS_NAME_OPEN = 'modal-open';
  const CLASS_NAME_FADE$3 = 'fade';
  const CLASS_NAME_SHOW$4 = 'show';
  const CLASS_NAME_STATIC = 'modal-static';
  const OPEN_SELECTOR$1 = '.modal.show';
  const SELECTOR_DIALOG = '.modal-dialog';
  const SELECTOR_MODAL_BODY = '.modal-body';
  const SELECTOR_DATA_TOGGLE$2 = '[data-bs-toggle="modal"]';
  const Default$6 = {
    backdrop: true,
    focus: true,
    keyboard: true
  };
  const DefaultType$6 = {
    backdrop: '(boolean|string)',
    focus: 'boolean',
    keyboard: 'boolean'
  };

  /**
   * Class definition
   */

  class Modal extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._dialog = SelectorEngine.findOne(SELECTOR_DIALOG, this._element);
      this._backdrop = this._initializeBackDrop();
      this._focustrap = this._initializeFocusTrap();
      this._isShown = false;
      this._isTransitioning = false;
      this._scrollBar = new ScrollBarHelper();
      this._addEventListeners();
    }

    // Getters
    static get Default() {
      return Default$6;
    }
    static get DefaultType() {
      return DefaultType$6;
    }
    static get NAME() {
      return NAME$7;
    }

    // Public
    toggle(relatedTarget) {
      return this._isShown ? this.hide() : this.show(relatedTarget);
    }
    show(relatedTarget) {
      if (this._isShown || this._isTransitioning) {
        return;
      }
      const showEvent = EventHandler.trigger(this._element, EVENT_SHOW$4, {
        relatedTarget
      });
      if (showEvent.defaultPrevented) {
        return;
      }
      this._isShown = true;
      this._isTransitioning = true;
      this._scrollBar.hide();
      document.body.classList.add(CLASS_NAME_OPEN);
      this._adjustDialog();
      this._backdrop.show(() => this._showElement(relatedTarget));
    }
    hide() {
      if (!this._isShown || this._isTransitioning) {
        return;
      }
      const hideEvent = EventHandler.trigger(this._element, EVENT_HIDE$4);
      if (hideEvent.defaultPrevented) {
        return;
      }
      this._isShown = false;
      this._isTransitioning = true;
      this._focustrap.deactivate();
      this._element.classList.remove(CLASS_NAME_SHOW$4);
      this._queueCallback(() => this._hideModal(), this._element, this._isAnimated());
    }
    dispose() {
      EventHandler.off(window, EVENT_KEY$4);
      EventHandler.off(this._dialog, EVENT_KEY$4);
      this._backdrop.dispose();
      this._focustrap.deactivate();
      super.dispose();
    }
    handleUpdate() {
      this._adjustDialog();
    }

    // Private
    _initializeBackDrop() {
      return new Backdrop({
        isVisible: Boolean(this._config.backdrop),
        // 'static' option will be translated to true, and booleans will keep their value,
        isAnimated: this._isAnimated()
      });
    }
    _initializeFocusTrap() {
      return new FocusTrap({
        trapElement: this._element
      });
    }
    _showElement(relatedTarget) {
      // try to append dynamic modal
      if (!document.body.contains(this._element)) {
        document.body.append(this._element);
      }
      this._element.style.display = 'block';
      this._element.removeAttribute('aria-hidden');
      this._element.setAttribute('aria-modal', true);
      this._element.setAttribute('role', 'dialog');
      this._element.scrollTop = 0;
      const modalBody = SelectorEngine.findOne(SELECTOR_MODAL_BODY, this._dialog);
      if (modalBody) {
        modalBody.scrollTop = 0;
      }
      reflow(this._element);
      this._element.classList.add(CLASS_NAME_SHOW$4);
      const transitionComplete = () => {
        if (this._config.focus) {
          this._focustrap.activate();
        }
        this._isTransitioning = false;
        EventHandler.trigger(this._element, EVENT_SHOWN$4, {
          relatedTarget
        });
      };
      this._queueCallback(transitionComplete, this._dialog, this._isAnimated());
    }
    _addEventListeners() {
      EventHandler.on(this._element, EVENT_KEYDOWN_DISMISS$1, event => {
        if (event.key !== ESCAPE_KEY$1) {
          return;
        }
        if (this._config.keyboard) {
          this.hide();
          return;
        }
        this._triggerBackdropTransition();
      });
      EventHandler.on(window, EVENT_RESIZE$1, () => {
        if (this._isShown && !this._isTransitioning) {
          this._adjustDialog();
        }
      });
      EventHandler.on(this._element, EVENT_MOUSEDOWN_DISMISS, event => {
        // a bad trick to segregate clicks that may start inside dialog but end outside, and avoid listen to scrollbar clicks
        EventHandler.one(this._element, EVENT_CLICK_DISMISS, event2 => {
          if (this._element !== event.target || this._element !== event2.target) {
            return;
          }
          if (this._config.backdrop === 'static') {
            this._triggerBackdropTransition();
            return;
          }
          if (this._config.backdrop) {
            this.hide();
          }
        });
      });
    }
    _hideModal() {
      this._element.style.display = 'none';
      this._element.setAttribute('aria-hidden', true);
      this._element.removeAttribute('aria-modal');
      this._element.removeAttribute('role');
      this._isTransitioning = false;
      this._backdrop.hide(() => {
        document.body.classList.remove(CLASS_NAME_OPEN);
        this._resetAdjustments();
        this._scrollBar.reset();
        EventHandler.trigger(this._element, EVENT_HIDDEN$4);
      });
    }
    _isAnimated() {
      return this._element.classList.contains(CLASS_NAME_FADE$3);
    }
    _triggerBackdropTransition() {
      const hideEvent = EventHandler.trigger(this._element, EVENT_HIDE_PREVENTED$1);
      if (hideEvent.defaultPrevented) {
        return;
      }
      const isModalOverflowing = this._element.scrollHeight > document.documentElement.clientHeight;
      const initialOverflowY = this._element.style.overflowY;
      // return if the following background transition hasn't yet completed
      if (initialOverflowY === 'hidden' || this._element.classList.contains(CLASS_NAME_STATIC)) {
        return;
      }
      if (!isModalOverflowing) {
        this._element.style.overflowY = 'hidden';
      }
      this._element.classList.add(CLASS_NAME_STATIC);
      this._queueCallback(() => {
        this._element.classList.remove(CLASS_NAME_STATIC);
        this._queueCallback(() => {
          this._element.style.overflowY = initialOverflowY;
        }, this._dialog);
      }, this._dialog);
      this._element.focus();
    }

    /**
     * The following methods are used to handle overflowing modals
     */

    _adjustDialog() {
      const isModalOverflowing = this._element.scrollHeight > document.documentElement.clientHeight;
      const scrollbarWidth = this._scrollBar.getWidth();
      const isBodyOverflowing = scrollbarWidth > 0;
      if (isBodyOverflowing && !isModalOverflowing) {
        const property = isRTL() ? 'paddingLeft' : 'paddingRight';
        this._element.style[property] = `${scrollbarWidth}px`;
      }
      if (!isBodyOverflowing && isModalOverflowing) {
        const property = isRTL() ? 'paddingRight' : 'paddingLeft';
        this._element.style[property] = `${scrollbarWidth}px`;
      }
    }
    _resetAdjustments() {
      this._element.style.paddingLeft = '';
      this._element.style.paddingRight = '';
    }

    // Static
    static jQueryInterface(config, relatedTarget) {
      return this.each(function () {
        const data = Modal.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (typeof data[config] === 'undefined') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config](relatedTarget);
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API$2, SELECTOR_DATA_TOGGLE$2, function (event) {
    const target = SelectorEngine.getElementFromSelector(this);
    if (['A', 'AREA'].includes(this.tagName)) {
      event.preventDefault();
    }
    EventHandler.one(target, EVENT_SHOW$4, showEvent => {
      if (showEvent.defaultPrevented) {
        // only register focus restorer if modal will actually get shown
        return;
      }
      EventHandler.one(target, EVENT_HIDDEN$4, () => {
        if (isVisible(this)) {
          this.focus();
        }
      });
    });

    // avoid conflict when clicking modal toggler while another one is open
    const alreadyOpen = SelectorEngine.findOne(OPEN_SELECTOR$1);
    if (alreadyOpen) {
      Modal.getInstance(alreadyOpen).hide();
    }
    const data = Modal.getOrCreateInstance(target);
    data.toggle(this);
  });
  enableDismissTrigger(Modal);

  /**
   * jQuery
   */

  defineJQueryPlugin(Modal);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap offcanvas.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$6 = 'offcanvas';
  const DATA_KEY$3 = 'bs.offcanvas';
  const EVENT_KEY$3 = `.${DATA_KEY$3}`;
  const DATA_API_KEY$1 = '.data-api';
  const EVENT_LOAD_DATA_API$2 = `load${EVENT_KEY$3}${DATA_API_KEY$1}`;
  const ESCAPE_KEY = 'Escape';
  const CLASS_NAME_SHOW$3 = 'show';
  const CLASS_NAME_SHOWING$1 = 'showing';
  const CLASS_NAME_HIDING = 'hiding';
  const CLASS_NAME_BACKDROP = 'offcanvas-backdrop';
  const OPEN_SELECTOR = '.offcanvas.show';
  const EVENT_SHOW$3 = `show${EVENT_KEY$3}`;
  const EVENT_SHOWN$3 = `shown${EVENT_KEY$3}`;
  const EVENT_HIDE$3 = `hide${EVENT_KEY$3}`;
  const EVENT_HIDE_PREVENTED = `hidePrevented${EVENT_KEY$3}`;
  const EVENT_HIDDEN$3 = `hidden${EVENT_KEY$3}`;
  const EVENT_RESIZE = `resize${EVENT_KEY$3}`;
  const EVENT_CLICK_DATA_API$1 = `click${EVENT_KEY$3}${DATA_API_KEY$1}`;
  const EVENT_KEYDOWN_DISMISS = `keydown.dismiss${EVENT_KEY$3}`;
  const SELECTOR_DATA_TOGGLE$1 = '[data-bs-toggle="offcanvas"]';
  const Default$5 = {
    backdrop: true,
    keyboard: true,
    scroll: false
  };
  const DefaultType$5 = {
    backdrop: '(boolean|string)',
    keyboard: 'boolean',
    scroll: 'boolean'
  };

  /**
   * Class definition
   */

  class Offcanvas extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._isShown = false;
      this._backdrop = this._initializeBackDrop();
      this._focustrap = this._initializeFocusTrap();
      this._addEventListeners();
    }

    // Getters
    static get Default() {
      return Default$5;
    }
    static get DefaultType() {
      return DefaultType$5;
    }
    static get NAME() {
      return NAME$6;
    }

    // Public
    toggle(relatedTarget) {
      return this._isShown ? this.hide() : this.show(relatedTarget);
    }
    show(relatedTarget) {
      if (this._isShown) {
        return;
      }
      const showEvent = EventHandler.trigger(this._element, EVENT_SHOW$3, {
        relatedTarget
      });
      if (showEvent.defaultPrevented) {
        return;
      }
      this._isShown = true;
      this._backdrop.show();
      if (!this._config.scroll) {
        new ScrollBarHelper().hide();
      }
      this._element.setAttribute('aria-modal', true);
      this._element.setAttribute('role', 'dialog');
      this._element.classList.add(CLASS_NAME_SHOWING$1);
      const completeCallBack = () => {
        if (!this._config.scroll || this._config.backdrop) {
          this._focustrap.activate();
        }
        this._element.classList.add(CLASS_NAME_SHOW$3);
        this._element.classList.remove(CLASS_NAME_SHOWING$1);
        EventHandler.trigger(this._element, EVENT_SHOWN$3, {
          relatedTarget
        });
      };
      this._queueCallback(completeCallBack, this._element, true);
    }
    hide() {
      if (!this._isShown) {
        return;
      }
      const hideEvent = EventHandler.trigger(this._element, EVENT_HIDE$3);
      if (hideEvent.defaultPrevented) {
        return;
      }
      this._focustrap.deactivate();
      this._element.blur();
      this._isShown = false;
      this._element.classList.add(CLASS_NAME_HIDING);
      this._backdrop.hide();
      const completeCallback = () => {
        this._element.classList.remove(CLASS_NAME_SHOW$3, CLASS_NAME_HIDING);
        this._element.removeAttribute('aria-modal');
        this._element.removeAttribute('role');
        if (!this._config.scroll) {
          new ScrollBarHelper().reset();
        }
        EventHandler.trigger(this._element, EVENT_HIDDEN$3);
      };
      this._queueCallback(completeCallback, this._element, true);
    }
    dispose() {
      this._backdrop.dispose();
      this._focustrap.deactivate();
      super.dispose();
    }

    // Private
    _initializeBackDrop() {
      const clickCallback = () => {
        if (this._config.backdrop === 'static') {
          EventHandler.trigger(this._element, EVENT_HIDE_PREVENTED);
          return;
        }
        this.hide();
      };

      // 'static' option will be translated to true, and booleans will keep their value
      const isVisible = Boolean(this._config.backdrop);
      return new Backdrop({
        className: CLASS_NAME_BACKDROP,
        isVisible,
        isAnimated: true,
        rootElement: this._element.parentNode,
        clickCallback: isVisible ? clickCallback : null
      });
    }
    _initializeFocusTrap() {
      return new FocusTrap({
        trapElement: this._element
      });
    }
    _addEventListeners() {
      EventHandler.on(this._element, EVENT_KEYDOWN_DISMISS, event => {
        if (event.key !== ESCAPE_KEY) {
          return;
        }
        if (this._config.keyboard) {
          this.hide();
          return;
        }
        EventHandler.trigger(this._element, EVENT_HIDE_PREVENTED);
      });
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Offcanvas.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (data[config] === undefined || config.startsWith('_') || config === 'constructor') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config](this);
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API$1, SELECTOR_DATA_TOGGLE$1, function (event) {
    const target = SelectorEngine.getElementFromSelector(this);
    if (['A', 'AREA'].includes(this.tagName)) {
      event.preventDefault();
    }
    if (isDisabled(this)) {
      return;
    }
    EventHandler.one(target, EVENT_HIDDEN$3, () => {
      // focus on trigger when it is closed
      if (isVisible(this)) {
        this.focus();
      }
    });

    // avoid conflict when clicking a toggler of an offcanvas, while another is open
    const alreadyOpen = SelectorEngine.findOne(OPEN_SELECTOR);
    if (alreadyOpen && alreadyOpen !== target) {
      Offcanvas.getInstance(alreadyOpen).hide();
    }
    const data = Offcanvas.getOrCreateInstance(target);
    data.toggle(this);
  });
  EventHandler.on(window, EVENT_LOAD_DATA_API$2, () => {
    for (const selector of SelectorEngine.find(OPEN_SELECTOR)) {
      Offcanvas.getOrCreateInstance(selector).show();
    }
  });
  EventHandler.on(window, EVENT_RESIZE, () => {
    for (const element of SelectorEngine.find('[aria-modal][class*=show][class*=offcanvas-]')) {
      if (getComputedStyle(element).position !== 'fixed') {
        Offcanvas.getOrCreateInstance(element).hide();
      }
    }
  });
  enableDismissTrigger(Offcanvas);

  /**
   * jQuery
   */

  defineJQueryPlugin(Offcanvas);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/sanitizer.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  // js-docs-start allow-list
  const ARIA_ATTRIBUTE_PATTERN = /^aria-[\w-]*$/i;
  const DefaultAllowlist = {
    // Global attributes allowed on any supplied element below.
    '*': ['class', 'dir', 'id', 'lang', 'role', ARIA_ATTRIBUTE_PATTERN],
    a: ['target', 'href', 'title', 'rel'],
    area: [],
    b: [],
    br: [],
    col: [],
    code: [],
    dd: [],
    div: [],
    dl: [],
    dt: [],
    em: [],
    hr: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    i: [],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height'],
    li: [],
    ol: [],
    p: [],
    pre: [],
    s: [],
    small: [],
    span: [],
    sub: [],
    sup: [],
    strong: [],
    u: [],
    ul: []
  };
  // js-docs-end allow-list

  const uriAttributes = new Set(['background', 'cite', 'href', 'itemtype', 'longdesc', 'poster', 'src', 'xlink:href']);

  /**
   * A pattern that recognizes URLs that are safe wrt. XSS in URL navigation
   * contexts.
   *
   * Shout-out to Angular https://github.com/angular/angular/blob/15.2.8/packages/core/src/sanitization/url_sanitizer.ts#L38
   */
  // eslint-disable-next-line unicorn/better-regex
  const SAFE_URL_PATTERN = /^(?!javascript:)(?:[a-z0-9+.-]+:|[^&:/?#]*(?:[/?#]|$))/i;
  const allowedAttribute = (attribute, allowedAttributeList) => {
    const attributeName = attribute.nodeName.toLowerCase();
    if (allowedAttributeList.includes(attributeName)) {
      if (uriAttributes.has(attributeName)) {
        return Boolean(SAFE_URL_PATTERN.test(attribute.nodeValue));
      }
      return true;
    }

    // Check if a regular expression validates the attribute.
    return allowedAttributeList.filter(attributeRegex => attributeRegex instanceof RegExp).some(regex => regex.test(attributeName));
  };
  function sanitizeHtml(unsafeHtml, allowList, sanitizeFunction) {
    if (!unsafeHtml.length) {
      return unsafeHtml;
    }
    if (sanitizeFunction && typeof sanitizeFunction === 'function') {
      return sanitizeFunction(unsafeHtml);
    }
    const domParser = new window.DOMParser();
    const createdDocument = domParser.parseFromString(unsafeHtml, 'text/html');
    const elements = [].concat(...createdDocument.body.querySelectorAll('*'));
    for (const element of elements) {
      const elementName = element.nodeName.toLowerCase();
      if (!Object.keys(allowList).includes(elementName)) {
        element.remove();
        continue;
      }
      const attributeList = [].concat(...element.attributes);
      const allowedAttributes = [].concat(allowList['*'] || [], allowList[elementName] || []);
      for (const attribute of attributeList) {
        if (!allowedAttribute(attribute, allowedAttributes)) {
          element.removeAttribute(attribute.nodeName);
        }
      }
    }
    return createdDocument.body.innerHTML;
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap util/template-factory.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$5 = 'TemplateFactory';
  const Default$4 = {
    allowList: DefaultAllowlist,
    content: {},
    // { selector : text ,  selector2 : text2 , }
    extraClass: '',
    html: false,
    sanitize: true,
    sanitizeFn: null,
    template: '<div></div>'
  };
  const DefaultType$4 = {
    allowList: 'object',
    content: 'object',
    extraClass: '(string|function)',
    html: 'boolean',
    sanitize: 'boolean',
    sanitizeFn: '(null|function)',
    template: 'string'
  };
  const DefaultContentType = {
    entry: '(string|element|function|null)',
    selector: '(string|element)'
  };

  /**
   * Class definition
   */

  class TemplateFactory extends Config {
    constructor(config) {
      super();
      this._config = this._getConfig(config);
    }

    // Getters
    static get Default() {
      return Default$4;
    }
    static get DefaultType() {
      return DefaultType$4;
    }
    static get NAME() {
      return NAME$5;
    }

    // Public
    getContent() {
      return Object.values(this._config.content).map(config => this._resolvePossibleFunction(config)).filter(Boolean);
    }
    hasContent() {
      return this.getContent().length > 0;
    }
    changeContent(content) {
      this._checkContent(content);
      this._config.content = {
        ...this._config.content,
        ...content
      };
      return this;
    }
    toHtml() {
      const templateWrapper = document.createElement('div');
      templateWrapper.innerHTML = this._maybeSanitize(this._config.template);
      for (const [selector, text] of Object.entries(this._config.content)) {
        this._setContent(templateWrapper, text, selector);
      }
      const template = templateWrapper.children[0];
      const extraClass = this._resolvePossibleFunction(this._config.extraClass);
      if (extraClass) {
        template.classList.add(...extraClass.split(' '));
      }
      return template;
    }

    // Private
    _typeCheckConfig(config) {
      super._typeCheckConfig(config);
      this._checkContent(config.content);
    }
    _checkContent(arg) {
      for (const [selector, content] of Object.entries(arg)) {
        super._typeCheckConfig({
          selector,
          entry: content
        }, DefaultContentType);
      }
    }
    _setContent(template, content, selector) {
      const templateElement = SelectorEngine.findOne(selector, template);
      if (!templateElement) {
        return;
      }
      content = this._resolvePossibleFunction(content);
      if (!content) {
        templateElement.remove();
        return;
      }
      if (isElement(content)) {
        this._putElementInTemplate(getElement(content), templateElement);
        return;
      }
      if (this._config.html) {
        templateElement.innerHTML = this._maybeSanitize(content);
        return;
      }
      templateElement.textContent = content;
    }
    _maybeSanitize(arg) {
      return this._config.sanitize ? sanitizeHtml(arg, this._config.allowList, this._config.sanitizeFn) : arg;
    }
    _resolvePossibleFunction(arg) {
      return execute(arg, [this]);
    }
    _putElementInTemplate(element, templateElement) {
      if (this._config.html) {
        templateElement.innerHTML = '';
        templateElement.append(element);
        return;
      }
      templateElement.textContent = element.textContent;
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Bootstrap tooltip.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$4 = 'tooltip';
  const DISALLOWED_ATTRIBUTES = new Set(['sanitize', 'allowList', 'sanitizeFn']);
  const CLASS_NAME_FADE$2 = 'fade';
  const CLASS_NAME_MODAL = 'modal';
  const CLASS_NAME_SHOW$2 = 'show';
  const SELECTOR_TOOLTIP_INNER = '.tooltip-inner';
  const SELECTOR_MODAL = `.${CLASS_NAME_MODAL}`;
  const EVENT_MODAL_HIDE = 'hide.bs.modal';
  const TRIGGER_HOVER = 'hover';
  const TRIGGER_FOCUS = 'focus';
  const TRIGGER_CLICK = 'click';
  const TRIGGER_MANUAL = 'manual';
  const EVENT_HIDE$2 = 'hide';
  const EVENT_HIDDEN$2 = 'hidden';
  const EVENT_SHOW$2 = 'show';
  const EVENT_SHOWN$2 = 'shown';
  const EVENT_INSERTED = 'inserted';
  const EVENT_CLICK$1 = 'click';
  const EVENT_FOCUSIN$1 = 'focusin';
  const EVENT_FOCUSOUT$1 = 'focusout';
  const EVENT_MOUSEENTER = 'mouseenter';
  const EVENT_MOUSELEAVE = 'mouseleave';
  const AttachmentMap = {
    AUTO: 'auto',
    TOP: 'top',
    RIGHT: isRTL() ? 'left' : 'right',
    BOTTOM: 'bottom',
    LEFT: isRTL() ? 'right' : 'left'
  };
  const Default$3 = {
    allowList: DefaultAllowlist,
    animation: true,
    boundary: 'clippingParents',
    container: false,
    customClass: '',
    delay: 0,
    fallbackPlacements: ['top', 'right', 'bottom', 'left'],
    html: false,
    offset: [0, 6],
    placement: 'top',
    popperConfig: null,
    sanitize: true,
    sanitizeFn: null,
    selector: false,
    template: '<div class="tooltip" role="tooltip">' + '<div class="tooltip-arrow"></div>' + '<div class="tooltip-inner"></div>' + '</div>',
    title: '',
    trigger: 'hover focus'
  };
  const DefaultType$3 = {
    allowList: 'object',
    animation: 'boolean',
    boundary: '(string|element)',
    container: '(string|element|boolean)',
    customClass: '(string|function)',
    delay: '(number|object)',
    fallbackPlacements: 'array',
    html: 'boolean',
    offset: '(array|string|function)',
    placement: '(string|function)',
    popperConfig: '(null|object|function)',
    sanitize: 'boolean',
    sanitizeFn: '(null|function)',
    selector: '(string|boolean)',
    template: 'string',
    title: '(string|element|function)',
    trigger: 'string'
  };

  /**
   * Class definition
   */

  class Tooltip extends BaseComponent {
    constructor(element, config) {
      if (typeof Popper__namespace === 'undefined') {
        throw new TypeError('Bootstrap\'s tooltips require Popper (https://popper.js.org)');
      }
      super(element, config);

      // Private
      this._isEnabled = true;
      this._timeout = 0;
      this._isHovered = null;
      this._activeTrigger = {};
      this._popper = null;
      this._templateFactory = null;
      this._newContent = null;

      // Protected
      this.tip = null;
      this._setListeners();
      if (!this._config.selector) {
        this._fixTitle();
      }
    }

    // Getters
    static get Default() {
      return Default$3;
    }
    static get DefaultType() {
      return DefaultType$3;
    }
    static get NAME() {
      return NAME$4;
    }

    // Public
    enable() {
      this._isEnabled = true;
    }
    disable() {
      this._isEnabled = false;
    }
    toggleEnabled() {
      this._isEnabled = !this._isEnabled;
    }
    toggle() {
      if (!this._isEnabled) {
        return;
      }
      this._activeTrigger.click = !this._activeTrigger.click;
      if (this._isShown()) {
        this._leave();
        return;
      }
      this._enter();
    }
    dispose() {
      clearTimeout(this._timeout);
      EventHandler.off(this._element.closest(SELECTOR_MODAL), EVENT_MODAL_HIDE, this._hideModalHandler);
      if (this._element.getAttribute('data-bs-original-title')) {
        this._element.setAttribute('title', this._element.getAttribute('data-bs-original-title'));
      }
      this._disposePopper();
      super.dispose();
    }
    show() {
      if (this._element.style.display === 'none') {
        throw new Error('Please use show on visible elements');
      }
      if (!(this._isWithContent() && this._isEnabled)) {
        return;
      }
      const showEvent = EventHandler.trigger(this._element, this.constructor.eventName(EVENT_SHOW$2));
      const shadowRoot = findShadowRoot(this._element);
      const isInTheDom = (shadowRoot || this._element.ownerDocument.documentElement).contains(this._element);
      if (showEvent.defaultPrevented || !isInTheDom) {
        return;
      }

      // TODO: v6 remove this or make it optional
      this._disposePopper();
      const tip = this._getTipElement();
      this._element.setAttribute('aria-describedby', tip.getAttribute('id'));
      const {
        container
      } = this._config;
      if (!this._element.ownerDocument.documentElement.contains(this.tip)) {
        container.append(tip);
        EventHandler.trigger(this._element, this.constructor.eventName(EVENT_INSERTED));
      }
      this._popper = this._createPopper(tip);
      tip.classList.add(CLASS_NAME_SHOW$2);

      // If this is a touch-enabled device we add extra
      // empty mouseover listeners to the body's immediate children;
      // only needed because of broken event delegation on iOS
      // https://www.quirksmode.org/blog/archives/2014/02/mouse_event_bub.html
      if ('ontouchstart' in document.documentElement) {
        for (const element of [].concat(...document.body.children)) {
          EventHandler.on(element, 'mouseover', noop);
        }
      }
      const complete = () => {
        EventHandler.trigger(this._element, this.constructor.eventName(EVENT_SHOWN$2));
        if (this._isHovered === false) {
          this._leave();
        }
        this._isHovered = false;
      };
      this._queueCallback(complete, this.tip, this._isAnimated());
    }
    hide() {
      if (!this._isShown()) {
        return;
      }
      const hideEvent = EventHandler.trigger(this._element, this.constructor.eventName(EVENT_HIDE$2));
      if (hideEvent.defaultPrevented) {
        return;
      }
      const tip = this._getTipElement();
      tip.classList.remove(CLASS_NAME_SHOW$2);

      // If this is a touch-enabled device we remove the extra
      // empty mouseover listeners we added for iOS support
      if ('ontouchstart' in document.documentElement) {
        for (const element of [].concat(...document.body.children)) {
          EventHandler.off(element, 'mouseover', noop);
        }
      }
      this._activeTrigger[TRIGGER_CLICK] = false;
      this._activeTrigger[TRIGGER_FOCUS] = false;
      this._activeTrigger[TRIGGER_HOVER] = false;
      this._isHovered = null; // it is a trick to support manual triggering

      const complete = () => {
        if (this._isWithActiveTrigger()) {
          return;
        }
        if (!this._isHovered) {
          this._disposePopper();
        }
        this._element.removeAttribute('aria-describedby');
        EventHandler.trigger(this._element, this.constructor.eventName(EVENT_HIDDEN$2));
      };
      this._queueCallback(complete, this.tip, this._isAnimated());
    }
    update() {
      if (this._popper) {
        this._popper.update();
      }
    }

    // Protected
    _isWithContent() {
      return Boolean(this._getTitle());
    }
    _getTipElement() {
      if (!this.tip) {
        this.tip = this._createTipElement(this._newContent || this._getContentForTemplate());
      }
      return this.tip;
    }
    _createTipElement(content) {
      const tip = this._getTemplateFactory(content).toHtml();

      // TODO: remove this check in v6
      if (!tip) {
        return null;
      }
      tip.classList.remove(CLASS_NAME_FADE$2, CLASS_NAME_SHOW$2);
      // TODO: v6 the following can be achieved with CSS only
      tip.classList.add(`bs-${this.constructor.NAME}-auto`);
      const tipId = getUID(this.constructor.NAME).toString();
      tip.setAttribute('id', tipId);
      if (this._isAnimated()) {
        tip.classList.add(CLASS_NAME_FADE$2);
      }
      return tip;
    }
    setContent(content) {
      this._newContent = content;
      if (this._isShown()) {
        this._disposePopper();
        this.show();
      }
    }
    _getTemplateFactory(content) {
      if (this._templateFactory) {
        this._templateFactory.changeContent(content);
      } else {
        this._templateFactory = new TemplateFactory({
          ...this._config,
          // the `content` var has to be after `this._config`
          // to override config.content in case of popover
          content,
          extraClass: this._resolvePossibleFunction(this._config.customClass)
        });
      }
      return this._templateFactory;
    }
    _getContentForTemplate() {
      return {
        [SELECTOR_TOOLTIP_INNER]: this._getTitle()
      };
    }
    _getTitle() {
      return this._resolvePossibleFunction(this._config.title) || this._element.getAttribute('data-bs-original-title');
    }

    // Private
    _initializeOnDelegatedTarget(event) {
      return this.constructor.getOrCreateInstance(event.delegateTarget, this._getDelegateConfig());
    }
    _isAnimated() {
      return this._config.animation || this.tip && this.tip.classList.contains(CLASS_NAME_FADE$2);
    }
    _isShown() {
      return this.tip && this.tip.classList.contains(CLASS_NAME_SHOW$2);
    }
    _createPopper(tip) {
      const placement = execute(this._config.placement, [this, tip, this._element]);
      const attachment = AttachmentMap[placement.toUpperCase()];
      return Popper__namespace.createPopper(this._element, tip, this._getPopperConfig(attachment));
    }
    _getOffset() {
      const {
        offset
      } = this._config;
      if (typeof offset === 'string') {
        return offset.split(',').map(value => Number.parseInt(value, 10));
      }
      if (typeof offset === 'function') {
        return popperData => offset(popperData, this._element);
      }
      return offset;
    }
    _resolvePossibleFunction(arg) {
      return execute(arg, [this._element]);
    }
    _getPopperConfig(attachment) {
      const defaultBsPopperConfig = {
        placement: attachment,
        modifiers: [{
          name: 'flip',
          options: {
            fallbackPlacements: this._config.fallbackPlacements
          }
        }, {
          name: 'offset',
          options: {
            offset: this._getOffset()
          }
        }, {
          name: 'preventOverflow',
          options: {
            boundary: this._config.boundary
          }
        }, {
          name: 'arrow',
          options: {
            element: `.${this.constructor.NAME}-arrow`
          }
        }, {
          name: 'preSetPlacement',
          enabled: true,
          phase: 'beforeMain',
          fn: data => {
            // Pre-set Popper's placement attribute in order to read the arrow sizes properly.
            // Otherwise, Popper mixes up the width and height dimensions since the initial arrow style is for top placement
            this._getTipElement().setAttribute('data-popper-placement', data.state.placement);
          }
        }]
      };
      return {
        ...defaultBsPopperConfig,
        ...execute(this._config.popperConfig, [defaultBsPopperConfig])
      };
    }
    _setListeners() {
      const triggers = this._config.trigger.split(' ');
      for (const trigger of triggers) {
        if (trigger === 'click') {
          EventHandler.on(this._element, this.constructor.eventName(EVENT_CLICK$1), this._config.selector, event => {
            const context = this._initializeOnDelegatedTarget(event);
            context.toggle();
          });
        } else if (trigger !== TRIGGER_MANUAL) {
          const eventIn = trigger === TRIGGER_HOVER ? this.constructor.eventName(EVENT_MOUSEENTER) : this.constructor.eventName(EVENT_FOCUSIN$1);
          const eventOut = trigger === TRIGGER_HOVER ? this.constructor.eventName(EVENT_MOUSELEAVE) : this.constructor.eventName(EVENT_FOCUSOUT$1);
          EventHandler.on(this._element, eventIn, this._config.selector, event => {
            const context = this._initializeOnDelegatedTarget(event);
            context._activeTrigger[event.type === 'focusin' ? TRIGGER_FOCUS : TRIGGER_HOVER] = true;
            context._enter();
          });
          EventHandler.on(this._element, eventOut, this._config.selector, event => {
            const context = this._initializeOnDelegatedTarget(event);
            context._activeTrigger[event.type === 'focusout' ? TRIGGER_FOCUS : TRIGGER_HOVER] = context._element.contains(event.relatedTarget);
            context._leave();
          });
        }
      }
      this._hideModalHandler = () => {
        if (this._element) {
          this.hide();
        }
      };
      EventHandler.on(this._element.closest(SELECTOR_MODAL), EVENT_MODAL_HIDE, this._hideModalHandler);
    }
    _fixTitle() {
      const title = this._element.getAttribute('title');
      if (!title) {
        return;
      }
      if (!this._element.getAttribute('aria-label') && !this._element.textContent.trim()) {
        this._element.setAttribute('aria-label', title);
      }
      this._element.setAttribute('data-bs-original-title', title); // DO NOT USE IT. Is only for backwards compatibility
      this._element.removeAttribute('title');
    }
    _enter() {
      if (this._isShown() || this._isHovered) {
        this._isHovered = true;
        return;
      }
      this._isHovered = true;
      this._setTimeout(() => {
        if (this._isHovered) {
          this.show();
        }
      }, this._config.delay.show);
    }
    _leave() {
      if (this._isWithActiveTrigger()) {
        return;
      }
      this._isHovered = false;
      this._setTimeout(() => {
        if (!this._isHovered) {
          this.hide();
        }
      }, this._config.delay.hide);
    }
    _setTimeout(handler, timeout) {
      clearTimeout(this._timeout);
      this._timeout = setTimeout(handler, timeout);
    }
    _isWithActiveTrigger() {
      return Object.values(this._activeTrigger).includes(true);
    }
    _getConfig(config) {
      const dataAttributes = Manipulator.getDataAttributes(this._element);
      for (const dataAttribute of Object.keys(dataAttributes)) {
        if (DISALLOWED_ATTRIBUTES.has(dataAttribute)) {
          delete dataAttributes[dataAttribute];
        }
      }
      config = {
        ...dataAttributes,
        ...(typeof config === 'object' && config ? config : {})
      };
      config = this._mergeConfigObj(config);
      config = this._configAfterMerge(config);
      this._typeCheckConfig(config);
      return config;
    }
    _configAfterMerge(config) {
      config.container = config.container === false ? document.body : getElement(config.container);
      if (typeof config.delay === 'number') {
        config.delay = {
          show: config.delay,
          hide: config.delay
        };
      }
      if (typeof config.title === 'number') {
        config.title = config.title.toString();
      }
      if (typeof config.content === 'number') {
        config.content = config.content.toString();
      }
      return config;
    }
    _getDelegateConfig() {
      const config = {};
      for (const [key, value] of Object.entries(this._config)) {
        if (this.constructor.Default[key] !== value) {
          config[key] = value;
        }
      }
      config.selector = false;
      config.trigger = 'manual';

      // In the future can be replaced with:
      // const keysWithDifferentValues = Object.entries(this._config).filter(entry => this.constructor.Default[entry[0]] !== this._config[entry[0]])
      // `Object.fromEntries(keysWithDifferentValues)`
      return config;
    }
    _disposePopper() {
      if (this._popper) {
        this._popper.destroy();
        this._popper = null;
      }
      if (this.tip) {
        this.tip.remove();
        this.tip = null;
      }
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Tooltip.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (typeof data[config] === 'undefined') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config]();
      });
    }
  }

  /**
   * jQuery
   */

  defineJQueryPlugin(Tooltip);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap popover.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$3 = 'popover';
  const SELECTOR_TITLE = '.popover-header';
  const SELECTOR_CONTENT = '.popover-body';
  const Default$2 = {
    ...Tooltip.Default,
    content: '',
    offset: [0, 8],
    placement: 'right',
    template: '<div class="popover" role="tooltip">' + '<div class="popover-arrow"></div>' + '<h3 class="popover-header"></h3>' + '<div class="popover-body"></div>' + '</div>',
    trigger: 'click'
  };
  const DefaultType$2 = {
    ...Tooltip.DefaultType,
    content: '(null|string|element|function)'
  };

  /**
   * Class definition
   */

  class Popover extends Tooltip {
    // Getters
    static get Default() {
      return Default$2;
    }
    static get DefaultType() {
      return DefaultType$2;
    }
    static get NAME() {
      return NAME$3;
    }

    // Overrides
    _isWithContent() {
      return this._getTitle() || this._getContent();
    }

    // Private
    _getContentForTemplate() {
      return {
        [SELECTOR_TITLE]: this._getTitle(),
        [SELECTOR_CONTENT]: this._getContent()
      };
    }
    _getContent() {
      return this._resolvePossibleFunction(this._config.content);
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Popover.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (typeof data[config] === 'undefined') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config]();
      });
    }
  }

  /**
   * jQuery
   */

  defineJQueryPlugin(Popover);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap scrollspy.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$2 = 'scrollspy';
  const DATA_KEY$2 = 'bs.scrollspy';
  const EVENT_KEY$2 = `.${DATA_KEY$2}`;
  const DATA_API_KEY = '.data-api';
  const EVENT_ACTIVATE = `activate${EVENT_KEY$2}`;
  const EVENT_CLICK = `click${EVENT_KEY$2}`;
  const EVENT_LOAD_DATA_API$1 = `load${EVENT_KEY$2}${DATA_API_KEY}`;
  const CLASS_NAME_DROPDOWN_ITEM = 'dropdown-item';
  const CLASS_NAME_ACTIVE$1 = 'active';
  const SELECTOR_DATA_SPY = '[data-bs-spy="scroll"]';
  const SELECTOR_TARGET_LINKS = '[href]';
  const SELECTOR_NAV_LIST_GROUP = '.nav, .list-group';
  const SELECTOR_NAV_LINKS = '.nav-link';
  const SELECTOR_NAV_ITEMS = '.nav-item';
  const SELECTOR_LIST_ITEMS = '.list-group-item';
  const SELECTOR_LINK_ITEMS = `${SELECTOR_NAV_LINKS}, ${SELECTOR_NAV_ITEMS} > ${SELECTOR_NAV_LINKS}, ${SELECTOR_LIST_ITEMS}`;
  const SELECTOR_DROPDOWN = '.dropdown';
  const SELECTOR_DROPDOWN_TOGGLE$1 = '.dropdown-toggle';
  const Default$1 = {
    offset: null,
    // TODO: v6 @deprecated, keep it for backwards compatibility reasons
    rootMargin: '0px 0px -25%',
    smoothScroll: false,
    target: null,
    threshold: [0.1, 0.5, 1]
  };
  const DefaultType$1 = {
    offset: '(number|null)',
    // TODO v6 @deprecated, keep it for backwards compatibility reasons
    rootMargin: 'string',
    smoothScroll: 'boolean',
    target: 'element',
    threshold: 'array'
  };

  /**
   * Class definition
   */

  class ScrollSpy extends BaseComponent {
    constructor(element, config) {
      super(element, config);

      // this._element is the observablesContainer and config.target the menu links wrapper
      this._targetLinks = new Map();
      this._observableSections = new Map();
      this._rootElement = getComputedStyle(this._element).overflowY === 'visible' ? null : this._element;
      this._activeTarget = null;
      this._observer = null;
      this._previousScrollData = {
        visibleEntryTop: 0,
        parentScrollTop: 0
      };
      this.refresh(); // initialize
    }

    // Getters
    static get Default() {
      return Default$1;
    }
    static get DefaultType() {
      return DefaultType$1;
    }
    static get NAME() {
      return NAME$2;
    }

    // Public
    refresh() {
      this._initializeTargetsAndObservables();
      this._maybeEnableSmoothScroll();
      if (this._observer) {
        this._observer.disconnect();
      } else {
        this._observer = this._getNewObserver();
      }
      for (const section of this._observableSections.values()) {
        this._observer.observe(section);
      }
    }
    dispose() {
      this._observer.disconnect();
      super.dispose();
    }

    // Private
    _configAfterMerge(config) {
      // TODO: on v6 target should be given explicitly & remove the {target: 'ss-target'} case
      config.target = getElement(config.target) || document.body;

      // TODO: v6 Only for backwards compatibility reasons. Use rootMargin only
      config.rootMargin = config.offset ? `${config.offset}px 0px -30%` : config.rootMargin;
      if (typeof config.threshold === 'string') {
        config.threshold = config.threshold.split(',').map(value => Number.parseFloat(value));
      }
      return config;
    }
    _maybeEnableSmoothScroll() {
      if (!this._config.smoothScroll) {
        return;
      }

      // unregister any previous listeners
      EventHandler.off(this._config.target, EVENT_CLICK);
      EventHandler.on(this._config.target, EVENT_CLICK, SELECTOR_TARGET_LINKS, event => {
        const observableSection = this._observableSections.get(event.target.hash);
        if (observableSection) {
          event.preventDefault();
          const root = this._rootElement || window;
          const height = observableSection.offsetTop - this._element.offsetTop;
          if (root.scrollTo) {
            root.scrollTo({
              top: height,
              behavior: 'smooth'
            });
            return;
          }

          // Chrome 60 doesn't support `scrollTo`
          root.scrollTop = height;
        }
      });
    }
    _getNewObserver() {
      const options = {
        root: this._rootElement,
        threshold: this._config.threshold,
        rootMargin: this._config.rootMargin
      };
      return new IntersectionObserver(entries => this._observerCallback(entries), options);
    }

    // The logic of selection
    _observerCallback(entries) {
      const targetElement = entry => this._targetLinks.get(`#${entry.target.id}`);
      const activate = entry => {
        this._previousScrollData.visibleEntryTop = entry.target.offsetTop;
        this._process(targetElement(entry));
      };
      const parentScrollTop = (this._rootElement || document.documentElement).scrollTop;
      const userScrollsDown = parentScrollTop >= this._previousScrollData.parentScrollTop;
      this._previousScrollData.parentScrollTop = parentScrollTop;
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          this._activeTarget = null;
          this._clearActiveClass(targetElement(entry));
          continue;
        }
        const entryIsLowerThanPrevious = entry.target.offsetTop >= this._previousScrollData.visibleEntryTop;
        // if we are scrolling down, pick the bigger offsetTop
        if (userScrollsDown && entryIsLowerThanPrevious) {
          activate(entry);
          // if parent isn't scrolled, let's keep the first visible item, breaking the iteration
          if (!parentScrollTop) {
            return;
          }
          continue;
        }

        // if we are scrolling up, pick the smallest offsetTop
        if (!userScrollsDown && !entryIsLowerThanPrevious) {
          activate(entry);
        }
      }
    }
    _initializeTargetsAndObservables() {
      this._targetLinks = new Map();
      this._observableSections = new Map();
      const targetLinks = SelectorEngine.find(SELECTOR_TARGET_LINKS, this._config.target);
      for (const anchor of targetLinks) {
        // ensure that the anchor has an id and is not disabled
        if (!anchor.hash || isDisabled(anchor)) {
          continue;
        }
        const observableSection = SelectorEngine.findOne(decodeURI(anchor.hash), this._element);

        // ensure that the observableSection exists & is visible
        if (isVisible(observableSection)) {
          this._targetLinks.set(decodeURI(anchor.hash), anchor);
          this._observableSections.set(anchor.hash, observableSection);
        }
      }
    }
    _process(target) {
      if (this._activeTarget === target) {
        return;
      }
      this._clearActiveClass(this._config.target);
      this._activeTarget = target;
      target.classList.add(CLASS_NAME_ACTIVE$1);
      this._activateParents(target);
      EventHandler.trigger(this._element, EVENT_ACTIVATE, {
        relatedTarget: target
      });
    }
    _activateParents(target) {
      // Activate dropdown parents
      if (target.classList.contains(CLASS_NAME_DROPDOWN_ITEM)) {
        SelectorEngine.findOne(SELECTOR_DROPDOWN_TOGGLE$1, target.closest(SELECTOR_DROPDOWN)).classList.add(CLASS_NAME_ACTIVE$1);
        return;
      }
      for (const listGroup of SelectorEngine.parents(target, SELECTOR_NAV_LIST_GROUP)) {
        // Set triggered links parents as active
        // With both <ul> and <nav> markup a parent is the previous sibling of any nav ancestor
        for (const item of SelectorEngine.prev(listGroup, SELECTOR_LINK_ITEMS)) {
          item.classList.add(CLASS_NAME_ACTIVE$1);
        }
      }
    }
    _clearActiveClass(parent) {
      parent.classList.remove(CLASS_NAME_ACTIVE$1);
      const activeNodes = SelectorEngine.find(`${SELECTOR_TARGET_LINKS}.${CLASS_NAME_ACTIVE$1}`, parent);
      for (const node of activeNodes) {
        node.classList.remove(CLASS_NAME_ACTIVE$1);
      }
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = ScrollSpy.getOrCreateInstance(this, config);
        if (typeof config !== 'string') {
          return;
        }
        if (data[config] === undefined || config.startsWith('_') || config === 'constructor') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config]();
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(window, EVENT_LOAD_DATA_API$1, () => {
    for (const spy of SelectorEngine.find(SELECTOR_DATA_SPY)) {
      ScrollSpy.getOrCreateInstance(spy);
    }
  });

  /**
   * jQuery
   */

  defineJQueryPlugin(ScrollSpy);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap tab.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME$1 = 'tab';
  const DATA_KEY$1 = 'bs.tab';
  const EVENT_KEY$1 = `.${DATA_KEY$1}`;
  const EVENT_HIDE$1 = `hide${EVENT_KEY$1}`;
  const EVENT_HIDDEN$1 = `hidden${EVENT_KEY$1}`;
  const EVENT_SHOW$1 = `show${EVENT_KEY$1}`;
  const EVENT_SHOWN$1 = `shown${EVENT_KEY$1}`;
  const EVENT_CLICK_DATA_API = `click${EVENT_KEY$1}`;
  const EVENT_KEYDOWN = `keydown${EVENT_KEY$1}`;
  const EVENT_LOAD_DATA_API = `load${EVENT_KEY$1}`;
  const ARROW_LEFT_KEY = 'ArrowLeft';
  const ARROW_RIGHT_KEY = 'ArrowRight';
  const ARROW_UP_KEY = 'ArrowUp';
  const ARROW_DOWN_KEY = 'ArrowDown';
  const HOME_KEY = 'Home';
  const END_KEY = 'End';
  const CLASS_NAME_ACTIVE = 'active';
  const CLASS_NAME_FADE$1 = 'fade';
  const CLASS_NAME_SHOW$1 = 'show';
  const CLASS_DROPDOWN = 'dropdown';
  const SELECTOR_DROPDOWN_TOGGLE = '.dropdown-toggle';
  const SELECTOR_DROPDOWN_MENU = '.dropdown-menu';
  const NOT_SELECTOR_DROPDOWN_TOGGLE = `:not(${SELECTOR_DROPDOWN_TOGGLE})`;
  const SELECTOR_TAB_PANEL = '.list-group, .nav, [role="tablist"]';
  const SELECTOR_OUTER = '.nav-item, .list-group-item';
  const SELECTOR_INNER = `.nav-link${NOT_SELECTOR_DROPDOWN_TOGGLE}, .list-group-item${NOT_SELECTOR_DROPDOWN_TOGGLE}, [role="tab"]${NOT_SELECTOR_DROPDOWN_TOGGLE}`;
  const SELECTOR_DATA_TOGGLE = '[data-bs-toggle="tab"], [data-bs-toggle="pill"], [data-bs-toggle="list"]'; // TODO: could only be `tab` in v6
  const SELECTOR_INNER_ELEM = `${SELECTOR_INNER}, ${SELECTOR_DATA_TOGGLE}`;
  const SELECTOR_DATA_TOGGLE_ACTIVE = `.${CLASS_NAME_ACTIVE}[data-bs-toggle="tab"], .${CLASS_NAME_ACTIVE}[data-bs-toggle="pill"], .${CLASS_NAME_ACTIVE}[data-bs-toggle="list"]`;

  /**
   * Class definition
   */

  class Tab extends BaseComponent {
    constructor(element) {
      super(element);
      this._parent = this._element.closest(SELECTOR_TAB_PANEL);
      if (!this._parent) {
        return;
        // TODO: should throw exception in v6
        // throw new TypeError(`${element.outerHTML} has not a valid parent ${SELECTOR_INNER_ELEM}`)
      }

      // Set up initial aria attributes
      this._setInitialAttributes(this._parent, this._getChildren());
      EventHandler.on(this._element, EVENT_KEYDOWN, event => this._keydown(event));
    }

    // Getters
    static get NAME() {
      return NAME$1;
    }

    // Public
    show() {
      // Shows this elem and deactivate the active sibling if exists
      const innerElem = this._element;
      if (this._elemIsActive(innerElem)) {
        return;
      }

      // Search for active tab on same parent to deactivate it
      const active = this._getActiveElem();
      const hideEvent = active ? EventHandler.trigger(active, EVENT_HIDE$1, {
        relatedTarget: innerElem
      }) : null;
      const showEvent = EventHandler.trigger(innerElem, EVENT_SHOW$1, {
        relatedTarget: active
      });
      if (showEvent.defaultPrevented || hideEvent && hideEvent.defaultPrevented) {
        return;
      }
      this._deactivate(active, innerElem);
      this._activate(innerElem, active);
    }

    // Private
    _activate(element, relatedElem) {
      if (!element) {
        return;
      }
      element.classList.add(CLASS_NAME_ACTIVE);
      this._activate(SelectorEngine.getElementFromSelector(element)); // Search and activate/show the proper section

      const complete = () => {
        if (element.getAttribute('role') !== 'tab') {
          element.classList.add(CLASS_NAME_SHOW$1);
          return;
        }
        element.removeAttribute('tabindex');
        element.setAttribute('aria-selected', true);
        this._toggleDropDown(element, true);
        EventHandler.trigger(element, EVENT_SHOWN$1, {
          relatedTarget: relatedElem
        });
      };
      this._queueCallback(complete, element, element.classList.contains(CLASS_NAME_FADE$1));
    }
    _deactivate(element, relatedElem) {
      if (!element) {
        return;
      }
      element.classList.remove(CLASS_NAME_ACTIVE);
      element.blur();
      this._deactivate(SelectorEngine.getElementFromSelector(element)); // Search and deactivate the shown section too

      const complete = () => {
        if (element.getAttribute('role') !== 'tab') {
          element.classList.remove(CLASS_NAME_SHOW$1);
          return;
        }
        element.setAttribute('aria-selected', false);
        element.setAttribute('tabindex', '-1');
        this._toggleDropDown(element, false);
        EventHandler.trigger(element, EVENT_HIDDEN$1, {
          relatedTarget: relatedElem
        });
      };
      this._queueCallback(complete, element, element.classList.contains(CLASS_NAME_FADE$1));
    }
    _keydown(event) {
      if (![ARROW_LEFT_KEY, ARROW_RIGHT_KEY, ARROW_UP_KEY, ARROW_DOWN_KEY, HOME_KEY, END_KEY].includes(event.key)) {
        return;
      }
      event.stopPropagation(); // stopPropagation/preventDefault both added to support up/down keys without scrolling the page
      event.preventDefault();
      const children = this._getChildren().filter(element => !isDisabled(element));
      let nextActiveElement;
      if ([HOME_KEY, END_KEY].includes(event.key)) {
        nextActiveElement = children[event.key === HOME_KEY ? 0 : children.length - 1];
      } else {
        const isNext = [ARROW_RIGHT_KEY, ARROW_DOWN_KEY].includes(event.key);
        nextActiveElement = getNextActiveElement(children, event.target, isNext, true);
      }
      if (nextActiveElement) {
        nextActiveElement.focus({
          preventScroll: true
        });
        Tab.getOrCreateInstance(nextActiveElement).show();
      }
    }
    _getChildren() {
      // collection of inner elements
      return SelectorEngine.find(SELECTOR_INNER_ELEM, this._parent);
    }
    _getActiveElem() {
      return this._getChildren().find(child => this._elemIsActive(child)) || null;
    }
    _setInitialAttributes(parent, children) {
      this._setAttributeIfNotExists(parent, 'role', 'tablist');
      for (const child of children) {
        this._setInitialAttributesOnChild(child);
      }
    }
    _setInitialAttributesOnChild(child) {
      child = this._getInnerElement(child);
      const isActive = this._elemIsActive(child);
      const outerElem = this._getOuterElement(child);
      child.setAttribute('aria-selected', isActive);
      if (outerElem !== child) {
        this._setAttributeIfNotExists(outerElem, 'role', 'presentation');
      }
      if (!isActive) {
        child.setAttribute('tabindex', '-1');
      }
      this._setAttributeIfNotExists(child, 'role', 'tab');

      // set attributes to the related panel too
      this._setInitialAttributesOnTargetPanel(child);
    }
    _setInitialAttributesOnTargetPanel(child) {
      const target = SelectorEngine.getElementFromSelector(child);
      if (!target) {
        return;
      }
      this._setAttributeIfNotExists(target, 'role', 'tabpanel');
      if (child.id) {
        this._setAttributeIfNotExists(target, 'aria-labelledby', `${child.id}`);
      }
    }
    _toggleDropDown(element, open) {
      const outerElem = this._getOuterElement(element);
      if (!outerElem.classList.contains(CLASS_DROPDOWN)) {
        return;
      }
      const toggle = (selector, className) => {
        const element = SelectorEngine.findOne(selector, outerElem);
        if (element) {
          element.classList.toggle(className, open);
        }
      };
      toggle(SELECTOR_DROPDOWN_TOGGLE, CLASS_NAME_ACTIVE);
      toggle(SELECTOR_DROPDOWN_MENU, CLASS_NAME_SHOW$1);
      outerElem.setAttribute('aria-expanded', open);
    }
    _setAttributeIfNotExists(element, attribute, value) {
      if (!element.hasAttribute(attribute)) {
        element.setAttribute(attribute, value);
      }
    }
    _elemIsActive(elem) {
      return elem.classList.contains(CLASS_NAME_ACTIVE);
    }

    // Try to get the inner element (usually the .nav-link)
    _getInnerElement(elem) {
      return elem.matches(SELECTOR_INNER_ELEM) ? elem : SelectorEngine.findOne(SELECTOR_INNER_ELEM, elem);
    }

    // Try to get the outer element (usually the .nav-item)
    _getOuterElement(elem) {
      return elem.closest(SELECTOR_OUTER) || elem;
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Tab.getOrCreateInstance(this);
        if (typeof config !== 'string') {
          return;
        }
        if (data[config] === undefined || config.startsWith('_') || config === 'constructor') {
          throw new TypeError(`No method named "${config}"`);
        }
        data[config]();
      });
    }
  }

  /**
   * Data API implementation
   */

  EventHandler.on(document, EVENT_CLICK_DATA_API, SELECTOR_DATA_TOGGLE, function (event) {
    if (['A', 'AREA'].includes(this.tagName)) {
      event.preventDefault();
    }
    if (isDisabled(this)) {
      return;
    }
    Tab.getOrCreateInstance(this).show();
  });

  /**
   * Initialize on focus
   */
  EventHandler.on(window, EVENT_LOAD_DATA_API, () => {
    for (const element of SelectorEngine.find(SELECTOR_DATA_TOGGLE_ACTIVE)) {
      Tab.getOrCreateInstance(element);
    }
  });
  /**
   * jQuery
   */

  defineJQueryPlugin(Tab);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap toast.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */


  /**
   * Constants
   */

  const NAME = 'toast';
  const DATA_KEY = 'bs.toast';
  const EVENT_KEY = `.${DATA_KEY}`;
  const EVENT_MOUSEOVER = `mouseover${EVENT_KEY}`;
  const EVENT_MOUSEOUT = `mouseout${EVENT_KEY}`;
  const EVENT_FOCUSIN = `focusin${EVENT_KEY}`;
  const EVENT_FOCUSOUT = `focusout${EVENT_KEY}`;
  const EVENT_HIDE = `hide${EVENT_KEY}`;
  const EVENT_HIDDEN = `hidden${EVENT_KEY}`;
  const EVENT_SHOW = `show${EVENT_KEY}`;
  const EVENT_SHOWN = `shown${EVENT_KEY}`;
  const CLASS_NAME_FADE = 'fade';
  const CLASS_NAME_HIDE = 'hide'; // @deprecated - kept here only for backwards compatibility
  const CLASS_NAME_SHOW = 'show';
  const CLASS_NAME_SHOWING = 'showing';
  const DefaultType = {
    animation: 'boolean',
    autohide: 'boolean',
    delay: 'number'
  };
  const Default = {
    animation: true,
    autohide: true,
    delay: 5000
  };

  /**
   * Class definition
   */

  class Toast extends BaseComponent {
    constructor(element, config) {
      super(element, config);
      this._timeout = null;
      this._hasMouseInteraction = false;
      this._hasKeyboardInteraction = false;
      this._setListeners();
    }

    // Getters
    static get Default() {
      return Default;
    }
    static get DefaultType() {
      return DefaultType;
    }
    static get NAME() {
      return NAME;
    }

    // Public
    show() {
      const showEvent = EventHandler.trigger(this._element, EVENT_SHOW);
      if (showEvent.defaultPrevented) {
        return;
      }
      this._clearTimeout();
      if (this._config.animation) {
        this._element.classList.add(CLASS_NAME_FADE);
      }
      const complete = () => {
        this._element.classList.remove(CLASS_NAME_SHOWING);
        EventHandler.trigger(this._element, EVENT_SHOWN);
        this._maybeScheduleHide();
      };
      this._element.classList.remove(CLASS_NAME_HIDE); // @deprecated
      reflow(this._element);
      this._element.classList.add(CLASS_NAME_SHOW, CLASS_NAME_SHOWING);
      this._queueCallback(complete, this._element, this._config.animation);
    }
    hide() {
      if (!this.isShown()) {
        return;
      }
      const hideEvent = EventHandler.trigger(this._element, EVENT_HIDE);
      if (hideEvent.defaultPrevented) {
        return;
      }
      const complete = () => {
        this._element.classList.add(CLASS_NAME_HIDE); // @deprecated
        this._element.classList.remove(CLASS_NAME_SHOWING, CLASS_NAME_SHOW);
        EventHandler.trigger(this._element, EVENT_HIDDEN);
      };
      this._element.classList.add(CLASS_NAME_SHOWING);
      this._queueCallback(complete, this._element, this._config.animation);
    }
    dispose() {
      this._clearTimeout();
      if (this.isShown()) {
        this._element.classList.remove(CLASS_NAME_SHOW);
      }
      super.dispose();
    }
    isShown() {
      return this._element.classList.contains(CLASS_NAME_SHOW);
    }

    // Private

    _maybeScheduleHide() {
      if (!this._config.autohide) {
        return;
      }
      if (this._hasMouseInteraction || this._hasKeyboardInteraction) {
        return;
      }
      this._timeout = setTimeout(() => {
        this.hide();
      }, this._config.delay);
    }
    _onInteraction(event, isInteracting) {
      switch (event.type) {
        case 'mouseover':
        case 'mouseout':
          {
            this._hasMouseInteraction = isInteracting;
            break;
          }
        case 'focusin':
        case 'focusout':
          {
            this._hasKeyboardInteraction = isInteracting;
            break;
          }
      }
      if (isInteracting) {
        this._clearTimeout();
        return;
      }
      const nextElement = event.relatedTarget;
      if (this._element === nextElement || this._element.contains(nextElement)) {
        return;
      }
      this._maybeScheduleHide();
    }
    _setListeners() {
      EventHandler.on(this._element, EVENT_MOUSEOVER, event => this._onInteraction(event, true));
      EventHandler.on(this._element, EVENT_MOUSEOUT, event => this._onInteraction(event, false));
      EventHandler.on(this._element, EVENT_FOCUSIN, event => this._onInteraction(event, true));
      EventHandler.on(this._element, EVENT_FOCUSOUT, event => this._onInteraction(event, false));
    }
    _clearTimeout() {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    // Static
    static jQueryInterface(config) {
      return this.each(function () {
        const data = Toast.getOrCreateInstance(this, config);
        if (typeof config === 'string') {
          if (typeof data[config] === 'undefined') {
            throw new TypeError(`No method named "${config}"`);
          }
          data[config](this);
        }
      });
    }
  }

  /**
   * Data API implementation
   */

  enableDismissTrigger(Toast);

  /**
   * jQuery
   */

  defineJQueryPlugin(Toast);

  /**
   * --------------------------------------------------------------------------
   * Bootstrap index.umd.js
   * Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE)
   * --------------------------------------------------------------------------
   */

  const index_umd = {
    Alert,
    Button,
    Carousel,
    Collapse,
    Dropdown,
    Modal,
    Offcanvas,
    Popover,
    ScrollSpy,
    Tab,
    Toast,
    Tooltip
  };

  return index_umd;

}));
//# sourceMappingURL=bootstrap.js.map
/*!
 * Modified by vlad, more options, no jQuery
 *
 *
 * Popup dialog boxes for Bootstrap - https://github.com/rigon/bootpopup
 * Copyright (C) 2016  rigon<ricardompgoncalves@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

function bootpopup(...args)
{
    const app = window.app;

    const inputs = [
        "text", "color", "url", "password", "hidden", "file", "number",
        "email", "reset", "date", "time", "checkbox", "radio", "datetime-local",
        "week", "tel", "search", "range", "month", "image", "button"
    ];

    // Create a new instance if this is not
    if (!(this instanceof bootpopup)) return new bootpopup(...args);

    const self = this;

    // Create a global random ID for the form
    this.formid = "bpf" + String(Math.random()).substr(2);

    this.options = {
        id: "",
        self: self,
        title: document.title,
        debug: false,
        show_close: true,
        show_header: true,
        show_footer: true,
        size: "normal",
        size_label: "col-sm-4",
        size_input: "col-sm-8",
        content: [],
        footer: [],
        onsubmit: "close",
        buttons: ["close"],
        attrs_modal: null,
        class_h: "",
        class_modal: "modal fade",
        class_dialog: "modal-dialog",
        class_title: "modal-title",
        class_content: "modal-content",
        class_body: "modal-body",
        class_header: "modal-header",
        class_footer: "modal-footer",
        class_footer_block: "modal-footer d-block text-end",
        class_group: "mb-3",
        class_options: "options flex-grow-1 text-start",
        class_alert: "alert alert-danger fade show",
        class_info: "alert alert-info fade show",
        class_form: "",
        class_label: "",
        class_row: "",
        class_col: "",
        class_suffix: "form-text text-muted text-end",
        class_buttons: "btn",
        class_button: "btn-outline-secondary",
        class_submit: "btn-primary",
        class_ok: "btn-primary",
        class_yes: "btn-primary",
        class_no: "btn-secondary",
        class_help: "btn-outline-secondary",
        class_agree: "btn-primary",
        class_cancel: "text-muted",
        class_close: "text-muted",
        class_button1: "btn-outline-secondary",
        class_button2: "btn-outline-secondary",

        class_tabs: "nav nav-tabs mb-4",
        class_tablink: "nav-link",
        class_tabcontent: "tab-content",
        class_input_button: "btn btn-outline-secondary",
        class_list_button: "btn btn-outline-secondary dropdown-toggle",
        class_input_menu: "dropdown-menu bg-light",
        list_input_mh: "25vh",
        text_ok: "OK",
        text_yes: "Yes",
        text_no: "No",
        text_help: "Help",
        text_agree: "Agree",
        text_cancel: "Cancel",
        text_close: "Close",
        center: false,
        scroll: false,
        horizontal: true,
        alert: false,
        info: false,
        backdrop: true,
        keyboard: true,
        autofocus: true,
        empty: false,
        xscope: "",
        xdata: "",
        data: "",
        tabs: "",
        tab: "",
        sanitizer: null,
        inputs: ["input", "textarea", "select"],

        before: function() {},
        dismiss: function() {},
        close: function() {},
        ok: function() {},
        cancel: function() {},
        yes: function() {},
        no: function() {},
        agree: function() {},
        help: function() {},
        button1: function() {},
        button2: function() {},
        show: function() {},
        shown: function() {},
        showtab: function() {},
        complete: function() {},
        submit: function(e) {
            self.callback(self.options.onsubmit, e);
            e.preventDefault();
        },
    }

    this.create = function() {
        var controller = new AbortController();
        var eventOpts = { signal: controller.signal };

        // Option for modal dialog size
        var class_dialog = this.options.class_dialog;
        if (this.options.size == "xlarge") class_dialog += " modal-xl";
        if (this.options.size == "large") class_dialog += " modal-lg";
        if (this.options.size == "small") class_dialog += " modal-sm";
        if (this.options.size == "fullscreen") class_dialog += " modal-fullscreen";
        if (this.options.center) class_dialog += " modal-dialog-centered";
        if (this.options.scroll) class_dialog += " modal-dialog-scrollable";

        // Create HTML elements for modal dialog
        var opts = { class: this.options.class_modal, id: this.options.id || "", tabindex: "-1", "aria-labelledby": "a" + this.formid, "aria-hidden": true };
        if (this.options.backdrop !== true) opts["data-bs-backdrop"] = typeof this.options.backdrop == "string" ? this.options.backdrop : false;
        if (!this.options.keyboard) opts["data-bs-keyboard"] = false;
        for (const p in this.options.attrs_modal) opts[p] = this.options.attrs_modal[p];

        this.modal = app.$elem('div', opts, eventOpts);
        this.dialog = app.$elem('div', { class: class_dialog, role: "document" });
        this.content = app.$elem('div', { class: this.options.class_content + " " + this.options.class_h });
        this.dialog.append(this.content);
        this.modal.append(this.dialog);

        // Header
        if (this.options.show_header && this.options.title) {
            this.header = app.$elem('div', { class: this.options.class_header });
            const title = app.$elem('h5', { class: this.options.class_title, id: "a" + this.formid });
            title.append(...this.sanitize(this.options.title));
            this.header.append(title);

            if (this.options.show_close) {
                const close = app.$elem('button', { type: "button", class: "btn-close", "data-bs-dismiss": "modal", "aria-label": "Close" });
                this.header.append(close);
            }
            this.content.append(this.header);
        }

        // Body
        var class_form = this.options.class_form;
        if (!class_form && this.options.horizontal) class_form = "form-horizontal";
        this.body = app.$elem('div', { class: this.options.class_body });
        this.form = app.$elem("form", { id: this.formid, class: class_form, role: "form", submit: (e) => (self.options.submit(e)) });
        this.body.append(this.form);
        this.content.append(this.body);

        if (this.options.alert) {
            this.alert = app.$elem("div");
            this.form.append(this.alert);
        }
        if (this.options.info) {
            this.info = app.$elem("div");
            this.form.append(this.info);
        }

        var tabs = {}, toggle = /nav-pills/.test(this.options.class_tabs) ? "pill" : "tab";
        if (this.options.tabs) {
            this.tabs = app.$elem("div", { class: this.options.class_tabs, role: "tablist" });
            this.form.append(this.tabs);
            this.tabContent = app.$elem("div", { class: this.options.class_tabcontent });
            this.form.append(this.tabContent);

            for (const p in this.options.tabs) {
                // Skip tabs with no elements
                if (!this.options.content.some((o) => {
                    for (const k in o) {
                        for (const l in o[k]) {
                            if (l == "tab_id" && p == o[k][l]) return 1;
                        }
                    }
                    return 0
                })) continue;
                const active = this.options.tab ? this.options.tab == p : !Object.keys(tabs).length;
                const tid = this.formid + "-tab" + p;

                const a = app.$elem("a", {
                    class: this.options.class_tablink + (active ? " active" : ""),
                    "data-bs-toggle": toggle,
                    id: tid + "0",
                    href: "#" + tid,
                    role: "tab",
                    "aria-controls": tid,
                    "aria-selected": false,
                    "data-callback": p,
                    click: (event) => { self.options.showtab(event.target.dataset.callback, event) },
                    text: this.options.tabs[p],
                }, eventOpts);
                this.tabs.append(a);

                tabs[p] = app.$elem("div", {
                    class: "tab-pane fade" + (active ? " show active": ""),
                    id: tid,
                    role: "tabpanel", "aria-labelledby":
                    tid + "0"
                });
                this.tabContent.append(tabs[p]);
            }
        }

        var parent = this.form, children, attrs, label, elem, group, html;

        const addElement = (type) => {
            if (!this.options.inputs.includes(type)) {
                this.options.inputs.push(type);
            }
            if (opts.class_append || opts.text_append) {
                const span = app.$elem("span", { class: opts.class_append, text: opts.text_append });
                elem.append(span);
            }
            if (opts.list_input_button || opts.list_input_tags) {
                if (attrs.value && opts.list_input_tags) {
                    app.$attr(elem, 'value', app.strSplit(attrs.value).join(', '));
                }
                const group = app.$elem('div', { class: `input-group ${opts.class_input_group || ""}` });
                group.append(elem);
                elem = group;

                const button = app.$elem('button', {
                    class: opts.class_list_button || this.options.class_list_button,
                    type: "button",
                    'data-bs-toggle': "dropdown",
                    'aria-haspopup': "true",
                    'aria-expanded': "false",
                    text: opts.text_input_button,
                });
                elem.append(button);

                var menu = app.$elem('div', {
                    class: opts.class_input_menu || this.options.class_input_menu,
                    "-overflowY": "auto",
                    "-maxHeight": opts.list_input_mh || this.options.list_input_mh
                });
                elem.append(menu);

                var list = opts.list_input_button || opts.list_input_tags || [];
                for (const l of list) {
                    let n = l, v = this.escape(n);
                    if (typeof n == "object") v = this.escape(n.value), n = this.escape(n.name);
                    if (n == "-") {
                        menu.appendTo(app.$elem('div', { class: "dropdown-divider" }));
                    } else
                    if (opts.list_input_tags) {
                        const a = app.$elem('a', {
                            class: "dropdown-item " + (opts.class_list_input_item || ""),
                            role: "button",
                            'data-attrid': '#' + attrs.id,
                            click: (ev) => {
                                var el = app.$(ev.target.dataset.attrid);
                                el.value = app.toFlags("add", app.strSplit(el.value), ev.target.textContent).join(', ')
                            },
                            text: n
                        }, eventOpts);
                        menu.append(a);
                    } else {
                        const a = app.$elem('a', {
                            class: "dropdown-item " + (opts.class_list_input_item || ""),
                            role: "button",
                            'data-value': v || n,
                            'data-attrid': '#' + attrs.id,
                            click: (ev) => {
                                app.$(ev.target.dataset.attrid).value = ev.target.dataset.value
                            },
                            text: n
                        }, eventOpts);
                        menu.append(a);
                    }
                }
            } else
            if (opts.text_input_button) {
                const group = app.$elem('div', { class: `input-group ${opts.class_input_group || ""}` });
                group.append(elem);
                elem = group;
                const bopts = {
                    class: opts.class_input_button || this.options.class_input_button,
                    type: "button",
                    'data-formid': '#'+this.formid,
                    text: opts.text_input_button
                };
                for (const b in opts.attrs_input_button) bopts[b] = opts.attrs_input_button[b];
                const button = app.$elem('button', bopts);
                elem.append(button);
            }

            for (const k in children) elem.append(children[k]);
            var class_group = opts.class_group || this.options.class_group;
            var class_label = (opts.class_label || this.options.class_label) + " " + (attrs.value ? "active" : "");
            var gopts = { class: class_group, title: attrs.title };
            for (const p in opts.attrs_group) gopts[p] = opts.attrs_group[p];

            group = app.$elem('div', gopts)
            parent.append(group);

            if (opts.class_prefix || opts.text_prefix) {
                const div = app.$elem("span", { class: opts.class_prefix || "" });
                if (opts.text_prefix) div.append(...this.sanitize(opts.text_prefix));
                group.append(div);
            }
            if (opts.horizontal !== undefined ? opts.horizontal : this.options.horizontal) {
                group.classList.add("row");
                class_label = " col-form-label " + (opts.size_label || this.options.size_label) + " " + class_label;
                const lopts = { for: opts.for || attrs.id, class: class_label };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                const label = app.$elem("label", lopts);
                label.append(...this.sanitize(opts.label));

                const input = app.$elem('div', { class: opts.size_input || this.options.size_input });
                input.append(elem);
                group.append(label, input);
            } else {
                const lopts = { for: opts.for || attrs.id, class: "form-label " + class_label };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                const label = app.$elem("label", lopts);
                label.append(...this.sanitize(opts.label));

                if (opts.floating) {
                    if (!opts.placeholder) app.$attr(elem, "placeholder", "");
                    group.classList.add("form-floating");
                    group.append(elem);
                    if (opts.label) group.append(label);
                } else {
                    if (opts.label) group.append(label);
                    group.append(elem);
                }
            }
            if (opts.text_valid) {
                group.append(app.$eem("div", { class: "valid-feedback", text: opts.text_valid }));
            }
            if (opts.text_invalid) {
                group.append(app.$elem("div", { class: "invalid-feedback", text: opts.text_invalid }));
            }
            if (opts.class_suffix || opts.text_suffix) {
                const div = app.$elem("div", { class: opts.class_suffix || this.options.class_suffix });
                if (opts.text_suffix) div.append(...this.sanitize(opts.text_suffix));
                group.append(div);
            }
            if (opts.autofocus) this.autofocus = elem;
        }

        const processEntry = (type, entry) => {
            opts = {}, children = [], attrs = {};
            label = elem = group = html = undefined;

            if (Array.isArray(entry)) {
                children = entry;
            } else
            if (typeof entry == "string") {
                opts.label = entry;
            } else {
                for (const p in entry) opts[p] = entry[p];
            }
            for (const p in opts) {
                if (p == "html") {
                    html = opts.nosanitize ? app.$parse(opts[p], 'list') : this.sanitize(opts[p]);
                } else
                if (!/^(tab_|attrs_|click_|list_|class_|text_|icon_|size_|label|for)/.test(p)) {
                    attrs[p] = opts[p];
                }
            }

            // Create a random id for the input if none provided
            if (!attrs.id) attrs.id = "bpi" + String(Math.random()).substr(2);
            attrs["data-formid"] = "#" + this.formid;

            // Choose to the current tab content
            if (opts.tab_id && tabs[opts.tab_id]) {
                parent = tabs[opts.tab_id];
            }

            // Check if type is a shortcut for input
            if (inputs.includes(type)) {
                attrs.type = type;
                type = "input";
            }

            switch (type) {
            case "button":
            case "submit":
            case "input":
            case "textarea":
                attrs.type = (attrs.type === undefined ? "text" : attrs.type);
                if (attrs.type == "hidden") {
                    elem = app.$elem(type, attrs, eventOpts);
                    parent.append(elem);
                    break;
                }
                if (!attrs.class) attrs.class = this.options["class_" + attrs.type];

            case "select":
                if (type == "select" && Array.isArray(attrs.options)) {
                    for (const j in attrs.options) {
                        const option = {}, opt = attrs.options[j];
                        if (typeof opt == "string") {
                            if (attrs.value && attrs.value == opt) option.selected = true;
                            option.text = this.escape(opt);
                            children.push(app.$elem("option", option));
                        } else
                        if (opt?.name) {
                            option.value = attrs.options[j].value || "";
                            option.selected = typeof opt.selected == "boolean" ? opt.selected : attrs.value && attrs.value == option.value ? true : false;
                            if (opt.label) option.label = opt.label;
                            if (typeof opt.disabled == "boolean") option.disabled = opt.disabled;
                            option.text = this.escape(opt.name);
                            children.push(app.$elem("option", option));
                        }
                    }
                    delete attrs.options;
                    delete attrs.value;
                }

                // Special case for checkbox
                if (["radio", "checkbox"].includes(attrs.type) && !opts.raw) {
                    if (attrs.checked === false || attrs.checked == 0) delete attrs.checked;
                    label = app.$elem('label', {
                        class: opts.class_input_btn || opts.class_input_label || "form-check-label",
                        for: opts.for || attrs.id,
                        text: opts.input_label || opts.label
                    });
                    let class_check = "form-check";
                    if (opts.switch) class_check += " form-switch", attrs.role = "switch";
                    if (opts.inline) class_check += " form-check-inline";
                    if (opts.reverse) class_check += " form-check-reverse";
                    if (opts.class_check) class_check += " " + opts.class_check;
                    attrs.class = (opts.class_input_btn ? "btn-check " : "form-check-input ") + (attrs.class || "");
                    elem = app.$elem('div', { class: class_check });
                    elem.append(app.$elem(type, attrs, eventOpts), label);

                    if (opts.class_append || opts.text_append) {
                        label.append(app.$elem("span", { class: opts.class_append || "", text: opts.text_append }));
                    }
                    // Clear label to not add as header, it was added before
                    if (!opts.input_label) delete opts.label;
                } else {
                    if (["select", "range"].includes(attrs.type)) {
                        attrs.class = `form-${attrs.type} ${attrs.class || ""}`;
                    }
                    attrs.class = attrs.class || "form-control";
                    if (type == "textarea") {
                        delete attrs.value;
                        elem = app.$elem(type, attrs, eventOpts);
                        if (opts.value) elem.append(opts.value);
                    } else {
                        elem = app.$elem(type, attrs, eventOpts);
                    }
                }
                addElement(type);
                break;

            case "checkboxes":
                elem = app.$elem("div", { class: opts.class_container });
                for (const i in attrs.options) {
                    let o = attrs.options[i];
                    if (!o?.name) continue;
                    if (o.checked === false || o.checked == 0) delete o.checked;
                    const title = o.title;
                    const label = app.$elem('label', { class: "form-check-label", for: attrs.id + "-" + i, text: o.label || o.name });
                    o = Object.assign(o, {
                        id: attrs.id + "-" + i,
                        class: `form-check-input ${o.class || ""}`,
                        role: opts.switch && "switch",
                        type: attrs.type || "checkbox",
                        label: undefined,
                        title: undefined,
                    });
                    let c = "form-check";
                    if (o.switch || opts.switch) c += " form-switch";
                    if (o.inline || opts.inline) c += " form-check-inline";
                    if (o.reverse || opts.reverse) c += " form-check-reverse";
                    if (o.class_check || opts.class_check) c += " " + (o.class_check || opts.class_check);
                    const div = app.$elem('div', { class: c, title: title });
                    div.append(app.$elem(`input`, o, eventOpts), label);
                    children.push(div);
                }
                for (const p of ["switch", "inline", "reverse", "options", "value", "type"]) delete attrs[p];
                addElement(type);
                break;

            case "alert":
            case "success":
                this[type] = elem = app.$elem("div", attrs, eventOpts);
                parent.append(elem);
                break;

            case "row":
                var row = app.$elem("div", { class: opts.class_row || this.options.class_row || "row" });
                parent.append(row);
                for (const subEntry of children) {
                    const col = app.$elem("div", { class: subEntry.class_col || this.options.class_col || "col-auto" });
                    row.append(col);
                    const oldParent = parent;
                    parent = col;
                    for (const type in subEntry) {
                        processEntry(type, subEntry[type]);
                    }
                    parent = oldParent;
                }
                break;

            default:
                elem = app.$elem(type, attrs, eventOpts);
                if (html) elem.append(...html);
                if (opts.class_append || opts.text_append) {
                    elem.append(app.$elem("span", { class: opts.class_append || "", text: opts.text_append }));
                }
                if (opts.name && opts.label) {
                    addElement(type);
                } else {
                    parent.append(elem);
                }
            }
        }

        // Iterate over entries
        for (const c in this.options.content) {
            const entry = this.options.content[c];
            switch (typeof entry) {
            case "string":
                // HTML string
                this.form.append(...this.sanitize(entry));
                break;

            case "object":
                for (const type in entry) {
                    processEntry(type, entry[type]);
                }
                break;
            }
        }

        // Footer
        this.footer = app.$elem('div', { class: this.options.class_footer });
        if (this.options.show_footer) this.content.append(this.footer);

        for (const i in this.options.footer) {
            const entry = this.options.footer[i];
            let div, html, elem;
            switch (typeof entry) {
            case "string":
                this.footer.append(...this.sanitize(entry));
                break;

            case "object":
                div = app.$elem('div', { class: this.options.class_options });
                this.footer.append(div)
                for (const type in entry) {
                    const opts = typeof entry[type] == "string" ? { text: entry[type] } : entry[type], attrs = {};
                    for (const p in opts) {
                        if (p == "html") {
                            html = opts.nosanitize ? app.$parse(opts[p], 'list') : this.sanitize(opts[p]);
                        } else
                        if (!/^(type|[0-9]+)$|^(class|text|icon|size)_/.test(p)) attrs[p] = opts[p];
                    }
                    elem = app.$elem(opts.type || type, attrs, eventOpts)
                    if (html) elem.append(...html);
                    div.append(elem);
                }
                break;
            }
        }

        for (const i in this.options.buttons) {
            var name = this.options.buttons[i];
            if (!name) continue;
            const btn = app.$elem("button", {
                type: "button",
                class: `${this.options.class_buttons} ${this.options["class_" + name] || this.options.class_button}`,
                "data-callback": name,
                "data-formid": "#" + this.formid,
                click: (event) => { self.callback(event.target.dataset.callback, event) }
            }, eventOpts);
            btn.append(...this.sanitize(this.options["text_" + name] || name));
            if (this.options["icon_" + name]) {
                btn.append(app.$elem("i", { class: this.options["icon_" + name] }));
            }
            this["btn_" + name] = btn;
            this.footer.append(btn);
        }

        // Setup events for dismiss and complete
        app.$on(this.modal, 'show.bs.modal', (e) => {
            self.options.show.call(self.options.self, e, self);
        });

        app.$on(this.modal, 'shown.bs.modal', (e) => {
            if (self.options.autofocus) {
                var focus = self.autofocus ||
                            Array.from(app.$all("input,select,textarea", this.form)).
                                  find(el => !(el.readOnly||el.disabled||el.type=='hidden'));
                if (focus) focus.focus();
            }
            self.options.shown.call(self.options.self, e, self);
        });

        app.$on(this.modal, 'hide.bs.modal', (e) => {
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            e.bootpopupButton = self._callback;
            self.options.dismiss.call(self.options.self, e, self);
        });

        app.$on(this.modal, 'hidden.bs.modal', (e) => {
            e.bootpopupButton = self._callback;
            self.options.complete.call(self.options.self, e, self);
            controller.abort();
            self.modal.remove();
            bootstrap.Modal.getInstance(self.modal)?.dispose();
            delete self.options.data;
            delete self.xdata;
        });
    }

    this.show = function() {
        if (app.isO(this.options.xdata)) {
            var xdata = this.xdata = Alpine.reactive(this.options.xdata);
            Alpine.addScopeToNode(this.modal, xdata, app.isE(this.options.xscope));
            Alpine.initTree(this.modal);
            Alpine.onElRemoved(this.modal, () => {
                delete this.modal._x_dataStack;
            });
        }
        document.body.append(this.modal);

        // Call before event
        this.options.before(this);

        // Fire the modal window
        bootstrap.Modal.getOrCreateInstance(this.modal).show();
    }

    this.showAlert = function(text, opts) {
        const type = opts?.type || "alert", element = this[type];
        if (!element) return;
        if (text?.message) text = text.message;
        if (typeof text != "string") return;
        if (!opts?.safe) text = app.textToEntity(text.replace(/<br>/g, "\n"));
        const alert = app.$elem(`div`, { class: this.options['class_' + type], role: "alert" });
        alert.append(...self.sanitize(text));
        if (opts?.dismiss) {
            alert.classList.add("alert-dismissibl");
            alert.append(app.$elem(`button`, { type: "button", class: "btn-close", 'data-bs-dismiss': "alert", 'aria-label': "Close" }));
        } else {
            setTimeout(() => { app.$empty(element) }, this.delay || 10000);
        }
        app.$empty(element).append(alert);
        if (this.options.scroll) element.scrollIntoView();
        return null;
    }

    this.validate = function() {
        this.form.classList.add('was-validated')
        return this.form.checkValidity();
    }

    this.sanitize = function(str) {
        return !str ? [] : this.options.sanitizer?.run(str, 1) || [str];
    }

    var _emap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' };
    this.escape = function(str) {
        if (typeof str != "string") return str;
        return str.replace(/([&<>'"`])/g, (_, n) => (_emap[n] || n));
    }

    this.data = function() {
        var inputs = [...this.options.inputs, ...bootpopup.inputs];
        var d = { list: [], obj: {} }, e, n, v, l = app.$all(inputs.join(","), this.form);
        for (let i = 0; i < l.length; i++) {
            e = l[i];
            n = e.name || app.$attr(e, "name") || e.id || app.$attr("id");
            v = e.value;
            if (this.options.debug) console.log("bootpopup:", n, e.type, e.checked, v, e);
            if (!n || e.disabled) continue;
            if (/radio|checkbox/i.test(e.type) && !e.checked) v = undefined;
            if (v === undefined || v === "") {
                if (!this.options.empty) continue;
                v = "";
            }
            d.list.push({ name: n, value: v })
        }
        for (const v of d.list) d.obj[v.name] = v.value;
        if (this.options.debug) console.log("bootpopup:", this.options.inputs, d);
        return d;
    },

    this.callback = function(name, event) {
        if (this.options.debug) console.log("bootpopup:", name, event);
        var func = this.options[name];        // Get function to call
        if (typeof func != "function") return;
        this._callback = name;
        // Perform callback
        var a = this.data();
        var ret = func.call(this.options.self, a.obj, a.list, event);
        // Hide window
        if (ret !== null) {
            bootstrap.Modal.getOrCreateInstance(this.modal).hide();
        }
        return ret;
    }

    this.addOptions = function(...args) {
        for (const opts of args) {
            for (const key in opts) {
                if (typeof opts[key] != "undefined") {
                    // Chaining all callbacks together, not replacing
                    if (typeof this.options[key] == "function") {
                        const _o = this.options[key], _n = opts[key];
                        this.options[key] = function(...args) {
                            if (typeof _o == "function") _o.apply(this, args);
                            return _n.apply(this, args);
                        }
                    } else {
                        this.options[key] = opts[key];
                    }
                }
            }
        }
        // Determine what is the best action if none is given
        if (this.options.onsubmit == "close") {
            if (this.options.buttons.includes("ok")) this.options.onsubmit = "ok"; else
            if (this.options.buttons.includes("yes")) this.options.onsubmit = "yes";
        }

        return this.options;
    }

    this.close = function() { return this.callback("close") }

    this.addOptions(...bootpopup.plugins, ...args);
    this.create();
    this.show();

    return this;
}
bootpopup.plugins = [];
bootpopup.inputs = [];
(() => {
  // src/app.js
  var app = {
    base: "/app/",
    main: "#app-main",
    index: "index",
    event: "component:event",
    templates: {},
    components: {},
    isF: isFunction,
    isS: isString,
    isE: isElement,
    isO: isObj,
    toCamel
  };
  function isString(str) {
    return typeof str == "string" && str;
  }
  function isFunction(callback) {
    return typeof callback == "function" && callback;
  }
  function isObj(obj) {
    return typeof obj == "object" && obj;
  }
  function isElement(element) {
    return element instanceof HTMLElement && element;
  }
  function toCamel(key) {
    return isString(key) ? key.toLowerCase().replace(/[.:_-](\w)/g, (_, c) => c.toUpperCase()) : "";
  }

  // src/util.js
  app.noop = () => {
  };
  app.log = (...args) => console.log(...args);
  app.trace = (...args) => {
    app.debug && app.log(...args);
  };
  app.call = (obj, method, ...arg) => {
    if (isFunction(obj)) return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (isFunction(method)) return method.call(obj, ...arg);
    if (obj && isFunction(obj[method])) return obj[method].call(obj, ...arg);
  };
  var _events = {};
  app.on = (event, callback, namespace) => {
    if (!isFunction(callback)) return;
    if (!_events[event]) _events[event] = [];
    _events[event].push([callback, isString(namespace)]);
  };
  app.once = (event, callback, namespace) => {
    if (!isFunction(callback)) return;
    const cb = (...args) => {
      app.off(event, cb);
      callback(...args);
    };
    app.on(event, cb, namespace);
  };
  app.only = (event, callback, namespace) => {
    _events[event] = isFunction(callback) ? [callback, isString(namespace)] : [];
  };
  app.off = (event, callback) => {
    if (event && callback) {
      if (!_events[event]) return;
      const i = isFunction(callback) ? 0 : isString(callback) ? 1 : -1;
      if (i >= 0) _events[event] = _events[event].filter((x) => x[i] !== callback);
    } else if (isString(event)) {
      for (const ev in _events) {
        _events[ev] = _events[ev].filter((x) => x[1] !== event);
      }
    }
  };
  app.emit = (event, ...args) => {
    app.trace("emit:", event, ...args, app.debug > 1 && _events[event]);
    if (_events[event]) {
      for (const cb of _events[event]) cb[0](...args);
    } else if (isString(event) && event.endsWith(":*")) {
      event = event.slice(0, -1);
      for (const p in _events) {
        if (p.startsWith(event)) {
          for (const cb of _events[p]) cb[0](...args);
        }
      }
    }
  };

  // src/dom.js
  app.$param = (name, dflt) => {
    return new URLSearchParams(location.search).get(name) || dflt || "";
  };
  var esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
  app.$ = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelector(esc(selector)) : null;
  app.$all = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelectorAll(esc(selector)) : null;
  app.$event = (element, name, detail = {}) => element instanceof EventTarget && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
  app.$on = (element, event, callback, ...arg) => {
    return isFunction(callback) && element.addEventListener(event, callback, ...arg);
  };
  app.$off = (element, event, callback, ...arg) => {
    return isFunction(callback) && element.removeEventListener(event, callback, ...arg);
  };
  app.$attr = (element, attr, value) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  app.$empty = (element, cleanup) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
      app.call(cleanup, node);
    }
    return element;
  };
  app.$elem = (name, ...arg) => {
    var element = document.createElement(name), key, val, opts;
    if (isObj(arg[0])) {
      arg = Object.entries(arg[0]).flatMap((x) => x);
      opts = arg[1];
    }
    for (let i = 0; i < arg.length - 1; i += 2) {
      key = arg[i], val = arg[i + 1];
      if (!isString(key)) continue;
      if (isFunction(val)) {
        app.$on(element, key, val, { capture: opts?.capture, passive: opts?.passive, once: opts?.once, signal: opts?.signal });
      } else if (key.startsWith("-")) {
        element.style[key.substr(1)] = val;
      } else if (key.startsWith(".")) {
        element[key.substr(1)] = val;
      } else if (key.startsWith("data-")) {
        element.dataset[toCamel(key.substr(5))] = val;
      } else if (key == "text") {
        element.textContent = val || "";
      } else if (val !== null) {
        element.setAttribute(key, val ?? "");
      }
    }
    return element;
  };
  app.$parse = (html, format) => {
    html = new window.DOMParser().parseFromString(html || "", "text/html");
    return format === "doc" ? html : format === "list" ? Array.from(html.body.childNodes) : html.body;
  };
  app.$append = (element, template, setup) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    let doc;
    if (isString(template)) doc = app.$parse(template, "doc");
    else if (template?.content?.nodeType == 11) doc = { body: template.content.cloneNode(true) };
    else
      return element;
    let node;
    while (node = doc.head?.firstChild) {
      element.appendChild(node);
    }
    while (node = doc.body.firstChild) {
      element.appendChild(node);
      if (setup && node.nodeType == 1) app.call(setup, node);
    }
    return element;
  };
  var _ready = [];
  app.$ready = (callback) => {
    _ready.push(callback);
    if (document.readyState == "loading") return;
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  };
  app.$on(window, "DOMContentLoaded", () => {
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  });

  // src/router.js
  app.parsePath = (path) => {
    var rc = { name: "", params: {} }, query, loc = window.location;
    if (!isString(path)) return rc;
    var base = app.base;
    if (path.startsWith(loc.origin)) path = path.substr(loc.origin.length);
    if (path.includes("://")) path = path.replace(/^(.*:\/\/[^\/]*)/, "");
    if (path.startsWith(base)) path = path.substr(base.length);
    if (path.startsWith("/")) path = path.substr(1);
    if (path == base.slice(1, -1)) path = "";
    const q = path.indexOf("?");
    if (q > 0) {
      query = path.substr(q + 1, 1024);
      rc.name = path = path.substr(0, q);
    }
    if (path.includes("/")) {
      path = path.split("/").slice(0, 5);
      rc.name = path.shift();
      for (let i = 0; i < path.length; i++) {
        if (!path[i]) continue;
        rc.params[`param${i + 1}`] = path[i];
      }
    } else {
      rc.name = path || "";
    }
    if (query) {
      for (const [key, value] of new URLSearchParams(query).entries()) {
        rc.params[key] = value;
      }
    }
    return rc;
  };
  app.savePath = (options) => {
    if (isString(options)) options = { name: options };
    if (!options?.name) return;
    var path = [options.name];
    if (options?.params) {
      for (let i = 1; i < 5; i++) path.push(options.params[`param${i}`] || "");
    }
    while (!path.at(-1)) path.length--;
    path = path.join("/");
    app.trace("savePath:", path, options);
    if (!path) return;
    app.emit("path:push", window.location.origin + app.base + path);
    window.history.pushState(null, "", window.location.origin + app.base + path);
  };
  app.restorePath = (path) => {
    app.trace("restorePath:", path, app.index);
    app.render(path, app.index);
  };
  app.start = () => {
    app.on("path:save", app.savePath);
    app.on("path:restore", app.restorePath);
    app.$ready(app.restorePath.bind(app, window.location.href));
  };
  app.$on(window, "popstate", () => app.emit("path:restore", window.location.href));

  // src/render.js
  var _plugins = {};
  var _default_plugin;
  app.plugin = (name, options) => {
    if (!name || !isString(name)) throw Error("type must be defined");
    if (options) {
      for (const p of ["render", "cleanup", "data"]) {
        if (options[p] && !isFunction(options[p])) throw Error(p + " must be a function");
      }
      if (isFunction(options?.Component)) {
        app[`${name.substr(0, 1).toUpperCase() + name.substr(1).toLowerCase()}Component`] = options.Component;
      }
    }
    var plugin = _plugins[name] = _plugins[name] || {};
    if (options?.default) _default_plugin = plugin;
    return Object.assign(plugin, options);
  };
  app.$data = (element, level) => {
    if (isString(element)) element = app.$(element);
    for (const p in _plugins) {
      if (!_plugins[p].data) continue;
      const d = _plugins[p].data(element, level);
      if (d) return d;
    }
  };
  app.resolve = (path, dflt) => {
    const rc = app.parsePath(path);
    app.trace("resolve:", path, dflt, rc);
    var name = rc.name, templates = app.templates, components = app.components;
    var template = templates[name] || document.getElementById(name);
    if (!template && dflt) {
      template = templates[dflt] || document.getElementById(dflt);
      if (template) rc.name = dflt;
    }
    if (isString(template) && template.startsWith("#")) {
      template = document.getElementById(template.substr(1));
    } else if (isString(template) && template.startsWith("$")) {
      template = templates[template.substr(1)];
    }
    if (!template) return;
    rc.template = template;
    var component = components[name] || components[rc.name];
    if (isString(component)) component = components[component];
    rc.component = component;
    return rc;
  };
  app.render = (options, dflt) => {
    var tmpl = app.resolve(options?.name || options, dflt);
    if (!tmpl) return;
    var params = tmpl.params;
    Object.assign(params, options?.params);
    params.$target = params.$target || app.main;
    app.trace("render:", options, tmpl.name, tmpl.params);
    const element = app.$(params.$target);
    if (!element) return;
    var plugin = tmpl.component?.$type || options?.plugin || params.$plugin;
    plugin = _plugins[plugin] || _default_plugin;
    if (!plugin?.render) return;
    if (params.$target == app.main) {
      var ev = { name: tmpl.name, params };
      app.emit(app.event, "prepare:delete", ev);
      if (ev.stop) return;
      var plugins = Object.values(_plugins);
      for (const p of plugins.filter((x) => x.cleanup)) {
        app.call(p.cleanup, element);
      }
      if (!(options?.nohistory || params.$nohistory || tmpl.component?.$nohistory)) {
        queueMicrotask(() => {
          app.emit("path:save", tmpl);
        });
      }
    }
    app.emit("component:render", tmpl);
    plugin.render(element, tmpl);
    return tmpl;
  };
  app.on("alpine:init", () => {
    for (const p in _plugins) {
      app.call(_plugins[p], "init");
    }
  });

  // src/component.js
  var Component = class {
    params = {};
    constructor(name, params) {
      this.$name = name;
      Object.assign(this.params, params);
      this._handleEvent = handleEvent.bind(this);
      this._onCreate = this.onCreate || null;
      this._onDelete = this.onDelete || null;
    }
    init(params) {
      app.trace("init:", this.$type, this.$name);
      Object.assign(this.params, params);
      app.emit("component:create", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      if (!this.params.$noevents) {
        app.on(app.event, this._handleEvent);
      }
      app.call(this._onCreate?.bind(this, this.params));
    }
    destroy() {
      app.trace("destroy:", this.$type, this.$name);
      app.off(app.event, this._handleEvent);
      app.emit("component:delete", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      app.call(this._onDelete?.bind(this));
      this.params = {};
      delete this.$root;
    }
  };
  function handleEvent(event, ...args) {
    if (this.onEvent) {
      app.trace("event:", this.$type, this.$name, event, ...args);
      app.call(this.onEvent?.bind(this.$data || this), event, ...args);
    }
    if (!isString(event)) return;
    var method = toCamel("on_" + event);
    if (!this[method]) return;
    app.trace("event:", this.$type, this.$name, method, ...args);
    app.call(this[method]?.bind(this.$data || this), ...args);
  }
  var component_default = Component;

  // src/alpine.js
  var _alpine = "alpine";
  var AlpineComponent = class extends component_default {
    static $type = _alpine;
    constructor(name, params) {
      super(name, params);
      this.$type = _alpine;
    }
    init() {
      super.init(this.$root._x_params);
    }
  };
  var Element = class extends HTMLElement {
    connectedCallback() {
      queueMicrotask(() => {
        render(this, this.localName.substr(4));
      });
    }
  };
  function render(element, options) {
    if (isString(options)) {
      options = app.resolve(options);
      if (!options) return;
    }
    app.$empty(element);
    if (!options.component) {
      Alpine.mutateDom(() => {
        app.$append(element, options.template, Alpine.initTree);
      });
    } else {
      Alpine.data(options.name, () => new options.component(options.name));
      const node = app.$elem("div", "x-data", options.name, "._x_params", options.params);
      app.$append(node, options.template);
      Alpine.mutateDom(() => {
        element.appendChild(node);
        Alpine.initTree(node);
        delete node._x_params;
      });
    }
    return options;
  }
  function data(element, level) {
    if (!isElement(element)) element = app.$(app.main + " div");
    if (!element) return;
    if (typeof level == "number") return element._x_dataStack?.at(level);
    return Alpine.closestDataStack(element)[0];
  }
  function init() {
    for (const [name, obj] of Object.entries(app.components)) {
      const tag = `app-${obj?.$tag || name}`;
      if (obj?.$type != _alpine || customElements.get(tag)) continue;
      customElements.define(tag, class extends Element {
      });
      Alpine.data(name, () => new obj(name));
    }
  }
  app.plugin(_alpine, { render, Component: AlpineComponent, data, init, default: 1 });
  app.$on(document, "alpine:init", () => {
    app.emit("alpine:init");
    Alpine.magic("app", (el) => app);
    Alpine.magic("component", (el) => Alpine.closestDataStack(el).find((x) => x.$type == _alpine && x.$name));
    Alpine.magic("parent", (el) => Alpine.closestDataStack(el).filter((x) => x.$type == _alpine && x.$name)[1]);
    Alpine.directive("render", (el, { modifiers, expression }, { evaluate, cleanup }) => {
      const click = (e) => {
        const name = evaluate(expression);
        if (!name) return;
        e.preventDefault();
        e.stopPropagation();
        app.render(name);
      };
      app.$on(el, "click", click);
      el.style.cursor = "pointer";
      cleanup(() => {
        app.$off(el, "click", click);
      });
    });
    Alpine.directive("template", (el, { modifiers, expression }, { effect, cleanup }) => {
      const evaluate = Alpine.evaluateLater(el, expression);
      var template;
      const empty = () => {
        template = null;
        Alpine.mutateDom(() => {
          app.$empty(el, (node) => Alpine.destroyTree(node));
          if (modifiers.includes("show")) {
            el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
          }
        });
      };
      effect(() => evaluate((value) => {
        if (!value) return empty();
        if (value !== template) {
          const tmpl = app.resolve(value);
          if (!tmpl) return;
          const mods = {};
          for (let i = 0; i < modifiers.length; i++) {
            const mod = modifiers[i];
            switch (mod) {
              case "params":
                var scope = Alpine.$data(el);
                if (!isObj(scope[modifiers[i + 1]])) break;
                tmpl.params = Object.assign(scope[modifiers[i + 1]], tmpl.params);
                break;
              case "inline":
                mods.inline = "inline-block";
                break;
              default:
                mods[mod] = mod;
            }
          }
          if (render(el, tmpl)) {
            if (mods.show) {
              if (mods.nonempty && !el.firstChild) {
                el.style.setProperty("display", "none", mods.important);
              } else {
                el.style.setProperty("display", mods.flex || mods.inline || "block", mods.important);
              }
            }
          }
        }
        template = value;
      }));
      cleanup(empty);
    });
    Alpine.directive("scope-level", (el, { expression }, { evaluate }) => {
      const scope = Alpine.closestDataStack(el);
      el._x_dataStack = scope.slice(0, parseInt(evaluate(expression || "")) || 0);
    });
  });

  // src/fetch.js
  app.fetchOpts = function(options) {
    var headers = options.headers || {};
    var opts = Object.assign({
      headers,
      method: options.type || "POST",
      cache: "default"
    }, options.fetchOptions);
    var data2 = options.data;
    if (opts.method == "GET" || opts.method == "HEAD") {
      if (isObj(data2)) {
        options.url += "?" + new URLSearchParams(data2).toString();
      }
    } else if (isString(data2)) {
      opts.body = data2;
      headers["content-type"] = options.contentType || "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (data2 instanceof FormData) {
      opts.body = data2;
      delete headers["content-type"];
    } else if (isObj(data2)) {
      opts.body = JSON.stringify(data2);
      headers["content-type"] = "application/json; charset=UTF-8";
    } else if (data2) {
      opts.body = data2;
      headers["content-type"] = options.contentType || "application/octet-stream";
    }
    return opts;
  };
  app.fetch = function(options, callback) {
    try {
      const opts = app.fetchOpts(options);
      window.fetch(options.url, opts).then(async (res) => {
        var err, data2;
        var info = { status: res.status, headers: {}, type: res.type };
        for (const h of res.headers) info.headers[h[0].toLowerCase()] = h[1];
        if (!res.ok) {
          if (/\/json/.test(info.headers["content-type"])) {
            const d = await res.json();
            err = { status: res.status };
            for (const p in d) err[p] = d[p];
          } else {
            err = { message: await res.text(), status: res.status };
          }
          return app.call(callback, err, data2, info);
        }
        switch (options.dataType) {
          case "text":
            data2 = await res.text();
            break;
          case "blob":
            data2 = await res.blob();
            break;
          default:
            data2 = /\/json/.test(info.headers["content-type"]) ? await res.json() : await res.text();
        }
        app.call(callback, null, data2, info);
      }).catch((err) => {
        app.call(callback, err);
      });
    } catch (err) {
      app.call(callback, err);
    }
  };

  // src/index.js
  app.Component = component_default;
  var src_default = app;

  // builds/cdn.js
  window.app = src_default;
})();
/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

app.inherits = function(ctor, superCtor, options)
{
    if (!ctor) return;
    if (ctor.prototype && superCtor?.prototype) {
        Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }
    for (const p in options) {
        if (typeof options[p] != "function") ctor[p] = options[p]; else
        if (ctor.prototype) ctor.prototype[p] = options[p];
    }
    return ctor;
}

// Determine type of the object
app.typeName = function(v)
{
    if (v === null) return "null";
    const t = typeof v;
    if (t === "object") {
        switch (v.constructor?.name) {
        case "Array":
        case "Buffer":
        case "Date":
        case "Error":
        case "RegExp":
        case "Set":
        case "Map":
        case "WeakMap":
            return v.constructor.name.toLowerCase();
        }
    }
    return t;
}

app._formatPresets = {
    compact: {
        sbracket1: "",
        sbracket2: "",
        cbracket1: "",
        cbracket2: "",
        nl1: "<br>",
        nl2: "",
        quote1: "",
        quote2: "",
        squote1: "",
        squote2: "",
        comma: "",
        prefix: "&nbsp;&nbsp;-&nbsp;",
        space: "&nbsp;",
        skipnull: 1,
        skipempty: 1,
    },
};

// Format an object into nice JSON formatted text
app.formatJSON = function(obj, options)
{
    if (typeof options == "string") options = { indent: options };
    if (!options) options = {};
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        if (obj[0] != "[" && obj[0] != "{") return obj;
        try { obj = JSON.parse(obj); } catch (e) { app.log(e) }
    }
    var preset = app._formatPresets[options.preset];
    for (const p in preset) options[p] = preset[p];

    if (!options.level) options.level = 0;
    if (!options.indent) options.indent = "";
    if (options.nl1 === undefined) options.nl1 = "\n";
    if (options.nl2 === undefined) options.nl2 = "\n";
    if (options.sbracket1 === undefined) options.sbracket1 = "[";
    if (options.sbracket2 === undefined) options.sbracket2 = "]";
    if (options.cbracket1 === undefined) options.cbracket1 = "{";
    if (options.cbracket2 === undefined) options.cbracket2 = "}";
    if (options.quote1 === undefined) options.quote1 = '"';
    if (options.quote2 === undefined) options.quote2 = '"';
    if (options.squote1 === undefined) options.squote1 = '"';
    if (options.squote2 === undefined) options.squote2 = '"';
    if (options.space === undefined) options.space = " ";
    if (options.nspace === undefined) options.nspace = 4;
    if (options.comma === undefined) options.comma = ", ";
    if (options.sep === undefined) options.sep = ", ";
    if (options.prefix === undefined) options.prefix = "";

    var type = app.typeName(obj);
    var count = 0, indent;
    var text = type == "array" ? options.sbracket1 : options.cbracket1;
    var map = options.map || "";
    // Insert newlines only until specified level deep
    var nline = !options.indentlevel || options.level < options.indentlevel;
    // Top level prefix set, skip new line for the first item
    var prefix = options.__prefix;
    delete options.__prefix;

    for (const p in obj) {
        if (options.ignore && options.ignore.test(p)) continue;
        var val = obj[p];
        if (typeof options.preprocess == "function") {
            val = options.preprocess(p, val, options);
            if (val === undefined) continue;
        }
        if (options.skipnull && (val === "" || val === null || val === undefined)) continue;
        if (options.skipempty && app.isEmpty(val)) continue;
        if (options.skipvalue && options.skipvalue.test(val)) continue;

        if (count > 0) {
            text += type == "array" ? options.sep : options.comma;
        }
        if (type != "array") {
            if (nline && options.nl1) {
                text += !count && (prefix || !options.level) ? "" : options.nl1;
            }
            if (!prefix || count) text += options.indent;
            if (!prefix) text += options.space.repeat(options.nspace);
            text += options.quote1 + (map[p] || p) + options.quote2 + ": ";
        } else
        if (options.prefix && options.nl1) {
            text += options.nl1 + options.indent + options.prefix;
        }
        switch (app.typeName(val)) {
        case "array":
        case "object":
            if (type == "array" && options.prefix && options.nl1) {
                indent = options.__prefix = options.space.repeat(options.prefix.length);
            } else {
                indent = options.space.repeat(options.nspace);
            }
            options.indent += indent;
            options.level++;
            text += app.formatJSON(val, options);
            options.level--;
            options.indent = options.indent.substr(0, options.indent.length - indent.length);
            break;
        case "boolean":
        case "number":
            text += val.toString();
            break;
        case "null":
            text += "null";
            break;
        case "string":
            text += (options.squote1 + val + options.squote2);
            break;
        default:
            text += ("unknown: " + typeof(val));
        }
        count++;
    }
    text += type == "array" ? options.sbracket2 : ((nline && options.nl2 ? options.nl2 + options.indent : "") + options.cbracket2);
    return text;
}

app.weekOfYear = function(date, utc)
{
    date = app.toDate(date, null);
    if (!date) return 0;
    utc = utc ? "UTC": "";
    var target = new Date(date.valueOf());
    target["set" + utc + "Date"](target["get" + utc + "Date"]() - ((date["get" + utc + "Day"]() + 6) % 7) + 3);
    var firstThursday = target.valueOf();
    target["set" + utc + "Month"](0, 1);
    var day = target["get" + utc + "Day"]();
    if (day != 4) target["set" + utc + "Month"](0, 1 + ((4 - day) + 7) % 7);
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Returns true if the given date is in DST timezone
app.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

app.strftimeFormat = "%Y-%m-%d %H:%M:%S %Z";
app.strftimeMap = {
        weekDays: {
            "": [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ]
        },
        weekDaysFull: {
            "": [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ]
        },
        months: {
            "": [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ]
        },
        monthsFull: {
            "": [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ]
        },
};
app.tzMap = [
        ["EDT", "GMT-0400", true],
        ["EST", "GMT-0500", false],
        ["PDT", "GMT-0700", true],
        ["PST", "GMT-0800", false],
        ["CDT", "GMT-0500", true],
        ["CST", "GMT-0600", false],
        ["MDT", "GMT-0600", true],
        ["MST", "GMT-0700", false],
        ["HADT", "GMT-0900", true, false],
        ["HAST", "GMT-1000", false, false],
        ["AKDT", "GMT-0800", true, false],
        ["AKST", "GMT-0900", false, false],
        ["ADT", "GMT-0300", true, false],
        ["AST", "GMT-0400", false, false],
];

// Return a timezone human name if matched (EST, PDT...), tz must be in GMT-NNNN format
app.tzName = function(tz)
{
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in app.tzMap) {
        if (t == app.tzMap[i][1]) return app.tzMap[i][0];
    }
    return tz;
}

// Format a Date object
app.strftime = function(date, fmt, options)
{
    const spacepad = (n) => (n > 9 ? n : ' ' + n)
    const zeropad = (n) => (n > 9 ? n : '0' + n)

    date = app.toDate(date, null);
    if (!date) return "";
    const tz = typeof options?.tz == "number" ? options.tz : 0;
    if (tz) date = new Date(date.getTime() - tz);
    fmt = fmt || app.strftimeFormat;
    const cmds = {
        a: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.weekDays[lang]) {
                app.strftimeMap.weekDays[lang] = app.strftimeMap.weekDays[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.weekDays[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        A: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.weekDaysFull[lang]) {
                app.strftimeMap.weekDaysFull[lang] = app.strftimeMap.weekDaysFull[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.weekDaysFull[lang || ""][utc ? t.getUTCDay() : t.getDay()]
        },
        b: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.months[lang]) {
                app.strftimeMap.months[lang] = app.strftimeMap.months[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.months[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        B: (t, utc, lang, tz) => {
            if (lang && !app.strftimeMap.monthsFull[lang]) {
                app.strftimeMap.monthsFull[lang] = app.strftimeMap.monthsFull[""].map((x) => (app.__({ phrase: x, locale: lang })));
            }
            return app.strftimeMap.monthsFull[lang || ""][utc ? t.getUTCMonth() : t.getMonth()]
        },
        c: (t, utc, lang, tz) => (utc ? t.toUTCString() : t.toString()),
        d: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCDate() : t.getDate())),
        e: (t, utc, lang, tz) => (spacepad(utc ? t.getUTCDate() : t.getDate())),
        H: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCHours() : t.getHours())),
        I: (t, utc, lang, tz) => (zeropad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)),
        k: (t, utc, lang, tz) => (spacepad(utc ? t.getUTCHours() : t.getHours())),
        l: (t, utc, lang, tz) => (spacepad((((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) || 12)),
        L: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCMilliseconds() : t.getMilliseconds())),
        m: (t, utc, lang, tz) => (zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1)), // month-1
        M: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCMinutes() : t.getMinutes())),
        p: (t, utc, lang, tz) => ((utc ? t.getUTCHours() : t.getHours()) < 12 ? 'am' : 'pm'),
        S: (t, utc, lang, tz) => (zeropad(utc ? t.getUTCSeconds() : t.getSeconds())),
        w: (t, utc, lang, tz) => (utc ? t.getUTCDay() : t.getDay()), // 0..6 == sun..sat
        W: (t, utc, lang, tz) => (zeropad(app.weekOfYear(t, utc))),
        y: (t, utc, lang, tz) => (zeropad(t.getYear() % 100)),
        Y: (t, utc, lang, tz) => (utc ? t.getUTCFullYear() : t.getFullYear()),
        t: (t, utc, lang, tz) => (t.getTime()),
        u: (t, utc, lang, tz) => (Math.floor(t.getTime()/1000)),
        Z: (t, utc, lang, tz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            return "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
        },
        zz: (t, utc, lang, tz) => (cmds.z(t, utc, lang, tz, 1)),
        z: (t, utc, lang, tz, zz) => {
            tz = tz ? tz/60000 : t.getTimezoneOffset();
            tz = "GMT" + (tz < 0 ? "+" : "-") + zeropad(Math.abs(-tz/60)) + "00";
            var dst = app.isDST(t);
            for (var i in app.tzMap) {
                if (tz == app.tzMap[i][1] && (dst === app.tzMap[i][2])) {
                    return zz ? tz + " " + app.tzMap[i][0] : app.tzMap[i][0];
                }
            }
            return tz;
        },
        Q: (t, utc, lang, tz) => {
            var h = utc ? t.getUTCHours() : t.getHours();
            return h < 12 ? app.__({ phrase: "Morning", locale: lang }) :
                   h < 17 ? app.__({ phrase: "Afternoon", locale: lang }) :
                   app.__({ phrase: "Evening", locale: lang }) },
                   '%': function() { return '%' },
    };

    for (var c in cmds) {
        fmt = fmt.replace('%' + c, cmds[c](date, options?.utc, options?.lang, tz));
    }
    return fmt;
}

app.sprintf = function(fmt, ...args)
{
    if (typeof fmt != "string") return "";
    var i = -1, regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexdz])/g;

    return fmt.replace(regex, (sym, p0, p1, p2, p3, p4) => {
        if (sym == '%%') return '%';
        if (args[++i] === undefined) return undefined;
        var arg = args[i];
        var exp = p2 ? parseInt(p2.substr(1)) : undefined;
        var base = p3 ? parseInt(p3.substr(1)) : undefined;
        var val;
        switch (p4) {
        case 's':
            val = arg;
            break;
        case 'c':
            val = arg[0];
            break;
        case 'f':
            val = parseFloat(arg).toFixed(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'g':
            val = parseFloat(arg).toFixed(exp);
            if (isNaN(val)) val = 0;
            if (val.indexOf(".") > -1) {
                while (val[val.length - 1] == "0") val = val.slice(0, -1);
                if (val[val.length - 1] == ".") val = val.slice(0, -1);
            }
            break;
        case 'p':
            val = parseFloat(arg).toPrecision(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'e':
            val = parseFloat(arg).toExponential(exp);
            if (isNaN(val)) val = 0;
            break;
        case 'x':
            val = parseInt(arg).toString(base ? base : 16);
            if (isNaN(val)) val = 0;
            break;
        case 'd':
            val = parseFloat(parseInt(arg, base ? base : 10).toPrecision(exp)).toFixed(0);
            if (isNaN(val)) val = 0;
            break;
        }
        val = typeof val == "object" ? JSON.stringify(val) : val.toString(base);
        var sz = parseInt(p1); /* padding size */
        var ch = p1 && p1[0] == '0' ? '0' : ' '; /* isnull? */
        while (val.length < sz) val = p0 !== undefined ? val + ch : ch + val; /* isminus? */
        return val;
    });
}

// Apply an iterator function to each item in an array serially. Execute a callback when all items
// have been completed or immediately if there is is an error provided.
app.forEachSeries = function(list, iterator, callback, direct = true)
{
    callback = typeof callback == "function" ? callback : app.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, ...args) {
        if (i >= list.length) return direct ? callback(null, ...args) : setTimeout(callback, 0, null, ...args);
        iterator(list[i], (...args) => {
            if (args[0]) {
                if (direct) callback(...args); else setTimeout(callback, 0, ...args);
                callback = app.noop;
            } else {
                iterate(++i, ...args.slice(1));
            }
        }, ...args);
    }
    iterate(0);
}

// Execute a list of functions serially and execute a callback upon completion or occurance of an error.
app.series = function(tasks, callback, direct = true)
{
    app.forEachSeries(tasks, (task, next, ...args) => {
        if (direct) task(next, ...args); else setTimeout(task, 0, next, ...args);
    }, callback, direct);
}

// Apply an iterator function to each item in an array in parallel. Execute a callback when all items
// have been completed or immediately if there is an error provided
app.forEach = function(list, iterator, callback, direct = true)
{
    callback = typeof callback == "function" ? callback : app.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], (err) => {
            if (err) {
                if (direct) callback(err); else setTimeout(callback, 0, err);
                callback = app.noop;
                i = list.length + 1;
            } else
            if (--count == 0) {
                if (direct) callback(); else setTimeout(callback, 0);
                callback = app.noop;
            }
        });
    }
}

// Execute a list of functions in parallel and execute a callback upon completion or occurance of an error.
app.parallel = function(tasks, callback, direct = true)
{
    app.forEach(tasks, (task, next) => { task(next) }, callback, direct);
}

// Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
// in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
app.toDate = function(val, dflt, invalid)
{
    if (typeof val?.getTime == "function") return val;
    var d = NaN;
    // String that looks like a number
    if (typeof val == "string") {
        val = /^[0-9.]+$/.test(val) ? app.toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
   if (typeof val == "number") {
        // Convert nanoseconds to milliseconds
        if (val > 2147485547000) val = Math.round(val / 1000);
        // Convert seconds to milliseconds
        if (val < 2147483647) val *= 1000;
    }
    if (typeof val != "string" && typeof val != "number") val = d;
    // Remove unsupported timezone names
    if (typeof val == "string") {
        var gmt = val.indexOf("GMT") > -1;
        for (const i in app.tzMap) {
            if ((gmt || app.tzMap[i][3] === false) && val.indexOf(app.tzMap[i][0]) > -1) {
                val = val.replace(app.tzMap[i][0], "");
            }
        }
    }
    if (val) try { d = new Date(val); } catch (e) {}
    return !isNaN(d) ? d : invalid || (dflt !== undefined && isNaN(dflt)) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
}

// Returns a human representation of an age for the given timestamp in milliseconds
app.toAge = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : app.toNumber(mtime);
    if (mtime > 0) {
        var secs = Math.floor((Date.now() - mtime)/1000);
        var d = Math.floor(secs / 86400);
        var mm = Math.floor(d / 30);
        var w = Math.floor(d / 7);
        var h = Math.floor((secs - d * 86400) / 3600);
        var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
        var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
        if (mm > 0) {
            str = mm > 1 ? app.__("%s months", mm) : app.__("1 month");
            if (d > 0) str += " " + (d > 1 ? app.__("%s days", d) : app.__("1 day"));
            if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
        } else
            if (w > 0) {
                str = w > 1 ? app.__("%s weeks", w) : app.__("1 week");
                if (d > 0) str += " " + (d > 1 ? app.__("%s days", d) : app.__("1 day"));
                if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
            } else
                if (d > 0) {
                    str = d > 1 ? app.__("%s days", d) : app.__("1 day");
                    if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) : app.__("1 hour"));
                    if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) : app.__("1 minute"));
                } else
                    if (h > 0) {
                        str = h > 1 ? app.__("%s hours", h) : app.__("1 hour");
                        if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) : app.__("1 minute"));
                    } else
                        if (m > 0) {
                            str = m > 1 ? app.__("%s minutes", m) : app.__("1 minute");
                            if (s > 0) str += " " + (s > 1 ? app.__("%s seconds", s) : app.__("1 second"));
                        } else {
                            str = secs > 1 ? app.__("%s seconds", secs) : app.__("1 second");
                        }
    }
    return str;
}

app.toDuration = function(mtime, options)
{
    var str = "";
    mtime = typeof mtime == "number" ? mtime : app.toNumber(mtime);
    if (mtime > 0) {
        var seconds = Math.floor(mtime/1000);
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds - d * 86400) / 3600);
        var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
        var s = Math.floor(seconds - d * 86400 - h * 3600 - m * 60);
        if (d > 0) {
            str = d > 1 ? app.__("%s days", d) :
                          app.__("1 day");
            if (h > 0) str += " " + (h > 1 ? app.__("%s hours", h) :
                                             app.__("1 hour"));
            if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) :
                                             app.__("1 minute"));
        } else
            if (h > 0) {
                str = h > 1 ? app.__("%s hours", h) :
                              app.__("1 hour");
                if (m > 0) str += " " + (m > 1 ? app.__("%s minutes", m) :
                                                 app.__("1 minute"));
            } else
                if (m > 0) {
                    str = m > 1 ? app.__("%s minutes", m) :
                                  app.__("1 minute");
                    if (s > 0) str += " " + (s > 1 ? app.__("%s seconds", s) :
                                                     app.__("1 second"));
                } else {
                    str = seconds > 1 ? app.__("%s seconds", seconds) :
                                        app.__("1 second");
                }
    }
    return str;
}

app.toSize = function(size, decimals)
{
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(typeof decimals == "number" ? decimals : 2) * 1 + ' ' + [app.__('Bytes'), app.__('KBytes'), app.__('MBytes'), app.__('GBytes'), app.__('TBytes')][i];
}

app.autoType = function(val)
{
    return app.isNumeric(val) ? "number":
           typeof val == "boolean" || val == "true" || val == "false" ? "bool":
           typeof val == "string" ?
           val[0] == "^" && val.slice(-1) == "$" ? "regexp":
           val[0] == "[" && val.slice(-1) == "]" ? "js":
           val[0] == "{" && val.slice(-1) == "}" ? "js":
           val.includes("|") && !/[()[\]^$]/.test(val) ? "list": "" : "";
}

app.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

app.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some((x) => (list.includes(x))) : list.includes(name));
}

app.isObject = function(v)
{
    return app.typeName(v) == "object";
}

app.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/.test(val);
}

// Return true of the given value considered empty
app.isEmpty = function(val)
{
    switch (app.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length == 0;
    case "number":
    case "date":
        return isNaN(val);
    case "regexp":
    case "boolean":
    case "function":
        return false;
    case "object":
        for (const p in val) return false;
        return true;
    case "string":
        return /^\s*$/.test(val) ? true : false;
    default:
        return val ? false: true;
    }
}

// Flags command utility, the commands are:
// - add - adds the `name` flags to the list if does not exists, returns the same array
// - update - adds new flags and removes flags that starts with - , returns the same array
// - concat - same as add but always returns a new list
// - del - removes the flags `name`, returns the same array
// - present - returns only flags that present in the list `name`
// - absent - returns only flags that are not present in the list `name`
app.toFlags = function(cmd, list, name)
{
    switch (cmd) {
    case "concat":
        list = Array.isArray(list) ? list.slice(0) : [];
    case "add":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) {
            if (name && !list.includes(name)) list.push(name);
        } else {
            name.forEach((x) => { if (!list.includes(x)) list.push(x) });
        }
        break;

    case "update":
        if (!Array.isArray(list)) list = [];
        if (!Array.isArray(name)) name = [name];
        name.forEach((x) => {
            if (typeof x == "string" && x[0] == "-") {
                var i = list.indexOf(x.substr(1));
                if (i > -1) list.splice(i, 1);
            } else {
                if (!list.includes(x)) list.push(x);
            }
        });
        break;

    case "del":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) name = [name];
        name.forEach((x) => {
            var i = list.indexOf(x);
            if (i > -1) list.splice(i, 1);
        });
        break;

    case "present":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (name.includes(x)));
        break;

    case "absent":
        if (!Array.isArray(list)) return [];
        if (!Array.isArray(name)) return list;
        list = list.filter((x) => (!name.includes(x)));
        break;
    }
    return list;
}

// Capitalize words
app.toTitle = function(name, minlen)
{
    return typeof name == "string" ?
           minlen > 0 && name.length <= minlen ? name :
           name.replace(/_/g, " ").
           split(/[ ]+/).
           reduce((x,y) => (x + y.substr(0,1).toUpperCase() + y.substr(1) + " "), "").
           trim() : "";
}

// Interpret the value as a boolean
app.toBool = function(val, dflt)
{
    if (typeof val == "boolean") return val;
    if (typeof val == "number") return !!val;
    if (val === undefined) val = dflt;
    return !val || String(val).trim().match(/^(false|off|f|0$)/i) ? false : true;
}

app.toClamp = function(num, min, max)
{
  return Math.max(app.toNumber(min), Math.min(app.toNumber(num), app.toNumber(max)));
}

// Convert a string to a number, on invalid input returns 0
app.toNumber = function(val, options)
{
    var n = 0;
    if (typeof val == "number") {
        n = val;
    } else {
        if (typeof val != "string") {
            n = options?.dflt || 0;
        } else {
            // Autodetect floating number
            var f = !options || options.float === undefined || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
            n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
        }
    }
    n = isNaN(n) ? (options?.dflt || 0) : n;
    if (options) {
        if (typeof options.min == "number" && n < options.min) n = options.min;
        if (typeof options.max == "number" && n > options.max) n = options.max;
        if (typeof options.digits == "number") n = parseFloat(n.toFixed(options.digits));
    }
    return n;
}

// Return a test representation of a number according to the money formatting rules
app.toPrice = function(num, options)
{
    try {
        return this.toNumber(num).toLocaleString(options?.locale || "en-US", { style: 'currency',
            currency: options?.currency || 'USD',
            currencyDisplay: options?.display || "symbol",
            currencySign: options?.sign || "standard",
            minimumFractionDigits: options?.min || 2,
            maximumFractionDigits: options?.max || 5 });
    } catch (e) {
        console.error("toPrice:", e, num, options);
        return "";
    }
}

app.toValue = function(val, type, options)
{
    switch ((type || "").trim()) {
    case "auto":
        if (val === undefined || val === null) return "";
        type = app.autoType(val);
        return app.toValue(val, type, options);

    case "set":
    case "list":
    case 'array':
        return app.strSplitUnique(val, options && options.separator, options);

    case "map":
        return app.strSplit(val, options?.delimiter || ",").
            map((y) => (app.strSplit(y, options?.separator || /[:;]/, options))).
            reduce((a, b) => {
                let v;
                if (b.length < 2) {
                    if (options?.empty) v = "";
                } else {
                    v = b.length == 2 ? b[1] : b.slice(1);
                    if (options?.maptype) v = app.toValue(v, options.maptype, options);
                }
                if (options?.noempty && app.isEmpty(v)) return a;
                if (options?.mapcamel) b[0] = lib.toCamel(b[0]);
                a[b[0]] = v;
                return a;
            }, {});

    case "expr":
    case "buffer":
        return val;

    case "real":
    case "float":
    case "double":
        return app.toNumber(val, { float: 1 });

    case "int":
    case "smallint":
    case "integer":
    case "number":
    case "bigint":
    case "numeric":
    case "counter":
        return app.toNumber(val);

    case "bool":
    case "boolean":
        return app.toBool(val);

    case "date":
    case "time":
        return app.toDate(val);

    case "mtime":
        return /^[0-9.]+$/.test(String(val)) ? app.toNumber(val) : (new Date(val));

    case "json":
        return JSON.stringify(val);

    case "phone":
        return String(val).replace(/[^0-9]+/g, "");

    default:
        if (typeof val == "string") return val;
        return String(val);
    }
}

app.toTemplate = function(text, obj, options)
{
    const encoder = (enc, v) => {
        try {
            switch (enc) {
            case "url":
                if (typeof v != "string") v = String(v);
                v = encodeURIComponent(v);
                break;
            case "d-url":
                if (typeof v != "string") v = String(v);
                v = decodeURIComponent(v);
                break;
            case "base64":
                if (typeof v != "string") v = String(v);
                v = window.btoa(v);
                break;
            case "d-base64":
                if (typeof v != "string") v = String(v);
                v = window.atob(v);
                break;
            case "entity":
                v = app.textToEntity(v);
                break;
            case "d-entity":
                v = app.entityToText(v);
                break;
            case "strftime":
                v = app.strftime(v);
                break;
            case "mtime":
                v = app.toDate(v, null);
                if (!v) v = 0;
                break;
            case "price":
                v = app.toPrice(v, options);
                break;
            }
        } catch (e) {}
        return v;
    }
    return _toTemplate(text, obj, options, encoder);
}

function _toTemplate(text, obj, options, encoder)
{
    if (typeof text != "string" || !text) return "";
    var i, j, rc = [], top;
    if (!options) options = {};
    if (options.__exit === undefined) {
        top = 1;
        options.__exit = 0;
    }
    if (!Array.isArray(obj)) obj = [obj];
    for (i = 0; i < obj.length; i++) {
        if (typeof obj[i] == "object" && obj[i]) rc.push(obj[i]);
    }
    var tmpl = "", str = text, sep1 = options.separator1 || "@", sep2 = options.separator2 || sep1;
    while (str) {
        var start = str.indexOf(sep1);
        if (start == -1) {
            tmpl += str;
            break;
        }
        var end = str.indexOf(sep2, start + sep1.length);
        if (end == -1) {
            tmpl += str;
            break;
        }
        var tag = str.substr(start + sep1.length, end - start - sep2.length);
        tmpl += str.substr(0, start);
        str = str.substr(end + sep2.length);
        var d, v = null, dflt = null, field = null, enc = options.encoding;
        if (tag == "") {
            v = sep1;
        } else
        if (tag == "exit") {
            options.__exit = 1;
            break;
        } else
        if (tag == "RAND") {
            v = Math.random();
            tmpl += v;
            continue;
        } else
        if (tag == "n" || tag == "p") {
            v = tag == "p" ? "\n\n" : "\n";
            tmpl += v;
            continue;
        } else
        if (tag.startsWith("if")) {
            // @if type tester,admin@
            // @endif@
            end = str.indexOf(sep1 + "endif" + sep2);
            if (end == -1) continue;
            var body = str.substr(0, end);
            str = str.substr(end + 5 + sep1.length + sep2.length);
            d = tag.match(/^(if|ifnull|ifnotnull|ifempty|ifnotempty|ifne|ifeq|ifgt|ifge|iflt|ifle|ifnot|ifall|ifstr) ([a-zA-Z0-9._-]+) *(.*)$/)
            if (!d) continue;
            var ok, val = null, t = d[2];
            i = t.indexOf(".");
            if (i > 0) {
                field = t.substr(i + 1);
                t = t.substr(0, i);
            }
            for (i = 0; i < rc.length && !val; i++) {
                val = typeof rc[i][t] == "function" ? rc[i][t]() : rc[i][t];
                if (val && field && typeof val == "object") {
                    field = field.split(".");
                    for (j = 0; val && j < field.length; j++) {
                        val = val ? val[field[j]] : undefined;
                        if (typeof val == "function") val = val();
                    }
                }
            }
            switch (d[1]) {
            case "ifnull":
                ok = val === null || val === undefined;
                break;
            case "ifnotnull":
                ok = !!val;
                break;
            case "ifempty":
                ok = app.isEmpty(val);
                break;
            case "ifnotempty":
                ok = !app.isEmpty(val);
                break;
            case "if":
                ok = val && app.isFlag(app.strSplit(d[3]), app.strSplit(val));
                break;
            case "ifne":
                ok = val != d[3];
                break;
            case "ifnot":
                ok = !val || !app.isFlag(app.strSplit(d[3]), app.strSplit(val));
                break;
            case "ifall":
                val = app.strSplit(val);
                ok = app.strSplit(d[3]).every((x) => (val.includes(x)));
                break;
            case "ifstr":
                ok = app.testRegexp(val || "", app.toRegexp(d[3], "i"));
                break;
            case "ifnotstr":
                ok = !app.testRegexp(val || "", app.toRegexp(d[3], "i"));
                break;
            case "ifeq":
                ok = val == d[3];
                break;
            case "ifgt":
                ok = val > d[3];
                break;
            case "iflt":
                ok = val < d[3];
                break;
            case "ifge":
                ok = val >= d[3];
                break;
            case "ifle":
                ok = val <= d[3];
                break;
            }
            end = body.indexOf(sep1 + "else" + sep2);
            if (ok) {
                if (end > -1) body = body.substr(0, end);
                v = app.toTemplate(body, rc, options);
            } else
            if (end > -1) {
                body = body.substr(end + 4 + sep1.length + sep2.length);
                v = app.toTemplate(body, rc, options);
            }
        } else {
            d = tag.match(/^([a-zA-Z0-9._-]+)(\|.+)?$/);
            if (d) {
                tag = d[1];
                if (d[2]) dflt = d[2].substr(1);
                i = tag.indexOf(".");
                if (i > 0) {
                    field = tag.substr(i + 1);
                    tag = tag.substr(0, i);
                }
                if (dflt) {
                    i = dflt.indexOf("|");
                    if (i >= 0) {
                        enc = dflt.substr(i + 1);
                        dflt = dflt.substr(0, i);
                    }
                }
                for (i = 0; i < rc.length && !v; i++) {
                    v = typeof rc[i][tag] == "function" ? rc[i][tag]() : rc[i][tag];
                    if (v && field && typeof v == "object") {
                        field = field.split(".");
                        for (j = 0; v && j < field.length; j++) {
                            v = v ? v[field[j]] : undefined;
                            if (typeof v == "function") v = v();
                        }
                    }
                }
                if (typeof options.preprocess == "function") v = options.preprocess(tag, field, v, dflt, enc);
            } else {
                tmpl += sep1 + tag + sep2;
                continue;
            }
            if (Array.isArray(options.allow) && !options.allow.includes(tag)) continue;
            if (Array.isArray(options.skip) && options.skip.includes(tag)) continue;
            if (Array.isArray(options.only) && !options.only.includes(tag)) v = sep1 + tag + sep2;
        }
        v ??= dflt;
        if (v) {
            if (Array.isArray(v) && (typeof v[0] == "string" || typeof v[0] == "number")) v = v.toString(); else
            if (typeof v == "object") v = app.stringify(v);
            if (typeof encoder == "function") v = encoder(enc, v, options);
        }
        if (v !== null && v !== undefined && v !== "") tmpl += v;
        if (options.__exit) break;
    }
    if (options.noline) tmpl = tmpl.replace(/[\r\n]/g, "");
    if (options.nospace) tmpl = tmpl.replace(/ {2,}/g, " ").trim();
    if (top) delete options.__exit;
    return tmpl;
}

// Split string into array, ignore empty items,
// - `sep` is an RegExp to use as a separator instead of default  pattern `[,\|]`,
// - `options` is an object with the same properties as for the `toParams`, `datatype' will be used with
//   `toValue` to convert the value for each item
//
// If `str` is an array and type is not specified then all non-string items will be returned as is.
app.strSplit = function(str, sep, options)
{
    if (!str) return [];
    return (Array.isArray(str) ? str : (typeof str == "string" ? str : String(str)).split(sep || /[,|]/)).
            map((x) => {
                if (x === "" && !options?.keepempty) return x;
                x = options?.datatype ? app.toValue(x, options?.datatype) : typeof x == "string" ? x.trim() : x;
                if (typeof x != "string") return x;
                if (!options) return x;
                if (options.regexp && !options.regexp.test(x)) return "";
                if (options.lower) x = x.toLowerCase();
                if (options.upper) x = x.toUpperCase();
                if (options.strip) x = x.replace(options.strip, "");
                if (options.camel) x = app.toCamel(x, options);
                if (options.cap) x = app.toTitle(x);
                if (options.replace) {
                    for (const p in options.replace) {
                        x = x.replaceAll(p, options.replace[p]);
                    }
                }
                if (options.trunc > 0) x = x.substr(0, options.trunc);
                return x;
            }).
            filter((x) => (options?.keepempty || typeof x == "string" ? x.length : 1));
}

app.strSplitUnique = function(str, sep, type)
{
    var rc = [];
    var typed = type !== undefined;
    app.strSplit(str, sep, type).forEach((x) => {
        if (!rc.some((y) => (typed || !(typeof x == "string" && typeof y == "string") ? x == y : x.toLowerCase() == y.toLowerCase()))) rc.push(x);
    });
    return rc;
}

app.phraseSplit = function(str, options)
{
    if (typeof str != "string" || !str) return [];
    var delim = typeof options?.separator == "string" ? options.separator : " ";
    var quotes = typeof options?.quotes == "string" ? options.quotes : `"'`;
    var keepempty = options?.keepempty || null;

    var rc = [], i = 0, q, len = str.length;
    while (i < len) {
        while (i < len && delim.indexOf(str[i]) != -1) {
            if (keepempty) rc.push("");
            i++;
        }
        if (i >= len) break;
        // Opening quote
        if (quotes.indexOf(str[i]) > -1) {
            q = ++i;
            while (q < len) {
                while (q < len && quotes.indexOf(str[q]) == -1) q++;
                // Ignore escaped quotes
                if (q >= len || str[q - 1] != '\\') break;
                q++;
            }
            if (q < len) {
                if (keepempty || q - i > 0) rc.push(str.substr(i, q - i));
                while (q < len && delim.indexOf(str[q]) == -1) q++;
                if (q >= len) break;
                i = q + 1;
                continue;
            }
        }
        // End of the word
        for (q = i; q < len && delim.indexOf(str[q]) == -1; q++);
        if (q >= len) {
            if (keepempty || len - i > 0) rc.push(str.substr(i, len - i));
            break;
        } else {
            if (keepempty || q - i > 0) rc.push(str.substr(i, q - i));
        }
        i = q + 1;
    }
    return rc;
}

// Returns a new object constructed from the arguments pairs
app.objNew = function(...args)
{
    var obj = {};
    for (var i = 0; i < args.length - 1; i += 2) {
        if (args[i + 1] !== undefined) obj[args[i]] = args[i + 1];
    }
    return obj;
}

// Return all object properties
app.objKeys = function(obj)
{
    return app.isObject(obj) ? Object.keys(obj) : [];
}

// Shallow copy of an object, all additional arguments are treated as properties to be added to the new object
app.objClone = function(obj, ...args)
{
    var rc = Array.isArray(obj) ? [] : {}, o1, o2;
    for (const p in obj) {
        if (!obj.hasOwnProperty(p)) continue;
        o1 = obj[p];
        switch (app.typeName(o1)) {
        case "object":
            rc[p] = Object.assign({}, o1);
            break;
        case "map":
            rc[p] = o2 = new Map();
            for (const k of o1) o2.set(k[0], k[1]);
            break;
        case "set":
            rc[p] = o2 = new Set();
            for (const k of o1) o2.add(k);
            break;
        case "array":
            rc[p] = o1.slice(0);
            break;
        default:
            rc[p] = o1;
        }
    }
    for (let i = 0; i < args.length - 1; i += 2) {
        if (args[i] === "__proto__") continue;
        rc[args[i]] = args[i + 1];
    }
    return rc;
}

// Delete properties from the object, first arg is an object, the rest are properties to be deleted
app.objDel = function(obj, ...args)
{
    if (!app.isObject(obj)) return;
    for (let i = 0; i < args.length; i++) delete obj[args[i]];
    return obj;
}

// Return a value from object, can go deep inside, name is a list of parts or a string like part1.part2.part3...
app.objGet = function(obj, path)
{
    if (!Array.isArray(path)) path = String(path).split(".");
    for (var i = 0; i < path.length; i++) {
        obj = obj ? obj[path[i]] : undefined;
        if (obj === undefined) break;
    }
    return obj;
}

// Randomize the list items in place
app.shuffle = function(list)
{
    if (!Array.isArray(list)) return [];
    if (list.length == 1) return list;
    for (var i = 0; i < list.length; i++) {
        var j = Math.round((list.length - 1) * Math.random());
        if (i == j) {
            continue;
        }
        var item = list[j];
        list[j] = list[i];
        list[i] = item;
    }
    return list;
}

// Return a random hex string
app.random = function(size)
{
    var s = "", u = new Uint8Array(size || 16), h = "0123456789abcdef";
    window.crypto.getRandomValues(u);
    for (let i = 0; i < u.length; i++) s += h.charAt(u[i] >> 4) + h.charAt(u[i] & 0x0F);
    return s;
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
app.__ = function(msg, ...args)
{
    var lang = app.lang, locales = app.locales || "";

    if (typeof msg == "object" && msg.phrase) {
        lang = msg.locale || lang;
        msg = msg.phrase;
    }
    msg = (lang && locales[lang] && locales[lang][msg]) || msg;
    if (args.length == 0) return msg;
    return app.sprintf(msg, ...args);
}

// Based on Bootstrap internal sanitizer
var sanitizer = {
    _attrs: new Set(['background','cite','href','itemtype','longdesc','poster','src','xlink:href']),
    _urls: /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i,
    _data: /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i,
    _tags: {
        '*': ['class', 'dir', 'id', 'lang', 'role', /^aria-[\w-]*$/i,
              'data-bs-toggle', 'data-bs-target', 'data-bs-dismiss', 'data-bs-parent'],
        a: ['target', 'href', 'title', 'rel'], area: [],
        b: [], blockquote: [], br: [], button: [],
        col: [], code: [],
        div: [], em: [], hr: [],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'style'],
        h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
        i: [], li: [], ol: [], p: [], pre: [],
        s: [], small: [], span: [], sub: [], sup: [], strong: [],
        table: [], thead: [], tbody: [], th: [], tr: [], td: [],
        u: [], ul: [],
    },

    isattr: function(attr, list) {
        const name = attr.nodeName.toLowerCase();
        if (list.includes(name)) {
            if (sanitizer._attrs.has(name)) {
                return sanitizer._urls.test(attr.nodeValue) || sanitizer._data.test(attr.nodeValue);
            }
            return true;
        }
        return list.some((x) => (x instanceof RegExp && x.test(name)));
    },

    run: function(html, list) {
        if (!html || typeof html != "string") return html;
        const body = app.$parse(html);
        const elements = [...body.querySelectorAll('*')];
        for (const el of elements) {
            const name = el.nodeName.toLowerCase();
            if (sanitizer._tags[name]) {
                const allow = [...sanitizer._tags['*'], ...sanitizer._tags[name] || []];
                for (const attr of [...el.attributes]) {
                    if (!sanitizer.isattr(attr, allow)) el.removeAttribute(attr.nodeName);
                }
            } else {
                el.remove();
            }
        }
        return list ? Array.from(body.childNodes) : body.innerHTML;
    }
}
app.sanitizer = sanitizer;

// Inject CSS/Script resources into the current page, all urls are loaded at the same time by default.
// - `options.series` - load urls one after another
// - `options.async` if set then scripts executed as soon as loaded otherwise executing scripts will be in the order provided
// - `options.callback` will be called with (el, opts) args for customizations after loading each url or on error
// - `options.attrs` is an object with attributes to set like nonce, ...
// - `options.timeout` - call the callback after timeout
app.loadResources = function(urls, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof urls == "string") urls = [urls];
    app[`forEach${options?.series ? "Series" : ""}`](urls, (url, next) => {
        let el;
        const ev = () => { app.call(options?.callback, el, options); next() }
        if (/\.css/.test(url)) {
            el = app.$elem("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev)
        } else {
            el = app.$elem('script', "async", !!options?.async, "src", url, "load", ev, "error", ev)
        }
        for (const p in options?.attrs) app.$attr(el, p, options.attrs[p]);
        document.head.appendChild(el);
    }, options?.timeout > 0 ? () => { setTimeout(callback, options.timeout) } : callback);
}

// Return a file object for the selector
app.getFileInput = function(file)
{
    if (typeof file == "string") file = app.$(file);
    if (file?.jquery !== undefined && file.length) file = file[0];
    if (app.isO(file)) {
        if (file.files?.length) return file.files[0];
        if (!app.isE(file) && file.name && file.size && (file.type || file.lastModified)) return file;
    }
    return "";
}

})();
/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
app.send = function(options, onsuccess, onerror)
{
    if (app.isS(options)) options = { url: options };
    if (!options.headers) options.headers = {};
    if (!options.type) options.type = 'POST';
    options.headers["bk-tz"] = (new Date()).getTimezoneOffset();
    for (const p in app.headers) if (options.headers[p] === undefined) options.headers[p] = app.headers[p];
    for (const p in options.data) if (options.data[p] === undefined) delete options.data[p];
    app.emit("loading", "show");

    this[options.xhr ? "xhr" : "fetch"](options, (err, data, info) => {
        app.emit("loading", "hide");

        var h = info?.headers["bk-csrf"] || "";
        switch (h) {
        case "":
            break;
        case "0":
            if (!app.headers) break;
            delete app.headers["bk-csrf"];
            break;
        default:
            if (!app.headers) app.headers = {};
            app.headers["bk-csrf"] = h;
        }

        if (err) {
            if (!options.quiet) app.log('send:', err, options);
            if (options.alert) {
                var a = app.isS(options.alert);
                app.emit("alert", "error", a || err, { safe: !a });
            }
            app.call(options.self || this, onerror, err, info);
            if (options.trigger) app.emit(options.trigger, { url: options.url, query: options.data, err: err });
        } else {
            if (!data && options.dataType == 'json') data = {};
            if (options.info_msg || options.success_msg) {
                app.emit("alert", options.info_msg ? "info" : "success", options.info_msg || options.success_msg);
            }
            app.call(options.self || this, onsuccess, data, info);
            if (options.trigger) app.emit(options.trigger, { url: options.url, query: options.data, data: data });
        }
    });
}

app.get = function(options, callback)
{
    app.sendRequest(Object.assign(options, { type: "GET" }), callback);
}

// Make a request and use single callback with error as the first argument or null if no error
app.sendRequest = function(options, callback)
{
    return app.send(options, (data, info) => {
        app.call(options.self || this, callback, null, data, info);
    }, (err, info) => {
        app.call(options.self || this, callback, err, {}, info);
    });
}

// Send a file as multi-part upload, uses `options.name` or "data" for file namne. Additional files can be passed in the `options.files` object. Optional form inputs
// can be specified in the `options.data` object.
app.sendFile = function(options, callback)
{
    var v, n = 0, form = new FormData(), files = {};
    if (options.file) files[options.name || "data"] = options.file;
    for (const p in options.files) files[p] = options.files[p];
    for (const p in files) {
        v = app.getFileInput(files[p]);
        if (!v) continue;
        form.append(p, v);
        n++;
    }
    if (!n) return app.call(options.self || this, callback);

    const add = (k, v) => {
       form.append(k, app.isF(v) ? v() : v === null || v === true ? "" : v);
    }

    const build = (key, val) => {
        if (val === undefined) return;
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${app.isO(val[i]) ? i : ""}]`, val[i]);
        } else
        if (app.isObject(val)) {
            for (const n in val) build(`${key}[${n}]`, val[n]);
        } else {
            add(key, val);
        }
    }
    for (const p in options.data) build(p, options.data[p]);
    for (const p in options.json) {
        const blob = new Blob([JSON.stringify(options.json[p])], { type: "application/json" });
        form.append(p, blob);
    }

    // Send within the session, multipart is not supported by signature
    var rc = { url: options.url, data: form };
    for (const p in options) if (rc[p] === undefined) rc[p] = options[p];
    app.sendRequest(rc, callback);
}

// Make Ajax request, options are comptible with fetch
app.xhr = function(options, callback)
{
    const opts = app.fetchOpts(options);
    const r = new XMLHttpRequest();
    r.open(opts.method, options.url, options.sync ? false : true);
    if (options.dataType == "blob") r.responseType = "blob";
    for (const h in opts.headers) r.setRequestHeader(h, opts.headers[h]);
    r.onloadend = (ev) => {
        var info = { status: r.status, headers: {}, readyState: r.readyState };
        app.strSplit(r.getAllResponseHeaders(), /[\r\n]+/).forEach((line) => {
            line = line.split(': ');
            info.headers[line.shift()] = line.join(': ');
        });
        var data = r.response || "";
        if (/\/json/.test(info.headers["content-type"])) {
            try { data = JSON.parse(data) } catch (e) {}
        }
        if (r.status >= 200 && r.status < 300) {
            app.call(callback, null, data, info);
        } else {
            app.call(callback, { status: r.status, message: data.message || data || r.statusText }, data, info);
        }
    }
    try {
        r.send(opts.body || null);
    } catch (err) {
        app.call(callback, err);
    }
}

})();
/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Convert all special symbols into xml entities
app.textToXml = function(str)
{
    return String(str || "").replace(/([&<>'":])/g, (_, n) => {
      switch (n) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&apos;'
      default: return n;
      }
    });
}

app.textToEntity = function(str)
{
    if (typeof str != "string") return "";
    if (!app.textEntities) {
        app.textEntities = {};
        for (const p in app.htmlEntities) app.textEntities[app.htmlEntities[p]] = "&" + p + ";";
    }
    return str.replace(/([&<>'":])/g, (_, n) => (app.textEntities[n] || n));
}

// Convert html entities into their original symbols
app.entityToText = function(str)
{
    if (typeof str != "string") return "";
    return str.replace(/&(#?[a-zA-Z0-9]+);/g, (_, n) => {
        if (n[0] === '#') return n.charAt(1) === 'x' ? String.fromCharCode(parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
        return app.htmlEntities[n] || "";
    });
}

app._unicodeCache = {};

// Replace Unicode symbols with ASCII equivalents, types is a string with list of types of characters to
// replace, default is: opqs, for quotes,other,punctuations,spaces
app.unicode2Ascii = function(str, types)
{
    if (typeof str != "string") return "";
    types = typeof types == "string" && types || "opqs";
    var map = app._unicodeCache[types];
    if (!map) {
        map = app._unicodeCache[types] = {};
        for (var t of types) {
            Object.assign(app._unicodeCache[types], app.unicodeAsciiMap[t]);
        }
    }
    var rc = "";
    for (var c of str) rc += map[c] || c;
    return rc.trim();
}

app.htmlEntities = {
    'AElig': 'Æ','AMP': '','Aacute': 'Á','Abreve': 'Ă','Acirc': 'Â',
    'Acy': 'А','Afr': '𝔄','Agrave': 'À','Alpha': 'Α','Amacr': 'Ā',
    'And': '⩓','Aogon': 'Ą','Aopf': '𝔸','ApplyFunction': '','Aring': 'Å',
    'Ascr': '𝒜','Assign': '≔','Atilde': 'Ã','Auml': 'Ä','Backslash': '∖',
    'Barv': '⫧','Barwed': '⌆','Bcy': 'Б','Because': '∵','Bernoullis': 'ℬ',
    'Beta': 'Β','Bfr': '𝔅','Bopf': '𝔹','Breve': '˘','Bscr': 'ℬ',
    'Bumpeq': '≎','CHcy': 'Ч','COPY': '©','Cacute': 'Ć','Cap': '⋒',
    'CapitalDifferentialD': 'ⅅ','Cayleys': 'ℭ','Ccaron': 'Č','Ccedil': 'Ç','Ccirc': 'Ĉ',
    'Cconint': '∰','Cdot': 'Ċ','Cedilla': '¸','CenterDot': '·','Cfr': 'ℭ',
    'Chi': 'Χ','CircleDot': '⊙','CircleMinus': '⊖','CirclePlus': '⊕','CircleTimes': '⊗',
    'ClockwiseContourIntegral': '∲','CloseCurlyDoubleQuote': '”','CloseCurlyQuote': '’','Colon': '∷','Colone': '⩴',
    'Congruent': '≡','Conint': '∯','ContourIntegral': '∮','Copf': 'ℂ','Coproduct': '∐',
    'CounterClockwiseContourIntegral': '∳','Cross': '⨯','Cscr': '𝒞','Cup': '⋓','CupCap': '≍',
    'DD': 'ⅅ','DDotrahd': '⤑','DJcy': 'Ђ','DScy': 'Ѕ','DZcy': 'Џ',
    'Dagger': '‡','Darr': '↡','Dashv': '⫤','Dcaron': 'Ď','Dcy': 'Д',
    'Del': '∇','Delta': 'Δ','Dfr': '𝔇','DiacriticalAcute': '´','DiacriticalDot': '˙',
    'DiacriticalDoubleAcute': '˝','DiacriticalGrave': '`','DiacriticalTilde': '˜','Diamond': '⋄','DifferentialD': 'ⅆ',
    'Dopf': '𝔻','Dot': '¨','DotDot': '⃜','DotEqual': '≐','DoubleContourIntegral': '∯',
    'DoubleDot': '¨','DoubleDownArrow': '⇓','DoubleLeftArrow': '⇐','DoubleLeftRightArrow': '⇔','DoubleLeftTee': '⫤',
    'DoubleLongLeftArrow': '⟸','DoubleLongLeftRightArrow': '⟺','DoubleLongRightArrow': '⟹','DoubleRightArrow': '⇒','DoubleRightTee': '⊨',
    'DoubleUpArrow': '⇑','DoubleUpDownArrow': '⇕','DoubleVerticalBar': '∥','DownArrow': '↓','DownArrowBar': '⤓',
    'DownArrowUpArrow': '⇵','DownBreve': '̑','DownLeftRightVector': '⥐','DownLeftTeeVector': '⥞','DownLeftVector': '↽',
    'DownLeftVectorBar': '⥖','DownRightTeeVector': '⥟','DownRightVector': '⇁','DownRightVectorBar': '⥗','DownTee': '⊤',
    'DownTeeArrow': '↧','Downarrow': '⇓','Dscr': '𝒟','Dstrok': 'Đ','ENG': 'Ŋ',
    'ETH': 'Ð','Eacute': 'É','Ecaron': 'Ě','Ecirc': 'Ê','Ecy': 'Э',
    'Edot': 'Ė','Efr': '𝔈','Egrave': 'È','Element': '∈','Emacr': 'Ē',
    'EmptySmallSquare': '◻','EmptyVerySmallSquare': '▫','Eogon': 'Ę','Eopf': '𝔼','Epsilon': 'Ε',
    'Equal': '⩵','EqualTilde': '≂','Equilibrium': '⇌','Escr': 'ℰ','Esim': '⩳',
    'Eta': 'Η','Euml': 'Ë','Exists': '∃','ExponentialE': 'ⅇ','Fcy': 'Ф',
    'Ffr': '𝔉','FilledSmallSquare': '◼','FilledVerySmallSquare': '▪','Fopf': '𝔽','ForAll': '∀',
    'Fouriertrf': 'ℱ','Fscr': 'ℱ','GJcy': 'Ѓ','GT': '>','Gamma': 'Γ',
    'Gammad': 'Ϝ','Gbreve': 'Ğ','Gcedil': 'Ģ','Gcirc': 'Ĝ','Gcy': 'Г',
    'Gdot': 'Ġ','Gfr': '𝔊','Gg': '⋙','Gopf': '𝔾','GreaterEqual': '≥',
    'GreaterEqualLess': '⋛','GreaterFullEqual': '≧','GreaterGreater': '⪢','GreaterLess': '≷','GreaterSlantEqual': '⩾',
    'GreaterTilde': '≳','Gscr': '𝒢','Gt': '≫','HARDcy': 'Ъ','Hacek': 'ˇ',
    'Hat': '^','Hcirc': 'Ĥ','Hfr': 'ℌ','HilbertSpace': 'ℋ','Hopf': 'ℍ',
    'HorizontalLine': '─','Hscr': 'ℋ','Hstrok': 'Ħ','HumpDownHump': '≎','HumpEqual': '≏',
    'IEcy': 'Е','IJlig': 'Ĳ','IOcy': 'Ё','Iacute': 'Í','Icirc': 'Î',
    'Icy': 'И','Idot': 'İ','Ifr': 'ℑ','Igrave': 'Ì','Im': 'ℑ',
    'Imacr': 'Ī','ImaginaryI': 'ⅈ','Implies': '⇒','Int': '∬','Integral': '∫',
    'Intersection': '⋂','InvisibleComma': '','InvisibleTimes': '','Iogon': 'Į','Iopf': '𝕀',
    'Iota': 'Ι','Iscr': 'ℐ','Itilde': 'Ĩ','Iukcy': 'І','Iuml': 'Ï',
    'Jcirc': 'Ĵ','Jcy': 'Й','Jfr': '𝔍','Jopf': '𝕁','Jscr': '𝒥',
    'Jsercy': 'Ј','Jukcy': 'Є','KHcy': 'Х','KJcy': 'Ќ','Kappa': 'Κ',
    'Kcedil': 'Ķ','Kcy': 'К','Kfr': '𝔎','Kopf': '𝕂','Kscr': '𝒦',
    'LJcy': 'Љ','LT': '<','Lacute': 'Ĺ','Lambda': 'Λ','Lang': '⟪',
    'Laplacetrf': 'ℒ','Larr': '↞','Lcaron': 'Ľ','Lcedil': 'Ļ','Lcy': 'Л',
    'LeftAngleBracket': '⟨','LeftArrow': '←','LeftArrowBar': '⇤','LeftArrowRightArrow': '⇆','LeftCeiling': '⌈',
    'LeftDoubleBracket': '⟦','LeftDownTeeVector': '⥡','LeftDownVector': '⇃','LeftDownVectorBar': '⥙','LeftFloor': '⌊',
    'LeftRightArrow': '↔','LeftRightVector': '⥎','LeftTee': '⊣','LeftTeeArrow': '↤','LeftTeeVector': '⥚',
    'LeftTriangle': '⊲','LeftTriangleBar': '⧏','LeftTriangleEqual': '⊴','LeftUpDownVector': '⥑','LeftUpTeeVector': '⥠',
    'LeftUpVector': '↿','LeftUpVectorBar': '⥘','LeftVector': '↼','LeftVectorBar': '⥒','Leftarrow': '⇐',
    'Leftrightarrow': '⇔','LessEqualGreater': '⋚','LessFullEqual': '≦','LessGreater': '≶','LessLess': '⪡',
    'LessSlantEqual': '⩽','LessTilde': '≲','Lfr': '𝔏','Ll': '⋘','Lleftarrow': '⇚',
    'Lmidot': 'Ŀ','LongLeftArrow': '⟵','LongLeftRightArrow': '⟷','LongRightArrow': '⟶','Longleftarrow': '⟸',
    'Longleftrightarrow': '⟺','Longrightarrow': '⟹','Lopf': '𝕃','LowerLeftArrow': '↙','LowerRightArrow': '↘',
    'Lscr': 'ℒ','Lsh': '↰','Lstrok': 'Ł','Lt': '≪','Map': '⤅',
    'Mcy': 'М','MediumSpace': ' ','Mellintrf': 'ℳ','Mfr': '𝔐','MinusPlus': '∓',
    'Mopf': '𝕄','Mscr': 'ℳ','Mu': 'Μ','NJcy': 'Њ','Nacute': 'Ń',
    'Ncaron': 'Ň','Ncedil': 'Ņ','Ncy': 'Н','NegativeMediumSpace': '','NegativeThickSpace': '',
    'NegativeThinSpace': '','NegativeVeryThinSpace': '','NestedGreaterGreater': '≫','NestedLessLess': '≪','NewLine': '\n',
    'Nfr': '𝔑','NoBreak': '','NonBreakingSpace': ' ','Nopf': 'ℕ','Not': '⫬',
    'NotCongruent': '≢','NotCupCap': '≭','NotDoubleVerticalBar': '∦','NotElement': '∉','NotEqual': '≠',
    'NotEqualTilde': '≂̸','NotExists': '∄','NotGreater': '≯','NotGreaterEqual': '≱','NotGreaterFullEqual': '≧̸',
    'NotGreaterGreater': '≫̸','NotGreaterLess': '≹','NotGreaterSlantEqual': '⩾̸','NotGreaterTilde': '≵','NotHumpDownHump': '≎̸',
    'NotHumpEqual': '≏̸','NotLeftTriangle': '⋪','NotLeftTriangleBar': '⧏̸','NotLeftTriangleEqual': '⋬','NotLess': '≮',
    'NotLessEqual': '≰','NotLessGreater': '≸','NotLessLess': '≪̸','NotLessSlantEqual': '⩽̸','NotLessTilde': '≴',
    'NotNestedGreaterGreater': '⪢̸','NotNestedLessLess': '⪡̸','NotPrecedes': '⊀','NotPrecedesEqual': '⪯̸','NotPrecedesSlantEqual': '⋠',
    'NotReverseElement': '∌','NotRightTriangle': '⋫','NotRightTriangleBar': '⧐̸','NotRightTriangleEqual': '⋭','NotSquareSubset': '⊏̸',
    'NotSquareSubsetEqual': '⋢','NotSquareSuperset': '⊐̸','NotSquareSupersetEqual': '⋣','NotSubset': '⊂⃒','NotSubsetEqual': '⊈',
    'NotSucceeds': '⊁','NotSucceedsEqual': '⪰̸','NotSucceedsSlantEqual': '⋡','NotSucceedsTilde': '≿̸','NotSuperset': '⊃⃒',
    'NotSupersetEqual': '⊉','NotTilde': '≁','NotTildeEqual': '≄','NotTildeFullEqual': '≇','NotTildeTilde': '≉',
    'NotVerticalBar': '∤','Nscr': '𝒩','Ntilde': 'Ñ','Nu': 'Ν','OElig': 'Œ',
    'Oacute': 'Ó','Ocirc': 'Ô','Ocy': 'О','Odblac': 'Ő','Ofr': '𝔒',
    'Ograve': 'Ò','Omacr': 'Ō','Omega': 'Ω','Omicron': 'Ο','Oopf': '𝕆',
    'OpenCurlyDoubleQuote': '“','OpenCurlyQuote': '‘','Or': '⩔','Oscr': '𝒪','Oslash': 'Ø',
    'Otilde': 'Õ','Otimes': '⨷','Ouml': 'Ö','OverBar': '‾','OverBrace': '⏞',
    'OverBracket': '⎴','OverParenthesis': '⏜','PartialD': '∂','Pcy': 'П','Pfr': '𝔓',
    'Phi': 'Φ','Pi': 'Π','PlusMinus': '±','Poincareplane': 'ℌ','Popf': 'ℙ',
    'Pr': '⪻','Precedes': '≺','PrecedesEqual': '⪯','PrecedesSlantEqual': '≼','PrecedesTilde': '≾',
    'Prime': '″','Product': '∏','Proportion': '∷','Proportional': '∝','Pscr': '𝒫',
    'Psi': 'Ψ','QUOT': '"','Qfr': '𝔔','Qopf': 'ℚ','Qscr': '𝒬',
    'RBarr': '⤐','REG': '®','Racute': 'Ŕ','Rang': '⟫','Rarr': '↠',
    'Rarrtl': '⤖','Rcaron': 'Ř','Rcedil': 'Ŗ','Rcy': 'Р','Re': 'ℜ',
    'ReverseElement': '∋','ReverseEquilibrium': '⇋','ReverseUpEquilibrium': '⥯','Rfr': 'ℜ','Rho': 'Ρ',
    'RightAngleBracket': '⟩','RightArrow': '→','RightArrowBar': '⇥','RightArrowLeftArrow': '⇄','RightCeiling': '⌉',
    'RightDoubleBracket': '⟧','RightDownTeeVector': '⥝','RightDownVector': '⇂','RightDownVectorBar': '⥕','RightFloor': '⌋',
    'RightTee': '⊢','RightTeeArrow': '↦','RightTeeVector': '⥛','RightTriangle': '⊳','RightTriangleBar': '⧐',
    'RightTriangleEqual': '⊵','RightUpDownVector': '⥏','RightUpTeeVector': '⥜','RightUpVector': '↾','RightUpVectorBar': '⥔',
    'RightVector': '⇀','RightVectorBar': '⥓','Rightarrow': '⇒','Ropf': 'ℝ','RoundImplies': '⥰',
    'Rrightarrow': '⇛','Rscr': 'ℛ','Rsh': '↱','RuleDelayed': '⧴','SHCHcy': 'Щ',
    'SHcy': 'Ш','SOFTcy': 'Ь','Sacute': 'Ś','Sc': '⪼','Scaron': 'Š',
    'Scedil': 'Ş','Scirc': 'Ŝ','Scy': 'С','Sfr': '𝔖','ShortDownArrow': '↓',
    'ShortLeftArrow': '←','ShortRightArrow': '→','ShortUpArrow': '↑','Sigma': 'Σ','SmallCircle': '∘',
    'Sopf': '𝕊','Sqrt': '√','Square': '□','SquareIntersection': '⊓','SquareSubset': '⊏',
    'SquareSubsetEqual': '⊑','SquareSuperset': '⊐','SquareSupersetEqual': '⊒','SquareUnion': '⊔','Sscr': '𝒮',
    'Star': '⋆','Sub': '⋐','Subset': '⋐','SubsetEqual': '⊆','Succeeds': '≻',
    'SucceedsEqual': '⪰','SucceedsSlantEqual': '≽','SucceedsTilde': '≿','SuchThat': '∋','Sum': '∑',
    'Sup': '⋑','Superset': '⊃','SupersetEqual': '⊇','Supset': '⋑','THORN': 'Þ',
    'TRADE': '™','TSHcy': 'Ћ','TScy': 'Ц','Tab': '  ','Tau': 'Τ',
    'Tcaron': 'Ť','Tcedil': 'Ţ','Tcy': 'Т','Tfr': '𝔗','Therefore': '∴',
    'Theta': 'Θ','ThickSpace': '  ','ThinSpace': ' ','Tilde': '∼','TildeEqual': '≃',
    'TildeFullEqual': '≅','TildeTilde': '≈','Topf': '𝕋','TripleDot': '⃛','Tscr': '𝒯',
    'Tstrok': 'Ŧ','Uacute': 'Ú','Uarr': '↟','Uarrocir': '⥉','Ubrcy': 'Ў',
    'Ubreve': 'Ŭ','Ucirc': 'Û','Ucy': 'У','Udblac': 'Ű','Ufr': '𝔘',
    'Ugrave': 'Ù','Umacr': 'Ū','UnderBar': '_','UnderBrace': '⏟','UnderBracket': '⎵',
    'UnderParenthesis': '⏝','Union': '⋃','UnionPlus': '⊎','Uogon': 'Ų','Uopf': '𝕌',
    'UpArrow': '↑','UpArrowBar': '⤒','UpArrowDownArrow': '⇅','UpDownArrow': '↕','UpEquilibrium': '⥮',
    'UpTee': '⊥','UpTeeArrow': '↥','Uparrow': '⇑','Updownarrow': '⇕','UpperLeftArrow': '↖',
    'UpperRightArrow': '↗','Upsi': 'ϒ','Upsilon': 'Υ','Uring': 'Ů','Uscr': '𝒰',
    'Utilde': 'Ũ','Uuml': 'Ü','VDash': '⊫','Vbar': '⫫','Vcy': 'В',
    'Vdash': '⊩','Vdashl': '⫦','Vee': '⋁','Verbar': '‖','Vert': '‖',
    'VerticalBar': '∣','VerticalLine': '|','VerticalSeparator': '❘','VerticalTilde': '≀','VeryThinSpace': ' ',
    'Vfr': '𝔙','Vopf': '𝕍','Vscr': '𝒱','Vvdash': '⊪','Wcirc': 'Ŵ',
    'Wedge': '⋀','Wfr': '𝔚','Wopf': '𝕎','Wscr': '𝒲','Xfr': '𝔛',
    'Xi': 'Ξ','Xopf': '𝕏','Xscr': '𝒳','YAcy': 'Я','YIcy': 'Ї',
    'YUcy': 'Ю','Yacute': 'Ý','Ycirc': 'Ŷ','Ycy': 'Ы','Yfr': '𝔜',
    'Yopf': '𝕐','Yscr': '𝒴','Yuml': 'Ÿ','ZHcy': 'Ж','Zacute': 'Ź',
    'Zcaron': 'Ž','Zcy': 'З','Zdot': 'Ż','ZeroWidthSpace': '','Zeta': 'Ζ',
    'Zfr': 'ℨ','Zopf': 'ℤ','Zscr': '𝒵','aacute': 'á','abreve': 'ă',
    'ac': '∾','acE': '∾̳','acd': '∿','acirc': 'â','acute': '´',
    'acy': 'а','aelig': 'æ','af': '','afr': '𝔞','agrave': 'à',
    'alefsym': 'ℵ','aleph': 'ℵ','alpha': 'α','amacr': 'ā','amalg': '⨿',
    'amp': '','and': '∧','andand': '⩕','andd': '⩜','andslope': '⩘',
    'andv': '⩚','ang': '∠','ange': '⦤','angle': '∠','angmsd': '∡',
    'angmsdaa': '⦨','angmsdab': '⦩','angmsdac': '⦪','angmsdad': '⦫','angmsdae': '⦬',
    'angmsdaf': '⦭','angmsdag': '⦮','angmsdah': '⦯','angrt': '∟','angrtvb': '⊾',
    'angrtvbd': '⦝','angsph': '∢','angst': 'Å','angzarr': '⍼','aogon': 'ą',
    'aopf': '𝕒','ap': '≈','apE': '⩰','apacir': '⩯','ape': '≊',
    'apid': '≋','apos': "'",'approx': '≈','approxeq': '≊','aring': 'å',
    'ascr': '𝒶','ast': '*','asymp': '≈','asympeq': '≍','atilde': 'ã',
    'auml': 'ä','awconint': '∳','awint': '⨑','bNot': '⫭','backcong': '≌',
    'backepsilon': '϶','backprime': '‵','backsim': '∽','backsimeq': '⋍','barvee': '⊽',
    'barwed': '⌅','barwedge': '⌅','bbrk': '⎵','bbrktbrk': '⎶','bcong': '≌',
    'bcy': 'б','bdquo': '„','becaus': '∵','because': '∵','bemptyv': '⦰',
    'bepsi': '϶','bernou': 'ℬ','beta': 'β','beth': 'ℶ','between': '≬',
    'bfr': '𝔟','bigcap': '⋂','bigcirc': '◯','bigcup': '⋃','bigodot': '⨀',
    'bigoplus': '⨁','bigotimes': '⨂','bigsqcup': '⨆','bigstar': '★','bigtriangledown': '▽',
    'bigtriangleup': '△','biguplus': '⨄','bigvee': '⋁','bigwedge': '⋀','bkarow': '⤍',
    'blacklozenge': '⧫','blacksquare': '▪','blacktriangle': '▴','blacktriangledown': '▾','blacktriangleleft': '◂',
    'blacktriangleright': '▸','blank': '␣','blk12': '▒','blk14': '░','blk34': '▓',
    'block': '█','bne': '=⃥','bnequiv': '≡⃥','bnot': '⌐','bopf': '𝕓',
    'bot': '⊥','bottom': '⊥','bowtie': '⋈','boxDL': '╗','boxDR': '╔',
    'boxDl': '╖','boxDr': '╓','boxH': '═','boxHD': '╦','boxHU': '╩',
    'boxHd': '╤','boxHu': '╧','boxUL': '╝','boxUR': '╚','boxUl': '╜',
    'boxUr': '╙','boxV': '║','boxVH': '╬','boxVL': '╣','boxVR': '╠',
    'boxVh': '╫','boxVl': '╢','boxVr': '╟','boxbox': '⧉','boxdL': '╕',
    'boxdR': '╒','boxdl': '┐','boxdr': '┌','boxh': '─','boxhD': '╥',
    'boxhU': '╨','boxhd': '┬','boxhu': '┴','boxminus': '⊟','boxplus': '⊞',
    'boxtimes': '⊠','boxuL': '╛','boxuR': '╘','boxul': '┘','boxur': '└',
    'boxv': '│','boxvH': '╪','boxvL': '╡','boxvR': '╞','boxvh': '┼',
    'boxvl': '┤','boxvr': '├','bprime': '‵','breve': '˘','brvbar': '¦',
    'bscr': '𝒷','bsemi': '⁏','bsim': '∽','bsime': '⋍','bsol': '\\',
    'bsolb': '⧅','bsolhsub': '⟈','bull': '•','bullet': '•','bump': '≎',
    'bumpE': '⪮','bumpe': '≏','bumpeq': '≏','cacute': 'ć','cap': '∩',
    'capand': '⩄','capbrcup': '⩉','capcap': '⩋','capcup': '⩇','capdot': '⩀',
    'caps': '∩︀','caret': '⁁','caron': 'ˇ','ccaps': '⩍','ccaron': 'č',
    'ccedil': 'ç','ccirc': 'ĉ','ccups': '⩌','ccupssm': '⩐','cdot': 'ċ',
    'cedil': '¸','cemptyv': '⦲','cent': '¢','centerdot': '·','cfr': '𝔠',
    'chcy': 'ч','check': '✓','checkmark': '✓','chi': 'χ','cir': '○',
    'cirE': '⧃','circ': 'ˆ','circeq': '≗','circlearrowleft': '↺','circlearrowright': '↻',
    'circledR': '®','circledS': 'Ⓢ','circledast': '⊛','circledcirc': '⊚','circleddash': '⊝',
    'cire': '≗','cirfnint': '⨐','cirmid': '⫯','cirscir': '⧂','clubs': '♣',
    'clubsuit': '♣','colon': ':','colone': '≔','coloneq': '≔','comma': ',',
    'commat': '@','comp': '∁','compfn': '∘','complement': '∁','complexes': 'ℂ',
    'cong': '≅','congdot': '⩭','conint': '∮','copf': '𝕔','coprod': '∐',
    'copy': '©','copysr': '℗','crarr': '↵','cross': '✗','cscr': '𝒸',
    'csub': '⫏','csube': '⫑','csup': '⫐','csupe': '⫒','ctdot': '⋯',
    'cudarrl': '⤸','cudarrr': '⤵','cuepr': '⋞','cuesc': '⋟','cularr': '↶',
    'cularrp': '⤽','cup': '∪','cupbrcap': '⩈','cupcap': '⩆','cupcup': '⩊',
    'cupdot': '⊍','cupor': '⩅','cups': '∪︀','curarr': '↷','curarrm': '⤼',
    'curlyeqprec': '⋞','curlyeqsucc': '⋟','curlyvee': '⋎','curlywedge': '⋏','curren': '¤',
    'curvearrowleft': '↶','curvearrowright': '↷','cuvee': '⋎','cuwed': '⋏','cwconint': '∲',
    'cwint': '∱','cylcty': '⌭','dArr': '⇓','dHar': '⥥','dagger': '†',
    'daleth': 'ℸ','darr': '↓','dash': '‐','dashv': '⊣','dbkarow': '⤏',
    'dblac': '˝','dcaron': 'ď','dcy': 'д','dd': 'ⅆ','ddagger': '‡',
    'ddarr': '⇊','ddotseq': '⩷','deg': '°','delta': 'δ','demptyv': '⦱',
    'dfisht': '⥿','dfr': '𝔡','dharl': '⇃','dharr': '⇂','diam': '⋄',
    'diamond': '⋄','diamondsuit': '♦','diams': '♦','die': '¨','digamma': 'ϝ',
    'disin': '⋲','div': '÷','divide': '÷','divideontimes': '⋇','divonx': '⋇',
    'djcy': 'ђ','dlcorn': '⌞','dlcrop': '⌍','dollar': '$','dopf': '𝕕',
    'dot': '˙','doteq': '≐','doteqdot': '≑','dotminus': '∸','dotplus': '∔',
    'dotsquare': '⊡','doublebarwedge': '⌆','downarrow': '↓','downdownarrows': '⇊','downharpoonleft': '⇃',
    'downharpoonright': '⇂','drbkarow': '⤐','drcorn': '⌟','drcrop': '⌌','dscr': '𝒹',
    'dscy': 'ѕ','dsol': '⧶','dstrok': 'đ','dtdot': '⋱','dtri': '▿',
    'dtrif': '▾','duarr': '⇵','duhar': '⥯','dwangle': '⦦','dzcy': 'џ',
    'dzigrarr': '⟿','eDDot': '⩷','eDot': '≑','eacute': 'é','easter': '⩮',
    'ecaron': 'ě','ecir': '≖','ecirc': 'ê','ecolon': '≕','ecy': 'э',
    'edot': 'ė','ee': 'ⅇ','efDot': '≒','efr': '𝔢','eg': '⪚',
    'egrave': 'è','egs': '⪖','egsdot': '⪘','el': '⪙','elinters': '⏧',
    'ell': 'ℓ','els': '⪕','elsdot': '⪗','emacr': 'ē','empty': '∅',
    'emptyset': '∅','emptyv': '∅','emsp13': ' ','emsp14': ' ','emsp': ' ',
    'eng': 'ŋ','ensp': ' ','eogon': 'ę','eopf': '𝕖','epar': '⋕',
    'eparsl': '⧣','eplus': '⩱','epsi': 'ε','epsilon': 'ε','epsiv': 'ϵ',
    'eqcirc': '≖','eqcolon': '≕','eqsim': '≂','eqslantgtr': '⪖','eqslantless': '⪕',
    'equals': '=','equest': '≟','equiv': '≡','equivDD': '⩸','eqvparsl': '⧥',
    'erDot': '≓','erarr': '⥱','escr': 'ℯ','esdot': '≐','esim': '≂',
    'eta': 'η','eth': 'ð','euml': 'ë','euro': '€','excl': '!',
    'exist': '∃','expectation': 'ℰ','exponentiale': 'ⅇ','fallingdotseq': '≒','fcy': 'ф',
    'female': '♀','ffilig': 'ﬃ','fflig': 'ﬀ','ffllig': 'ﬄ','ffr': '𝔣',
    'filig': 'ﬁ','fjlig': 'fj','flat': '♭','fllig': 'ﬂ','fltns': '▱',
    'fnof': 'ƒ','fopf': '𝕗','forall': '∀','fork': '⋔','forkv': '⫙',
    'fpartint': '⨍','frac12': '½','frac13': '⅓','frac14': '¼','frac15': '⅕',
    'frac16': '⅙','frac18': '⅛','frac23': '⅔','frac25': '⅖','frac34': '¾',
    'frac35': '⅗','frac38': '⅜','frac45': '⅘','frac56': '⅚','frac58': '⅝',
    'frac78': '⅞','frasl': '⁄','frown': '⌢','fscr': '𝒻','gE': '≧',
    'gEl': '⪌','gacute': 'ǵ','gamma': 'γ','gammad': 'ϝ','gap': '⪆',
    'gbreve': 'ğ','gcirc': 'ĝ','gcy': 'г','gdot': 'ġ','ge': '≥',
    'gel': '⋛','geq': '≥','geqq': '≧','geqslant': '⩾','ges': '⩾',
    'gescc': '⪩','gesdot': '⪀','gesdoto': '⪂','gesdotol': '⪄','gesl': '⋛︀',
    'gesles': '⪔','gfr': '𝔤','gg': '≫','ggg': '⋙','gimel': 'ℷ',
    'gjcy': 'ѓ','gl': '≷','glE': '⪒','gla': '⪥','glj': '⪤',
    'gnE': '≩','gnap': '⪊','gnapprox': '⪊','gne': '⪈','gneq': '⪈',
    'gneqq': '≩','gnsim': '⋧','gopf': '𝕘','grave': '`','gscr': 'ℊ',
    'gsim': '≳','gsime': '⪎','gsiml': '⪐','gt': '>','gtcc': '⪧',
    'gtcir': '⩺','gtdot': '⋗','gtlPar': '⦕','gtquest': '⩼','gtrapprox': '⪆',
    'gtrarr': '⥸','gtrdot': '⋗','gtreqless': '⋛','gtreqqless': '⪌','gtrless': '≷',
    'gtrsim': '≳','gvertneqq': '≩︀','gvnE': '≩︀','hArr': '⇔','hairsp': ' ',
    'half': '½','hamilt': 'ℋ','hardcy': 'ъ','harr': '↔','harrcir': '⥈',
    'harrw': '↭','hbar': 'ℏ','hcirc': 'ĥ','hearts': '♥','heartsuit': '♥',
    'hellip': '…','hercon': '⊹','hfr': '𝔥','hksearow': '⤥','hkswarow': '⤦',
    'hoarr': '⇿','homtht': '∻','hookleftarrow': '↩','hookrightarrow': '↪','hopf': '𝕙',
    'horbar': '―','hscr': '𝒽','hslash': 'ℏ','hstrok': 'ħ','hybull': '⁃',
    'hyphen': '‐','iacute': 'í','ic': '','icirc': 'î','icy': 'и',
    'iecy': 'е','iexcl': '¡','iff': '⇔','ifr': '𝔦','igrave': 'ì',
    'ii': 'ⅈ','iiiint': '⨌','iiint': '∭','iinfin': '⧜','iiota': '℩',
    'ijlig': 'ĳ','imacr': 'ī','image': 'ℑ','imagline': 'ℐ','imagpart': 'ℑ',
    'imath': 'ı','imof': '⊷','imped': 'Ƶ','in': '∈','incare': '℅',
    'infin': '∞','infintie': '⧝','inodot': 'ı','int': '∫','intcal': '⊺',
    'integers': 'ℤ','intercal': '⊺','intlarhk': '⨗','intprod': '⨼','iocy': 'ё',
    'iogon': 'į','iopf': '𝕚','iota': 'ι','iprod': '⨼','iquest': '¿',
    'iscr': '𝒾','isin': '∈','isinE': '⋹','isindot': '⋵','isins': '⋴',
    'isinsv': '⋳','isinv': '∈','it': '','itilde': 'ĩ','iukcy': 'і',
    'iuml': 'ï','jcirc': 'ĵ','jcy': 'й','jfr': '𝔧','jmath': 'ȷ',
    'jopf': '𝕛','jscr': '𝒿','jsercy': 'ј','jukcy': 'є','kappa': 'κ',
    'kappav': 'ϰ','kcedil': 'ķ','kcy': 'к','kfr': '𝔨','kgreen': 'ĸ',
    'khcy': 'х','kjcy': 'ќ','kopf': '𝕜','kscr': '𝓀','lAarr': '⇚',
    'lArr': '⇐','lAtail': '⤛','lBarr': '⤎','lE': '≦','lEg': '⪋',
    'lHar': '⥢','lacute': 'ĺ','laemptyv': '⦴','lagran': 'ℒ','lambda': 'λ',
    'lang': '⟨','langd': '⦑','langle': '⟨','lap': '⪅','laquo': '«',
    'larr': '←','larrb': '⇤','larrbfs': '⤟','larrfs': '⤝','larrhk': '↩',
    'larrlp': '↫','larrpl': '⤹','larrsim': '⥳','larrtl': '↢','lat': '⪫',
    'latail': '⤙','late': '⪭','lates': '⪭︀','lbarr': '⤌','lbbrk': '❲',
    'lbrace': '{','lbrack': '[','lbrke': '⦋','lbrksld': '⦏','lbrkslu': '⦍',
    'lcaron': 'ľ','lcedil': 'ļ','lceil': '⌈','lcub': '{','lcy': 'л',
    'ldca': '⤶','ldquo': '“','ldquor': '„','ldrdhar': '⥧','ldrushar': '⥋',
    'ldsh': '↲','le': '≤','leftarrow': '←','leftarrowtail': '↢','leftharpoondown': '↽',
    'leftharpoonup': '↼','leftleftarrows': '⇇','leftrightarrow': '↔','leftrightarrows': '⇆','leftrightharpoons': '⇋',
    'leftrightsquigarrow': '↭','leftthreetimes': '⋋','leg': '⋚','leq': '≤','leqq': '≦',
    'leqslant': '⩽','les': '⩽','lescc': '⪨','lesdot': '⩿','lesdoto': '⪁',
    'lesdotor': '⪃','lesg': '⋚︀','lesges': '⪓','lessapprox': '⪅','lessdot': '⋖',
    'lesseqgtr': '⋚','lesseqqgtr': '⪋','lessgtr': '≶','lesssim': '≲','lfisht': '⥼',
    'lfloor': '⌊','lfr': '𝔩','lg': '≶','lgE': '⪑','lhard': '↽',
    'lharu': '↼','lharul': '⥪','lhblk': '▄','ljcy': 'љ','ll': '≪',
    'llarr': '⇇','llcorner': '⌞','llhard': '⥫','lltri': '◺','lmidot': 'ŀ',
    'lmoust': '⎰','lmoustache': '⎰','lnE': '≨','lnap': '⪉','lnapprox': '⪉',
    'lne': '⪇','lneq': '⪇','lneqq': '≨','lnsim': '⋦','loang': '⟬',
    'loarr': '⇽','lobrk': '⟦','longleftarrow': '⟵','longleftrightarrow': '⟷','longmapsto': '⟼',
    'longrightarrow': '⟶','looparrowleft': '↫','looparrowright': '↬','lopar': '⦅','lopf': '𝕝',
    'loplus': '⨭','lotimes': '⨴','lowast': '∗','lowbar': '_','loz': '◊',
    'lozenge': '◊','lozf': '⧫','lpar': '(','lparlt': '⦓','lrarr': '⇆',
    'lrcorner': '⌟','lrhar': '⇋','lrhard': '⥭','lrm': '','lrtri': '⊿',
    'lsaquo': '‹','lscr': '𝓁','lsh': '↰','lsim': '≲','lsime': '⪍',
    'lsimg': '⪏','lsqb': '[','lsquo': '‘','lsquor': '‚','lstrok': 'ł',
    'lt': '<','ltcc': '⪦','ltcir': '⩹','ltdot': '⋖','lthree': '⋋',
    'ltimes': '⋉','ltlarr': '⥶','ltquest': '⩻','ltrPar': '⦖','ltri': '◃',
    'ltrie': '⊴','ltrif': '◂','lurdshar': '⥊','luruhar': '⥦','lvertneqq': '≨︀',
    'lvnE': '≨︀','mDDot': '∺','macr': '¯','male': '♂','malt': '✠',
    'maltese': '✠','map': '↦','mapsto': '↦','mapstodown': '↧','mapstoleft': '↤',
    'mapstoup': '↥','marker': '▮','mcomma': '⨩','mcy': 'м','mdash': '—',
    'measuredangle': '∡','mfr': '𝔪','mho': '℧','micro': 'µ','mid': '∣',
    'midast': '*','midcir': '⫰','middot': '·','minus': '−','minusb': '⊟',
    'minusd': '∸','minusdu': '⨪','mlcp': '⫛','mldr': '…','mnplus': '∓',
    'models': '⊧','mopf': '𝕞','mp': '∓','mscr': '𝓂','mstpos': '∾',
    'mu': 'μ','multimap': '⊸','mumap': '⊸','nGg': '⋙̸','nGt': '≫⃒',
    'nGtv': '≫̸','nLeftarrow': '⇍','nLeftrightarrow': '⇎','nLl': '⋘̸','nLt': '≪⃒',
    'nLtv': '≪̸','nRightarrow': '⇏','nVDash': '⊯','nVdash': '⊮','nabla': '∇',
    'nacute': 'ń','nang': '∠⃒','nap': '≉','napE': '⩰̸','napid': '≋̸',
    'napos': 'ŉ','napprox': '≉','natur': '♮','natural': '♮','naturals': 'ℕ',
    'nbsp': ' ','nbump': '≎̸','nbumpe': '≏̸','ncap': '⩃','ncaron': 'ň',
    'ncedil': 'ņ','ncong': '≇','ncongdot': '⩭̸','ncup': '⩂','ncy': 'н',
    'ndash': '–','ne': '≠','neArr': '⇗','nearhk': '⤤','nearr': '↗',
    'nearrow': '↗','nedot': '≐̸','nequiv': '≢','nesear': '⤨','nesim': '≂̸',
    'nexist': '∄','nexists': '∄','nfr': '𝔫','ngE': '≧̸','nge': '≱',
    'ngeq': '≱','ngeqq': '≧̸','ngeqslant': '⩾̸','nges': '⩾̸','ngsim': '≵',
    'ngt': '≯','ngtr': '≯','nhArr': '⇎','nharr': '↮','nhpar': '⫲',
    'ni': '∋','nis': '⋼','nisd': '⋺','niv': '∋','njcy': 'њ',
    'nlArr': '⇍','nlE': '≦̸','nlarr': '↚','nldr': '‥','nle': '≰',
    'nleftarrow': '↚','nleftrightarrow': '↮','nleq': '≰','nleqq': '≦̸','nleqslant': '⩽̸',
    'nles': '⩽̸','nless': '≮','nlsim': '≴','nlt': '≮','nltri': '⋪',
    'nltrie': '⋬','nmid': '∤','nopf': '𝕟','not': '¬','notin': '∉',
    'notinE': '⋹̸','notindot': '⋵̸','notinva': '∉','notinvb': '⋷','notinvc': '⋶',
    'notni': '∌','notniva': '∌','notnivb': '⋾','notnivc': '⋽','npar': '∦',
    'nparallel': '∦','nparsl': '⫽⃥','npart': '∂̸','npolint': '⨔','npr': '⊀',
    'nprcue': '⋠','npre': '⪯̸','nprec': '⊀','npreceq': '⪯̸','nrArr': '⇏',
    'nrarr': '↛','nrarrc': '⤳̸','nrarrw': '↝̸','nrightarrow': '↛','nrtri': '⋫',
    'nrtrie': '⋭','nsc': '⊁','nsccue': '⋡','nsce': '⪰̸','nscr': '𝓃',
    'nshortmid': '∤','nshortparallel': '∦','nsim': '≁','nsime': '≄','nsimeq': '≄',
    'nsmid': '∤','nspar': '∦','nsqsube': '⋢','nsqsupe': '⋣','nsub': '⊄',
    'nsubE': '⫅̸','nsube': '⊈','nsubset': '⊂⃒','nsubseteq': '⊈','nsubseteqq': '⫅̸',
    'nsucc': '⊁','nsucceq': '⪰̸','nsup': '⊅','nsupE': '⫆̸','nsupe': '⊉',
    'nsupset': '⊃⃒','nsupseteq': '⊉','nsupseteqq': '⫆̸','ntgl': '≹','ntilde': 'ñ',
    'ntlg': '≸','ntriangleleft': '⋪','ntrianglelefteq': '⋬','ntriangleright': '⋫','ntrianglerighteq': '⋭',
    'nu': 'ν','num': '#','numero': '№','numsp': ' ','nvDash': '⊭',
    'nvHarr': '⤄','nvap': '≍⃒','nvdash': '⊬','nvge': '≥⃒','nvgt': '>⃒',
    'nvinfin': '⧞','nvlArr': '⤂','nvle': '≤⃒','nvlt': '<⃒','nvltrie': '⊴⃒',
    'nvrArr': '⤃','nvrtrie': '⊵⃒','nvsim': '∼⃒','nwArr': '⇖','nwarhk': '⤣',
    'nwarr': '↖','nwarrow': '↖','nwnear': '⤧','oS': 'Ⓢ','oacute': 'ó',
    'oast': '⊛','ocir': '⊚','ocirc': 'ô','ocy': 'о','odash': '⊝',
    'odblac': 'ő','odiv': '⨸','odot': '⊙','odsold': '⦼','oelig': 'œ',
    'ofcir': '⦿','ofr': '𝔬','ogon': '˛','ograve': 'ò','ogt': '⧁',
    'ohbar': '⦵','ohm': 'Ω','oint': '∮','olarr': '↺','olcir': '⦾',
    'olcross': '⦻','oline': '‾','olt': '⧀','omacr': 'ō','omega': 'ω',
    'omicron': 'ο','omid': '⦶','ominus': '⊖','oopf': '𝕠','opar': '⦷',
    'operp': '⦹','oplus': '⊕','or': '∨','orarr': '↻','ord': '⩝',
    'order': 'ℴ','orderof': 'ℴ','ordf': 'ª','ordm': 'º','origof': '⊶',
    'oror': '⩖','orslope': '⩗','orv': '⩛','oscr': 'ℴ','oslash': 'ø',
    'osol': '⊘','otilde': 'õ','otimes': '⊗','otimesas': '⨶','ouml': 'ö',
    'ovbar': '⌽','par': '∥','para': '¶','parallel': '∥','parsim': '⫳',
    'parsl': '⫽','part': '∂','pcy': 'п','percnt': '%','period': '.',
    'permil': '‰','perp': '⊥','pertenk': '‱','pfr': '𝔭','phi': 'φ',
    'phiv': 'ϕ','phmmat': 'ℳ','phone': '☎','pi': 'π','pitchfork': '⋔',
    'piv': 'ϖ','planck': 'ℏ','planckh': 'ℎ','plankv': 'ℏ','plus': '+',
    'plusacir': '⨣','plusb': '⊞','pluscir': '⨢','plusdo': '∔','plusdu': '⨥',
    'pluse': '⩲','plusmn': '±','plussim': '⨦','plustwo': '⨧','pm': '±',
    'pointint': '⨕','popf': '𝕡','pound': '£','pr': '≺','prE': '⪳',
    'prap': '⪷','prcue': '≼','pre': '⪯','prec': '≺','precapprox': '⪷',
    'preccurlyeq': '≼','preceq': '⪯','precnapprox': '⪹','precneqq': '⪵','precnsim': '⋨',
    'precsim': '≾','prime': '′','primes': 'ℙ','prnE': '⪵','prnap': '⪹',
    'prnsim': '⋨','prod': '∏','profalar': '⌮','profline': '⌒','profsurf': '⌓',
    'prop': '∝','propto': '∝','prsim': '≾','prurel': '⊰','pscr': '𝓅',
    'psi': 'ψ','puncsp': ' ','qfr': '𝔮','qint': '⨌','qopf': '𝕢',
    'qprime': '⁗','qscr': '𝓆','quaternions': 'ℍ','quatint': '⨖','quest': '?',
    'questeq': '≟','quot': '"','rAarr': '⇛','rArr': '⇒','rAtail': '⤜',
    'rBarr': '⤏','rHar': '⥤','race': '∽̱','racute': 'ŕ','radic': '√',
    'raemptyv': '⦳','rang': '⟩','rangd': '⦒','range': '⦥','rangle': '⟩',
    'raquo': '»','rarr': '→','rarrap': '⥵','rarrb': '⇥','rarrbfs': '⤠',
    'rarrc': '⤳','rarrfs': '⤞','rarrhk': '↪','rarrlp': '↬','rarrpl': '⥅',
    'rarrsim': '⥴','rarrtl': '↣','rarrw': '↝','ratail': '⤚','ratio': '∶',
    'rationals': 'ℚ','rbarr': '⤍','rbbrk': '❳','rbrace': '}','rbrack': ']',
    'rbrke': '⦌','rbrksld': '⦎','rbrkslu': '⦐','rcaron': 'ř','rcedil': 'ŗ',
    'rceil': '⌉','rcub': '}','rcy': 'р','rdca': '⤷','rdldhar': '⥩',
    'rdquo': '”','rdquor': '”','rdsh': '↳','real': 'ℜ','realine': 'ℛ',
    'realpart': 'ℜ','reals': 'ℝ','rect': '▭','reg': '®','rfisht': '⥽',
    'rfloor': '⌋','rfr': '𝔯','rhard': '⇁','rharu': '⇀','rharul': '⥬',
    'rho': 'ρ','rhov': 'ϱ','rightarrow': '→','rightarrowtail': '↣','rightharpoondown': '⇁',
    'rightharpoonup': '⇀','rightleftarrows': '⇄','rightleftharpoons': '⇌','rightrightarrows': '⇉','rightsquigarrow': '↝',
    'rightthreetimes': '⋌','ring': '˚','risingdotseq': '≓','rlarr': '⇄','rlhar': '⇌',
    'rlm': '','rmoust': '⎱','rmoustache': '⎱','rnmid': '⫮','roang': '⟭',
    'roarr': '⇾','robrk': '⟧','ropar': '⦆','ropf': '𝕣','roplus': '⨮',
    'rotimes': '⨵','rpar': ')','rpargt': '⦔','rppolint': '⨒','rrarr': '⇉',
    'rsaquo': '›','rscr': '𝓇','rsh': '↱','rsqb': ']','rsquo': '’',
    'rsquor': '’','rthree': '⋌','rtimes': '⋊','rtri': '▹','rtrie': '⊵',
    'rtrif': '▸','rtriltri': '⧎','ruluhar': '⥨','rx': '℞','sacute': 'ś',
    'sbquo': '‚','sc': '≻','scE': '⪴','scap': '⪸','scaron': 'š',
    'sccue': '≽','sce': '⪰','scedil': 'ş','scirc': 'ŝ','scnE': '⪶',
    'scnap': '⪺','scnsim': '⋩','scpolint': '⨓','scsim': '≿','scy': 'с',
    'sdot': '⋅','sdotb': '⊡','sdote': '⩦','seArr': '⇘','searhk': '⤥',
    'searr': '↘','searrow': '↘','sect': '§','semi': '','seswar': '⤩',
    'setminus': '∖','setmn': '∖','sext': '✶','sfr': '𝔰','sfrown': '⌢',
    'sharp': '♯','shchcy': 'щ','shcy': 'ш','shortmid': '∣','shortparallel': '∥',
    'shy': '','sigma': 'σ','sigmaf': 'ς','sigmav': 'ς','sim': '∼',
    'simdot': '⩪','sime': '≃','simeq': '≃','simg': '⪞','simgE': '⪠',
    'siml': '⪝','simlE': '⪟','simne': '≆','simplus': '⨤','simrarr': '⥲',
    'slarr': '←','smallsetminus': '∖','smashp': '⨳','smeparsl': '⧤','smid': '∣',
    'smile': '⌣','smt': '⪪','smte': '⪬','smtes': '⪬︀','softcy': 'ь',
    'sol': '/','solb': '⧄','solbar': '⌿','sopf': '𝕤','spades': '♠',
    'spadesuit': '♠','spar': '∥','sqcap': '⊓','sqcaps': '⊓︀','sqcup': '⊔',
    'sqcups': '⊔︀','sqsub': '⊏','sqsube': '⊑','sqsubset': '⊏','sqsubseteq': '⊑',
    'sqsup': '⊐','sqsupe': '⊒','sqsupset': '⊐','sqsupseteq': '⊒','squ': '□',
    'square': '□','squarf': '▪','squf': '▪','srarr': '→','sscr': '𝓈',
    'ssetmn': '∖','ssmile': '⌣','sstarf': '⋆','star': '☆','starf': '★',
    'straightepsilon': 'ϵ','straightphi': 'ϕ','strns': '¯','sub': '⊂','subE': '⫅',
    'subdot': '⪽','sube': '⊆','subedot': '⫃','submult': '⫁','subnE': '⫋',
    'subne': '⊊','subplus': '⪿','subrarr': '⥹','subset': '⊂','subseteq': '⊆',
    'subseteqq': '⫅','subsetneq': '⊊','subsetneqq': '⫋','subsim': '⫇','subsub': '⫕',
    'subsup': '⫓','succ': '≻','succapprox': '⪸','succcurlyeq': '≽','succeq': '⪰',
    'succnapprox': '⪺','succneqq': '⪶','succnsim': '⋩','succsim': '≿','sum': '∑',
    'sung': '♪','sup1': '¹','sup2': '²','sup3': '³','sup': '⊃',
    'supE': '⫆','supdot': '⪾','supdsub': '⫘','supe': '⊇','supedot': '⫄',
    'suphsol': '⟉','suphsub': '⫗','suplarr': '⥻','supmult': '⫂','supnE': '⫌',
    'supne': '⊋','supplus': '⫀','supset': '⊃','supseteq': '⊇','supseteqq': '⫆',
    'supsetneq': '⊋','supsetneqq': '⫌','supsim': '⫈','supsub': '⫔','supsup': '⫖',
    'swArr': '⇙','swarhk': '⤦','swarr': '↙','swarrow': '↙','swnwar': '⤪',
    'szlig': 'ß','target': '⌖','tau': 'τ','tbrk': '⎴','tcaron': 'ť',
    'tcedil': 'ţ','tcy': 'т','tdot': '⃛','telrec': '⌕','tfr': '𝔱',
    'there4': '∴','therefore': '∴','theta': 'θ','thetasym': 'ϑ','thetav': 'ϑ',
    'thickapprox': '≈','thicksim': '∼','thinsp': ' ','thkap': '≈','thksim': '∼',
    'thorn': 'þ','tilde': '˜','times': '×','timesb': '⊠','timesbar': '⨱',
    'timesd': '⨰','tint': '∭','toea': '⤨','top': '⊤','topbot': '⌶',
    'topcir': '⫱','topf': '𝕥','topfork': '⫚','tosa': '⤩','tprime': '‴',
    'trade': '™','triangle': '▵','triangledown': '▿','triangleleft': '◃','trianglelefteq': '⊴',
    'triangleq': '≜','triangleright': '▹','trianglerighteq': '⊵','tridot': '◬','trie': '≜',
    'triminus': '⨺','triplus': '⨹','trisb': '⧍','tritime': '⨻','trpezium': '⏢',
    'tscr': '𝓉','tscy': 'ц','tshcy': 'ћ','tstrok': 'ŧ','twixt': '≬',
    'twoheadleftarrow': '↞','twoheadrightarrow': '↠','uArr': '⇑','uHar': '⥣','uacute': 'ú',
    'uarr': '↑','ubrcy': 'ў','ubreve': 'ŭ','ucirc': 'û','ucy': 'у',
    'udarr': '⇅','udblac': 'ű','udhar': '⥮','ufisht': '⥾','ufr': '𝔲',
    'ugrave': 'ù','uharl': '↿','uharr': '↾','uhblk': '▀','ulcorn': '⌜',
    'ulcorner': '⌜','ulcrop': '⌏','ultri': '◸','umacr': 'ū','uml': '¨',
    'uogon': 'ų','uopf': '𝕦','uparrow': '↑','updownarrow': '↕','upharpoonleft': '↿',
    'upharpoonright': '↾','uplus': '⊎','upsi': 'υ','upsih': 'ϒ','upsilon': 'υ',
    'upuparrows': '⇈','urcorn': '⌝','urcorner': '⌝','urcrop': '⌎','uring': 'ů',
    'urtri': '◹','uscr': '𝓊','utdot': '⋰','utilde': 'ũ','utri': '▵',
    'utrif': '▴','uuarr': '⇈','uuml': 'ü','uwangle': '⦧','vArr': '⇕',
    'vBar': '⫨','vBarv': '⫩','vDash': '⊨','vangrt': '⦜','varepsilon': 'ϵ',
    'varkappa': 'ϰ','varnothing': '∅','varphi': 'ϕ','varpi': 'ϖ','varpropto': '∝',
    'varr': '↕','varrho': 'ϱ','varsigma': 'ς','varsubsetneq': '⊊︀','varsubsetneqq': '⫋︀',
    'varsupsetneq': '⊋︀','varsupsetneqq': '⫌︀','vartheta': 'ϑ','vartriangleleft': '⊲','vartriangleright': '⊳',
    'vcy': 'в','vdash': '⊢','vee': '∨','veebar': '⊻','veeeq': '≚',
    'vellip': '⋮','verbar': '|','vert': '|','vfr': '𝔳','vltri': '⊲',
    'vnsub': '⊂⃒','vnsup': '⊃⃒','vopf': '𝕧','vprop': '∝','vrtri': '⊳',
    'vscr': '𝓋','vsubnE': '⫋︀','vsubne': '⊊︀','vsupnE': '⫌︀','vsupne': '⊋︀',
    'vzigzag': '⦚','wcirc': 'ŵ','wedbar': '⩟','wedge': '∧','wedgeq': '≙',
    'weierp': '℘','wfr': '𝔴','wopf': '𝕨','wp': '℘','wr': '≀',
    'wreath': '≀','wscr': '𝓌','xcap': '⋂','xcirc': '◯','xcup': '⋃',
    'xdtri': '▽','xfr': '𝔵','xhArr': '⟺','xharr': '⟷','xi': 'ξ',
    'xlArr': '⟸','xlarr': '⟵','xmap': '⟼','xnis': '⋻','xodot': '⨀',
    'xopf': '𝕩','xoplus': '⨁','xotime': '⨂','xrArr': '⟹','xrarr': '⟶',
    'xscr': '𝓍','xsqcup': '⨆','xuplus': '⨄','xutri': '△','xvee': '⋁',
    'xwedge': '⋀','yacute': 'ý','yacy': 'я','ycirc': 'ŷ','ycy': 'ы',
    'yen': '¥','yfr': '𝔶','yicy': 'ї','yopf': '𝕪','yscr': '𝓎',
    'yucy': 'ю','yuml': 'ÿ','zacute': 'ź','zcaron': 'ž','zcy': 'з',
    'zdot': 'ż','zeetrf': 'ℨ','zeta': 'ζ','zfr': '𝔷','zhcy': 'ж',
};

app.unicodeAsciiMap = {
    d: {
        "\uFF10": "0", "\uFF11": "1", "\uFF12": "2", "\uFF13": "3", "\uFF14": "4",
        "\uFF15": "5", "\uFF16": "6", "\uFF17": "7", "\uFF18": "8", "\uFF19": "9",
    },

    l: {
        "\uFF21": "A", "\u1D00": "A", "\uFF22": "B", "\u0299": "B", "\uFF23": "C", "\u1D04": "C",
        "\uFF24": "D", "\u1D05": "D", "\uFF25": "E", "\u1D07": "E", "\uFF26": "F", "\uA730": "F",
        "\uFF27": "G", "\u0262": "G", "\uFF28": "H", "\u029C": "H", "\uFF29": "I", "\u026A": "I",
        "\uFF2A": "J", "\u1D0A": "J", "\uFF2B": "K", "\u1D0B": "K", "\uFF2C": "L", "\u029F": "L",
        "\uFF2D": "M", "\u1D0D": "M", "\uFF2E": "N", "\u0274": "N", "\uFF2F": "O", "\u1D0F": "O",
        "\uFF30": "P", "\u1D18": "P", "\uFF31": "Q", "\uFF32": "R", "\u0280": "R", "\uFF33": "S",
        "\uA731": "S", "\uFF34": "T", "\u1D1B": "T", "\uFF35": "U", "\u1D1C": "U", "\uFF36": "V",
        "\u1D20": "V", "\uFF37": "W", "\u1D21": "W", "\uFF38": "X", "\uFF39": "Y", "\u028F": "Y",
        "\uFF3A": "Z", "\u1D22": "Z",
    },

    q: {
        "\u00AB": "\"", "\u00BB": "\"", "\u201C": "\"", "\u201D": "\"", "\u02BA": "\"", "\u02EE": "\"",
        "\u201F": "\"", "\u275D": "\"", "\u275E": "\"", "\u301D": "\"", "\u301E": "\"",
        "\uFF02": "\"", "\u2018": "'", "\u2019": "'", "\u02BB": "'", "\u02C8": "'", "\u02BC": "'",
        "\u02BD": "'", "\u02B9": "'", "\u201B": "'", "\uFF07": "'", "\u00B4": "'", "\u02CA": "'",
        "\u0060": "'", "\u02CB": "'", "\u275B": "'", "\u275C": "'", "\u0313": "'", "\u0314": "'",
        "\uFE10": "'", "\uFE11": "'", "\u00A0": "'", "\u2000": "'", "\u201E": "\"",
    },

    o: {
        "\u00BC": "1/4", "\u00BD": "1/2", "\u00BE": "3/4",

        "\u20D2": "|", "\u20D3": "|", "\u2223": "|", "\uFF5C": "|", "\u23B8": "|",
        "\u23B9": "|", "\u23D0": "|", "\u239C": "|", "\u239F": "|",

        "\uFE6B": "@", "\uFF20": "@",
        "\uFE69": "$", "\uFF04": "$",
        "\uFE5F": "#", "\uFF03": "#",
        "\uFE6A": "%", "\uFF05": "%",
        "\uFE60": "&", "\uFF06": "&",


        "\u2768": "(", "\u276A": "(", "\uFE59": "(", "\uFF08": "(", "\u27EE": "(", "\u2985": "(",
        "\u2769": ")", "\u276B": ")", "\uFE5A": ")", "\uFF09": ")", "\u27EF": ")", "\u2986": ")",

        "\u204E": "*", "\u2217": "*", "\u229B": "*", "\u2722": "*", "\u2723": "*",
        "\u2724": "*", "\u2725": "*", "\u2731": "*", "\u2732": "*", "\u2733": "*", "\u273A": "*",
        "\u273B": "*", "\u273C": "*", "\u273D": "*", "\u2743": "*", "\u2749": "*", "\u274A": "*",
        "\u274B": "*", "\u29C6": "*", "\uFE61": "*", "\uFF0A": "*",

        "\u02D6": "+", "\uFE62": "+", "\uFF0B": "+",

        "\u00F7": "/", "\u29F8": "/", "\u0337": "/", "\u0338": "/", "\u2044": "/", "\u2215": "/", "\uFF0F": "/",
        "\u29F9": "\\", "\u29F5": "\\", "\u20E5": "\\", "\uFE68": "\\", "\uFF3C": "\\",

        "\uFE64": "<", "\uFF1C": "<", "\u2039": ">", "\u203A": "<", "\uFE65": ">", "\uFF1E": ">",

        "\u0347": "=", "\uA78A": "=", "\uFE66": "=", "\uFF1D": "=",

        "\u02C6": "^", "\u0302": "^", "\uFF3E": "^", "\u1DCD": "^",
        "\u2774": "{", "\uFE5B": "{", "\uFF5B": "{", "\u2775": "}", "\uFE5C": "}", "\uFF5D": "}",
        "\uFF3B": "[", "\uFF3D": "]",
        "\u02DC": "~", "\u02F7": "~", "\u0303": "~", "\u0330": "~", "\u0334": "~", "\u223C": "~", "\uFF5E": "~",

    },

    p: {
        "\u3002": ".", "\uFE52": ".", "\uFF0E": ".", "\uFF61": ".",
        "\uFF64": ", ", "\u201A": ", ", "\u0326": ", ", "\uFE50": ", ", "\uFE51": ", ", "\uFF0C": ", ",
        "\u02D0": ":", "\u02F8": ":", "\u2982": ":", "\uA789": ":", "\uFE13": ":", "\uFF1A": ":",
        "\u204F": ";", "\uFE14": ";", "\uFE54": ";", "\uFF1B": ";",
        "\uFE16": "?", "\uFE56": "?", "\uFF1F": "?",
        "\u01C3": "!", "\uFE15": "!", "\uFE57": "!", "\uFF01": "!",
        "\u2026": "...", "\u203C": "!!",
        "\u0332": "_", "\uFF3F": "_", "\u2017": "_", "\u2014": "-", "\u2013": "-",
        "\u23BC": "-", "\u23BD": "-", "\u2015": "-", "\uFE63": "-", "\uFF0D": "-", "\u2010": "-", "\u2043": "-",
    },

    s: {
        "\u2001": " ", "\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ", "\u2006": " ",
        "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u205F": " ",
        "\u008D": " ", "\u009F": " ", "\u0080": " ", "\u0090": " ", "\u009B": " ", "\u0010": " ",
        "\u0009": " ", "\u0000": " ", "\u0003": " ", "\u0004": " ", "\u0017": " ", "\u0019": " ",
        "\u0011": " ", "\u0012": " ", "\u0013": " ", "\u0014": " ", "\u2028": " ", "\u2029": " ",
        "\u2060": " ", "\u202C": " ", "\u3000": " ",
    }
};

})();
/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Websockets
app.wsconf = {
    host: null,
    port: 0,
    path: "/",
    query: null,
    retry_timeout: 500,
    retry_factor: 2,
    max_timeout: 30000,
    max_retries: Infinity,
    max_pending: 10,
    ping_interval: 300000,
    _retries: 0,
    _pending: [],
};

// Open a new websocket connection, updates the wsconf from the options
app.wsConnect = function(options)
{
    var conf = app.wsconf;
    if (conf._timer) {
        clearTimeout(conf._timer);
        delete conf._timer;
    }
    if (conf.disabled) return;

    for (const p in options) conf[p] = options[p];
    var host = conf.host || window.location.hostname;

    if (navigator.onLine === false && !/^(localhost|127.0.0.1)$/.test(host)) {
        return app.wsTimer(0);
    }

    if (!conf.query) conf.query = {};
    for (const p in conf.headers) if (conf.query[p] === undefined) conf.query[p] = conf.headers[p];

    var port = conf.port || window.location.port;
    var proto = conf.protocol || window.location.protocol.replace("http", "ws");
    var url = `${proto}//${host}:${port}${conf.path}?${conf.query ? new URLSearchParams(conf.query).toString() : ""}`;

    app.ws = new WebSocket(url);
    app.ws.onopen = () => {
        if (conf.debug) app.log("ws.open:", url);
        app.emit("ws:open", url);
        conf._ctime = Date.now();
        conf._timeout = conf.retry_timeout;
        conf._retries = 0;
        while (conf._pending.length) {
            app.wsSend(conf.pending.shift());
        }
        app.wsPing();
    }
    app.ws.onclose = () => {
        if (conf.debug) app.log("ws.closed:", url, conf._timeout, conf._retries);
        app.ws = null;
        app.emit("ws:close", url);
        if (++conf._retries < conf.max_retries) app.wsTimer();
    }
    app.ws.onmessage = (msg) => {
        var data = msg.data;
        if (data === "bye") return app.wsClose(1);
        if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (conf.debug) app.log('ws.message:', data);
        app.emit("ws:message", data);
    }
    app.ws.onerror = (err) => {
        if (conf.debug) app.log('ws.error:', url, err);
    }
}

// Restart websocket reconnect timer, increase conf.timeout according to reconnect policy conf.(retry_factor, max_timeout)
app.wsTimer = function(timeout)
{
    var conf = app.wsconf;
    clearTimeout(conf._timer);
    if (conf.disabled) return;
    if (typeof timeout == "number") conf._timeout = timeout;
    conf._timer = setTimeout(app.wsConnect.bind(this), conf._timeout);
    conf._timeout *= conf._timeout == conf.max_timeout ? 0 : conf.retry_factor;
    conf._timeout = app.toClamp(conf._timeout, conf.retry_timeout, conf.max_timeout);
}

// Send a ping and shcedule next one
app.wsPing = function()
{
    var conf = app.wsconf;
    clearTimeout(conf._ping);
    if (conf.disabled || !conf.ping_interval) return;
    if (app.ws?.readyState === WebSocket.OPEN) {
        app.ws.send(conf.ping_path || "/ping");
    }
    conf._ping = setTimeout(app.wsPing.bind(this), conf.ping_interval);
}

// Closes and possibly disables WS connection, to reconnect again must delete .disabled property from wsconf
app.wsClose = function(disable)
{
    app.wsconf.disabled = disable;
    if (app.ws) {
        app.ws.close();
        delete app.ws;
    }
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
app.wsSend = function(data)
{
    var conf = app.wsconf;
    if (app.ws?.readyState != WebSocket.OPEN) {
        if (!conf.max_pending || conf._pending.length < conf.max_pending) {
            conf._pending.push(data);
        }
        return;
    }
    if (app.isO(data)) {
        if (data.url && data.url[0] == "/") {
            data = data.url;
            if (app.isO(data.data)) {
                data += "?" + new URLSearchParams(data.data).toString();
            }
        } else {
            data = JSON.stringified(data);
        }
    }
    app.ws.send(data);
}

// Check the status of websocket connection, reconnect if needed
app.wsOnline = function()
{
    if (app.wsconf.debug) app.log('ws.online:', navigator.onLine, app.ws?.readyState, app.wsconf.path, app.wsconf._ctime);
    if (app.ws?.readyState !== WebSocket.OPEN && app.wsconf._ctime) {
        app.wsConnect();
    }
}

app.$ready(() => {
    app.$on(window, "online", app.wsOnline);
});

})();
/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// True if current credentials are good
app.loggedIn = false;

    // HTTP headers to be sent with every request
app.headers = {};

// Current user record
app.user = {};

// Secret policy for plain text passwords
app.passwordPolicy = {
    '[a-z]+': 'requires at least one lower case letter',
    '[A-Z]+': 'requires at least one upper case letter',
    '[0-9]+': 'requires at least one digit',
    '.{9,}': 'requires at least 9 characters',
};

// Verify user secret against the policy
app.checkPassword = function(secret, policy, options)
{
    secret = secret || "";
    policy = policy || app.passwordPolicy;
    for (var p in policy) {
        if (!secret.match(p)) {
            return {
                status: 400,
                message: app.__(policy[p]),
                policy: Object.keys(policy).map((x) => (app.__(policy[x]))),
            };
        }
    }
    return "";
}

// Try to authenticate with the supplied login and secret
app.login = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    app.send({ url: options?.url || "/auth", data: options?.data }, (data) => {
        app.loggedIn = true;
        Object.assign(app.user, data);
        app.call(callback);
        app.emit("login", options?.path);
    }, (err) => {
        app.loggedIn = false;
        for (const p in app.user) delete app.user[p];
        app.call(callback, err);
        app.emit("nologin", err);
    });
}

// Logout and clear all cookies and local credentials
app.logout = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    for (const p in app.user) delete app.user[p];
    app.loggedIn = false;
    app.sendRequest({ url: options?.url || "/logout" }, (err) => {
        app.call(callback, err);
        app.emit("logout", err);
    });
}

// Retrieve current user record, call the callback with the object or error
app.getUser = function(query, callback)
{
    if (typeof query == "function") callback = query, query = null;
    app.sendRequest({ url: "/auth", data: query }, (err, data) => {
        if (!err) Object.assign(app.user, data);
        app.call(callback, err, data);
    });
}

})();
//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

// Passkey support

(() => {
var app = window.app;

app.passkeyInit = function(callback)
{
    if (app.passkeyClient) return;
    import("/js/webauthn.min.mjs").then((mod) => {
        app.passkeyClient = mod.client;
        app.call(callback)
    }).catch((err) => {
        app.call(callback, err);
    });
}

app.passkeyRegisterStart = function(options, callback)
{
    app.get({ url: "/passkey/register", data: options?.query }, callback);
}

app.passkeyRegisterFinish = function(config, options, callback)
{
    app.passkeyClient.register(options?.name || app.account?.name, config?.challenge, {
        attestation: true,
        userHandle: config?.id,
        domain: config?.domain,
    }).then((data) => {
        app.sendRequest({ url: "/passkey/register", data: Object.assign(data || {}, options?.query) }, callback);
    }).catch((err) => {
        app.call(callback, err);
    });
}

app.passkeyRegister = function(options, callback)
{
    app.passkeyRegisterStart(options, (err, config) => {
        if (err) return app.call(callback, err);
        app.passkeyRegisterFinish(config, options, callback);
    });
}

app.passkeyLogin = function(options, callback)
{
    app.get({ url: "/passkey/login" }, (err, config) => {
        if (err) return app.call(callback, err);

        app.passkeyClient.authenticate(app.strSplit(options?.ids), config.challenge, {
            domain: config.domain,
        }).then((data) => {
            app.login({ url: "/passkey/login", data: Object.assign(data, options?.query) }, callback);
        }).catch((err) => {
            app.call(callback, err);
        });
    });
}

})();
//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// Bootstrap backend support

(() => {
var app = window.app;

app.getBreakpoint = function()
{
    var w = document.documentElement.clientWidth;
    return w < 576 ? 'xs' : w < 768 ? 'sm' : w < 992 ? 'md' : w < 1200 ? 'lg' : w < 1400 ? 'xl' : 'xxl';
}

app.setBreakpoint = function()
{
    app.isMobile = /xs|sm|md/.test(app.getBreakpoint());
    document.documentElement.style.setProperty('--height', (window.innerHeight * 0.01) + "px");
    app.emit("breakpoint");
}

app.setColorScheme = function()
{
    document.documentElement.setAttribute("data-bs-theme", window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light");
}

// Show/hide loading animation, only first element
var loading = { count: 0 };

app.showLoading = function(op)
{
    var imgs = app.$all('.loading');
    if (!imgs.length) return;

    switch (op) {
    case "hide":
        if (--loading.count > 0) break;
        loading.count = 0;
        imgs.forEach(img => { img.style.visibility = "hidden" })
        break;

    case "show":
        if (loading.count++ > 0) break;
        imgs.forEach(img => { img.style.visibility = "visible" })
        break;
    }
}

app.getAlertText = function(text, options)
{
    text = text?.message || text?.text || text?.msg || text;
    text = typeof text == "string" ? options?.safe ? text : app.textToEntity(text) : app.formatJSON(text, { preset: "compact" }).replace(/[<>]/g, "");
    return app.sanitizer.run(text).replace(/\n/g, "<br>");
}

app.showAlert = function(obj, type, text, options)
{
    if (obj?.jquery !== undefined) obj = obj[0];
    if (typeof obj == "string") options = text, text = type, type = obj, obj = document.body;
    if (!text) return;
    var o = Object.assign({}, options, { type });
    o.type = o.type == "error" ? "danger" : o.type || "info";

    var element = o.element || ".alerts";
    var alerts = app.$(element, app.isE(obj) || document.body);
    if (!alerts) return;

    var html = `
    <div class="alert alert-dismissible alert-${o.type} show fade" role="alert">
        ${o.icon ? `<i class="fa fa-fw ${o.icon}"></i>` : ""}
        ${app.getAlertText(text, o)}
        <button type="button" class="btn-close" data-dismiss="alert" aria-label="Close"></button>
    </div>`;
    if (o.hide || alerts.style.display == "none") {
        alerts.dataset.alert = "hide";
        alerts.style.display = "block";
    }
    if (o.css) alerts.classList.add(o.css);
    if (o.clear) app.$empty(alerts);
    var alert = app.$parse(html).firstElementChild;
    var instance = bootstrap.Alert.getOrCreateInstance(alert);
    alerts.prepend(alert);
    if (!o.dismiss) {
        o.delay = (o.delay || 3000) * (type == "danger" || type == "warning" ? 3 : type == "info" ? 2 : 1);
        setTimeout(() => { instance.close() }, o.delay);
    }
    app.$on(alert, 'closed.bs.alert', (ev) => { cleanupAlerts(alerts, o) });
    if (o.scroll) alerts.scrollIntoView();
    return alert;
}

app.hideAlert = function(obj, options)
{
    var alerts = app.$(options?.element || ".alerts", obj);
    if (!alerts) return;
    app.$empty(alerts);
    cleanupAlerts(alerts, options);
}

const cleanupAlerts = (alerts, options) => {
    if (alerts.firstElementChild) return;
    if (options?.css) alerts.classList.remove(options.css);
    if (options?.hide || alerts.dataset.alert == "hide") alerts.style.display = "none";
    delete alerts.dataset.alert;
}

app.showConfirm = function(options, callback, cancelled)
{
    if (typeof options == "string") options = { text: options };

    var opts = {
        self: options.self || this,
        sanitizer: app.sanitizer,
        title: options.title || 'Confirm',
        show_header: options.title !== null,
        buttons: ["cancel", "ok"],
        content: [{ div: { html: String(options.text || "").replace(/\n/g, "<br>"), class: options.css || "" } }],
        ok: () => { app.call(this, callback) },
        cancel: () => { app.call(this, cancelled) },
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

app.showPrompt = function(options, callback)
{
    if (typeof options == "string") options = { text: options };

    var value;
    var opts = {
        self: options.self || this,
        sanitizer: app.sanitizer,
        title: options.title || 'Prompt',
        buttons: ["cancel", "ok"],
        content: [{ input: { name: "value", label: String(options.text || "").replace(/\n/g, "<br>"), class: `form-control ${options.css ||""}`, value: options.value } }],
        ok: (d) => { value = d.value },
        dismiss: () => { app.call(this, callback, value) }
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

app.showLogin = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var popup;
    var opts = {
        self: options.self || this,
        sanitizer: app.sanitizer,
        id: "app-login-modal",
        show_header: false,
        buttons: ["cancel", "ok"],
        text_ok: "Login",
        content: [
            { h4: {
                html: `<img src="${options?.logo || "/img/logo.png"}" style="max-height: 3rem;"> ${options?.title || 'Please Sign In'}`,
                class: "text-center py-4"
            } },
            { input: { name: "login", label: options?.login || "Login", placeholder: options?.login, autofocus: true,
                       keyup: (ev) => { if (ev.which == 13) { app.$('input[type="password"]', popup.form).focus(); ev.preventDefault() } }
            } },
            { password: { name: "secret", label: options?.password || "Password", placeholder: "Password",
                          keyup: (ev) => { if (ev.which == 13) { popup.form.submit(); ev.preventDefault() } }
            } },
            options?.disclaimer ? { div: { html: options.disclaimer } } : null,
        ],
        ok: function(d) {
            if (typeof options?.onSubmit == "function" && !options.onSubmit(popup, d)) return false;
            app.login({ url: options.url, data: d }, (err) => {
                if (err) popup.showAlert(err);
                app.call(this, callback, err);
            });
            return false;
        },
    }
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    popup = bootpopup(opts);
    return popup;
}

app.showToast = function(element, type, text, options)
{
    if (typeof element == "string") options = text, text = type, type = element, element = null;
    if (!text) return;
    var o = Object.assign({ type: type == "error" ? "danger" : typeof type == "string" && type || "info", now: Date.now(), delay: 5000, role: "alert" }, options || {});
    var t = o.type[0];
    var delay = o.delay * (t == "d" || t == "w" ? 3 : t == "i" ? 2 : 1);
    var icon = o.icon || t == "s" ? "fa-check-circle" : t == "d" ? "fa-exclamation-circle" : t == "w" ? "fa-exclamation-triangle": "fa-info-circle";
    var html = `
    <div class="toast fade show ${o.type} ${o.css || ""}" role="${o.role}" aria-live="polite" aria-atomic="true" data-bs-autohide="${!o.dismiss}" data-bs-delay="${delay}">
        <div class="toast-header ${o.css_header || ""}">
            <span class="fa fa-fw ${icon} me-2 text-${o.type}" aria-hidden="true"></span>
            <strong class="me-auto toast-title">${o.title || app.toTitle(type)}</strong>
            <small class="timer px-1" aria-hidden="true">${o.countdown ? Math.round(delay/1000)+"s" : !o.notimer ? "just now" : ""}</small>
            <small>${app.strftime(o.now, " (%I:%M%p)")}</small>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body ${o.css_body || ""}">
            ${app.getAlertText(text, o)}
        </div>
    </div>`;
    if (!element) {
        element = app.$(".toast-container");
        if (!element) {
            element = app.$elem("div", "aria-live", "polite");
            document.body.append(element);
        }
        var pos = o.pos == "tl" ? "top-0 start-0" :
                  o.pos == "tr" ? "top-0 end-0" :
                  o.pos == "ml" ? "top-50 start-0  translate-middle-y" :
                  o.pos == "mc" ? "top-50 start-50 translate-middle" :
                  o.pos == "mr" ? "top-50 end-0 translate-middle-y" :
                  o.pos == "bl" ? "bottom-0 start-0" :
                  o.pos == "bc" ? "bottom-0 start-50 translate-middle-x" :
                  o.pos == "br" ? "bottom-0 end-0" : "top-0 start-50 translate-middle-x";
        element.className = `toast-container position-fixed ${pos} p-3`;
    }
    if (o.clear) app.$empty(element);
    var toast = app.$parse(html).firstElementChild;
    bootstrap.Toast.getOrCreateInstance(toast).show();
    element.prepend(toast);
    toast._timer = o.notimer ? "" : setInterval(() => {
        if (!toast.parentElement) return clearInterval(toast._timer);
        app.$(".timer", toast).textContent = o.countdown ? app.toDuration(delay - (Date.now() - o.now)) : app.toAge(o.now) + " ago";
    }, o.countdown ? o.delay/2 : o.delay);
    app.$on(toast, "hidden.bs.toast", (ev) => { clearInterval(ev.target._timer); ev.target.remove() });
    return toast;
}

app.hideToast = function()
{
    app.$empty(app.$(".toast-container"));
}

var _plugins = [];
app.elementPlugin = function(callback)
{
    if (typeof callback == "function") _plugins.push(callback);
}
app.applyElementPlugins = function(element)
{
    if (!(element instanceof HTMLElement)) return;
    app.$all(".carousel", element).forEach(el => (bootstrap.Carousel.getOrCreateInstance(el)));
    app.$all(`[data-bs-toggle="popover"]`, element).forEach(el => (bootstrap.Popover.getOrCreateInstance(el)));
    for (const cb of _plugins) cb(element);
}

app.$ready(() => {
    app.setBreakpoint();

    app.$on(window, "resize", () => {
        clearTimeout(app._resized);
        app._resized = setTimeout(app.setBreakpoint, 250);
    });

    app.on("component:create", (data) => { app.applyElementPlugins(data?.element) });

    app.on("alert", app.showAlert);

    app.on("loading", app.showLoading);
});

})();
(() => {
  // packages/alpinejs/src/scheduler.js
  var flushPending = false;
  var flushing = false;
  var queue = [];
  var lastFlushedIndex = -1;
  function scheduler(callback) {
    queueJob(callback);
  }
  function queueJob(job) {
    if (!queue.includes(job))
      queue.push(job);
    queueFlush();
  }
  function dequeueJob(job) {
    let index = queue.indexOf(job);
    if (index !== -1 && index > lastFlushedIndex)
      queue.splice(index, 1);
  }
  function queueFlush() {
    if (!flushing && !flushPending) {
      flushPending = true;
      queueMicrotask(flushJobs);
    }
  }
  function flushJobs() {
    flushPending = false;
    flushing = true;
    for (let i = 0; i < queue.length; i++) {
      queue[i]();
      lastFlushedIndex = i;
    }
    queue.length = 0;
    lastFlushedIndex = -1;
    flushing = false;
  }

  // packages/alpinejs/src/reactivity.js
  var reactive;
  var effect;
  var release;
  var raw;
  var shouldSchedule = true;
  function disableEffectScheduling(callback) {
    shouldSchedule = false;
    callback();
    shouldSchedule = true;
  }
  function setReactivityEngine(engine) {
    reactive = engine.reactive;
    release = engine.release;
    effect = (callback) => engine.effect(callback, { scheduler: (task) => {
      if (shouldSchedule) {
        scheduler(task);
      } else {
        task();
      }
    } });
    raw = engine.raw;
  }
  function overrideEffect(override) {
    effect = override;
  }
  function elementBoundEffect(el) {
    let cleanup2 = () => {
    };
    let wrappedEffect = (callback) => {
      let effectReference = effect(callback);
      if (!el._x_effects) {
        el._x_effects = /* @__PURE__ */ new Set();
        el._x_runEffects = () => {
          el._x_effects.forEach((i) => i());
        };
      }
      el._x_effects.add(effectReference);
      cleanup2 = () => {
        if (effectReference === void 0)
          return;
        el._x_effects.delete(effectReference);
        release(effectReference);
      };
      return effectReference;
    };
    return [wrappedEffect, () => {
      cleanup2();
    }];
  }
  function watch(getter, callback) {
    let firstTime = true;
    let oldValue;
    let effectReference = effect(() => {
      let value = getter();
      JSON.stringify(value);
      if (!firstTime) {
        queueMicrotask(() => {
          callback(value, oldValue);
          oldValue = value;
        });
      } else {
        oldValue = value;
      }
      firstTime = false;
    });
    return () => release(effectReference);
  }

  // packages/alpinejs/src/mutation.js
  var onAttributeAddeds = [];
  var onElRemoveds = [];
  var onElAddeds = [];
  function onElAdded(callback) {
    onElAddeds.push(callback);
  }
  function onElRemoved(el, callback) {
    if (typeof callback === "function") {
      if (!el._x_cleanups)
        el._x_cleanups = [];
      el._x_cleanups.push(callback);
    } else {
      callback = el;
      onElRemoveds.push(callback);
    }
  }
  function onAttributesAdded(callback) {
    onAttributeAddeds.push(callback);
  }
  function onAttributeRemoved(el, name, callback) {
    if (!el._x_attributeCleanups)
      el._x_attributeCleanups = {};
    if (!el._x_attributeCleanups[name])
      el._x_attributeCleanups[name] = [];
    el._x_attributeCleanups[name].push(callback);
  }
  function cleanupAttributes(el, names) {
    if (!el._x_attributeCleanups)
      return;
    Object.entries(el._x_attributeCleanups).forEach(([name, value]) => {
      if (names === void 0 || names.includes(name)) {
        value.forEach((i) => i());
        delete el._x_attributeCleanups[name];
      }
    });
  }
  function cleanupElement(el) {
    el._x_effects?.forEach(dequeueJob);
    while (el._x_cleanups?.length)
      el._x_cleanups.pop()();
  }
  var observer = new MutationObserver(onMutate);
  var currentlyObserving = false;
  function startObservingMutations() {
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
    currentlyObserving = true;
  }
  function stopObservingMutations() {
    flushObserver();
    observer.disconnect();
    currentlyObserving = false;
  }
  var queuedMutations = [];
  function flushObserver() {
    let records = observer.takeRecords();
    queuedMutations.push(() => records.length > 0 && onMutate(records));
    let queueLengthWhenTriggered = queuedMutations.length;
    queueMicrotask(() => {
      if (queuedMutations.length === queueLengthWhenTriggered) {
        while (queuedMutations.length > 0)
          queuedMutations.shift()();
      }
    });
  }
  function mutateDom(callback) {
    if (!currentlyObserving)
      return callback();
    stopObservingMutations();
    let result = callback();
    startObservingMutations();
    return result;
  }
  var isCollecting = false;
  var deferredMutations = [];
  function deferMutations() {
    isCollecting = true;
  }
  function flushAndStopDeferringMutations() {
    isCollecting = false;
    onMutate(deferredMutations);
    deferredMutations = [];
  }
  function onMutate(mutations) {
    if (isCollecting) {
      deferredMutations = deferredMutations.concat(mutations);
      return;
    }
    let addedNodes = [];
    let removedNodes = /* @__PURE__ */ new Set();
    let addedAttributes = /* @__PURE__ */ new Map();
    let removedAttributes = /* @__PURE__ */ new Map();
    for (let i = 0; i < mutations.length; i++) {
      if (mutations[i].target._x_ignoreMutationObserver)
        continue;
      if (mutations[i].type === "childList") {
        mutations[i].removedNodes.forEach((node) => {
          if (node.nodeType !== 1)
            return;
          if (!node._x_marker)
            return;
          removedNodes.add(node);
        });
        mutations[i].addedNodes.forEach((node) => {
          if (node.nodeType !== 1)
            return;
          if (removedNodes.has(node)) {
            removedNodes.delete(node);
            return;
          }
          if (node._x_marker)
            return;
          addedNodes.push(node);
        });
      }
      if (mutations[i].type === "attributes") {
        let el = mutations[i].target;
        let name = mutations[i].attributeName;
        let oldValue = mutations[i].oldValue;
        let add2 = () => {
          if (!addedAttributes.has(el))
            addedAttributes.set(el, []);
          addedAttributes.get(el).push({ name, value: el.getAttribute(name) });
        };
        let remove = () => {
          if (!removedAttributes.has(el))
            removedAttributes.set(el, []);
          removedAttributes.get(el).push(name);
        };
        if (el.hasAttribute(name) && oldValue === null) {
          add2();
        } else if (el.hasAttribute(name)) {
          remove();
          add2();
        } else {
          remove();
        }
      }
    }
    removedAttributes.forEach((attrs, el) => {
      cleanupAttributes(el, attrs);
    });
    addedAttributes.forEach((attrs, el) => {
      onAttributeAddeds.forEach((i) => i(el, attrs));
    });
    for (let node of removedNodes) {
      if (addedNodes.some((i) => i.contains(node)))
        continue;
      onElRemoveds.forEach((i) => i(node));
    }
    for (let node of addedNodes) {
      if (!node.isConnected)
        continue;
      onElAddeds.forEach((i) => i(node));
    }
    addedNodes = null;
    removedNodes = null;
    addedAttributes = null;
    removedAttributes = null;
  }

  // packages/alpinejs/src/scope.js
  function scope(node) {
    return mergeProxies(closestDataStack(node));
  }
  function addScopeToNode(node, data2, referenceNode) {
    node._x_dataStack = [data2, ...closestDataStack(referenceNode || node)];
    return () => {
      node._x_dataStack = node._x_dataStack.filter((i) => i !== data2);
    };
  }
  function closestDataStack(node) {
    if (node._x_dataStack)
      return node._x_dataStack;
    if (typeof ShadowRoot === "function" && node instanceof ShadowRoot) {
      return closestDataStack(node.host);
    }
    if (!node.parentNode) {
      return [];
    }
    return closestDataStack(node.parentNode);
  }
  function mergeProxies(objects) {
    return new Proxy({ objects }, mergeProxyTrap);
  }
  var mergeProxyTrap = {
    ownKeys({ objects }) {
      return Array.from(
        new Set(objects.flatMap((i) => Object.keys(i)))
      );
    },
    has({ objects }, name) {
      if (name == Symbol.unscopables)
        return false;
      return objects.some(
        (obj) => Object.prototype.hasOwnProperty.call(obj, name) || Reflect.has(obj, name)
      );
    },
    get({ objects }, name, thisProxy) {
      if (name == "toJSON")
        return collapseProxies;
      return Reflect.get(
        objects.find(
          (obj) => Reflect.has(obj, name)
        ) || {},
        name,
        thisProxy
      );
    },
    set({ objects }, name, value, thisProxy) {
      const target = objects.find(
        (obj) => Object.prototype.hasOwnProperty.call(obj, name)
      ) || objects[objects.length - 1];
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor?.set && descriptor?.get)
        return descriptor.set.call(thisProxy, value) || true;
      return Reflect.set(target, name, value);
    }
  };
  function collapseProxies() {
    let keys = Reflect.ownKeys(this);
    return keys.reduce((acc, key) => {
      acc[key] = Reflect.get(this, key);
      return acc;
    }, {});
  }

  // packages/alpinejs/src/interceptor.js
  function initInterceptors(data2) {
    let isObject2 = (val) => typeof val === "object" && !Array.isArray(val) && val !== null;
    let recurse = (obj, basePath = "") => {
      Object.entries(Object.getOwnPropertyDescriptors(obj)).forEach(([key, { value, enumerable }]) => {
        if (enumerable === false || value === void 0)
          return;
        if (typeof value === "object" && value !== null && value.__v_skip)
          return;
        let path = basePath === "" ? key : `${basePath}.${key}`;
        if (typeof value === "object" && value !== null && value._x_interceptor) {
          obj[key] = value.initialize(data2, path, key);
        } else {
          if (isObject2(value) && value !== obj && !(value instanceof Element)) {
            recurse(value, path);
          }
        }
      });
    };
    return recurse(data2);
  }
  function interceptor(callback, mutateObj = () => {
  }) {
    let obj = {
      initialValue: void 0,
      _x_interceptor: true,
      initialize(data2, path, key) {
        return callback(this.initialValue, () => get(data2, path), (value) => set(data2, path, value), path, key);
      }
    };
    mutateObj(obj);
    return (initialValue) => {
      if (typeof initialValue === "object" && initialValue !== null && initialValue._x_interceptor) {
        let initialize = obj.initialize.bind(obj);
        obj.initialize = (data2, path, key) => {
          let innerValue = initialValue.initialize(data2, path, key);
          obj.initialValue = innerValue;
          return initialize(data2, path, key);
        };
      } else {
        obj.initialValue = initialValue;
      }
      return obj;
    };
  }
  function get(obj, path) {
    return path.split(".").reduce((carry, segment) => carry[segment], obj);
  }
  function set(obj, path, value) {
    if (typeof path === "string")
      path = path.split(".");
    if (path.length === 1)
      obj[path[0]] = value;
    else if (path.length === 0)
      throw error;
    else {
      if (obj[path[0]])
        return set(obj[path[0]], path.slice(1), value);
      else {
        obj[path[0]] = {};
        return set(obj[path[0]], path.slice(1), value);
      }
    }
  }

  // packages/alpinejs/src/magics.js
  var magics = {};
  function magic(name, callback) {
    magics[name] = callback;
  }
  function injectMagics(obj, el) {
    let memoizedUtilities = getUtilities(el);
    Object.entries(magics).forEach(([name, callback]) => {
      Object.defineProperty(obj, `$${name}`, {
        get() {
          return callback(el, memoizedUtilities);
        },
        enumerable: false
      });
    });
    return obj;
  }
  function getUtilities(el) {
    let [utilities, cleanup2] = getElementBoundUtilities(el);
    let utils = { interceptor, ...utilities };
    onElRemoved(el, cleanup2);
    return utils;
  }

  // packages/alpinejs/src/utils/error.js
  function tryCatch(el, expression, callback, ...args) {
    try {
      return callback(...args);
    } catch (e) {
      handleError(e, el, expression);
    }
  }
  function handleError(error2, el, expression = void 0) {
    error2 = Object.assign(
      error2 ?? { message: "No error message given." },
      { el, expression }
    );
    console.warn(`Alpine Expression Error: ${error2.message}

${expression ? 'Expression: "' + expression + '"\n\n' : ""}`, el);
    setTimeout(() => {
      throw error2;
    }, 0);
  }

  // packages/alpinejs/src/evaluator.js
  var shouldAutoEvaluateFunctions = true;
  function dontAutoEvaluateFunctions(callback) {
    let cache = shouldAutoEvaluateFunctions;
    shouldAutoEvaluateFunctions = false;
    let result = callback();
    shouldAutoEvaluateFunctions = cache;
    return result;
  }
  function evaluate(el, expression, extras = {}) {
    let result;
    evaluateLater(el, expression)((value) => result = value, extras);
    return result;
  }
  function evaluateLater(...args) {
    return theEvaluatorFunction(...args);
  }
  var theEvaluatorFunction = normalEvaluator;
  function setEvaluator(newEvaluator) {
    theEvaluatorFunction = newEvaluator;
  }
  function normalEvaluator(el, expression) {
    let overriddenMagics = {};
    injectMagics(overriddenMagics, el);
    let dataStack = [overriddenMagics, ...closestDataStack(el)];
    let evaluator = typeof expression === "function" ? generateEvaluatorFromFunction(dataStack, expression) : generateEvaluatorFromString(dataStack, expression, el);
    return tryCatch.bind(null, el, expression, evaluator);
  }
  function generateEvaluatorFromFunction(dataStack, func) {
    return (receiver = () => {
    }, { scope: scope2 = {}, params = [] } = {}) => {
      let result = func.apply(mergeProxies([scope2, ...dataStack]), params);
      runIfTypeOfFunction(receiver, result);
    };
  }
  var evaluatorMemo = {};
  function generateFunctionFromString(expression, el) {
    if (evaluatorMemo[expression]) {
      return evaluatorMemo[expression];
    }
    let AsyncFunction = Object.getPrototypeOf(async function() {
    }).constructor;
    let rightSideSafeExpression = /^[\n\s]*if.*\(.*\)/.test(expression.trim()) || /^(let|const)\s/.test(expression.trim()) ? `(async()=>{ ${expression} })()` : expression;
    const safeAsyncFunction = () => {
      try {
        let func2 = new AsyncFunction(
          ["__self", "scope"],
          `with (scope) { __self.result = ${rightSideSafeExpression} }; __self.finished = true; return __self.result;`
        );
        Object.defineProperty(func2, "name", {
          value: `[Alpine] ${expression}`
        });
        return func2;
      } catch (error2) {
        handleError(error2, el, expression);
        return Promise.resolve();
      }
    };
    let func = safeAsyncFunction();
    evaluatorMemo[expression] = func;
    return func;
  }
  function generateEvaluatorFromString(dataStack, expression, el) {
    let func = generateFunctionFromString(expression, el);
    return (receiver = () => {
    }, { scope: scope2 = {}, params = [] } = {}) => {
      func.result = void 0;
      func.finished = false;
      let completeScope = mergeProxies([scope2, ...dataStack]);
      if (typeof func === "function") {
        let promise = func(func, completeScope).catch((error2) => handleError(error2, el, expression));
        if (func.finished) {
          runIfTypeOfFunction(receiver, func.result, completeScope, params, el);
          func.result = void 0;
        } else {
          promise.then((result) => {
            runIfTypeOfFunction(receiver, result, completeScope, params, el);
          }).catch((error2) => handleError(error2, el, expression)).finally(() => func.result = void 0);
        }
      }
    };
  }
  function runIfTypeOfFunction(receiver, value, scope2, params, el) {
    if (shouldAutoEvaluateFunctions && typeof value === "function") {
      let result = value.apply(scope2, params);
      if (result instanceof Promise) {
        result.then((i) => runIfTypeOfFunction(receiver, i, scope2, params)).catch((error2) => handleError(error2, el, value));
      } else {
        receiver(result);
      }
    } else if (typeof value === "object" && value instanceof Promise) {
      value.then((i) => receiver(i));
    } else {
      receiver(value);
    }
  }

  // packages/alpinejs/src/directives.js
  var prefixAsString = "x-";
  function prefix(subject = "") {
    return prefixAsString + subject;
  }
  function setPrefix(newPrefix) {
    prefixAsString = newPrefix;
  }
  var directiveHandlers = {};
  function directive(name, callback) {
    directiveHandlers[name] = callback;
    return {
      before(directive2) {
        if (!directiveHandlers[directive2]) {
          console.warn(String.raw`Cannot find directive \`${directive2}\`. \`${name}\` will use the default order of execution`);
          return;
        }
        const pos = directiveOrder.indexOf(directive2);
        directiveOrder.splice(pos >= 0 ? pos : directiveOrder.indexOf("DEFAULT"), 0, name);
      }
    };
  }
  function directiveExists(name) {
    return Object.keys(directiveHandlers).includes(name);
  }
  function directives(el, attributes, originalAttributeOverride) {
    attributes = Array.from(attributes);
    if (el._x_virtualDirectives) {
      let vAttributes = Object.entries(el._x_virtualDirectives).map(([name, value]) => ({ name, value }));
      let staticAttributes = attributesOnly(vAttributes);
      vAttributes = vAttributes.map((attribute) => {
        if (staticAttributes.find((attr) => attr.name === attribute.name)) {
          return {
            name: `x-bind:${attribute.name}`,
            value: `"${attribute.value}"`
          };
        }
        return attribute;
      });
      attributes = attributes.concat(vAttributes);
    }
    let transformedAttributeMap = {};
    let directives2 = attributes.map(toTransformedAttributes((newName, oldName) => transformedAttributeMap[newName] = oldName)).filter(outNonAlpineAttributes).map(toParsedDirectives(transformedAttributeMap, originalAttributeOverride)).sort(byPriority);
    return directives2.map((directive2) => {
      return getDirectiveHandler(el, directive2);
    });
  }
  function attributesOnly(attributes) {
    return Array.from(attributes).map(toTransformedAttributes()).filter((attr) => !outNonAlpineAttributes(attr));
  }
  var isDeferringHandlers = false;
  var directiveHandlerStacks = /* @__PURE__ */ new Map();
  var currentHandlerStackKey = Symbol();
  function deferHandlingDirectives(callback) {
    isDeferringHandlers = true;
    let key = Symbol();
    currentHandlerStackKey = key;
    directiveHandlerStacks.set(key, []);
    let flushHandlers = () => {
      while (directiveHandlerStacks.get(key).length)
        directiveHandlerStacks.get(key).shift()();
      directiveHandlerStacks.delete(key);
    };
    let stopDeferring = () => {
      isDeferringHandlers = false;
      flushHandlers();
    };
    callback(flushHandlers);
    stopDeferring();
  }
  function getElementBoundUtilities(el) {
    let cleanups = [];
    let cleanup2 = (callback) => cleanups.push(callback);
    let [effect3, cleanupEffect] = elementBoundEffect(el);
    cleanups.push(cleanupEffect);
    let utilities = {
      Alpine: alpine_default,
      effect: effect3,
      cleanup: cleanup2,
      evaluateLater: evaluateLater.bind(evaluateLater, el),
      evaluate: evaluate.bind(evaluate, el)
    };
    let doCleanup = () => cleanups.forEach((i) => i());
    return [utilities, doCleanup];
  }
  function getDirectiveHandler(el, directive2) {
    let noop = () => {
    };
    let handler4 = directiveHandlers[directive2.type] || noop;
    let [utilities, cleanup2] = getElementBoundUtilities(el);
    onAttributeRemoved(el, directive2.original, cleanup2);
    let fullHandler = () => {
      if (el._x_ignore || el._x_ignoreSelf)
        return;
      handler4.inline && handler4.inline(el, directive2, utilities);
      handler4 = handler4.bind(handler4, el, directive2, utilities);
      isDeferringHandlers ? directiveHandlerStacks.get(currentHandlerStackKey).push(handler4) : handler4();
    };
    fullHandler.runCleanups = cleanup2;
    return fullHandler;
  }
  var startingWith = (subject, replacement) => ({ name, value }) => {
    if (name.startsWith(subject))
      name = name.replace(subject, replacement);
    return { name, value };
  };
  var into = (i) => i;
  function toTransformedAttributes(callback = () => {
  }) {
    return ({ name, value }) => {
      let { name: newName, value: newValue } = attributeTransformers.reduce((carry, transform) => {
        return transform(carry);
      }, { name, value });
      if (newName !== name)
        callback(newName, name);
      return { name: newName, value: newValue };
    };
  }
  var attributeTransformers = [];
  function mapAttributes(callback) {
    attributeTransformers.push(callback);
  }
  function outNonAlpineAttributes({ name }) {
    return alpineAttributeRegex().test(name);
  }
  var alpineAttributeRegex = () => new RegExp(`^${prefixAsString}([^:^.]+)\\b`);
  function toParsedDirectives(transformedAttributeMap, originalAttributeOverride) {
    return ({ name, value }) => {
      let typeMatch = name.match(alpineAttributeRegex());
      let valueMatch = name.match(/:([a-zA-Z0-9\-_:]+)/);
      let modifiers = name.match(/\.[^.\]]+(?=[^\]]*$)/g) || [];
      let original = originalAttributeOverride || transformedAttributeMap[name] || name;
      return {
        type: typeMatch ? typeMatch[1] : null,
        value: valueMatch ? valueMatch[1] : null,
        modifiers: modifiers.map((i) => i.replace(".", "")),
        expression: value,
        original
      };
    };
  }
  var DEFAULT = "DEFAULT";
  var directiveOrder = [
    "ignore",
    "ref",
    "data",
    "id",
    "anchor",
    "bind",
    "init",
    "for",
    "model",
    "modelable",
    "transition",
    "show",
    "if",
    DEFAULT,
    "teleport"
  ];
  function byPriority(a, b) {
    let typeA = directiveOrder.indexOf(a.type) === -1 ? DEFAULT : a.type;
    let typeB = directiveOrder.indexOf(b.type) === -1 ? DEFAULT : b.type;
    return directiveOrder.indexOf(typeA) - directiveOrder.indexOf(typeB);
  }

  // packages/alpinejs/src/utils/dispatch.js
  function dispatch(el, name, detail = {}) {
    el.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
        // Allows events to pass the shadow DOM barrier.
        composed: true,
        cancelable: true
      })
    );
  }

  // packages/alpinejs/src/utils/walk.js
  function walk(el, callback) {
    if (typeof ShadowRoot === "function" && el instanceof ShadowRoot) {
      Array.from(el.children).forEach((el2) => walk(el2, callback));
      return;
    }
    let skip = false;
    callback(el, () => skip = true);
    if (skip)
      return;
    let node = el.firstElementChild;
    while (node) {
      walk(node, callback, false);
      node = node.nextElementSibling;
    }
  }

  // packages/alpinejs/src/utils/warn.js
  function warn(message, ...args) {
    console.warn(`Alpine Warning: ${message}`, ...args);
  }

  // packages/alpinejs/src/lifecycle.js
  var started = false;
  function start() {
    if (started)
      warn("Alpine has already been initialized on this page. Calling Alpine.start() more than once can cause problems.");
    started = true;
    if (!document.body)
      warn("Unable to initialize. Trying to load Alpine before `<body>` is available. Did you forget to add `defer` in Alpine's `<script>` tag?");
    dispatch(document, "alpine:init");
    dispatch(document, "alpine:initializing");
    startObservingMutations();
    onElAdded((el) => initTree(el, walk));
    onElRemoved((el) => destroyTree(el));
    onAttributesAdded((el, attrs) => {
      directives(el, attrs).forEach((handle) => handle());
    });
    let outNestedComponents = (el) => !closestRoot(el.parentElement, true);
    Array.from(document.querySelectorAll(allSelectors().join(","))).filter(outNestedComponents).forEach((el) => {
      initTree(el);
    });
    dispatch(document, "alpine:initialized");
    setTimeout(() => {
      warnAboutMissingPlugins();
    });
  }
  var rootSelectorCallbacks = [];
  var initSelectorCallbacks = [];
  function rootSelectors() {
    return rootSelectorCallbacks.map((fn) => fn());
  }
  function allSelectors() {
    return rootSelectorCallbacks.concat(initSelectorCallbacks).map((fn) => fn());
  }
  function addRootSelector(selectorCallback) {
    rootSelectorCallbacks.push(selectorCallback);
  }
  function addInitSelector(selectorCallback) {
    initSelectorCallbacks.push(selectorCallback);
  }
  function closestRoot(el, includeInitSelectors = false) {
    return findClosest(el, (element) => {
      const selectors = includeInitSelectors ? allSelectors() : rootSelectors();
      if (selectors.some((selector) => element.matches(selector)))
        return true;
    });
  }
  function findClosest(el, callback) {
    if (!el)
      return;
    if (callback(el))
      return el;
    if (el._x_teleportBack)
      el = el._x_teleportBack;
    if (!el.parentElement)
      return;
    return findClosest(el.parentElement, callback);
  }
  function isRoot(el) {
    return rootSelectors().some((selector) => el.matches(selector));
  }
  var initInterceptors2 = [];
  function interceptInit(callback) {
    initInterceptors2.push(callback);
  }
  var markerDispenser = 1;
  function initTree(el, walker = walk, intercept = () => {
  }) {
    if (findClosest(el, (i) => i._x_ignore))
      return;
    deferHandlingDirectives(() => {
      walker(el, (el2, skip) => {
        if (el2._x_marker)
          return;
        intercept(el2, skip);
        initInterceptors2.forEach((i) => i(el2, skip));
        directives(el2, el2.attributes).forEach((handle) => handle());
        if (!el2._x_ignore)
          el2._x_marker = markerDispenser++;
        el2._x_ignore && skip();
      });
    });
  }
  function destroyTree(root, walker = walk) {
    walker(root, (el) => {
      cleanupElement(el);
      cleanupAttributes(el);
      delete el._x_marker;
    });
  }
  function warnAboutMissingPlugins() {
    let pluginDirectives = [
      ["ui", "dialog", ["[x-dialog], [x-popover]"]],
      ["anchor", "anchor", ["[x-anchor]"]],
      ["sort", "sort", ["[x-sort]"]]
    ];
    pluginDirectives.forEach(([plugin2, directive2, selectors]) => {
      if (directiveExists(directive2))
        return;
      selectors.some((selector) => {
        if (document.querySelector(selector)) {
          warn(`found "${selector}", but missing ${plugin2} plugin`);
          return true;
        }
      });
    });
  }

  // packages/alpinejs/src/nextTick.js
  var tickStack = [];
  var isHolding = false;
  function nextTick(callback = () => {
  }) {
    queueMicrotask(() => {
      isHolding || setTimeout(() => {
        releaseNextTicks();
      });
    });
    return new Promise((res) => {
      tickStack.push(() => {
        callback();
        res();
      });
    });
  }
  function releaseNextTicks() {
    isHolding = false;
    while (tickStack.length)
      tickStack.shift()();
  }
  function holdNextTicks() {
    isHolding = true;
  }

  // packages/alpinejs/src/utils/classes.js
  function setClasses(el, value) {
    if (Array.isArray(value)) {
      return setClassesFromString(el, value.join(" "));
    } else if (typeof value === "object" && value !== null) {
      return setClassesFromObject(el, value);
    } else if (typeof value === "function") {
      return setClasses(el, value());
    }
    return setClassesFromString(el, value);
  }
  function setClassesFromString(el, classString) {
    let split = (classString2) => classString2.split(" ").filter(Boolean);
    let missingClasses = (classString2) => classString2.split(" ").filter((i) => !el.classList.contains(i)).filter(Boolean);
    let addClassesAndReturnUndo = (classes) => {
      el.classList.add(...classes);
      return () => {
        el.classList.remove(...classes);
      };
    };
    classString = classString === true ? classString = "" : classString || "";
    return addClassesAndReturnUndo(missingClasses(classString));
  }
  function setClassesFromObject(el, classObject) {
    let split = (classString) => classString.split(" ").filter(Boolean);
    let forAdd = Object.entries(classObject).flatMap(([classString, bool]) => bool ? split(classString) : false).filter(Boolean);
    let forRemove = Object.entries(classObject).flatMap(([classString, bool]) => !bool ? split(classString) : false).filter(Boolean);
    let added = [];
    let removed = [];
    forRemove.forEach((i) => {
      if (el.classList.contains(i)) {
        el.classList.remove(i);
        removed.push(i);
      }
    });
    forAdd.forEach((i) => {
      if (!el.classList.contains(i)) {
        el.classList.add(i);
        added.push(i);
      }
    });
    return () => {
      removed.forEach((i) => el.classList.add(i));
      added.forEach((i) => el.classList.remove(i));
    };
  }

  // packages/alpinejs/src/utils/styles.js
  function setStyles(el, value) {
    if (typeof value === "object" && value !== null) {
      return setStylesFromObject(el, value);
    }
    return setStylesFromString(el, value);
  }
  function setStylesFromObject(el, value) {
    let previousStyles = {};
    Object.entries(value).forEach(([key, value2]) => {
      previousStyles[key] = el.style[key];
      if (!key.startsWith("--")) {
        key = kebabCase(key);
      }
      el.style.setProperty(key, value2);
    });
    setTimeout(() => {
      if (el.style.length === 0) {
        el.removeAttribute("style");
      }
    });
    return () => {
      setStyles(el, previousStyles);
    };
  }
  function setStylesFromString(el, value) {
    let cache = el.getAttribute("style", value);
    el.setAttribute("style", value);
    return () => {
      el.setAttribute("style", cache || "");
    };
  }
  function kebabCase(subject) {
    return subject.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }

  // packages/alpinejs/src/utils/once.js
  function once(callback, fallback = () => {
  }) {
    let called = false;
    return function() {
      if (!called) {
        called = true;
        callback.apply(this, arguments);
      } else {
        fallback.apply(this, arguments);
      }
    };
  }

  // packages/alpinejs/src/directives/x-transition.js
  directive("transition", (el, { value, modifiers, expression }, { evaluate: evaluate2 }) => {
    if (typeof expression === "function")
      expression = evaluate2(expression);
    if (expression === false)
      return;
    if (!expression || typeof expression === "boolean") {
      registerTransitionsFromHelper(el, modifiers, value);
    } else {
      registerTransitionsFromClassString(el, expression, value);
    }
  });
  function registerTransitionsFromClassString(el, classString, stage) {
    registerTransitionObject(el, setClasses, "");
    let directiveStorageMap = {
      "enter": (classes) => {
        el._x_transition.enter.during = classes;
      },
      "enter-start": (classes) => {
        el._x_transition.enter.start = classes;
      },
      "enter-end": (classes) => {
        el._x_transition.enter.end = classes;
      },
      "leave": (classes) => {
        el._x_transition.leave.during = classes;
      },
      "leave-start": (classes) => {
        el._x_transition.leave.start = classes;
      },
      "leave-end": (classes) => {
        el._x_transition.leave.end = classes;
      }
    };
    directiveStorageMap[stage](classString);
  }
  function registerTransitionsFromHelper(el, modifiers, stage) {
    registerTransitionObject(el, setStyles);
    let doesntSpecify = !modifiers.includes("in") && !modifiers.includes("out") && !stage;
    let transitioningIn = doesntSpecify || modifiers.includes("in") || ["enter"].includes(stage);
    let transitioningOut = doesntSpecify || modifiers.includes("out") || ["leave"].includes(stage);
    if (modifiers.includes("in") && !doesntSpecify) {
      modifiers = modifiers.filter((i, index) => index < modifiers.indexOf("out"));
    }
    if (modifiers.includes("out") && !doesntSpecify) {
      modifiers = modifiers.filter((i, index) => index > modifiers.indexOf("out"));
    }
    let wantsAll = !modifiers.includes("opacity") && !modifiers.includes("scale");
    let wantsOpacity = wantsAll || modifiers.includes("opacity");
    let wantsScale = wantsAll || modifiers.includes("scale");
    let opacityValue = wantsOpacity ? 0 : 1;
    let scaleValue = wantsScale ? modifierValue(modifiers, "scale", 95) / 100 : 1;
    let delay = modifierValue(modifiers, "delay", 0) / 1e3;
    let origin = modifierValue(modifiers, "origin", "center");
    let property = "opacity, transform";
    let durationIn = modifierValue(modifiers, "duration", 150) / 1e3;
    let durationOut = modifierValue(modifiers, "duration", 75) / 1e3;
    let easing = `cubic-bezier(0.4, 0.0, 0.2, 1)`;
    if (transitioningIn) {
      el._x_transition.enter.during = {
        transformOrigin: origin,
        transitionDelay: `${delay}s`,
        transitionProperty: property,
        transitionDuration: `${durationIn}s`,
        transitionTimingFunction: easing
      };
      el._x_transition.enter.start = {
        opacity: opacityValue,
        transform: `scale(${scaleValue})`
      };
      el._x_transition.enter.end = {
        opacity: 1,
        transform: `scale(1)`
      };
    }
    if (transitioningOut) {
      el._x_transition.leave.during = {
        transformOrigin: origin,
        transitionDelay: `${delay}s`,
        transitionProperty: property,
        transitionDuration: `${durationOut}s`,
        transitionTimingFunction: easing
      };
      el._x_transition.leave.start = {
        opacity: 1,
        transform: `scale(1)`
      };
      el._x_transition.leave.end = {
        opacity: opacityValue,
        transform: `scale(${scaleValue})`
      };
    }
  }
  function registerTransitionObject(el, setFunction, defaultValue = {}) {
    if (!el._x_transition)
      el._x_transition = {
        enter: { during: defaultValue, start: defaultValue, end: defaultValue },
        leave: { during: defaultValue, start: defaultValue, end: defaultValue },
        in(before = () => {
        }, after = () => {
        }) {
          transition(el, setFunction, {
            during: this.enter.during,
            start: this.enter.start,
            end: this.enter.end
          }, before, after);
        },
        out(before = () => {
        }, after = () => {
        }) {
          transition(el, setFunction, {
            during: this.leave.during,
            start: this.leave.start,
            end: this.leave.end
          }, before, after);
        }
      };
  }
  window.Element.prototype._x_toggleAndCascadeWithTransitions = function(el, value, show, hide) {
    const nextTick2 = document.visibilityState === "visible" ? requestAnimationFrame : setTimeout;
    let clickAwayCompatibleShow = () => nextTick2(show);
    if (value) {
      if (el._x_transition && (el._x_transition.enter || el._x_transition.leave)) {
        el._x_transition.enter && (Object.entries(el._x_transition.enter.during).length || Object.entries(el._x_transition.enter.start).length || Object.entries(el._x_transition.enter.end).length) ? el._x_transition.in(show) : clickAwayCompatibleShow();
      } else {
        el._x_transition ? el._x_transition.in(show) : clickAwayCompatibleShow();
      }
      return;
    }
    el._x_hidePromise = el._x_transition ? new Promise((resolve, reject) => {
      el._x_transition.out(() => {
      }, () => resolve(hide));
      el._x_transitioning && el._x_transitioning.beforeCancel(() => reject({ isFromCancelledTransition: true }));
    }) : Promise.resolve(hide);
    queueMicrotask(() => {
      let closest = closestHide(el);
      if (closest) {
        if (!closest._x_hideChildren)
          closest._x_hideChildren = [];
        closest._x_hideChildren.push(el);
      } else {
        nextTick2(() => {
          let hideAfterChildren = (el2) => {
            let carry = Promise.all([
              el2._x_hidePromise,
              ...(el2._x_hideChildren || []).map(hideAfterChildren)
            ]).then(([i]) => i?.());
            delete el2._x_hidePromise;
            delete el2._x_hideChildren;
            return carry;
          };
          hideAfterChildren(el).catch((e) => {
            if (!e.isFromCancelledTransition)
              throw e;
          });
        });
      }
    });
  };
  function closestHide(el) {
    let parent = el.parentNode;
    if (!parent)
      return;
    return parent._x_hidePromise ? parent : closestHide(parent);
  }
  function transition(el, setFunction, { during, start: start2, end } = {}, before = () => {
  }, after = () => {
  }) {
    if (el._x_transitioning)
      el._x_transitioning.cancel();
    if (Object.keys(during).length === 0 && Object.keys(start2).length === 0 && Object.keys(end).length === 0) {
      before();
      after();
      return;
    }
    let undoStart, undoDuring, undoEnd;
    performTransition(el, {
      start() {
        undoStart = setFunction(el, start2);
      },
      during() {
        undoDuring = setFunction(el, during);
      },
      before,
      end() {
        undoStart();
        undoEnd = setFunction(el, end);
      },
      after,
      cleanup() {
        undoDuring();
        undoEnd();
      }
    });
  }
  function performTransition(el, stages) {
    let interrupted, reachedBefore, reachedEnd;
    let finish = once(() => {
      mutateDom(() => {
        interrupted = true;
        if (!reachedBefore)
          stages.before();
        if (!reachedEnd) {
          stages.end();
          releaseNextTicks();
        }
        stages.after();
        if (el.isConnected)
          stages.cleanup();
        delete el._x_transitioning;
      });
    });
    el._x_transitioning = {
      beforeCancels: [],
      beforeCancel(callback) {
        this.beforeCancels.push(callback);
      },
      cancel: once(function() {
        while (this.beforeCancels.length) {
          this.beforeCancels.shift()();
        }
        ;
        finish();
      }),
      finish
    };
    mutateDom(() => {
      stages.start();
      stages.during();
    });
    holdNextTicks();
    requestAnimationFrame(() => {
      if (interrupted)
        return;
      let duration = Number(getComputedStyle(el).transitionDuration.replace(/,.*/, "").replace("s", "")) * 1e3;
      let delay = Number(getComputedStyle(el).transitionDelay.replace(/,.*/, "").replace("s", "")) * 1e3;
      if (duration === 0)
        duration = Number(getComputedStyle(el).animationDuration.replace("s", "")) * 1e3;
      mutateDom(() => {
        stages.before();
      });
      reachedBefore = true;
      requestAnimationFrame(() => {
        if (interrupted)
          return;
        mutateDom(() => {
          stages.end();
        });
        releaseNextTicks();
        setTimeout(el._x_transitioning.finish, duration + delay);
        reachedEnd = true;
      });
    });
  }
  function modifierValue(modifiers, key, fallback) {
    if (modifiers.indexOf(key) === -1)
      return fallback;
    const rawValue = modifiers[modifiers.indexOf(key) + 1];
    if (!rawValue)
      return fallback;
    if (key === "scale") {
      if (isNaN(rawValue))
        return fallback;
    }
    if (key === "duration" || key === "delay") {
      let match = rawValue.match(/([0-9]+)ms/);
      if (match)
        return match[1];
    }
    if (key === "origin") {
      if (["top", "right", "left", "center", "bottom"].includes(modifiers[modifiers.indexOf(key) + 2])) {
        return [rawValue, modifiers[modifiers.indexOf(key) + 2]].join(" ");
      }
    }
    return rawValue;
  }

  // packages/alpinejs/src/clone.js
  var isCloning = false;
  function skipDuringClone(callback, fallback = () => {
  }) {
    return (...args) => isCloning ? fallback(...args) : callback(...args);
  }
  function onlyDuringClone(callback) {
    return (...args) => isCloning && callback(...args);
  }
  var interceptors = [];
  function interceptClone(callback) {
    interceptors.push(callback);
  }
  function cloneNode(from, to) {
    interceptors.forEach((i) => i(from, to));
    isCloning = true;
    dontRegisterReactiveSideEffects(() => {
      initTree(to, (el, callback) => {
        callback(el, () => {
        });
      });
    });
    isCloning = false;
  }
  var isCloningLegacy = false;
  function clone(oldEl, newEl) {
    if (!newEl._x_dataStack)
      newEl._x_dataStack = oldEl._x_dataStack;
    isCloning = true;
    isCloningLegacy = true;
    dontRegisterReactiveSideEffects(() => {
      cloneTree(newEl);
    });
    isCloning = false;
    isCloningLegacy = false;
  }
  function cloneTree(el) {
    let hasRunThroughFirstEl = false;
    let shallowWalker = (el2, callback) => {
      walk(el2, (el3, skip) => {
        if (hasRunThroughFirstEl && isRoot(el3))
          return skip();
        hasRunThroughFirstEl = true;
        callback(el3, skip);
      });
    };
    initTree(el, shallowWalker);
  }
  function dontRegisterReactiveSideEffects(callback) {
    let cache = effect;
    overrideEffect((callback2, el) => {
      let storedEffect = cache(callback2);
      release(storedEffect);
      return () => {
      };
    });
    callback();
    overrideEffect(cache);
  }

  // packages/alpinejs/src/utils/bind.js
  function bind(el, name, value, modifiers = []) {
    if (!el._x_bindings)
      el._x_bindings = reactive({});
    el._x_bindings[name] = value;
    name = modifiers.includes("camel") ? camelCase(name) : name;
    switch (name) {
      case "value":
        bindInputValue(el, value);
        break;
      case "style":
        bindStyles(el, value);
        break;
      case "class":
        bindClasses(el, value);
        break;
      case "selected":
      case "checked":
        bindAttributeAndProperty(el, name, value);
        break;
      default:
        bindAttribute(el, name, value);
        break;
    }
  }
  function bindInputValue(el, value) {
    if (isRadio(el)) {
      if (el.attributes.value === void 0) {
        el.value = value;
      }
      if (window.fromModel) {
        if (typeof value === "boolean") {
          el.checked = safeParseBoolean(el.value) === value;
        } else {
          el.checked = checkedAttrLooseCompare(el.value, value);
        }
      }
    } else if (isCheckbox(el)) {
      if (Number.isInteger(value)) {
        el.value = value;
      } else if (!Array.isArray(value) && typeof value !== "boolean" && ![null, void 0].includes(value)) {
        el.value = String(value);
      } else {
        if (Array.isArray(value)) {
          el.checked = value.some((val) => checkedAttrLooseCompare(val, el.value));
        } else {
          el.checked = !!value;
        }
      }
    } else if (el.tagName === "SELECT") {
      updateSelect(el, value);
    } else {
      if (el.value === value)
        return;
      el.value = value === void 0 ? "" : value;
    }
  }
  function bindClasses(el, value) {
    if (el._x_undoAddedClasses)
      el._x_undoAddedClasses();
    el._x_undoAddedClasses = setClasses(el, value);
  }
  function bindStyles(el, value) {
    if (el._x_undoAddedStyles)
      el._x_undoAddedStyles();
    el._x_undoAddedStyles = setStyles(el, value);
  }
  function bindAttributeAndProperty(el, name, value) {
    bindAttribute(el, name, value);
    setPropertyIfChanged(el, name, value);
  }
  function bindAttribute(el, name, value) {
    if ([null, void 0, false].includes(value) && attributeShouldntBePreservedIfFalsy(name)) {
      el.removeAttribute(name);
    } else {
      if (isBooleanAttr(name))
        value = name;
      setIfChanged(el, name, value);
    }
  }
  function setIfChanged(el, attrName, value) {
    if (el.getAttribute(attrName) != value) {
      el.setAttribute(attrName, value);
    }
  }
  function setPropertyIfChanged(el, propName, value) {
    if (el[propName] !== value) {
      el[propName] = value;
    }
  }
  function updateSelect(el, value) {
    const arrayWrappedValue = [].concat(value).map((value2) => {
      return value2 + "";
    });
    Array.from(el.options).forEach((option) => {
      option.selected = arrayWrappedValue.includes(option.value);
    });
  }
  function camelCase(subject) {
    return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
  }
  function checkedAttrLooseCompare(valueA, valueB) {
    return valueA == valueB;
  }
  function safeParseBoolean(rawValue) {
    if ([1, "1", "true", "on", "yes", true].includes(rawValue)) {
      return true;
    }
    if ([0, "0", "false", "off", "no", false].includes(rawValue)) {
      return false;
    }
    return rawValue ? Boolean(rawValue) : null;
  }
  var booleanAttributes = /* @__PURE__ */ new Set([
    "allowfullscreen",
    "async",
    "autofocus",
    "autoplay",
    "checked",
    "controls",
    "default",
    "defer",
    "disabled",
    "formnovalidate",
    "inert",
    "ismap",
    "itemscope",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "readonly",
    "required",
    "reversed",
    "selected",
    "shadowrootclonable",
    "shadowrootdelegatesfocus",
    "shadowrootserializable"
  ]);
  function isBooleanAttr(attrName) {
    return booleanAttributes.has(attrName);
  }
  function attributeShouldntBePreservedIfFalsy(name) {
    return !["aria-pressed", "aria-checked", "aria-expanded", "aria-selected"].includes(name);
  }
  function getBinding(el, name, fallback) {
    if (el._x_bindings && el._x_bindings[name] !== void 0)
      return el._x_bindings[name];
    return getAttributeBinding(el, name, fallback);
  }
  function extractProp(el, name, fallback, extract = true) {
    if (el._x_bindings && el._x_bindings[name] !== void 0)
      return el._x_bindings[name];
    if (el._x_inlineBindings && el._x_inlineBindings[name] !== void 0) {
      let binding = el._x_inlineBindings[name];
      binding.extract = extract;
      return dontAutoEvaluateFunctions(() => {
        return evaluate(el, binding.expression);
      });
    }
    return getAttributeBinding(el, name, fallback);
  }
  function getAttributeBinding(el, name, fallback) {
    let attr = el.getAttribute(name);
    if (attr === null)
      return typeof fallback === "function" ? fallback() : fallback;
    if (attr === "")
      return true;
    if (isBooleanAttr(name)) {
      return !![name, "true"].includes(attr);
    }
    return attr;
  }
  function isCheckbox(el) {
    return el.type === "checkbox" || el.localName === "ui-checkbox" || el.localName === "ui-switch";
  }
  function isRadio(el) {
    return el.type === "radio" || el.localName === "ui-radio";
  }

  // packages/alpinejs/src/utils/debounce.js
  function debounce(func, wait) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        func.apply(context, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // packages/alpinejs/src/utils/throttle.js
  function throttle(func, limit) {
    let inThrottle;
    return function() {
      let context = this, args = arguments;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // packages/alpinejs/src/entangle.js
  function entangle({ get: outerGet, set: outerSet }, { get: innerGet, set: innerSet }) {
    let firstRun = true;
    let outerHash;
    let innerHash;
    let reference = effect(() => {
      let outer = outerGet();
      let inner = innerGet();
      if (firstRun) {
        innerSet(cloneIfObject(outer));
        firstRun = false;
      } else {
        let outerHashLatest = JSON.stringify(outer);
        let innerHashLatest = JSON.stringify(inner);
        if (outerHashLatest !== outerHash) {
          innerSet(cloneIfObject(outer));
        } else if (outerHashLatest !== innerHashLatest) {
          outerSet(cloneIfObject(inner));
        } else {
        }
      }
      outerHash = JSON.stringify(outerGet());
      innerHash = JSON.stringify(innerGet());
    });
    return () => {
      release(reference);
    };
  }
  function cloneIfObject(value) {
    return typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
  }

  // packages/alpinejs/src/plugin.js
  function plugin(callback) {
    let callbacks = Array.isArray(callback) ? callback : [callback];
    callbacks.forEach((i) => i(alpine_default));
  }

  // packages/alpinejs/src/store.js
  var stores = {};
  var isReactive = false;
  function store(name, value) {
    if (!isReactive) {
      stores = reactive(stores);
      isReactive = true;
    }
    if (value === void 0) {
      return stores[name];
    }
    stores[name] = value;
    initInterceptors(stores[name]);
    if (typeof value === "object" && value !== null && value.hasOwnProperty("init") && typeof value.init === "function") {
      stores[name].init();
    }
  }
  function getStores() {
    return stores;
  }

  // packages/alpinejs/src/binds.js
  var binds = {};
  function bind2(name, bindings) {
    let getBindings = typeof bindings !== "function" ? () => bindings : bindings;
    if (name instanceof Element) {
      return applyBindingsObject(name, getBindings());
    } else {
      binds[name] = getBindings;
    }
    return () => {
    };
  }
  function injectBindingProviders(obj) {
    Object.entries(binds).forEach(([name, callback]) => {
      Object.defineProperty(obj, name, {
        get() {
          return (...args) => {
            return callback(...args);
          };
        }
      });
    });
    return obj;
  }
  function applyBindingsObject(el, obj, original) {
    let cleanupRunners = [];
    while (cleanupRunners.length)
      cleanupRunners.pop()();
    let attributes = Object.entries(obj).map(([name, value]) => ({ name, value }));
    let staticAttributes = attributesOnly(attributes);
    attributes = attributes.map((attribute) => {
      if (staticAttributes.find((attr) => attr.name === attribute.name)) {
        return {
          name: `x-bind:${attribute.name}`,
          value: `"${attribute.value}"`
        };
      }
      return attribute;
    });
    directives(el, attributes, original).map((handle) => {
      cleanupRunners.push(handle.runCleanups);
      handle();
    });
    return () => {
      while (cleanupRunners.length)
        cleanupRunners.pop()();
    };
  }

  // packages/alpinejs/src/datas.js
  var datas = {};
  function data(name, callback) {
    datas[name] = callback;
  }
  function injectDataProviders(obj, context) {
    Object.entries(datas).forEach(([name, callback]) => {
      Object.defineProperty(obj, name, {
        get() {
          return (...args) => {
            return callback.bind(context)(...args);
          };
        },
        enumerable: false
      });
    });
    return obj;
  }

  // packages/alpinejs/src/alpine.js
  var Alpine = {
    get reactive() {
      return reactive;
    },
    get release() {
      return release;
    },
    get effect() {
      return effect;
    },
    get raw() {
      return raw;
    },
    version: "3.14.8",
    flushAndStopDeferringMutations,
    dontAutoEvaluateFunctions,
    disableEffectScheduling,
    startObservingMutations,
    stopObservingMutations,
    setReactivityEngine,
    onAttributeRemoved,
    onAttributesAdded,
    closestDataStack,
    skipDuringClone,
    onlyDuringClone,
    addRootSelector,
    addInitSelector,
    interceptClone,
    addScopeToNode,
    deferMutations,
    mapAttributes,
    evaluateLater,
    interceptInit,
    setEvaluator,
    mergeProxies,
    extractProp,
    findClosest,
    onElRemoved,
    closestRoot,
    destroyTree,
    interceptor,
    // INTERNAL: not public API and is subject to change without major release.
    transition,
    // INTERNAL
    setStyles,
    // INTERNAL
    mutateDom,
    directive,
    entangle,
    throttle,
    debounce,
    evaluate,
    initTree,
    nextTick,
    prefixed: prefix,
    prefix: setPrefix,
    plugin,
    magic,
    store,
    start,
    clone,
    // INTERNAL
    cloneNode,
    // INTERNAL
    bound: getBinding,
    $data: scope,
    watch,
    walk,
    data,
    bind: bind2
  };
  var alpine_default = Alpine;

  // node_modules/@vue/shared/dist/shared.esm-bundler.js
  function makeMap(str, expectsLowerCase) {
    const map = /* @__PURE__ */ Object.create(null);
    const list = str.split(",");
    for (let i = 0; i < list.length; i++) {
      map[list[i]] = true;
    }
    return expectsLowerCase ? (val) => !!map[val.toLowerCase()] : (val) => !!map[val];
  }
  var specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
  var isBooleanAttr2 = /* @__PURE__ */ makeMap(specialBooleanAttrs + `,async,autofocus,autoplay,controls,default,defer,disabled,hidden,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected`);
  var EMPTY_OBJ = true ? Object.freeze({}) : {};
  var EMPTY_ARR = true ? Object.freeze([]) : [];
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  var hasOwn = (val, key) => hasOwnProperty.call(val, key);
  var isArray = Array.isArray;
  var isMap = (val) => toTypeString(val) === "[object Map]";
  var isString = (val) => typeof val === "string";
  var isSymbol = (val) => typeof val === "symbol";
  var isObject = (val) => val !== null && typeof val === "object";
  var objectToString = Object.prototype.toString;
  var toTypeString = (value) => objectToString.call(value);
  var toRawType = (value) => {
    return toTypeString(value).slice(8, -1);
  };
  var isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
  var cacheStringFunction = (fn) => {
    const cache = /* @__PURE__ */ Object.create(null);
    return (str) => {
      const hit = cache[str];
      return hit || (cache[str] = fn(str));
    };
  };
  var camelizeRE = /-(\w)/g;
  var camelize = cacheStringFunction((str) => {
    return str.replace(camelizeRE, (_, c) => c ? c.toUpperCase() : "");
  });
  var hyphenateRE = /\B([A-Z])/g;
  var hyphenate = cacheStringFunction((str) => str.replace(hyphenateRE, "-$1").toLowerCase());
  var capitalize = cacheStringFunction((str) => str.charAt(0).toUpperCase() + str.slice(1));
  var toHandlerKey = cacheStringFunction((str) => str ? `on${capitalize(str)}` : ``);
  var hasChanged = (value, oldValue) => value !== oldValue && (value === value || oldValue === oldValue);

  // node_modules/@vue/reactivity/dist/reactivity.esm-bundler.js
  var targetMap = /* @__PURE__ */ new WeakMap();
  var effectStack = [];
  var activeEffect;
  var ITERATE_KEY = Symbol(true ? "iterate" : "");
  var MAP_KEY_ITERATE_KEY = Symbol(true ? "Map key iterate" : "");
  function isEffect(fn) {
    return fn && fn._isEffect === true;
  }
  function effect2(fn, options = EMPTY_OBJ) {
    if (isEffect(fn)) {
      fn = fn.raw;
    }
    const effect3 = createReactiveEffect(fn, options);
    if (!options.lazy) {
      effect3();
    }
    return effect3;
  }
  function stop(effect3) {
    if (effect3.active) {
      cleanup(effect3);
      if (effect3.options.onStop) {
        effect3.options.onStop();
      }
      effect3.active = false;
    }
  }
  var uid = 0;
  function createReactiveEffect(fn, options) {
    const effect3 = function reactiveEffect() {
      if (!effect3.active) {
        return fn();
      }
      if (!effectStack.includes(effect3)) {
        cleanup(effect3);
        try {
          enableTracking();
          effectStack.push(effect3);
          activeEffect = effect3;
          return fn();
        } finally {
          effectStack.pop();
          resetTracking();
          activeEffect = effectStack[effectStack.length - 1];
        }
      }
    };
    effect3.id = uid++;
    effect3.allowRecurse = !!options.allowRecurse;
    effect3._isEffect = true;
    effect3.active = true;
    effect3.raw = fn;
    effect3.deps = [];
    effect3.options = options;
    return effect3;
  }
  function cleanup(effect3) {
    const { deps } = effect3;
    if (deps.length) {
      for (let i = 0; i < deps.length; i++) {
        deps[i].delete(effect3);
      }
      deps.length = 0;
    }
  }
  var shouldTrack = true;
  var trackStack = [];
  function pauseTracking() {
    trackStack.push(shouldTrack);
    shouldTrack = false;
  }
  function enableTracking() {
    trackStack.push(shouldTrack);
    shouldTrack = true;
  }
  function resetTracking() {
    const last = trackStack.pop();
    shouldTrack = last === void 0 ? true : last;
  }
  function track(target, type, key) {
    if (!shouldTrack || activeEffect === void 0) {
      return;
    }
    let depsMap = targetMap.get(target);
    if (!depsMap) {
      targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
    }
    let dep = depsMap.get(key);
    if (!dep) {
      depsMap.set(key, dep = /* @__PURE__ */ new Set());
    }
    if (!dep.has(activeEffect)) {
      dep.add(activeEffect);
      activeEffect.deps.push(dep);
      if (activeEffect.options.onTrack) {
        activeEffect.options.onTrack({
          effect: activeEffect,
          target,
          type,
          key
        });
      }
    }
  }
  function trigger(target, type, key, newValue, oldValue, oldTarget) {
    const depsMap = targetMap.get(target);
    if (!depsMap) {
      return;
    }
    const effects = /* @__PURE__ */ new Set();
    const add2 = (effectsToAdd) => {
      if (effectsToAdd) {
        effectsToAdd.forEach((effect3) => {
          if (effect3 !== activeEffect || effect3.allowRecurse) {
            effects.add(effect3);
          }
        });
      }
    };
    if (type === "clear") {
      depsMap.forEach(add2);
    } else if (key === "length" && isArray(target)) {
      depsMap.forEach((dep, key2) => {
        if (key2 === "length" || key2 >= newValue) {
          add2(dep);
        }
      });
    } else {
      if (key !== void 0) {
        add2(depsMap.get(key));
      }
      switch (type) {
        case "add":
          if (!isArray(target)) {
            add2(depsMap.get(ITERATE_KEY));
            if (isMap(target)) {
              add2(depsMap.get(MAP_KEY_ITERATE_KEY));
            }
          } else if (isIntegerKey(key)) {
            add2(depsMap.get("length"));
          }
          break;
        case "delete":
          if (!isArray(target)) {
            add2(depsMap.get(ITERATE_KEY));
            if (isMap(target)) {
              add2(depsMap.get(MAP_KEY_ITERATE_KEY));
            }
          }
          break;
        case "set":
          if (isMap(target)) {
            add2(depsMap.get(ITERATE_KEY));
          }
          break;
      }
    }
    const run = (effect3) => {
      if (effect3.options.onTrigger) {
        effect3.options.onTrigger({
          effect: effect3,
          target,
          key,
          type,
          newValue,
          oldValue,
          oldTarget
        });
      }
      if (effect3.options.scheduler) {
        effect3.options.scheduler(effect3);
      } else {
        effect3();
      }
    };
    effects.forEach(run);
  }
  var isNonTrackableKeys = /* @__PURE__ */ makeMap(`__proto__,__v_isRef,__isVue`);
  var builtInSymbols = new Set(Object.getOwnPropertyNames(Symbol).map((key) => Symbol[key]).filter(isSymbol));
  var get2 = /* @__PURE__ */ createGetter();
  var readonlyGet = /* @__PURE__ */ createGetter(true);
  var arrayInstrumentations = /* @__PURE__ */ createArrayInstrumentations();
  function createArrayInstrumentations() {
    const instrumentations = {};
    ["includes", "indexOf", "lastIndexOf"].forEach((key) => {
      instrumentations[key] = function(...args) {
        const arr = toRaw(this);
        for (let i = 0, l = this.length; i < l; i++) {
          track(arr, "get", i + "");
        }
        const res = arr[key](...args);
        if (res === -1 || res === false) {
          return arr[key](...args.map(toRaw));
        } else {
          return res;
        }
      };
    });
    ["push", "pop", "shift", "unshift", "splice"].forEach((key) => {
      instrumentations[key] = function(...args) {
        pauseTracking();
        const res = toRaw(this)[key].apply(this, args);
        resetTracking();
        return res;
      };
    });
    return instrumentations;
  }
  function createGetter(isReadonly = false, shallow = false) {
    return function get3(target, key, receiver) {
      if (key === "__v_isReactive") {
        return !isReadonly;
      } else if (key === "__v_isReadonly") {
        return isReadonly;
      } else if (key === "__v_raw" && receiver === (isReadonly ? shallow ? shallowReadonlyMap : readonlyMap : shallow ? shallowReactiveMap : reactiveMap).get(target)) {
        return target;
      }
      const targetIsArray = isArray(target);
      if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
        return Reflect.get(arrayInstrumentations, key, receiver);
      }
      const res = Reflect.get(target, key, receiver);
      if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
        return res;
      }
      if (!isReadonly) {
        track(target, "get", key);
      }
      if (shallow) {
        return res;
      }
      if (isRef(res)) {
        const shouldUnwrap = !targetIsArray || !isIntegerKey(key);
        return shouldUnwrap ? res.value : res;
      }
      if (isObject(res)) {
        return isReadonly ? readonly(res) : reactive2(res);
      }
      return res;
    };
  }
  var set2 = /* @__PURE__ */ createSetter();
  function createSetter(shallow = false) {
    return function set3(target, key, value, receiver) {
      let oldValue = target[key];
      if (!shallow) {
        value = toRaw(value);
        oldValue = toRaw(oldValue);
        if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
          oldValue.value = value;
          return true;
        }
      }
      const hadKey = isArray(target) && isIntegerKey(key) ? Number(key) < target.length : hasOwn(target, key);
      const result = Reflect.set(target, key, value, receiver);
      if (target === toRaw(receiver)) {
        if (!hadKey) {
          trigger(target, "add", key, value);
        } else if (hasChanged(value, oldValue)) {
          trigger(target, "set", key, value, oldValue);
        }
      }
      return result;
    };
  }
  function deleteProperty(target, key) {
    const hadKey = hasOwn(target, key);
    const oldValue = target[key];
    const result = Reflect.deleteProperty(target, key);
    if (result && hadKey) {
      trigger(target, "delete", key, void 0, oldValue);
    }
    return result;
  }
  function has(target, key) {
    const result = Reflect.has(target, key);
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, "has", key);
    }
    return result;
  }
  function ownKeys(target) {
    track(target, "iterate", isArray(target) ? "length" : ITERATE_KEY);
    return Reflect.ownKeys(target);
  }
  var mutableHandlers = {
    get: get2,
    set: set2,
    deleteProperty,
    has,
    ownKeys
  };
  var readonlyHandlers = {
    get: readonlyGet,
    set(target, key) {
      if (true) {
        console.warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
      }
      return true;
    },
    deleteProperty(target, key) {
      if (true) {
        console.warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
      }
      return true;
    }
  };
  var toReactive = (value) => isObject(value) ? reactive2(value) : value;
  var toReadonly = (value) => isObject(value) ? readonly(value) : value;
  var toShallow = (value) => value;
  var getProto = (v) => Reflect.getPrototypeOf(v);
  function get$1(target, key, isReadonly = false, isShallow = false) {
    target = target[
      "__v_raw"
      /* RAW */
    ];
    const rawTarget = toRaw(target);
    const rawKey = toRaw(key);
    if (key !== rawKey) {
      !isReadonly && track(rawTarget, "get", key);
    }
    !isReadonly && track(rawTarget, "get", rawKey);
    const { has: has2 } = getProto(rawTarget);
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
    if (has2.call(rawTarget, key)) {
      return wrap(target.get(key));
    } else if (has2.call(rawTarget, rawKey)) {
      return wrap(target.get(rawKey));
    } else if (target !== rawTarget) {
      target.get(key);
    }
  }
  function has$1(key, isReadonly = false) {
    const target = this[
      "__v_raw"
      /* RAW */
    ];
    const rawTarget = toRaw(target);
    const rawKey = toRaw(key);
    if (key !== rawKey) {
      !isReadonly && track(rawTarget, "has", key);
    }
    !isReadonly && track(rawTarget, "has", rawKey);
    return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
  }
  function size(target, isReadonly = false) {
    target = target[
      "__v_raw"
      /* RAW */
    ];
    !isReadonly && track(toRaw(target), "iterate", ITERATE_KEY);
    return Reflect.get(target, "size", target);
  }
  function add(value) {
    value = toRaw(value);
    const target = toRaw(this);
    const proto = getProto(target);
    const hadKey = proto.has.call(target, value);
    if (!hadKey) {
      target.add(value);
      trigger(target, "add", value, value);
    }
    return this;
  }
  function set$1(key, value) {
    value = toRaw(value);
    const target = toRaw(this);
    const { has: has2, get: get3 } = getProto(target);
    let hadKey = has2.call(target, key);
    if (!hadKey) {
      key = toRaw(key);
      hadKey = has2.call(target, key);
    } else if (true) {
      checkIdentityKeys(target, has2, key);
    }
    const oldValue = get3.call(target, key);
    target.set(key, value);
    if (!hadKey) {
      trigger(target, "add", key, value);
    } else if (hasChanged(value, oldValue)) {
      trigger(target, "set", key, value, oldValue);
    }
    return this;
  }
  function deleteEntry(key) {
    const target = toRaw(this);
    const { has: has2, get: get3 } = getProto(target);
    let hadKey = has2.call(target, key);
    if (!hadKey) {
      key = toRaw(key);
      hadKey = has2.call(target, key);
    } else if (true) {
      checkIdentityKeys(target, has2, key);
    }
    const oldValue = get3 ? get3.call(target, key) : void 0;
    const result = target.delete(key);
    if (hadKey) {
      trigger(target, "delete", key, void 0, oldValue);
    }
    return result;
  }
  function clear() {
    const target = toRaw(this);
    const hadItems = target.size !== 0;
    const oldTarget = true ? isMap(target) ? new Map(target) : new Set(target) : void 0;
    const result = target.clear();
    if (hadItems) {
      trigger(target, "clear", void 0, void 0, oldTarget);
    }
    return result;
  }
  function createForEach(isReadonly, isShallow) {
    return function forEach(callback, thisArg) {
      const observed = this;
      const target = observed[
        "__v_raw"
        /* RAW */
      ];
      const rawTarget = toRaw(target);
      const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
      !isReadonly && track(rawTarget, "iterate", ITERATE_KEY);
      return target.forEach((value, key) => {
        return callback.call(thisArg, wrap(value), wrap(key), observed);
      });
    };
  }
  function createIterableMethod(method, isReadonly, isShallow) {
    return function(...args) {
      const target = this[
        "__v_raw"
        /* RAW */
      ];
      const rawTarget = toRaw(target);
      const targetIsMap = isMap(rawTarget);
      const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
      const isKeyOnly = method === "keys" && targetIsMap;
      const innerIterator = target[method](...args);
      const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
      !isReadonly && track(rawTarget, "iterate", isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY);
      return {
        // iterator protocol
        next() {
          const { value, done } = innerIterator.next();
          return done ? { value, done } : {
            value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
            done
          };
        },
        // iterable protocol
        [Symbol.iterator]() {
          return this;
        }
      };
    };
  }
  function createReadonlyMethod(type) {
    return function(...args) {
      if (true) {
        const key = args[0] ? `on key "${args[0]}" ` : ``;
        console.warn(`${capitalize(type)} operation ${key}failed: target is readonly.`, toRaw(this));
      }
      return type === "delete" ? false : this;
    };
  }
  function createInstrumentations() {
    const mutableInstrumentations2 = {
      get(key) {
        return get$1(this, key);
      },
      get size() {
        return size(this);
      },
      has: has$1,
      add,
      set: set$1,
      delete: deleteEntry,
      clear,
      forEach: createForEach(false, false)
    };
    const shallowInstrumentations2 = {
      get(key) {
        return get$1(this, key, false, true);
      },
      get size() {
        return size(this);
      },
      has: has$1,
      add,
      set: set$1,
      delete: deleteEntry,
      clear,
      forEach: createForEach(false, true)
    };
    const readonlyInstrumentations2 = {
      get(key) {
        return get$1(this, key, true);
      },
      get size() {
        return size(this, true);
      },
      has(key) {
        return has$1.call(this, key, true);
      },
      add: createReadonlyMethod(
        "add"
        /* ADD */
      ),
      set: createReadonlyMethod(
        "set"
        /* SET */
      ),
      delete: createReadonlyMethod(
        "delete"
        /* DELETE */
      ),
      clear: createReadonlyMethod(
        "clear"
        /* CLEAR */
      ),
      forEach: createForEach(true, false)
    };
    const shallowReadonlyInstrumentations2 = {
      get(key) {
        return get$1(this, key, true, true);
      },
      get size() {
        return size(this, true);
      },
      has(key) {
        return has$1.call(this, key, true);
      },
      add: createReadonlyMethod(
        "add"
        /* ADD */
      ),
      set: createReadonlyMethod(
        "set"
        /* SET */
      ),
      delete: createReadonlyMethod(
        "delete"
        /* DELETE */
      ),
      clear: createReadonlyMethod(
        "clear"
        /* CLEAR */
      ),
      forEach: createForEach(true, true)
    };
    const iteratorMethods = ["keys", "values", "entries", Symbol.iterator];
    iteratorMethods.forEach((method) => {
      mutableInstrumentations2[method] = createIterableMethod(method, false, false);
      readonlyInstrumentations2[method] = createIterableMethod(method, true, false);
      shallowInstrumentations2[method] = createIterableMethod(method, false, true);
      shallowReadonlyInstrumentations2[method] = createIterableMethod(method, true, true);
    });
    return [
      mutableInstrumentations2,
      readonlyInstrumentations2,
      shallowInstrumentations2,
      shallowReadonlyInstrumentations2
    ];
  }
  var [mutableInstrumentations, readonlyInstrumentations, shallowInstrumentations, shallowReadonlyInstrumentations] = /* @__PURE__ */ createInstrumentations();
  function createInstrumentationGetter(isReadonly, shallow) {
    const instrumentations = shallow ? isReadonly ? shallowReadonlyInstrumentations : shallowInstrumentations : isReadonly ? readonlyInstrumentations : mutableInstrumentations;
    return (target, key, receiver) => {
      if (key === "__v_isReactive") {
        return !isReadonly;
      } else if (key === "__v_isReadonly") {
        return isReadonly;
      } else if (key === "__v_raw") {
        return target;
      }
      return Reflect.get(hasOwn(instrumentations, key) && key in target ? instrumentations : target, key, receiver);
    };
  }
  var mutableCollectionHandlers = {
    get: /* @__PURE__ */ createInstrumentationGetter(false, false)
  };
  var readonlyCollectionHandlers = {
    get: /* @__PURE__ */ createInstrumentationGetter(true, false)
  };
  function checkIdentityKeys(target, has2, key) {
    const rawKey = toRaw(key);
    if (rawKey !== key && has2.call(target, rawKey)) {
      const type = toRawType(target);
      console.warn(`Reactive ${type} contains both the raw and reactive versions of the same object${type === `Map` ? ` as keys` : ``}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`);
    }
  }
  var reactiveMap = /* @__PURE__ */ new WeakMap();
  var shallowReactiveMap = /* @__PURE__ */ new WeakMap();
  var readonlyMap = /* @__PURE__ */ new WeakMap();
  var shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
  function targetTypeMap(rawType) {
    switch (rawType) {
      case "Object":
      case "Array":
        return 1;
      case "Map":
      case "Set":
      case "WeakMap":
      case "WeakSet":
        return 2;
      default:
        return 0;
    }
  }
  function getTargetType(value) {
    return value[
      "__v_skip"
      /* SKIP */
    ] || !Object.isExtensible(value) ? 0 : targetTypeMap(toRawType(value));
  }
  function reactive2(target) {
    if (target && target[
      "__v_isReadonly"
      /* IS_READONLY */
    ]) {
      return target;
    }
    return createReactiveObject(target, false, mutableHandlers, mutableCollectionHandlers, reactiveMap);
  }
  function readonly(target) {
    return createReactiveObject(target, true, readonlyHandlers, readonlyCollectionHandlers, readonlyMap);
  }
  function createReactiveObject(target, isReadonly, baseHandlers, collectionHandlers, proxyMap) {
    if (!isObject(target)) {
      if (true) {
        console.warn(`value cannot be made reactive: ${String(target)}`);
      }
      return target;
    }
    if (target[
      "__v_raw"
      /* RAW */
    ] && !(isReadonly && target[
      "__v_isReactive"
      /* IS_REACTIVE */
    ])) {
      return target;
    }
    const existingProxy = proxyMap.get(target);
    if (existingProxy) {
      return existingProxy;
    }
    const targetType = getTargetType(target);
    if (targetType === 0) {
      return target;
    }
    const proxy = new Proxy(target, targetType === 2 ? collectionHandlers : baseHandlers);
    proxyMap.set(target, proxy);
    return proxy;
  }
  function toRaw(observed) {
    return observed && toRaw(observed[
      "__v_raw"
      /* RAW */
    ]) || observed;
  }
  function isRef(r) {
    return Boolean(r && r.__v_isRef === true);
  }

  // packages/alpinejs/src/magics/$nextTick.js
  magic("nextTick", () => nextTick);

  // packages/alpinejs/src/magics/$dispatch.js
  magic("dispatch", (el) => dispatch.bind(dispatch, el));

  // packages/alpinejs/src/magics/$watch.js
  magic("watch", (el, { evaluateLater: evaluateLater2, cleanup: cleanup2 }) => (key, callback) => {
    let evaluate2 = evaluateLater2(key);
    let getter = () => {
      let value;
      evaluate2((i) => value = i);
      return value;
    };
    let unwatch = watch(getter, callback);
    cleanup2(unwatch);
  });

  // packages/alpinejs/src/magics/$store.js
  magic("store", getStores);

  // packages/alpinejs/src/magics/$data.js
  magic("data", (el) => scope(el));

  // packages/alpinejs/src/magics/$root.js
  magic("root", (el) => closestRoot(el));

  // packages/alpinejs/src/magics/$refs.js
  magic("refs", (el) => {
    if (el._x_refs_proxy)
      return el._x_refs_proxy;
    el._x_refs_proxy = mergeProxies(getArrayOfRefObject(el));
    return el._x_refs_proxy;
  });
  function getArrayOfRefObject(el) {
    let refObjects = [];
    findClosest(el, (i) => {
      if (i._x_refs)
        refObjects.push(i._x_refs);
    });
    return refObjects;
  }

  // packages/alpinejs/src/ids.js
  var globalIdMemo = {};
  function findAndIncrementId(name) {
    if (!globalIdMemo[name])
      globalIdMemo[name] = 0;
    return ++globalIdMemo[name];
  }
  function closestIdRoot(el, name) {
    return findClosest(el, (element) => {
      if (element._x_ids && element._x_ids[name])
        return true;
    });
  }
  function setIdRoot(el, name) {
    if (!el._x_ids)
      el._x_ids = {};
    if (!el._x_ids[name])
      el._x_ids[name] = findAndIncrementId(name);
  }

  // packages/alpinejs/src/magics/$id.js
  magic("id", (el, { cleanup: cleanup2 }) => (name, key = null) => {
    let cacheKey = `${name}${key ? `-${key}` : ""}`;
    return cacheIdByNameOnElement(el, cacheKey, cleanup2, () => {
      let root = closestIdRoot(el, name);
      let id = root ? root._x_ids[name] : findAndIncrementId(name);
      return key ? `${name}-${id}-${key}` : `${name}-${id}`;
    });
  });
  interceptClone((from, to) => {
    if (from._x_id) {
      to._x_id = from._x_id;
    }
  });
  function cacheIdByNameOnElement(el, cacheKey, cleanup2, callback) {
    if (!el._x_id)
      el._x_id = {};
    if (el._x_id[cacheKey])
      return el._x_id[cacheKey];
    let output = callback();
    el._x_id[cacheKey] = output;
    cleanup2(() => {
      delete el._x_id[cacheKey];
    });
    return output;
  }

  // packages/alpinejs/src/magics/$el.js
  magic("el", (el) => el);

  // packages/alpinejs/src/magics/index.js
  warnMissingPluginMagic("Focus", "focus", "focus");
  warnMissingPluginMagic("Persist", "persist", "persist");
  function warnMissingPluginMagic(name, magicName, slug) {
    magic(magicName, (el) => warn(`You can't use [$${magicName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
  }

  // packages/alpinejs/src/directives/x-modelable.js
  directive("modelable", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2, cleanup: cleanup2 }) => {
    let func = evaluateLater2(expression);
    let innerGet = () => {
      let result;
      func((i) => result = i);
      return result;
    };
    let evaluateInnerSet = evaluateLater2(`${expression} = __placeholder`);
    let innerSet = (val) => evaluateInnerSet(() => {
    }, { scope: { "__placeholder": val } });
    let initialValue = innerGet();
    innerSet(initialValue);
    queueMicrotask(() => {
      if (!el._x_model)
        return;
      el._x_removeModelListeners["default"]();
      let outerGet = el._x_model.get;
      let outerSet = el._x_model.set;
      let releaseEntanglement = entangle(
        {
          get() {
            return outerGet();
          },
          set(value) {
            outerSet(value);
          }
        },
        {
          get() {
            return innerGet();
          },
          set(value) {
            innerSet(value);
          }
        }
      );
      cleanup2(releaseEntanglement);
    });
  });

  // packages/alpinejs/src/directives/x-teleport.js
  directive("teleport", (el, { modifiers, expression }, { cleanup: cleanup2 }) => {
    if (el.tagName.toLowerCase() !== "template")
      warn("x-teleport can only be used on a <template> tag", el);
    let target = getTarget(expression);
    let clone2 = el.content.cloneNode(true).firstElementChild;
    el._x_teleport = clone2;
    clone2._x_teleportBack = el;
    el.setAttribute("data-teleport-template", true);
    clone2.setAttribute("data-teleport-target", true);
    if (el._x_forwardEvents) {
      el._x_forwardEvents.forEach((eventName) => {
        clone2.addEventListener(eventName, (e) => {
          e.stopPropagation();
          el.dispatchEvent(new e.constructor(e.type, e));
        });
      });
    }
    addScopeToNode(clone2, {}, el);
    let placeInDom = (clone3, target2, modifiers2) => {
      if (modifiers2.includes("prepend")) {
        target2.parentNode.insertBefore(clone3, target2);
      } else if (modifiers2.includes("append")) {
        target2.parentNode.insertBefore(clone3, target2.nextSibling);
      } else {
        target2.appendChild(clone3);
      }
    };
    mutateDom(() => {
      placeInDom(clone2, target, modifiers);
      skipDuringClone(() => {
        initTree(clone2);
      })();
    });
    el._x_teleportPutBack = () => {
      let target2 = getTarget(expression);
      mutateDom(() => {
        placeInDom(el._x_teleport, target2, modifiers);
      });
    };
    cleanup2(
      () => mutateDom(() => {
        clone2.remove();
        destroyTree(clone2);
      })
    );
  });
  var teleportContainerDuringClone = document.createElement("div");
  function getTarget(expression) {
    let target = skipDuringClone(() => {
      return document.querySelector(expression);
    }, () => {
      return teleportContainerDuringClone;
    })();
    if (!target)
      warn(`Cannot find x-teleport element for selector: "${expression}"`);
    return target;
  }

  // packages/alpinejs/src/directives/x-ignore.js
  var handler = () => {
  };
  handler.inline = (el, { modifiers }, { cleanup: cleanup2 }) => {
    modifiers.includes("self") ? el._x_ignoreSelf = true : el._x_ignore = true;
    cleanup2(() => {
      modifiers.includes("self") ? delete el._x_ignoreSelf : delete el._x_ignore;
    });
  };
  directive("ignore", handler);

  // packages/alpinejs/src/directives/x-effect.js
  directive("effect", skipDuringClone((el, { expression }, { effect: effect3 }) => {
    effect3(evaluateLater(el, expression));
  }));

  // packages/alpinejs/src/utils/on.js
  function on(el, event, modifiers, callback) {
    let listenerTarget = el;
    let handler4 = (e) => callback(e);
    let options = {};
    let wrapHandler = (callback2, wrapper) => (e) => wrapper(callback2, e);
    if (modifiers.includes("dot"))
      event = dotSyntax(event);
    if (modifiers.includes("camel"))
      event = camelCase2(event);
    if (modifiers.includes("passive"))
      options.passive = true;
    if (modifiers.includes("capture"))
      options.capture = true;
    if (modifiers.includes("window"))
      listenerTarget = window;
    if (modifiers.includes("document"))
      listenerTarget = document;
    if (modifiers.includes("debounce")) {
      let nextModifier = modifiers[modifiers.indexOf("debounce") + 1] || "invalid-wait";
      let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
      handler4 = debounce(handler4, wait);
    }
    if (modifiers.includes("throttle")) {
      let nextModifier = modifiers[modifiers.indexOf("throttle") + 1] || "invalid-wait";
      let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
      handler4 = throttle(handler4, wait);
    }
    if (modifiers.includes("prevent"))
      handler4 = wrapHandler(handler4, (next, e) => {
        e.preventDefault();
        next(e);
      });
    if (modifiers.includes("stop"))
      handler4 = wrapHandler(handler4, (next, e) => {
        e.stopPropagation();
        next(e);
      });
    if (modifiers.includes("once")) {
      handler4 = wrapHandler(handler4, (next, e) => {
        next(e);
        listenerTarget.removeEventListener(event, handler4, options);
      });
    }
    if (modifiers.includes("away") || modifiers.includes("outside")) {
      listenerTarget = document;
      handler4 = wrapHandler(handler4, (next, e) => {
        if (el.contains(e.target))
          return;
        if (e.target.isConnected === false)
          return;
        if (el.offsetWidth < 1 && el.offsetHeight < 1)
          return;
        if (el._x_isShown === false)
          return;
        next(e);
      });
    }
    if (modifiers.includes("self"))
      handler4 = wrapHandler(handler4, (next, e) => {
        e.target === el && next(e);
      });
    if (isKeyEvent(event) || isClickEvent(event)) {
      handler4 = wrapHandler(handler4, (next, e) => {
        if (isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers)) {
          return;
        }
        next(e);
      });
    }
    listenerTarget.addEventListener(event, handler4, options);
    return () => {
      listenerTarget.removeEventListener(event, handler4, options);
    };
  }
  function dotSyntax(subject) {
    return subject.replace(/-/g, ".");
  }
  function camelCase2(subject) {
    return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
  }
  function isNumeric(subject) {
    return !Array.isArray(subject) && !isNaN(subject);
  }
  function kebabCase2(subject) {
    if ([" ", "_"].includes(
      subject
    ))
      return subject;
    return subject.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]/, "-").toLowerCase();
  }
  function isKeyEvent(event) {
    return ["keydown", "keyup"].includes(event);
  }
  function isClickEvent(event) {
    return ["contextmenu", "click", "mouse"].some((i) => event.includes(i));
  }
  function isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers) {
    let keyModifiers = modifiers.filter((i) => {
      return !["window", "document", "prevent", "stop", "once", "capture", "self", "away", "outside", "passive"].includes(i);
    });
    if (keyModifiers.includes("debounce")) {
      let debounceIndex = keyModifiers.indexOf("debounce");
      keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
    }
    if (keyModifiers.includes("throttle")) {
      let debounceIndex = keyModifiers.indexOf("throttle");
      keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
    }
    if (keyModifiers.length === 0)
      return false;
    if (keyModifiers.length === 1 && keyToModifiers(e.key).includes(keyModifiers[0]))
      return false;
    const systemKeyModifiers = ["ctrl", "shift", "alt", "meta", "cmd", "super"];
    const selectedSystemKeyModifiers = systemKeyModifiers.filter((modifier) => keyModifiers.includes(modifier));
    keyModifiers = keyModifiers.filter((i) => !selectedSystemKeyModifiers.includes(i));
    if (selectedSystemKeyModifiers.length > 0) {
      const activelyPressedKeyModifiers = selectedSystemKeyModifiers.filter((modifier) => {
        if (modifier === "cmd" || modifier === "super")
          modifier = "meta";
        return e[`${modifier}Key`];
      });
      if (activelyPressedKeyModifiers.length === selectedSystemKeyModifiers.length) {
        if (isClickEvent(e.type))
          return false;
        if (keyToModifiers(e.key).includes(keyModifiers[0]))
          return false;
      }
    }
    return true;
  }
  function keyToModifiers(key) {
    if (!key)
      return [];
    key = kebabCase2(key);
    let modifierToKeyMap = {
      "ctrl": "control",
      "slash": "/",
      "space": " ",
      "spacebar": " ",
      "cmd": "meta",
      "esc": "escape",
      "up": "arrow-up",
      "down": "arrow-down",
      "left": "arrow-left",
      "right": "arrow-right",
      "period": ".",
      "comma": ",",
      "equal": "=",
      "minus": "-",
      "underscore": "_"
    };
    modifierToKeyMap[key] = key;
    return Object.keys(modifierToKeyMap).map((modifier) => {
      if (modifierToKeyMap[modifier] === key)
        return modifier;
    }).filter((modifier) => modifier);
  }

  // packages/alpinejs/src/directives/x-model.js
  directive("model", (el, { modifiers, expression }, { effect: effect3, cleanup: cleanup2 }) => {
    let scopeTarget = el;
    if (modifiers.includes("parent")) {
      scopeTarget = el.parentNode;
    }
    let evaluateGet = evaluateLater(scopeTarget, expression);
    let evaluateSet;
    if (typeof expression === "string") {
      evaluateSet = evaluateLater(scopeTarget, `${expression} = __placeholder`);
    } else if (typeof expression === "function" && typeof expression() === "string") {
      evaluateSet = evaluateLater(scopeTarget, `${expression()} = __placeholder`);
    } else {
      evaluateSet = () => {
      };
    }
    let getValue = () => {
      let result;
      evaluateGet((value) => result = value);
      return isGetterSetter(result) ? result.get() : result;
    };
    let setValue = (value) => {
      let result;
      evaluateGet((value2) => result = value2);
      if (isGetterSetter(result)) {
        result.set(value);
      } else {
        evaluateSet(() => {
        }, {
          scope: { "__placeholder": value }
        });
      }
    };
    if (typeof expression === "string" && el.type === "radio") {
      mutateDom(() => {
        if (!el.hasAttribute("name"))
          el.setAttribute("name", expression);
      });
    }
    var event = el.tagName.toLowerCase() === "select" || ["checkbox", "radio"].includes(el.type) || modifiers.includes("lazy") ? "change" : "input";
    let removeListener = isCloning ? () => {
    } : on(el, event, modifiers, (e) => {
      setValue(getInputValue(el, modifiers, e, getValue()));
    });
    if (modifiers.includes("fill")) {
      if ([void 0, null, ""].includes(getValue()) || isCheckbox(el) && Array.isArray(getValue()) || el.tagName.toLowerCase() === "select" && el.multiple) {
        setValue(
          getInputValue(el, modifiers, { target: el }, getValue())
        );
      }
    }
    if (!el._x_removeModelListeners)
      el._x_removeModelListeners = {};
    el._x_removeModelListeners["default"] = removeListener;
    cleanup2(() => el._x_removeModelListeners["default"]());
    if (el.form) {
      let removeResetListener = on(el.form, "reset", [], (e) => {
        nextTick(() => el._x_model && el._x_model.set(getInputValue(el, modifiers, { target: el }, getValue())));
      });
      cleanup2(() => removeResetListener());
    }
    el._x_model = {
      get() {
        return getValue();
      },
      set(value) {
        setValue(value);
      }
    };
    el._x_forceModelUpdate = (value) => {
      if (value === void 0 && typeof expression === "string" && expression.match(/\./))
        value = "";
      window.fromModel = true;
      mutateDom(() => bind(el, "value", value));
      delete window.fromModel;
    };
    effect3(() => {
      let value = getValue();
      if (modifiers.includes("unintrusive") && document.activeElement.isSameNode(el))
        return;
      el._x_forceModelUpdate(value);
    });
  });
  function getInputValue(el, modifiers, event, currentValue) {
    return mutateDom(() => {
      if (event instanceof CustomEvent && event.detail !== void 0)
        return event.detail !== null && event.detail !== void 0 ? event.detail : event.target.value;
      else if (isCheckbox(el)) {
        if (Array.isArray(currentValue)) {
          let newValue = null;
          if (modifiers.includes("number")) {
            newValue = safeParseNumber(event.target.value);
          } else if (modifiers.includes("boolean")) {
            newValue = safeParseBoolean(event.target.value);
          } else {
            newValue = event.target.value;
          }
          return event.target.checked ? currentValue.includes(newValue) ? currentValue : currentValue.concat([newValue]) : currentValue.filter((el2) => !checkedAttrLooseCompare2(el2, newValue));
        } else {
          return event.target.checked;
        }
      } else if (el.tagName.toLowerCase() === "select" && el.multiple) {
        if (modifiers.includes("number")) {
          return Array.from(event.target.selectedOptions).map((option) => {
            let rawValue = option.value || option.text;
            return safeParseNumber(rawValue);
          });
        } else if (modifiers.includes("boolean")) {
          return Array.from(event.target.selectedOptions).map((option) => {
            let rawValue = option.value || option.text;
            return safeParseBoolean(rawValue);
          });
        }
        return Array.from(event.target.selectedOptions).map((option) => {
          return option.value || option.text;
        });
      } else {
        let newValue;
        if (isRadio(el)) {
          if (event.target.checked) {
            newValue = event.target.value;
          } else {
            newValue = currentValue;
          }
        } else {
          newValue = event.target.value;
        }
        if (modifiers.includes("number")) {
          return safeParseNumber(newValue);
        } else if (modifiers.includes("boolean")) {
          return safeParseBoolean(newValue);
        } else if (modifiers.includes("trim")) {
          return newValue.trim();
        } else {
          return newValue;
        }
      }
    });
  }
  function safeParseNumber(rawValue) {
    let number = rawValue ? parseFloat(rawValue) : null;
    return isNumeric2(number) ? number : rawValue;
  }
  function checkedAttrLooseCompare2(valueA, valueB) {
    return valueA == valueB;
  }
  function isNumeric2(subject) {
    return !Array.isArray(subject) && !isNaN(subject);
  }
  function isGetterSetter(value) {
    return value !== null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function";
  }

  // packages/alpinejs/src/directives/x-cloak.js
  directive("cloak", (el) => queueMicrotask(() => mutateDom(() => el.removeAttribute(prefix("cloak")))));

  // packages/alpinejs/src/directives/x-init.js
  addInitSelector(() => `[${prefix("init")}]`);
  directive("init", skipDuringClone((el, { expression }, { evaluate: evaluate2 }) => {
    if (typeof expression === "string") {
      return !!expression.trim() && evaluate2(expression, {}, false);
    }
    return evaluate2(expression, {}, false);
  }));

  // packages/alpinejs/src/directives/x-text.js
  directive("text", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
    let evaluate2 = evaluateLater2(expression);
    effect3(() => {
      evaluate2((value) => {
        mutateDom(() => {
          el.textContent = value;
        });
      });
    });
  });

  // packages/alpinejs/src/directives/x-html.js
  directive("html", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
    let evaluate2 = evaluateLater2(expression);
    effect3(() => {
      evaluate2((value) => {
        mutateDom(() => {
          el.innerHTML = value;
          el._x_ignoreSelf = true;
          initTree(el);
          delete el._x_ignoreSelf;
        });
      });
    });
  });

  // packages/alpinejs/src/directives/x-bind.js
  mapAttributes(startingWith(":", into(prefix("bind:"))));
  var handler2 = (el, { value, modifiers, expression, original }, { effect: effect3, cleanup: cleanup2 }) => {
    if (!value) {
      let bindingProviders = {};
      injectBindingProviders(bindingProviders);
      let getBindings = evaluateLater(el, expression);
      getBindings((bindings) => {
        applyBindingsObject(el, bindings, original);
      }, { scope: bindingProviders });
      return;
    }
    if (value === "key")
      return storeKeyForXFor(el, expression);
    if (el._x_inlineBindings && el._x_inlineBindings[value] && el._x_inlineBindings[value].extract) {
      return;
    }
    let evaluate2 = evaluateLater(el, expression);
    effect3(() => evaluate2((result) => {
      if (result === void 0 && typeof expression === "string" && expression.match(/\./)) {
        result = "";
      }
      mutateDom(() => bind(el, value, result, modifiers));
    }));
    cleanup2(() => {
      el._x_undoAddedClasses && el._x_undoAddedClasses();
      el._x_undoAddedStyles && el._x_undoAddedStyles();
    });
  };
  handler2.inline = (el, { value, modifiers, expression }) => {
    if (!value)
      return;
    if (!el._x_inlineBindings)
      el._x_inlineBindings = {};
    el._x_inlineBindings[value] = { expression, extract: false };
  };
  directive("bind", handler2);
  function storeKeyForXFor(el, expression) {
    el._x_keyExpression = expression;
  }

  // packages/alpinejs/src/directives/x-data.js
  addRootSelector(() => `[${prefix("data")}]`);
  directive("data", (el, { expression }, { cleanup: cleanup2 }) => {
    if (shouldSkipRegisteringDataDuringClone(el))
      return;
    expression = expression === "" ? "{}" : expression;
    let magicContext = {};
    injectMagics(magicContext, el);
    let dataProviderContext = {};
    injectDataProviders(dataProviderContext, magicContext);
    let data2 = evaluate(el, expression, { scope: dataProviderContext });
    if (data2 === void 0 || data2 === true)
      data2 = {};
    injectMagics(data2, el);
    let reactiveData = reactive(data2);
    initInterceptors(reactiveData);
    let undo = addScopeToNode(el, reactiveData);
    reactiveData["init"] && evaluate(el, reactiveData["init"]);
    cleanup2(() => {
      reactiveData["destroy"] && evaluate(el, reactiveData["destroy"]);
      undo();
    });
  });
  interceptClone((from, to) => {
    if (from._x_dataStack) {
      to._x_dataStack = from._x_dataStack;
      to.setAttribute("data-has-alpine-state", true);
    }
  });
  function shouldSkipRegisteringDataDuringClone(el) {
    if (!isCloning)
      return false;
    if (isCloningLegacy)
      return true;
    return el.hasAttribute("data-has-alpine-state");
  }

  // packages/alpinejs/src/directives/x-show.js
  directive("show", (el, { modifiers, expression }, { effect: effect3 }) => {
    let evaluate2 = evaluateLater(el, expression);
    if (!el._x_doHide)
      el._x_doHide = () => {
        mutateDom(() => {
          el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
        });
      };
    if (!el._x_doShow)
      el._x_doShow = () => {
        mutateDom(() => {
          if (el.style.length === 1 && el.style.display === "none") {
            el.removeAttribute("style");
          } else {
            el.style.removeProperty("display");
          }
        });
      };
    let hide = () => {
      el._x_doHide();
      el._x_isShown = false;
    };
    let show = () => {
      el._x_doShow();
      el._x_isShown = true;
    };
    let clickAwayCompatibleShow = () => setTimeout(show);
    let toggle = once(
      (value) => value ? show() : hide(),
      (value) => {
        if (typeof el._x_toggleAndCascadeWithTransitions === "function") {
          el._x_toggleAndCascadeWithTransitions(el, value, show, hide);
        } else {
          value ? clickAwayCompatibleShow() : hide();
        }
      }
    );
    let oldValue;
    let firstTime = true;
    effect3(() => evaluate2((value) => {
      if (!firstTime && value === oldValue)
        return;
      if (modifiers.includes("immediate"))
        value ? clickAwayCompatibleShow() : hide();
      toggle(value);
      oldValue = value;
      firstTime = false;
    }));
  });

  // packages/alpinejs/src/directives/x-for.js
  directive("for", (el, { expression }, { effect: effect3, cleanup: cleanup2 }) => {
    let iteratorNames = parseForExpression(expression);
    let evaluateItems = evaluateLater(el, iteratorNames.items);
    let evaluateKey = evaluateLater(
      el,
      // the x-bind:key expression is stored for our use instead of evaluated.
      el._x_keyExpression || "index"
    );
    el._x_prevKeys = [];
    el._x_lookup = {};
    effect3(() => loop(el, iteratorNames, evaluateItems, evaluateKey));
    cleanup2(() => {
      Object.values(el._x_lookup).forEach((el2) => mutateDom(
        () => {
          destroyTree(el2);
          el2.remove();
        }
      ));
      delete el._x_prevKeys;
      delete el._x_lookup;
    });
  });
  function loop(el, iteratorNames, evaluateItems, evaluateKey) {
    let isObject2 = (i) => typeof i === "object" && !Array.isArray(i);
    let templateEl = el;
    evaluateItems((items) => {
      if (isNumeric3(items) && items >= 0) {
        items = Array.from(Array(items).keys(), (i) => i + 1);
      }
      if (items === void 0)
        items = [];
      let lookup = el._x_lookup;
      let prevKeys = el._x_prevKeys;
      let scopes = [];
      let keys = [];
      if (isObject2(items)) {
        items = Object.entries(items).map(([key, value]) => {
          let scope2 = getIterationScopeVariables(iteratorNames, value, key, items);
          evaluateKey((value2) => {
            if (keys.includes(value2))
              warn("Duplicate key on x-for", el);
            keys.push(value2);
          }, { scope: { index: key, ...scope2 } });
          scopes.push(scope2);
        });
      } else {
        for (let i = 0; i < items.length; i++) {
          let scope2 = getIterationScopeVariables(iteratorNames, items[i], i, items);
          evaluateKey((value) => {
            if (keys.includes(value))
              warn("Duplicate key on x-for", el);
            keys.push(value);
          }, { scope: { index: i, ...scope2 } });
          scopes.push(scope2);
        }
      }
      let adds = [];
      let moves = [];
      let removes = [];
      let sames = [];
      for (let i = 0; i < prevKeys.length; i++) {
        let key = prevKeys[i];
        if (keys.indexOf(key) === -1)
          removes.push(key);
      }
      prevKeys = prevKeys.filter((key) => !removes.includes(key));
      let lastKey = "template";
      for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        let prevIndex = prevKeys.indexOf(key);
        if (prevIndex === -1) {
          prevKeys.splice(i, 0, key);
          adds.push([lastKey, i]);
        } else if (prevIndex !== i) {
          let keyInSpot = prevKeys.splice(i, 1)[0];
          let keyForSpot = prevKeys.splice(prevIndex - 1, 1)[0];
          prevKeys.splice(i, 0, keyForSpot);
          prevKeys.splice(prevIndex, 0, keyInSpot);
          moves.push([keyInSpot, keyForSpot]);
        } else {
          sames.push(key);
        }
        lastKey = key;
      }
      for (let i = 0; i < removes.length; i++) {
        let key = removes[i];
        if (!(key in lookup))
          continue;
        mutateDom(() => {
          destroyTree(lookup[key]);
          lookup[key].remove();
        });
        delete lookup[key];
      }
      for (let i = 0; i < moves.length; i++) {
        let [keyInSpot, keyForSpot] = moves[i];
        let elInSpot = lookup[keyInSpot];
        let elForSpot = lookup[keyForSpot];
        let marker = document.createElement("div");
        mutateDom(() => {
          if (!elForSpot)
            warn(`x-for ":key" is undefined or invalid`, templateEl, keyForSpot, lookup);
          elForSpot.after(marker);
          elInSpot.after(elForSpot);
          elForSpot._x_currentIfEl && elForSpot.after(elForSpot._x_currentIfEl);
          marker.before(elInSpot);
          elInSpot._x_currentIfEl && elInSpot.after(elInSpot._x_currentIfEl);
          marker.remove();
        });
        elForSpot._x_refreshXForScope(scopes[keys.indexOf(keyForSpot)]);
      }
      for (let i = 0; i < adds.length; i++) {
        let [lastKey2, index] = adds[i];
        let lastEl = lastKey2 === "template" ? templateEl : lookup[lastKey2];
        if (lastEl._x_currentIfEl)
          lastEl = lastEl._x_currentIfEl;
        let scope2 = scopes[index];
        let key = keys[index];
        let clone2 = document.importNode(templateEl.content, true).firstElementChild;
        let reactiveScope = reactive(scope2);
        addScopeToNode(clone2, reactiveScope, templateEl);
        clone2._x_refreshXForScope = (newScope) => {
          Object.entries(newScope).forEach(([key2, value]) => {
            reactiveScope[key2] = value;
          });
        };
        mutateDom(() => {
          lastEl.after(clone2);
          skipDuringClone(() => initTree(clone2))();
        });
        if (typeof key === "object") {
          warn("x-for key cannot be an object, it must be a string or an integer", templateEl);
        }
        lookup[key] = clone2;
      }
      for (let i = 0; i < sames.length; i++) {
        lookup[sames[i]]._x_refreshXForScope(scopes[keys.indexOf(sames[i])]);
      }
      templateEl._x_prevKeys = keys;
    });
  }
  function parseForExpression(expression) {
    let forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
    let stripParensRE = /^\s*\(|\)\s*$/g;
    let forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/;
    let inMatch = expression.match(forAliasRE);
    if (!inMatch)
      return;
    let res = {};
    res.items = inMatch[2].trim();
    let item = inMatch[1].replace(stripParensRE, "").trim();
    let iteratorMatch = item.match(forIteratorRE);
    if (iteratorMatch) {
      res.item = item.replace(forIteratorRE, "").trim();
      res.index = iteratorMatch[1].trim();
      if (iteratorMatch[2]) {
        res.collection = iteratorMatch[2].trim();
      }
    } else {
      res.item = item;
    }
    return res;
  }
  function getIterationScopeVariables(iteratorNames, item, index, items) {
    let scopeVariables = {};
    if (/^\[.*\]$/.test(iteratorNames.item) && Array.isArray(item)) {
      let names = iteratorNames.item.replace("[", "").replace("]", "").split(",").map((i) => i.trim());
      names.forEach((name, i) => {
        scopeVariables[name] = item[i];
      });
    } else if (/^\{.*\}$/.test(iteratorNames.item) && !Array.isArray(item) && typeof item === "object") {
      let names = iteratorNames.item.replace("{", "").replace("}", "").split(",").map((i) => i.trim());
      names.forEach((name) => {
        scopeVariables[name] = item[name];
      });
    } else {
      scopeVariables[iteratorNames.item] = item;
    }
    if (iteratorNames.index)
      scopeVariables[iteratorNames.index] = index;
    if (iteratorNames.collection)
      scopeVariables[iteratorNames.collection] = items;
    return scopeVariables;
  }
  function isNumeric3(subject) {
    return !Array.isArray(subject) && !isNaN(subject);
  }

  // packages/alpinejs/src/directives/x-ref.js
  function handler3() {
  }
  handler3.inline = (el, { expression }, { cleanup: cleanup2 }) => {
    let root = closestRoot(el);
    if (!root._x_refs)
      root._x_refs = {};
    root._x_refs[expression] = el;
    cleanup2(() => delete root._x_refs[expression]);
  };
  directive("ref", handler3);

  // packages/alpinejs/src/directives/x-if.js
  directive("if", (el, { expression }, { effect: effect3, cleanup: cleanup2 }) => {
    if (el.tagName.toLowerCase() !== "template")
      warn("x-if can only be used on a <template> tag", el);
    let evaluate2 = evaluateLater(el, expression);
    let show = () => {
      if (el._x_currentIfEl)
        return el._x_currentIfEl;
      let clone2 = el.content.cloneNode(true).firstElementChild;
      addScopeToNode(clone2, {}, el);
      mutateDom(() => {
        el.after(clone2);
        skipDuringClone(() => initTree(clone2))();
      });
      el._x_currentIfEl = clone2;
      el._x_undoIf = () => {
        mutateDom(() => {
          destroyTree(clone2);
          clone2.remove();
        });
        delete el._x_currentIfEl;
      };
      return clone2;
    };
    let hide = () => {
      if (!el._x_undoIf)
        return;
      el._x_undoIf();
      delete el._x_undoIf;
    };
    effect3(() => evaluate2((value) => {
      value ? show() : hide();
    }));
    cleanup2(() => el._x_undoIf && el._x_undoIf());
  });

  // packages/alpinejs/src/directives/x-id.js
  directive("id", (el, { expression }, { evaluate: evaluate2 }) => {
    let names = evaluate2(expression);
    names.forEach((name) => setIdRoot(el, name));
  });
  interceptClone((from, to) => {
    if (from._x_ids) {
      to._x_ids = from._x_ids;
    }
  });

  // packages/alpinejs/src/directives/x-on.js
  mapAttributes(startingWith("@", into(prefix("on:"))));
  directive("on", skipDuringClone((el, { value, modifiers, expression }, { cleanup: cleanup2 }) => {
    let evaluate2 = expression ? evaluateLater(el, expression) : () => {
    };
    if (el.tagName.toLowerCase() === "template") {
      if (!el._x_forwardEvents)
        el._x_forwardEvents = [];
      if (!el._x_forwardEvents.includes(value))
        el._x_forwardEvents.push(value);
    }
    let removeListener = on(el, value, modifiers, (e) => {
      evaluate2(() => {
      }, { scope: { "$event": e }, params: [e] });
    });
    cleanup2(() => removeListener());
  }));

  // packages/alpinejs/src/directives/index.js
  warnMissingPluginDirective("Collapse", "collapse", "collapse");
  warnMissingPluginDirective("Intersect", "intersect", "intersect");
  warnMissingPluginDirective("Focus", "trap", "focus");
  warnMissingPluginDirective("Mask", "mask", "mask");
  function warnMissingPluginDirective(name, directiveName, slug) {
    directive(directiveName, (el) => warn(`You can't use [x-${directiveName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
  }

  // packages/alpinejs/src/index.js
  alpine_default.setEvaluator(normalEvaluator);
  alpine_default.setReactivityEngine({ reactive: reactive2, effect: effect2, release: stop, raw: toRaw });
  var src_default = alpine_default;

  // packages/alpinejs/builds/cdn.js
  window.Alpine = src_default;
  queueMicrotask(() => {
    src_default.start();
  });
})();
