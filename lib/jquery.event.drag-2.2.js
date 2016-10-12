/*!
 * jquery.event.drag - v 2.2
 * Copyright (c) 2010 Three Dub Media - http://threedubmedia.com
 * Open Source MIT License - http://threedubmedia.com/code/license
 */
// Created: 2008-06-04
// Updated: 2012-05-21
// REQUIRES: jquery 1.7.x

import $ from 'jquery';

$.fn.drag = function (str, arg, opts) {
  let type = typeof str == 'string' ? str : '',
    fn = $.isFunction(str) ? str : $.isFunction(arg) ? arg : null;
  if (type.indexOf('drag') !== 0)
    type = `drag${type}`;
  opts = (str == fn ? arg : opts) || {};
  return fn ? this.bind(type, opts, fn) : this.trigger(type);
};

let $event = $.event;
let $special = $event.special;
let drag = $special.drag = {
  defaults: {
    which: 1, // mouse button pressed to start drag sequence
    distance: 0, // distance dragged before dragstart
    not: ':input', // selector to suppress dragging on target elements
    handle: null, // selector to match handle target elements
    relative: false, // true to use "position", false to use "offset"
    drop: true, // false to suppress drop events, true or selector to allow
    click: false, // false to suppress click events after dragend (no proxy)
  },

  datakey: 'dragdata',
  noBubble: true,

  add(obj) {
    let data = $.data(this, drag.datakey);
    let opts = obj.data || {};
    data.related += 1;
    $.each(drag.defaults, (key) => {
      if (opts[key] !== undefined) data[key] = opts[key];
    });
  },

  remove() {
    $.data(this, drag.datakey).related -= 1;
  },

  setup() {
    if ($.data(this, drag.datakey)) return;
    let data = $.extend({ related: 0 }, drag.defaults);
    $.data(this, drag.datakey, data);
    $event.add(this, 'touchstart mousedown', drag.init, data);
    if (this.attachEvent) this.attachEvent('ondragstart', drag.dontstart);
  },

  teardown() {
    let data = $.data(this, drag.datakey) || {};
    if (data.related) return;
    $.removeData(this, drag.datakey);
    $event.remove(this, 'touchstart mousedown', drag.init);
    drag.textselect(true);
    if (this.detachEvent) this.detachEvent('ondragstart', drag.dontstart);
  },

  init(event) {
    if (drag.touched) return;
    let dd = event.data;
    let results;
    if (event.which !== 0 && dd.which > 0 && event.which !== dd.which) return;
    if ($(event.target).is(dd.not)) return;
    if (dd.handle && !$(event.target).closest(dd.handle, event.currentTarget).length) return;

    drag.touched = event.type === 'touchstart' ? this : null;
    dd.propagates = 1;
    dd.mousedown = this;
    dd.interactions = [drag.interaction(this, dd)];
    dd.target = event.target;
    dd.pageX = event.pageX;
    dd.pageY = event.pageY;
    dd.dragging = null;
    results = drag.hijack(event, 'draginit', dd);
    if (!dd.propagates) return;
    results = drag.flatten(results);
    if (results && results.length) {
      dd.interactions = [];
      $.each(results, function () {
        dd.interactions.push(drag.interaction(this, dd));
      });
    }
    dd.propagates = dd.interactions.length;
    if (dd.drop !== false && $special.drop) $special.drop.handler(event, dd);
    drag.textselect(false);
    if (drag.touched) $event.add(drag.touched, 'touchmove touchend', drag.handler, dd);
    else $event.add(document, 'mousemove mouseup', drag.handler, dd);
    if (!drag.touched || dd.live) return false;
  },

  interaction(elem, dd) {
    let offset = $(elem)[dd.relative ? 'position' : 'offset']() || { top: 0, left: 0 };
    return {
      drag: elem,
      callback: new drag.callback(),
      droppable: [],
      offset,
    };
  },

  handler(event) {
    let dd = event.data;
    switch (event.type) {
      case !dd.dragging && 'touchmove':
        event.preventDefault();
      case !dd.dragging && 'mousemove':
        //  drag tolerance, x≤ + y≤ = distance≤
        if (Math.pow(event.pageX - dd.pageX, 2) + Math.pow(event.pageY - dd.pageY, 2) < Math.pow(dd.distance, 2))
          break; // distance tolerance not reached
        event.target = dd.target; // force target from "mousedown" event (fix distance issue)
        drag.hijack(event, 'dragstart', dd); // trigger "dragstart"
        if (dd.propagates) // "dragstart" not rejected
          dd.dragging = true; // activate interaction
      // mousemove, dragging
      case 'touchmove':
        event.preventDefault();
      case 'mousemove':
        if (dd.dragging) {
          // trigger "drag"
          drag.hijack(event, 'drag', dd);
          if (dd.propagates) {
            // manage drop events
            if (dd.drop !== false && $special.drop)
              $special.drop.handler(event, dd); // "dropstart", "dropend"
            break; // "drag" not rejected, stop
          }
          event.type = 'mouseup'; // helps "drop" handler behave
        }
      // mouseup, stop dragging
      case 'touchend':
      case 'mouseup':
      default:
        if (drag.touched)
          $event.remove(drag.touched, 'touchmove touchend', drag.handler); // remove touch events
        else
          $event.remove(document, 'mousemove mouseup', drag.handler); // remove page events
        if (dd.dragging) {
          if (dd.drop !== false && $special.drop)
            $special.drop.handler(event, dd); // "drop"
          drag.hijack(event, 'dragend', dd); // trigger "dragend"
        }
        drag.textselect(true); // enable text selection
        // if suppressing click events...
        if (dd.click === false && dd.dragging)
          $.data(dd.mousedown, 'suppress.click', new Date().getTime() + 5);
        dd.dragging = drag.touched = false; // deactivate element
        break;
    }
  },

  hijack(event, type, dd, x, elem) {
    if (!dd) return;
    let orig = { event: event.originalEvent, type: event.type },
      mode = type.indexOf('drop') ? 'drag' : 'drop',
      result, i = x || 0, ia, $elems, callback,
      len = !isNaN(x) ? x : dd.interactions.length;
    // modify the event type
    event.type = type;
    // remove the original event
    event.originalEvent = null;
    // initialize the results
    dd.results = [];
    // handle each interacted element
    do if (ia = dd.interactions[i]) {
      // validate the interaction
      if (type !== 'dragend' && ia.cancelled)
        continue;
      // set the dragdrop properties on the event object
      callback = drag.properties(event, dd, ia);
      // prepare for more results
      ia.results = [];
      // handle each element
      $(elem || ia[mode] || dd.droppable).each((p, subject) => {
        // identify drag or drop targets individually
        callback.target = subject;
        // force propagtion of the custom event
        event.isPropagationStopped = function () { return false; };
        // handle the event
        result = subject ? $event.dispatch.call(subject, event, callback) : null;
        // stop the drag interaction for this element
        if (result === false) {
          if (mode == 'drag') {
            ia.cancelled = true;
            dd.propagates -= 1;
          }
          if (type == 'drop') {
            ia[mode][p] = null;
          }
        }
        // assign any dropinit elements
        else if (type == 'dropinit')
          ia.droppable.push(drag.element(result) || subject);
        // accept a returned proxy element
        if (type == 'dragstart')
          ia.proxy = $(drag.element(result) || ia.drag)[0];
        // remember this result
        ia.results.push(result);
        // forget the event result, for recycling
        delete event.result;
        // break on cancelled handler
        if (type !== 'dropinit')
          return result;
      });
      // flatten the results
      dd.results[i] = drag.flatten(ia.results);
      // accept a set of valid drop targets
      if (type == 'dropinit')
        ia.droppable = drag.flatten(ia.droppable);
      // locate drop targets
      if (type == 'dragstart' && !ia.cancelled)
        callback.update();
    }
    while (++i < len);
    // restore the original event & type
    event.type = orig.type;
    event.originalEvent = orig.event;
    // return all handler results
    return drag.flatten(dd.results);
  },

  // extend the callback object with drag/drop properties...
  properties(event, dd, ia) {
    let obj = ia.callback;
    // elements
    obj.drag = ia.drag;
    obj.proxy = ia.proxy || ia.drag;
    // starting mouse position
    obj.startX = dd.pageX;
    obj.startY = dd.pageY;
    // current distance dragged
    obj.deltaX = event.pageX - dd.pageX;
    obj.deltaY = event.pageY - dd.pageY;
    // original element position
    obj.originalX = ia.offset.left;
    obj.originalY = ia.offset.top;
    // adjusted element position
    obj.offsetX = obj.originalX + obj.deltaX;
    obj.offsetY = obj.originalY + obj.deltaY;
    // assign the drop targets information
    obj.drop = drag.flatten((ia.drop || []).slice());
    obj.available = drag.flatten((ia.droppable || []).slice());
    return obj;
  },

  // determine is the argument is an element or jquery instance
  element(arg) {
    if (arg && (arg.jquery || arg.nodeType == 1))
      return arg;
  },

  // flatten nested jquery objects and arrays into a single dimension array
  flatten(arr) {
    return $.map(arr, (member) => {
      return member && member.jquery ? $.makeArray(member) :
        member && member.length ? drag.flatten(member) : member;
    });
  },

  // toggles text selection attributes ON (true) or OFF (false)
  textselect(bool) {
    $(document)[bool ? 'unbind' : 'bind']('selectstart', drag.dontstart)
      .css('MozUserSelect', bool ? '' : 'none');
    // .attr("unselectable", bool ? "off" : "on" )
    document.unselectable = bool ? 'off' : 'on';
  },

  // suppress "selectstart" and "ondragstart" events
  dontstart() {
    return false;
  },

  // a callback instance contructor
  callback() {},

};

// callback methods
drag.callback.prototype = {
  update() {
    if ($special.drop && this.available.length)
      $.each(this.available, function (i) {
        $special.drop.locate(this, i);
      });
  },
};

// patch $.event.$dispatch to allow suppressing clicks
let $dispatch = $event.dispatch;
$event.dispatch = function (event) {
  if ($.data(this, `suppress.${event.type}`) - new Date().getTime() > 0) {
    $.removeData(this, `suppress.${event.type}`);
    return;
  }
  return $dispatch.apply(this, arguments);
};

// event fix hooks for touch events...
let touchHooks =
$event.fixHooks.touchstart =
$event.fixHooks.touchmove =
$event.fixHooks.touchend =
$event.fixHooks.touchcancel = {
  props: 'clientX clientY pageX pageY screenX screenY'.split(' '),
  filter(event, orig) {
    if (orig) {
      let touched = (orig.touches && orig.touches[0]) || (orig.changedTouches && orig.changedTouches[0]) || null;
      // iOS webkit: touchstart, touchmove, touchend
      if (touched) $.each(touchHooks.props, (i, prop) => { event[prop] = touched[prop]; });
    }
    return event;
  },
};

// share the same special event configuration with related events...
$special.draginit = $special.dragstart = $special.dragend = drag;
