/**
 * @license
 * (c) 2009-2013 Michael Leibman
 * michael{dot}leibman{at}gmail{dot}com
 * http://github.com/mleibman/slickgrid
 *
 * Distributed under MIT license.
 * All rights reserved.
 *
 * NOTES:
 *     Cell/row DOM manipulations are done directly bypassing jQuery's DOM manipulation methods.
 *     This increases the speed dramatically, but can only be done safely
 *     because there are no event handlers or data associated with any cell/row DOM nodes.
 *     Cell editors must make sure they implement .destroy() and do proper cleanup.
 */

import _ from 'lodash';
import $ from 'jquery';
import './lib/jquery.event.drag-2.2';
import './lib/jquery.event.drop-2.2';

import Event from './slick.Event';
import EventData from './slick.EventData';
import keyCode from './slick.KeyCode';
import Range from './slick.Range';

let scrollbarDimensions;

function SlickGrid(container, data, columns, options) {
  const defaults = {
    rowHeight: 25,
    defaultColumnWidth: 80,
    enableRowNavigation: true,
    enableColumnReorder: true,
    forceFitColumns: false,
    formatterFactory: null,
    dataItemColumnValueExtractor: null,
    fullWidthRows: false,
    enableThreeStepsSorting: false,
    multiColumnSort: false,
    defaultFormatter,
    forceSyncScrolling: false,
  };

  const columnDefaults = {
    name: '',
    resizable: true,
    sortable: false,
    minWidth: 30,
    rerenderOnResize: false,
    headerCssClass: null,
    defaultSortAsc: true,
    focusable: true,
    selectable: true,
  };

  // scroller
  // virtual height
  let th;

  // real scrollable height
  let h;

  let vScrollDir = 1;

  // private
  let $container;
  let uid = `slickgrid_${Math.round(1000000 * Math.random())}`;
  let _this = this;
  let $focusSink;
  let $focusSink2;
  let $headerScroller;
  let $headers;
  let $viewport;
  let $canvas;
  let $style;
  let $boundAncestors;
  let stylesheet;
  let columnCssRulesL;
  let columnCssRulesR;
  let viewportH;
  let viewportW;
  let canvasWidth;
  let viewportHasHScroll;
  let viewportHasVScroll;
  let headerColumnWidthDiff = 0;
  let cellWidthDiff = 0;
  let cellHeightDiff = 0;
  let absoluteColumnMinWidth;

  let tabbingDirection = 1;
  let activeRow;
  let activeRowNode = null;

  let rowsCache = {};
  let numVisibleRows;
  let prevScrollTop = 0;
  let scrollTop = 0;
  let lastRenderedScrollTop = 0;
  let lastRenderedScrollLeft = 0;
  let prevScrollLeft = 0;
  let scrollLeft = 0;

  let selectionModel;
  let selectedRows = [];

  let plugins = [];
  let cellCssClasses = {};

  let columnsById = {};
  let sortColumns = [];
  let columnGroups = [];
  let columnPosLeft = [];
  let columnPosRight = [];

  let horizontalRender = null;

  // These two variables work around a bug with inertial scrolling in Webkit/Blink on Mac.
  // See http://crbug.com/312427.
  // this node must not be deleted while inertial scrolling
  let rowNodeFromLastMouseWheelEvent;

  // node that was hidden instead of getting deleted
  let zombieRowNodeFromLastMouseWheelEvent;

  // Initialization

  function init() {
    $container = $(container);
    if ($container.length < 1) {
      throw new Error(`SlickGrid requires a valid container, ${container} does not exist in the DOM.`);
    }

    scrollbarDimensions = scrollbarDimensions || measureScrollbar();

    options = $.extend({}, defaults, options);
    columnDefaults.width = options.defaultColumnWidth;

    columnsById = {};
    for (let i = 0; i < columns.length; i++) {
      let m = columns[i] = $.extend({}, columnDefaults, columns[i]);
      columnsById[m.id] = i;
      if (m.minWidth && m.width < m.minWidth) {
        m.width = m.minWidth;
      }

      if (m.maxWidth && m.width > m.maxWidth) {
        m.width = m.maxWidth;
      }
    }

    $container
      .empty()
      .css('overflow', 'hidden')
      .css('outline', 0)
      .addClass(uid)
      .addClass('ui-widget narrow');

    // set up a positioning container if needed
    if (!/relative|absolute|fixed/.test($container.css('position'))) {
      $container.css('position', 'relative');
    }

    $focusSink = $('<div tabIndex="0" hideFocus style="position:fixed;width:0;height:0;top:0;left:0;outline:0;"></div>').appendTo($container);

    $headerScroller = $('<div class="slick-header ui-state-default" style="overflow:hidden;position:relative;"/>').appendTo($container);
    $headers = $('<div class="slick-header-columns" style="left:-1000px"/>').appendTo($headerScroller);
    $headers.width(getHeadersWidth());

    $viewport = $('<div class="slick-viewport" style="width:100%;overflow:auto;outline:0;position:relative;"">').appendTo($container);

    $canvas = $('<div class="grid-canvas"/>').appendTo($viewport);

    $focusSink2 = $focusSink.clone().appendTo($container);

    viewportW = parseFloat($.css($container[0], 'width', true));

    // header columns and cells may have different padding/border skewing width calculations (box-sizing, hello?)
    // calculate the diff so we can set consistent sizes
    measureCellPaddingAndBorder();

    updateColumnCaches();
    createColumnHeaders();
    setupColumnSort();
    createCssRules();
    resizeCanvas();
    bindAncestorScrollEvents();

    $container
      .bind('resize.slickgrid', resizeCanvas);
    $viewport
      .bind('scroll', handleScroll);
    $headerScroller
      .bind('contextmenu', handleHeaderContextMenu)
      .bind('click', handleHeaderClick)
      .delegate('.slick-header-column', 'mouseenter', handleHeaderMouseEnter)
      .delegate('.slick-header-column', 'mouseleave', handleHeaderMouseLeave);
    $focusSink.add($focusSink2)
      .bind('keydown', handleKeyDown);
    $canvas
      .bind('keydown', handleKeyDown)
      .bind('click', handleClick)
      .bind('dblclick', handleDblClick)
      .bind('contextmenu', handleContextMenu)
      .delegate('.slick-cell', 'mouseenter', handleMouseEnter)
      .delegate('.slick-cell', 'mouseleave', handleMouseLeave);

    // Work around http://crbug.com/312427.
    if (navigator.userAgent.toLowerCase().match(/webkit/) &&
        navigator.userAgent.toLowerCase().match(/macintosh/)) {
      $canvas.bind('mousewheel', handleMouseWheel);
    }
  }

  function registerPlugin(plugin) {
    plugins.unshift(plugin);
    plugin.init(_this);
  }

  function unregisterPlugin(plugin) {
    for (let i = plugins.length; i >= 0; i--) {
      if (plugins[i] === plugin) {
        if (plugins[i].destroy) {
          plugins[i].destroy();
        }

        plugins.splice(i, 1);
        break;
      }
    }
  }

  function getCanvasNode() {
    return $canvas[0];
  }

  function measureScrollbar() {
    let $c = $('<div style="position:absolute; top:-10000px; left:-10000px; width:100px; height:100px; overflow:scroll;""></div>').appendTo('body');
    let dim = {
      width: $c.width() - $c[0].clientWidth,
      height: $c.height() - $c[0].clientHeight,
    };
    $c.remove();
    return dim;
  }

  function getHeadersWidth() {
    let headersWidth = 0;
    for (let i = 0, ii = columns.length; i < ii; i++) {
      let width = columns[i].width;
      headersWidth += width;
    }

    headersWidth += scrollbarDimensions.width;
    return Math.max(headersWidth, viewportW) + 1200;
  }

  function getCanvasWidth() {
    let availableWidth = viewportHasVScroll ? viewportW - scrollbarDimensions.width : viewportW;
    let rowWidth = 0;
    let i = columns.length;
    while (i--) {
      rowWidth += columns[i].width;
    }

    return options.fullWidthRows ? Math.max(rowWidth, availableWidth) : rowWidth;
  }

  function updateCanvasWidth(forceColumnWidthsUpdate) {
    let oldCanvasWidth = canvasWidth;
    canvasWidth = getCanvasWidth();

    if (canvasWidth !== oldCanvasWidth) {
      $canvas.width(canvasWidth);
      $headers.width(getHeadersWidth());
      viewportHasHScroll = (canvasWidth > viewportW - scrollbarDimensions.width);
    }

    if (canvasWidth !== oldCanvasWidth || forceColumnWidthsUpdate) {
      applyColumnWidths();
    }
  }

  function updateCanvasHeight() {
    let numberOfRows = getDataLength();

    let oldViewportHasVScroll = viewportHasVScroll;
    viewportHasVScroll = numberOfRows * options.rowHeight > viewportH;

    _.forEach(rowsCache, (cache, id) => {
      let row = data.getIdxById(id);
      if (row >= numberOfRows) {
        removeRowFromCache(id);
      }
    });

    if (activeRowNode && activeRow >= numberOfRows) {
      resetActiveRow();
    }

    let oldH = h;
    th = Math.max(options.rowHeight * numberOfRows, viewportH - scrollbarDimensions.height);

    // just one page
    h = th;

    if (h !== oldH) {
      $canvas.css('height', h);
      scrollTop = $viewport[0].scrollTop;
    }

    let oldScrollTopInRange = (scrollTop <= th - viewportH);

    if (th !== 0 && scrollTop !== 0) {
      if (oldScrollTopInRange) {
        // maintain virtual position
        scrollTo(scrollTop);
      } else {
        // scroll to bottom
        scrollTo(th - viewportH);
      }
    }

    if (options.forceFitColumns && oldViewportHasVScroll !== viewportHasVScroll) {
      autosizeColumns();
    }
  }

  // TODO:  this is static.  need to handle page mutation.
  function bindAncestorScrollEvents() {
    let elem = $canvas[0];
    while ((elem = elem.parentNode) !== document.body && elem != null) {
      // bind to scroll containers only
      if (elem === $viewport[0] || elem.scrollWidth !== elem.clientWidth || elem.scrollHeight !== elem.clientHeight) {
        let $elem = $(elem);
        if (!$boundAncestors) {
          $boundAncestors = $elem;
        } else {
          $boundAncestors = $boundAncestors.add($elem);
        }

        $elem.bind(`scroll.${uid}`, handleActiveRowPositionChange);
      }
    }
  }

  function unbindAncestorScrollEvents() {
    if (!$boundAncestors) {
      return;
    }

    $boundAncestors.unbind(`scroll.${uid}`);
    $boundAncestors = null;
  }

  function createColumnHeaders() {
    $headers.find('.slick-header-column')
      .each(function () {
        let columnDef = $(this).data('column');
        if (columnDef) {
          trigger(_this.onBeforeHeaderCellDestroy, {
            node: this,
            column: columnDef,
          });
        }
      });

    $headers.empty();
    $headers.width(getHeadersWidth());

    let $headerGroups = {};

    for (let i = 0; i < columns.length; i++) {
      let m = columns[i];

      let header = $('<div class="ui-state-default slick-header-column"/>')
        .html(`<span class="slick-column-name">${m.name}</span>`)
        .width(m.width - headerColumnWidthDiff)
        .attr('id', `${uid}${m.id}`)
        .attr('title', m.toolTip || '')
        .data('column', m)
        .addClass(m.headerCssClass || '');

      if (m.group != null) {
        let groupId = m.group;
        let group = columnGroups[groupId];
        if (!$headerGroups[groupId]) {
          let $group = $(`<div class="slick-header-column-group slick-header-column-group-${groupId}""/>`)
            .html(`<div class="slick-header-column-group-name">${group.name}</div><div class="slick-header-group-container"></div>`)
            .attr('id', `${uid}group_${groupId}`)
            .appendTo($headers);
          $headerGroups[groupId] = {
            childrenCount: 0,
            el: $group,
            container: $group.find('.slick-header-group-container'),
            width: 0,
          };
        }

        let g = $headerGroups[groupId];
        g.childrenCount++;
        header.appendTo(g.container);
        g.width += m.width - headerColumnWidthDiff + 8;
        g.el.width(g.width - g.childrenCount);
        g.container.width(g.width + 400);
      } else {
        header.appendTo($headers);
      }

      if (m.sortable) {
        header.addClass('slick-header-sortable');
        header.append('<span class="slick-sort-indicator"/>');
      }

      trigger(_this.onHeaderCellRendered, {
        node: header[0],
        column: m,
      });
    }

    setSortColumns(sortColumns);
    setupColumnResize();
    if (options.enableColumnReorder) {
      setupColumnReorder();
    }
  }

  function setupColumnSort() {
    $headers.click((e) => {
      // temporary workaround for a bug in jQuery 1.7.1 (http://bugs.jquery.com/ticket/11328)
      e.metaKey = e.metaKey || e.ctrlKey;

      if ($(e.target).hasClass('slick-resizable-handle')) {
        return;
      }

      let $col = $(e.target).closest('.slick-header-column');
      if (!$col.length) {
        return;
      }

      let column = $col.data('column');
      if (column.sortable) {
        let sortOpts = null;
        let i = 0;
        for (; i < sortColumns.length; i++) {
          if (sortColumns[i].columnId === column.id) {
            sortOpts = sortColumns[i];

            // clear sort for 3-step sorting
            if (options.enableThreeStepsSorting && sortOpts.sortAsc !== column.defaultSortAsc) {
              delete sortOpts.sortAsc;
            } else {
              sortOpts.sortAsc = !sortOpts.sortAsc;
            }

            break;
          }
        }

        if ((e.metaKey && options.multiColumnSort) || (sortOpts && typeof sortOpts.sortAsc === 'undefined' && options.enableThreeStepsSorting)) {
          if (sortOpts) {
            sortColumns.splice(i, 1);
          }
        } else {
          if ((!e.shiftKey && !e.metaKey) || !options.multiColumnSort) {
            sortColumns = [];
          }

          if (!sortOpts) {
            sortOpts = { columnId: column.id, sortAsc: column.defaultSortAsc };
            sortColumns.push(sortOpts);
          } else if (sortColumns.length === 0) {
            sortColumns.push(sortOpts);
          }
        }

        setSortColumns(sortColumns);

        if (!options.multiColumnSort) {
          trigger(_this.onSort, {
            multiColumnSort: false,
            sortCol: column,
            sortAsc: sortOpts.sortAsc,
          }, e);
        } else {
          trigger(_this.onSort, {
            multiColumnSort: true,
            sortCols: $.map(sortColumns, col => ({ sortCol: columns[getColumnIndex(col.columnId)], sortAsc: col.sortAsc })),
          }, e);
        }
      }
    });
  }

  function setupColumnReorder() {
    let sortableHeaders = [$headers]
      .concat(
        $headers
          .children('.slick-header-column-group')
          .children('.slick-header-group-container')
        );
    $.each(sortableHeaders, (i, headers) => {
      $(headers).filter(':ui-sortable').sortable('destroy');
      $(headers).sortable({
        containment: 'parent',
        distance: 3,
        axis: 'x',
        cursor: 'default',
        tolerance: 'intersection',
        helper: 'clone',
        placeholder: 'slick-sortable-placeholder ui-state-default slick-header-column',
        start(e, ui) {
          ui.placeholder.width(ui.helper.outerWidth() - headerColumnWidthDiff);
          $(ui.helper).addClass('slick-header-column-active');
        },

        beforeStop(e, ui) {
          $(ui.helper).removeClass('slick-header-column-active');
        },

        stop(e) {
          let i;
          let j;
          let column;
          let columnId;
          let groupId;

          let isReorderingInGroup = $(e.target).hasClass('slick-header-group-container');
          let reorderedIds = $(e.target).sortable('toArray');
          let reorderedColumns = [];

          if (isReorderingInGroup) {
            groupId = columns[getColumnIndex(reorderedIds[0].replace(uid, ''))].group;
            for (i = 0, j = columns.length; i < j; i++) {
              column = columns[i];
              if (column.group === groupId) {
                reorderedColumns.push(columns[getColumnIndex(reorderedIds.shift().replace(uid, ''))]);
              } else {
                reorderedColumns.push(column);
              }
            }
          } else {
            for (i = 0; i < reorderedIds.length; i++) {
              columnId = reorderedIds[i].replace(uid, '');
              if (/^group_\d/.test(columnId)) {
                groupId = parseInt(/^group_(\d+)/.exec(columnId)[1], 10);
                for (j = 0; j < columns.length; j++) {
                  column = columns[j];
                  if (column.group === groupId) {
                    reorderedColumns.push(column);
                  }
                }
              } else {
                reorderedColumns.push(columns[getColumnIndex(columnId)]);
              }
            }
          }

          setColumns(reorderedColumns, columnGroups);

          trigger(_this.onColumnsReordered, {});
          e.stopPropagation();
          setupColumnResize();
        },
      });
    });
  }

  function setupColumnResize() {
    let j;
    let c;
    let pageX;
    let columnElements;
    let minPageX;
    let maxPageX;
    let firstResizable;
    let lastResizable;

    columnElements = $headers.find('.slick-header-column');
    columnElements.find('.slick-resizable-handle').remove();
    columnElements.each((i) => {
      if (columns[i].resizable) {
        if (firstResizable === undefined) {
          firstResizable = i;
        }

        lastResizable = i;
      }
    });

    if (firstResizable === undefined) {
      return;
    }

    columnElements.each((i, e) => {
      if (i < firstResizable || (options.forceFitColumns && i >= lastResizable)) {
        return;
      }

      $('<div class="slick-resizable-handle"/>')
        .appendTo(e)
        .bind('dragstart', function (e) {
          pageX = e.pageX;
          $(this).parent().addClass('slick-header-column-active');
          let shrinkLeewayOnRight = null;
          let stretchLeewayOnRight = null;

          // lock each column's width option to current width
          columnElements.each((i, e) => {
            columns[i].previousWidth = $(e).outerWidth();
          });

          if (options.forceFitColumns) {
            shrinkLeewayOnRight = 0;
            stretchLeewayOnRight = 0;

            // colums on right affect maxPageX/minPageX
            for (j = i + 1; j < columnElements.length; j++) {
              c = columns[j];
              if (c.resizable) {
                if (stretchLeewayOnRight != null) {
                  if (c.maxWidth) {
                    stretchLeewayOnRight += c.maxWidth - c.previousWidth;
                  } else {
                    stretchLeewayOnRight = null;
                  }
                }

                shrinkLeewayOnRight += c.previousWidth - Math.max(c.minWidth || 0, absoluteColumnMinWidth);
              }
            }
          }

          let shrinkLeewayOnLeft = 0;
          let stretchLeewayOnLeft = 0;
          for (j = 0; j <= i; j++) {
            // columns on left only affect minPageX
            c = columns[j];
            if (c.resizable) {
              if (stretchLeewayOnLeft != null) {
                if (c.maxWidth) {
                  stretchLeewayOnLeft += c.maxWidth - c.previousWidth;
                } else {
                  stretchLeewayOnLeft = null;
                }
              }

              shrinkLeewayOnLeft += c.previousWidth - Math.max(c.minWidth || 0, absoluteColumnMinWidth);
            }
          }

          if (shrinkLeewayOnRight === null) {
            shrinkLeewayOnRight = 100000;
          }

          if (shrinkLeewayOnLeft === null) {
            shrinkLeewayOnLeft = 100000;
          }

          if (stretchLeewayOnRight === null) {
            stretchLeewayOnRight = 100000;
          }

          if (stretchLeewayOnLeft === null) {
            stretchLeewayOnLeft = 100000;
          }

          maxPageX = pageX + Math.min(shrinkLeewayOnRight, stretchLeewayOnLeft);
          minPageX = pageX - Math.min(shrinkLeewayOnLeft, stretchLeewayOnRight);
        })
        .bind('drag', (e) => {
          let actualMinWidth;
          let d = Math.min(maxPageX, Math.max(minPageX, e.pageX)) - pageX;
          let x;

          // shrink column
          if (d < 0) {
            x = d;
            for (j = i; j >= 0; j--) {
              c = columns[j];
              if (c.resizable) {
                actualMinWidth = Math.max(c.minWidth || 0, absoluteColumnMinWidth);
                if (x && c.previousWidth + x < actualMinWidth) {
                  x += c.previousWidth - actualMinWidth;
                  c.width = actualMinWidth;
                } else {
                  c.width = c.previousWidth + x;
                  x = 0;
                }
              }
            }

            if (options.forceFitColumns) {
              x = -d;
              for (j = i + 1; j < columnElements.length; j++) {
                c = columns[j];
                if (c.resizable) {
                  if (x && c.maxWidth && (c.maxWidth - c.previousWidth < x)) {
                    x -= c.maxWidth - c.previousWidth;
                    c.width = c.maxWidth;
                  } else {
                    c.width = c.previousWidth + x;
                    x = 0;
                  }
                }
              }
            }

          // stretch column
          } else {
            x = d;
            for (j = i; j >= 0; j--) {
              c = columns[j];
              if (c.resizable) {
                if (x && c.maxWidth && (c.maxWidth - c.previousWidth < x)) {
                  x -= c.maxWidth - c.previousWidth;
                  c.width = c.maxWidth;
                } else {
                  c.width = c.previousWidth + x;
                  x = 0;
                }
              }
            }

            if (options.forceFitColumns) {
              x = -d;
              for (j = i + 1; j < columnElements.length; j++) {
                c = columns[j];
                if (c.resizable) {
                  actualMinWidth = Math.max(c.minWidth || 0, absoluteColumnMinWidth);
                  if (x && c.previousWidth + x < actualMinWidth) {
                    x += c.previousWidth - actualMinWidth;
                    c.width = actualMinWidth;
                  } else {
                    c.width = c.previousWidth + x;
                    x = 0;
                  }
                }
              }
            }
          }

          applyColumnHeaderWidths();
          if (options.syncColumnCellResize) {
            applyColumnWidths();
          }
        })
        .bind('dragend', function () {
          let newWidth;
          $(this).parent().removeClass('slick-header-column-active');
          for (j = 0; j < columnElements.length; j++) {
            c = columns[j];
            newWidth = $(columnElements[j]).outerWidth();

            if (c.previousWidth !== newWidth && c.rerenderOnResize) {
              invalidateAllRows();
            }
          }

          updateCanvasWidth(true);
          render();
          trigger(_this.onColumnsResized, {});
        });
    });
  }

  function getVBoxDelta($el) {
    let p = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'];
    let delta = 0;
    $.each(p, (n, val) => {
      delta += parseFloat($el.css(val)) || 0;
    });

    return delta;
  }

  function measureCellPaddingAndBorder() {
    let el;
    let h = ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight'];
    let v = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'];

    el = $('<div class="ui-state-default slick-header-column" style="visibility:hidden">-</div>').appendTo($headers);
    headerColumnWidthDiff = 0;
    if (el.css('box-sizing') !== 'border-box' && el.css('-moz-box-sizing') !== 'border-box' && el.css('-webkit-box-sizing') !== 'border-box') {
      $.each(h, (n, val) => {
        headerColumnWidthDiff += parseFloat(el.css(val)) || 0;
      });
    }

    el.remove();

    let r = $('<div class="slick-row"/>').appendTo($canvas);
    el = $('<div class="slick-cell" id="" style="visibility:hidden">-</div>').appendTo(r);
    cellWidthDiff = cellHeightDiff = 0;
    if (el.css('box-sizing') !== 'border-box' && el.css('-moz-box-sizing') !== 'border-box' && el.css('-webkit-box-sizing') !== 'border-box') {
      $.each(h, (n, val) => {
        cellWidthDiff += parseFloat(el.css(val)) || 0;
      });

      $.each(v, (n, val) => {
        cellHeightDiff += parseFloat(el.css(val)) || 0;
      });
    }

    r.remove();

    absoluteColumnMinWidth = Math.max(headerColumnWidthDiff, cellWidthDiff);
  }

  function createCssRules() {
    $style = $('<style type="text/css" rel="stylesheet"/>').appendTo($('head'));
    let rowHeight = (options.rowHeight - cellHeightDiff);
    let rules = [
      `.${uid} .slick-header-column { left: 1000px; }`,
      `.${uid} .slick-header-group-container { position: relative; left: -200px; }`,
      `.${uid} .slick-header-group-container .slick-header-column { left: 200px; }`,
      `.${uid} .slick-cell { height:${rowHeight}px; }`,
      `.${uid} .slick-row { height:${options.rowHeight}px; }`,
    ];

    for (let i = 0; i < columns.length; i++) {
      rules.push(`.${uid} .l${i} { }`);
      rules.push(`.${uid} .r${i} { }`);
    }

    // IE
    if ($style[0].styleSheet) {
      $style[0].styleSheet.cssText = rules.join(' ');
    } else {
      $style[0].appendChild(document.createTextNode(rules.join(' ')));
    }
  }

  function getColumnCssRules(idx) {
    let i;
    if (!stylesheet) {
      let sheets = document.styleSheets;
      for (i = 0; i < sheets.length; i++) {
        if ((sheets[i].ownerNode || sheets[i].owningElement) === $style[0]) {
          stylesheet = sheets[i];
          break;
        }
      }

      if (!stylesheet) {
        throw new Error('Cannot find stylesheet.');
      }

      // find and cache column CSS rules
      columnCssRulesL = [];
      columnCssRulesR = [];
      let cssRules = (stylesheet.cssRules || stylesheet.rules);
      let matches;
      let columnIdx;
      for (i = 0; i < cssRules.length; i++) {
        let selector = cssRules[i].selectorText;
        if ((matches = /\.l\d+/.exec(selector)) != null) {
          columnIdx = parseInt(matches[0].substr(2, matches[0].length - 2), 10);
          columnCssRulesL[columnIdx] = cssRules[i];
        } else if ((matches = /\.r\d+/.exec(selector)) != null) {
          columnIdx = parseInt(matches[0].substr(2, matches[0].length - 2), 10);
          columnCssRulesR[columnIdx] = cssRules[i];
        }
      }
    }

    return {
      left: columnCssRulesL[idx],
      right: columnCssRulesR[idx],
    };
  }

  function removeCssRules() {
    $style.remove();
    stylesheet = null;
  }

  function destroy() {
    trigger(_this.onBeforeDestroy, {});

    let i = plugins.length;
    while (i--) {
      unregisterPlugin(plugins[i]);
    }

    if (options.enableColumnReorder) {
      $headers.filter(':ui-sortable').sortable('destroy');
    }

    unbindAncestorScrollEvents();
    $container.unbind('.slickgrid');
    removeCssRules();

    $container.empty().removeClass(uid);
  }

  // General

  function trigger(evt, args, e) {
    e = e || new EventData();
    args = args || {};
    args.grid = _this;
    return evt.notify(args, e, _this);
  }

  function getColumnIndex(id) {
    return columnsById[id];
  }

  function autosizeColumns() {
    let i;
    let c;
    let widths = [];
    let shrinkLeeway = 0;
    let total = 0;
    let prevTotal;
    let availWidth = viewportHasVScroll ? viewportW - scrollbarDimensions.width : viewportW;

    for (i = 0; i < columns.length; i++) {
      c = columns[i];
      widths.push(c.width);
      total += c.width;
      if (c.resizable) {
        shrinkLeeway += c.width - Math.max(c.minWidth, absoluteColumnMinWidth);
      }
    }

    // shrink
    prevTotal = total;
    while (total > availWidth && shrinkLeeway) {
      let shrinkProportion = (total - availWidth) / shrinkLeeway;
      for (i = 0; i < columns.length && total > availWidth; i++) {
        c = columns[i];
        let width = widths[i];
        if (!c.resizable || width <= c.minWidth || width <= absoluteColumnMinWidth) {
          continue;
        }

        let absMinWidth = Math.max(c.minWidth, absoluteColumnMinWidth);
        let shrinkSize = Math.floor(shrinkProportion * (width - absMinWidth)) || 1;
        shrinkSize = Math.min(shrinkSize, width - absMinWidth);
        total -= shrinkSize;
        shrinkLeeway -= shrinkSize;
        widths[i] -= shrinkSize;
      }

      // avoid infinite loop
      if (prevTotal <= total) {
        break;
      }

      prevTotal = total;
    }

    // grow
    prevTotal = total;
    while (total < availWidth) {
      let growProportion = availWidth / total;
      for (i = 0; i < columns.length && total < availWidth; i++) {
        c = columns[i];
        let currentWidth = widths[i];
        let growSize;

        if (!c.resizable || c.maxWidth <= currentWidth) {
          growSize = 0;
        } else {
          growSize = Math.min(Math.floor(growProportion * currentWidth) - currentWidth, (c.maxWidth - currentWidth) || 1000000) || 1;
        }

        total += growSize;
        widths[i] += growSize;
      }

      // avoid infinite loop
      if (prevTotal >= total) {
        break;
      }

      prevTotal = total;
    }

    let reRender = false;
    for (i = 0; i < columns.length; i++) {
      if (columns[i].rerenderOnResize && columns[i].width !== widths[i]) {
        reRender = true;
      }

      columns[i].width = widths[i];
    }

    applyColumnHeaderWidths();
    updateCanvasWidth(true);
    if (reRender) {
      invalidateAllRows();
      render();
    }
  }

  function applyColumnHeaderWidths() {
    let i;
    let ii;
    let headers;
    let h;
    let g;
    let groups = {};
    for (i = 0, headers = $headers.find('.slick-header-column'), ii = headers.length; i < ii; i++) {
      h = $(headers[i]);
      if (h.width() !== columns[i].width - headerColumnWidthDiff) {
        h.width(columns[i].width - headerColumnWidthDiff);
      }

      if (columns[i].group != null) {
        g = columns[i].group;
        groups[g] = {
          width: (groups[g] || { width: 0 }).width + h.outerWidth(),
          groupEl: h.parents('.slick-header-column-group'),
        };
      }
    }

    _.forEach(groups, (group) => {
      group.groupEl.width(group.width);
    });

    updateColumnCaches();
  }

  function applyColumnWidths() {
    let x = 0;
    let w;
    let rule;
    for (let i = 0; i < columns.length; i++) {
      w = columns[i].width;

      rule = getColumnCssRules(i);
      rule.left.style.left = `${x}px`;
      rule.right.style.right = `${canvasWidth - x - w}px`;

      x += columns[i].width;
    }
  }

  function setSortColumn(columnId, ascending) {
    setSortColumns([{ columnId, sortAsc: ascending }]);
  }

  function setSortColumns(cols) {
    sortColumns = cols;

    let headerColumnEls = $headers.find('.slick-header-column');
    headerColumnEls
        .removeClass('slick-header-column-sorted')
        .find('.slick-sort-indicator')
            .removeClass('slick-sort-indicator-asc slick-sort-indicator-desc');

    $.each(sortColumns, (i, col) => {
      if (col.sortAsc == null) {
        col.sortAsc = true;
      }

      let columnIndex = getColumnIndex(col.columnId);
      if (columnIndex != null) {
        headerColumnEls.eq(columnIndex)
            .addClass('slick-header-column-sorted')
            .find('.slick-sort-indicator')
                .addClass(col.sortAsc ? 'slick-sort-indicator-asc' : 'slick-sort-indicator-desc');
      }
    });
  }

  function getSortColumns() {
    return sortColumns;
  }

  function getColumns() {
    return columns;
  }

  function updateColumnCaches() {
    // Pre-calculate cell boundaries.
    columnPosLeft = [];
    columnPosRight = [];
    let x = 0;
    for (let i = 0, ii = columns.length; i < ii; i++) {
      columnPosLeft[i] = x;
      columnPosRight[i] = x + columns[i].width;
      x += columns[i].width;
    }
  }

  function setColumns(columnDefinitions, columnGroupDefinitions) {
    columns = columnDefinitions;
    columnGroups = columnGroupDefinitions || {};

    columnsById = {};
    for (let i = 0; i < columns.length; i++) {
      let m = columns[i] = $.extend({}, columnDefaults, columns[i]);
      columnsById[m.id] = i;
      if (m.minWidth && m.width < m.minWidth) {
        m.width = m.minWidth;
      }

      if (m.maxWidth && m.width > m.maxWidth) {
        m.width = m.maxWidth;
      }
    }

    updateColumnCaches();

    invalidateAllRows();
    createColumnHeaders();
    removeCssRules();
    createCssRules();
    resizeCanvas();
    applyColumnWidths();
    handleScroll();
  }

  function getOptions() {
    return options;
  }

  function setOptions(args) {
    options = $.extend(options, args);

    render();
  }

  function setData(newData, scrollToTop) {
    if (newData.name !== 'DataView') {
      throw new Error('Data should be DataView');
    }

    data = newData;
    invalidateAllRows();
    updateRowCount();
    if (scrollToTop) {
      scrollTo(0);
    }
  }

  function getData() {
    return data;
  }

  function getDataLength() {
    return data.getLength();
  }

  function getDataItem(i) {
    return data.getItem(i);
  }

  function getDataItemId(i) {
    let dataItem = getDataItem(i);
    return dataItem && dataItem.id;
  }

  function getContainerNode() {
    return $container.get(0);
  }

  // Rendering / Scrolling

  function getRowTop(row) {
    return options.rowHeight * row;
  }

  function getRowFromPosition(y) {
    return Math.floor(y / options.rowHeight);
  }

  function scrollTo(y) {
    y = Math.max(y, 0);
    y = Math.min(y, th - viewportH + (viewportHasHScroll ? scrollbarDimensions.height : 0));

    let newScrollTop = y;

    if (prevScrollTop !== newScrollTop) {
      vScrollDir = prevScrollTop < newScrollTop ? 1 : -1;
      $viewport[0].scrollTop = (lastRenderedScrollTop = scrollTop = prevScrollTop = newScrollTop);

      trigger(_this.onViewportChanged, {});
    }
  }

  function defaultFormatter(row, cell, value) {
    if (value == null) {
      return '';
    }

    return (`${value}`)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getFormatter(row, column) {
    let rowMetadata = data.getItemMetadata && data.getItemMetadata(row);

    // look up by id, then index
    let columnOverrides = rowMetadata &&
        rowMetadata.columns &&
        (rowMetadata.columns[column.id] || rowMetadata.columns[getColumnIndex(column.id)]);

    return (columnOverrides && columnOverrides.formatter) ||
        (rowMetadata && rowMetadata.formatter) ||
        column.formatter ||
        (options.formatterFactory && options.formatterFactory.getFormatter(column)) ||
        options.defaultFormatter;
  }

  function getDataItemValueForColumn(item, columnDef) {
    if (options.dataItemColumnValueExtractor) {
      return options.dataItemColumnValueExtractor(item, columnDef);
    }

    return item[columnDef.field];
  }

  function appendRowHtml(stringArray, row, range, dataLength) {
    let d = getDataItem(row);
    let dataLoading = row < dataLength && !d;
    let rowCss = `slick-row${
        dataLoading ? ' loading' : ''
        }${row === activeRow ? ' active' : ''}`;

    if (!d) {
      rowCss += ` ${options.addNewRowCssClass}`;
    }

    let metadata = data.getItemMetadata && data.getItemMetadata(row) || {};
    let cssClassesMeta = metadata.cssClasses;
    let columnsMeta = metadata.columns;

    if (cssClassesMeta) {
      rowCss += ` ${cssClassesMeta}`;
    }

    let translateValue = `translateY(${getRowTop(row)}px)`;
    stringArray.push(`<div class="${rowCss}" style="-webkit-transform:${translateValue};transform:${translateValue};">`);

    let colspan;
    let column;
    for (let i = 0, ii = columns.length; i < ii; i++) {
      column = columns[i];
      colspan = 1;

      if (columnsMeta) {
        let columnMeta = columnsMeta[column.id] || columnsMeta[i];
        colspan = columnMeta && columnMeta.colspan || 1;
        if (colspan === '*') {
          colspan = ii - i;
        }
      }

      // Do not render cells outside of the viewport.
      if (columnPosRight[Math.min(ii - 1, i)] > range.leftPx) {
        if (columnPosLeft[i] > range.rightPx) {
          // All columns to the right are outside the range.
          break;
        }

        appendCellHtml(stringArray, row, i, colspan, d);
      }

      if (colspan > 1) {
        i += colspan - 1;
      }
    }

    stringArray.push('</div>');
  }

  function appendCellHtml(stringArray, row, cell, colspan, item) {
    let m = columns[cell];
    let cLen = columns.length;
    let cellCss = `${'slick-cell' +
        ' l'}${cell} r${Math.min(cLen - 1, cell + colspan - 1)
        } b-l${cLen - 1 - cell} b-r${Math.max(0, cLen - 1 - cell + colspan - 1)
        }${m.cssClass ? ` ${m.cssClass}` : ''}`;

    // TODO:  merge them together in the setter
    for (let key in cellCssClasses) {
      if (cellCssClasses[key][row] && cellCssClasses[key][row][m.id]) {
        cellCss += (` ${cellCssClasses[key][row][m.id]}`);
      }
    }

    stringArray.push(`<div class="${cellCss}">`);

    // if there is a corresponding row (if not, this is the Add New row or this data hasn't been loaded yet)
    if (item) {
      let value = getDataItemValueForColumn(item, m);
      stringArray.push(getFormatter(row, m)(row, cell, value, m, item));
    }

    stringArray.push('</div>');

    let itemId = getDataItemId(row);
    rowsCache[itemId].cellRenderQueue.push(cell);
    rowsCache[itemId].cellColSpans[cell] = colspan;
  }

  function getInactiveRows() {
    let range = getRenderedRange();

    return _.reject(Object.keys(rowsCache), (rowId) => {
      let row = data.getIdxById(rowId);
      return row != null && range.top <= row && row <= range.bottom;
    });
  }

  function cleanupRows(rangeToKeep) {
    _.forEach(rowsCache, (cache, id) => {
      let row = data.getIdxById(id);
      if (row !== activeRow && (row < rangeToKeep.top || row > rangeToKeep.bottom)) {
        removeRowFromCache(id);
      }
    });
  }

  function invalidate() {
    updateRowCount();
    invalidateAllRows();
    render();
  }

  function invalidateAllRows() {
    _.forEach(rowsCache, (cache, id) => {
      removeRowFromCache(id);
    });
  }

  function removeRowFromCache(id) {
    let cacheEntry = rowsCache[id];
    if (!cacheEntry) {
      return;
    }

    if (rowNodeFromLastMouseWheelEvent === cacheEntry.rowNode) {
      cacheEntry.rowNode.style.display = 'none';
      zombieRowNodeFromLastMouseWheelEvent = rowNodeFromLastMouseWheelEvent;
    } else {
      $canvas[0].removeChild(cacheEntry.rowNode);
    }

    delete rowsCache[id];
  }

  function invalidateRows(rows) {
    let i;
    let rl;
    if (!rows || !rows.length) {
      return;
    }

    vScrollDir = 0;
    for (i = 0, rl = rows.length; i < rl; i++) {
      let rowId = getDataItemId(rows[i]);
      if (rowsCache[rowId]) {
        removeRowFromCache(rowId);
      }
    }
  }

  function invalidateRow(row) {
    invalidateRows([row]);
  }

  function updateCell(row, cell) {
    let cellNode = getCellNode(row, cell);
    if (!cellNode) {
      return;
    }

    let m = columns[cell];
    let d = getDataItem(row);
    cellNode.innerHTML = d ? getFormatter(row, m)(row, cell, getDataItemValueForColumn(d, m), m, d) : '';
  }

  function updateRow(row) {
    let rowId = getDataItemId(row);
    let cacheEntry = rowsCache[rowId];
    if (!cacheEntry) {
      return;
    }

    ensureCellNodesInRowsCache(row);

    let d = getDataItem(row);

    for (let columnIdx in cacheEntry.cellNodesByColumnIdx) {
      if (!cacheEntry.cellNodesByColumnIdx.hasOwnProperty(columnIdx)) {
        continue;
      }

      columnIdx |= 0;
      let m = columns[columnIdx];
      let node = cacheEntry.cellNodesByColumnIdx[columnIdx];

      if (d) {
        node.innerHTML = getFormatter(row, m)(row, columnIdx, getDataItemValueForColumn(d, m), m, d);
      } else {
        node.innerHTML = '';
      }
    }
  }

  function getViewportHeight() {
    return parseFloat($.css($container[0], 'height', true)) -
        parseFloat($.css($container[0], 'paddingTop', true)) -
        parseFloat($.css($container[0], 'paddingBottom', true)) -
        parseFloat($.css($headerScroller[0], 'height')) - getVBoxDelta($headerScroller);
  }

  function resizeCanvas() {
    viewportH = getViewportHeight();

    numVisibleRows = Math.ceil(viewportH / options.rowHeight);
    viewportW = parseFloat($.css($container[0], 'width', true));
    $viewport.height(viewportH);

    if (options.forceFitColumns) {
      autosizeColumns();
    }

    updateRowCount();
    handleScroll();

    // Since the width has changed, force the render() to reevaluate virtually rendered cells.
    lastRenderedScrollLeft = -1;
    render();
  }

  function updateRowCount() {
    updateCanvasHeight();
    updateCanvasWidth(false);
  }

  function getVisibleRange(viewportTop, viewportLeft) {
    if (viewportTop == null) {
      viewportTop = scrollTop;
    }

    if (viewportLeft == null) {
      viewportLeft = scrollLeft;
    }

    return {
      top: getRowFromPosition(viewportTop),
      bottom: getRowFromPosition(viewportTop + viewportH) + 1,
      leftPx: viewportLeft,
      rightPx: viewportLeft + viewportW,
    };
  }

  function getRenderedRange(viewportTop, viewportLeft) {
    let range = getVisibleRange(viewportTop, viewportLeft);
    let buffer = Math.round(viewportH / options.rowHeight);
    let minBuffer = 3;

    if (vScrollDir === -1) {
      range.top -= buffer;
      range.bottom += minBuffer;
    } else if (vScrollDir === 1) {
      range.top -= minBuffer;
      range.bottom += buffer;
    } else {
      range.top -= minBuffer;
      range.bottom += minBuffer;
    }

    range.top = Math.max(0, range.top);
    range.bottom = Math.min(getDataLength() - 1, range.bottom);

    range.leftPx -= viewportW;
    range.rightPx += viewportW;

    range.leftPx = Math.max(0, range.leftPx);
    range.rightPx = Math.min(canvasWidth, range.rightPx);

    return range;
  }

  function ensureCellNodesInRowsCache(row) {
    let cacheEntry = rowsCache[getDataItemId(row)];
    if (cacheEntry) {
      if (cacheEntry.cellRenderQueue.length) {
        let lastChild = cacheEntry.rowNode.lastChild;
        while (cacheEntry.cellRenderQueue.length) {
          let columnIdx = cacheEntry.cellRenderQueue.pop();
          cacheEntry.cellNodesByColumnIdx[columnIdx] = lastChild;
          lastChild = lastChild.previousSibling;
        }
      }
    }
  }

  function cleanUpCells(range, row) {
    let cacheEntry = rowsCache[getDataItemId(row)];

    // Remove cells outside the range.
    let cellsToRemove = [];
    for (let i in cacheEntry.cellNodesByColumnIdx) {
      // I really hate it when people mess with Array.prototype.
      if (!cacheEntry.cellNodesByColumnIdx.hasOwnProperty(i)) {
        continue;
      }

      // This is a string, so it needs to be cast back to a number.
      i |= 0;

      let colspan = cacheEntry.cellColSpans[i];
      if (columnPosLeft[i] > range.rightPx ||
        columnPosRight[Math.min(columns.length - 1, i + colspan - 1)] < range.leftPx) {
        cellsToRemove.push(i);
      }
    }

    let cellToRemove;
    while ((cellToRemove = cellsToRemove.pop()) != null) {
      cacheEntry.rowNode.removeChild(cacheEntry.cellNodesByColumnIdx[cellToRemove]);
      delete cacheEntry.cellColSpans[cellToRemove];
      delete cacheEntry.cellNodesByColumnIdx[cellToRemove];
    }
  }

  function cleanUpAndRenderCells(range) {
    let cacheEntry;
    let stringArray = [];
    let processedRows = [];
    let cellsAdded;

    for (let row = range.top, btm = range.bottom; row <= btm; row++) {
      cacheEntry = rowsCache[getDataItemId(row)];
      if (!cacheEntry) {
        continue;
      }

      // cellRenderQueue populated in renderRows() needs to be cleared first
      ensureCellNodesInRowsCache(row);

      cleanUpCells(range, row);

      // Render missing cells.
      cellsAdded = 0;

      let metadata = data.getItemMetadata && data.getItemMetadata(row);
      metadata = metadata && metadata.columns;

      let d = getDataItem(row);

      // TODO:  shorten this loop (index? heuristics? binary search?)
      for (let i = 0, ii = columns.length; i < ii; i++) {
        // Cells to the right are outside the range.
        if (columnPosLeft[i] > range.rightPx) {
          break;
        }

        // Already rendered.
        let colspan = cacheEntry.cellColSpans[i];
        if (colspan != null) {
          i += colspan > 1 ? colspan - 1 : 0;
          continue;
        }

        colspan = 1;
        if (metadata) {
          let columnMeta = metadata[columns[i].id] || metadata[i];
          colspan = columnMeta && columnMeta.colspan || 1;
          if (colspan === '*') {
            colspan = ii - i;
          }
        }
        if (columnPosRight[Math.min(ii - 1, i + colspan - 1)] > range.leftPx) {
          appendCellHtml(stringArray, row, i, colspan, d);
          cellsAdded++;
        }

        i += colspan > 1 ? colspan - 1 : 0;
      }

      if (cellsAdded) {
        processedRows.push(row);
      }
    }

    if (!stringArray.length) {
      return;
    }

    let x = document.createElement('div');
    x.innerHTML = stringArray.join('');

    let processedRow;
    let node;
    while ((processedRow = processedRows.pop()) != null) {
      cacheEntry = rowsCache[getDataItemId(processedRow)];
      let columnIdx;
      while ((columnIdx = cacheEntry.cellRenderQueue.pop()) != null) {
        node = x.lastChild;
        cacheEntry.rowNode.appendChild(node);
        cacheEntry.cellNodesByColumnIdx[columnIdx] = node;
      }
    }
  }

  function renderRows(range) {
    let i;
    let ii;
    let parentNode = $canvas[0];
    let stringArray = [];
    let rows = [];
    let needToReselectRow = false;
    let dataLength = getDataLength();

    for (i = range.top, ii = range.bottom; i <= ii; i++) {
      let id = getDataItemId(i);
      if (rowsCache[id]) {
        continue;
      }

      rows.push(i);

      rowsCache[id] = {
        rowNode: null,
        cellColSpans: [],
        cellNodesByColumnIdx: [],
        cellRenderQueue: [],
      };

      appendRowHtml(stringArray, i, range, dataLength);
      if (activeRowNode && activeRow === i) {
        needToReselectRow = true;
      }
    }

    if (!rows.length) { return; }

    let x = document.createElement('div');
    x.innerHTML = stringArray.join('');

    for (i = 0, ii = rows.length; i < ii; i++) {
      rowsCache[getDataItemId(rows[i])].rowNode = parentNode.appendChild(x.firstChild);
    }

    if (needToReselectRow) {
      activeRowNode = getRowNode(activeRow);
    }
  }

  function render() {
    let rendered = getRenderedRange();

    // remove rows no longer in the viewport
    cleanupRows(rendered);

    // add new rows & missing cells in existing rows
    if (lastRenderedScrollLeft !== scrollLeft) {
      cleanUpAndRenderCells(rendered);
    }

    // render missing rows
    renderRows(rendered);

    lastRenderedScrollTop = scrollTop;
    lastRenderedScrollLeft = scrollLeft;
    horizontalRender = null;
  }

  function handleScroll() {
    scrollTop = $viewport[0].scrollTop;
    scrollLeft = $viewport[0].scrollLeft;
    let vScrollDist = Math.abs(scrollTop - prevScrollTop);
    let hScrollDist = Math.abs(scrollLeft - prevScrollLeft);

    if (hScrollDist) {
      prevScrollLeft = scrollLeft;
      $headerScroller[0].scrollLeft = scrollLeft;
    }

    if (vScrollDist) {
      vScrollDir = prevScrollTop < scrollTop ? 1 : -1;
      prevScrollTop = scrollTop;

      // switch virtual pages if needed
      if (vScrollDist < viewportH) {
        scrollTo(scrollTop);
      }
    }

    if (hScrollDist || vScrollDist) {
      if (horizontalRender) {
        clearTimeout(horizontalRender);
      }

      if (Math.abs(lastRenderedScrollTop - scrollTop) > 20 ||
          Math.abs(lastRenderedScrollLeft - scrollLeft) > 20) {
        if (options.forceSyncScrolling || (
            Math.abs(lastRenderedScrollTop - scrollTop) < viewportH &&
            Math.abs(lastRenderedScrollLeft - scrollLeft) < viewportW)) {
          render();
        } else {
          horizontalRender = setTimeout(render, 50);
        }

        trigger(_this.onViewportChanged, {});
      }
    }

    trigger(_this.onScroll, { scrollLeft, scrollTop });
  }

  // Interactivity

  function handleMouseWheel(e) {
    let rowNode = $(e.target).closest('.slick-row')[0];
    if (rowNode !== rowNodeFromLastMouseWheelEvent) {
      if (zombieRowNodeFromLastMouseWheelEvent && zombieRowNodeFromLastMouseWheelEvent !== rowNode) {
        $canvas[0].removeChild(zombieRowNodeFromLastMouseWheelEvent);
        zombieRowNodeFromLastMouseWheelEvent = null;
      }

      rowNodeFromLastMouseWheelEvent = rowNode;
    }
  }

  function handleKeyDown(e) {
    trigger(_this.onKeyDown, { row: activeRow }, e);
    let handled = e.isImmediatePropagationStopped();

    if (!handled) {
      if (!e.shiftKey && !e.altKey && !e.ctrlKey) {
        if (e.which === keyCode.PAGEDOWN) {
          navigatePageDown();
          handled = true;
        } else if (e.which === keyCode.PAGEUP) {
          navigatePageUp();
          handled = true;
        } else if (e.which === keyCode.UP) {
          handled = navigateUp();
        } else if (e.which === keyCode.DOWN) {
          handled = navigateDown();
        } else if (e.which === keyCode.TAB) {
          handled = navigateNext();
        }
      } else if (e.which === keyCode.TAB && e.shiftKey && !e.ctrlKey && !e.altKey) {
        handled = navigatePrev();
      }
    }

    if (handled) {
      // the event has been handled so don't let parent element (bubbling/propagation) or browser (default) handle it
      e.stopPropagation();
      e.preventDefault();
      try {
        // prevent default behaviour for special keys in IE browsers (F3, F5, etc.)
        e.originalEvent.keyCode = 0;
      } catch (error) {
        // ignore exceptions - setting the original event's keycode throws access denied exception for "Ctrl"
        // (hitting control key only, nothing else), "Shift" (maybe others)
      }
    }
  }

  function handleClick(e) {
    if (e.target !== document.activeElement || $(e.target).hasClass('slick-cell')) {
      setFocus();
    }

    let cell = getCellFromEvent(e);
    if (!cell) {
      return;
    }

    trigger(_this.onClick, { row: cell.row, cell: cell.cell }, e);
    if (e.isImmediatePropagationStopped()) {
      return;
    }

    if (options.enableRowNavigation) {
      if (activeRow !== cell.row && canRowBeActive(cell.row)) {
        scrollRowIntoView(cell.row);
        setActiveRowInternal(getRowNode(cell.row));
      }
    }
  }

  function handleContextMenu(e) {
    let cell = getCellFromEvent(e);
    if (!cell) {
      return;
    }

    trigger(_this.onContextMenu, { row: cell.row, cell: cell.cell }, e);
  }

  function handleDblClick(e) {
    let cell = getCellFromEvent(e);
    if (!cell) {
      return;
    }

    trigger(_this.onDblClick, { row: cell.row, cell: cell.cell }, e);
    if (e.isImmediatePropagationStopped()) {
      return;
    }
  }

  function handleHeaderMouseEnter(e) {
    trigger(_this.onHeaderMouseEnter, {
      column: $(this).data('column'),
    }, e);
  }

  function handleHeaderMouseLeave(e) {
    trigger(_this.onHeaderMouseLeave, {
      column: $(this).data('column'),
    }, e);
  }

  function handleHeaderContextMenu(e) {
    let $header = $(e.target).closest('.slick-header-column', '.slick-header-columns');
    let column = $header && $header.data('column');
    trigger(_this.onHeaderContextMenu, { column }, e);
  }

  function handleHeaderClick(e) {
    let $header = $(e.target).closest('.slick-header-column', '.slick-header-columns');
    let column = $header && $header.data('column');
    if (column) {
      trigger(_this.onHeaderClick, { column }, e);
    }
  }

  function handleMouseEnter(e) {
    trigger(_this.onMouseEnter, {}, e);
  }

  function handleMouseLeave(e) {
    trigger(_this.onMouseLeave, {}, e);
  }

  function cellExists(row, cell) {
    return !(row < 0 || row >= getDataLength() || cell < 0 || cell >= columns.length);
  }

  function getCellFromPoint(x, y) {
    let row = getRowFromPosition(y);
    let cell = 0;

    let w = 0;
    for (let i = 0; i < columns.length && w < x; i++) {
      w += columns[i].width;
      cell++;
    }

    if (cell < 0) {
      cell = 0;
    }

    return { row, cell: cell - 1 };
  }

  function getCellFromNode(cellNode) {
    // read column number from .l<columnNumber> CSS class
    let cls = /l\d+/.exec(cellNode.className);
    if (!cls) {
      throw new Error(`getCellFromNode: cannot get cell - ${cellNode.className}`);
    }

    return parseInt(cls[0].substr(1, cls[0].length - 1), 10);
  }

  function getRowFromNode(rowNode) {
    for (let rowId in rowsCache) {
      if (rowsCache[rowId].rowNode === rowNode) {
        return data.getIdxById(rowId);
      }
    }

    return null;
  }

  function getCellFromEvent(e) {
    let $cell = $(e.target).closest('.slick-cell', $canvas);
    if (!$cell.length) {
      return null;
    }

    let row = getRowFromNode($cell[0].parentNode);
    let cell = getCellFromNode($cell[0]);

    if (row == null || cell == null) {
      return null;
    }

    return { row, cell };
  }

  function getCellNodeBox(row, cell) {
    if (!cellExists(row, cell)) {
      return null;
    }

    let y1 = getRowTop(row);
    let y2 = y1 + options.rowHeight - 1;
    let x1 = 0;
    for (let i = 0; i < cell; i++) {
      x1 += columns[i].width;
    }

    let x2 = x1 + columns[cell].width;

    return {
      top: y1,
      left: x1,
      bottom: y2,
      right: x2,
    };
  }

  // Cell switching

  function resetActiveRow() {
    setActiveRowInternal(null, false);
  }

  function setFocus() {
    if (tabbingDirection === -1) {
      $focusSink[0].focus();
    } else {
      $focusSink2[0].focus();
    }
  }

  function scrollCellIntoView(row, cell) {
    scrollRowIntoView(row);

    let left = columnPosLeft[cell];
    let right = columnPosRight[cell];
    let scrollRight = scrollLeft + viewportW;

    if (left < scrollLeft) {
      $viewport.scrollLeft(left);
      handleScroll();
      render();
    } else if (right > scrollRight) {
      $viewport.scrollLeft(Math.min(left, right - $viewport[0].clientWidth));
      handleScroll();
      render();
    }
  }

  function setActiveRowInternal(newRow) {
    if (activeRowNode != null) {
      $(activeRowNode).removeClass('active');
    }

    let activeCellChanged = activeRowNode !== newRow;
    activeRowNode = newRow;

    if (activeRowNode != null) {
      activeRow = getRowFromNode(newRow);

      if (options.enableRowNavigation) {
        $(activeRowNode).addClass('active');
      }
    } else {
      activeRow = null;
    }

    if (activeCellChanged) {
      trigger(_this.onActiveRowChanged, getActiveRow());
    }
  }

  function absBox(elem) {
    let box = {
      top: elem.offsetTop,
      left: elem.offsetLeft,
      bottom: 0,
      right: 0,
      width: $(elem).outerWidth(),
      height: $(elem).outerHeight(),
      visible: true,
    };
    box.bottom = box.top + box.height;
    box.right = box.left + box.width;

    // walk up the tree
    let offsetParent = elem.offsetParent;
    while ((elem = elem.parentNode) !== document.body) {
      if (box.visible && elem.scrollHeight !== elem.offsetHeight && $(elem).css('overflowY') !== 'visible') {
        box.visible = box.bottom > elem.scrollTop && box.top < elem.scrollTop + elem.clientHeight;
      }

      if (box.visible && elem.scrollWidth !== elem.offsetWidth && $(elem).css('overflowX') !== 'visible') {
        box.visible = box.right > elem.scrollLeft && box.left < elem.scrollLeft + elem.clientWidth;
      }

      box.left -= elem.scrollLeft;
      box.top -= elem.scrollTop;

      if (elem === offsetParent) {
        box.left += elem.offsetLeft;
        box.top += elem.offsetTop;
        offsetParent = elem.offsetParent;
      }

      box.bottom = box.top + box.height;
      box.right = box.left + box.width;
    }

    return box;
  }

  function getActiveRowPosition() {
    return absBox(activeRowNode);
  }

  function getGridPosition() {
    return absBox($container[0]);
  }

  function handleActiveRowPositionChange() {
    if (!activeRowNode) {
      return;
    }

    trigger(_this.onActiveRowPositionChanged, {});
  }

  function getActiveRow() {
    if (!activeRowNode) {
      return null;
    }

    return { row: activeRow };
  }

  function getActiveRowNode() {
    return activeRowNode;
  }

  function scrollRowIntoView(row) {
    let rowAtTop = row * options.rowHeight;
    let rowAtBottom = (row + 1) * options.rowHeight - viewportH + (viewportHasHScroll ? scrollbarDimensions.height : 0);

    if ((row + 1) * options.rowHeight > scrollTop + viewportH) {
      // need to page down?
      scrollTo(rowAtBottom);
      render();
    } else if (row * options.rowHeight < scrollTop) {
      // or page up?
      scrollTo(rowAtTop);
      render();
    }
  }

  function scrollRowToTop(row) {
    scrollTo(row * options.rowHeight);
    render();
  }

  function scrollPage(dir) {
    let deltaRows = dir * numVisibleRows;
    scrollTo((getRowFromPosition(scrollTop) + deltaRows) * options.rowHeight);
    render();

    if (options.enableRowNavigation && activeRow != null) {
      let row = activeRow + deltaRows;
      let dataLength = getDataLength();
      if (row >= dataLength) {
        row = dataLength - 1;
      }

      if (row < 0) {
        row = 0;
      }

      setActiveRowInternal(getRowNode(row));
    }
  }

  function navigatePageDown() {
    scrollPage(1);
  }

  function navigatePageUp() {
    scrollPage(-1);
  }

  function gotoDown(row) {
    let dataLength = getDataLength();
    while (true) {
      if (++row >= dataLength) {
        return null;
      }

      if (canRowBeActive(row)) {
        return {
          row,
        };
      }
    }
  }

  function gotoUp(row) {
    while (true) {
      if (--row < 0) {
        return null;
      }

      if (canRowBeActive(row)) {
        return {
          row,
        };
      }
    }
  }

  function navigateDown() {
    return navigate('down');
  }

  function navigateUp() {
    return navigate('up');
  }

  function navigateNext() {
    return navigate('next');
  }

  function navigatePrev() {
    return navigate('prev');
  }

  /**
   * @param {string} dir Navigation direction.
   * @return {boolean} Whether navigation resulted in a change of active cell.
   */
  function navigate(dir) {
    if (!options.enableRowNavigation) {
      return false;
    }

    if (!activeRowNode && dir !== 'prev' && dir !== 'next') {
      return false;
    }

    setFocus();

    let tabbingDirections = {
      up: -1,
      down: 1,
      prev: -1,
      next: 1,
    };
    tabbingDirection = tabbingDirections[dir];

    let stepFunctions = {
      up: gotoUp,
      down: gotoDown,
      prev: gotoUp,
      next: gotoDown,
    };
    let stepFn = stepFunctions[dir];
    let pos = stepFn(activeRow);
    if (pos) {
      scrollRowIntoView(pos.row);
      setActiveRowInternal(getRowNode(pos.row));
      return true;
    }

    setActiveRowInternal(getRowNode(activeRow));
    return false;
  }

  function getRowNode(row) {
    let cacheEntry = rowsCache[getDataItemId(row)];
    if (cacheEntry) {
      return cacheEntry.rowNode;
    }

    return null;
  }

  function getRowNodeById(rowId) {
    let cacheEntry = rowsCache[rowId];
    if (cacheEntry) {
      return cacheEntry.rowNode;
    }

    return null;
  }

  function getCellNode(row, cell) {
    let rowId = getDataItemId(row);
    if (rowsCache[rowId]) {
      ensureCellNodesInRowsCache(row);
      return rowsCache[rowId].cellNodesByColumnIdx[cell];
    }

    return null;
  }

  function setActiveRow(row) {
    if (row > getDataLength() || row < 0) {
      return;
    }

    if (!options.enableRowNavigation) {
      return;
    }

    scrollRowIntoView(row);
    setActiveRowInternal(getRowNode(row));
  }

  function canRowBeActive(row) {
    if (row >= getDataLength() || row < 0) {
      return false;
    }

    return true;
  }

  function gotoCell(row, cell) {
    if (!canRowBeActive(row)) {
      return;
    }

    scrollCellIntoView(row, cell);

    let newRow = getRowNode(row);

    setActiveRowInternal(newRow);

    setFocus();
  }

  function rowsToRanges(rows) {
    let ranges = [];
    let lastCell = columns.length - 1;
    for (let i = 0; i < rows.length; i++) {
      ranges.push(new Range(rows[i], 0, rows[i], lastCell));
    }

    return ranges;
  }

  function getSelectedRows() {
    if (!selectionModel) {
      throw new Error('Selection model is not set');
    }

    return selectedRows;
  }

  function setSelectedRows(rows) {
    if (!selectionModel) {
      throw new Error('Selection model is not set');
    }

    selectionModel.setSelectedRanges(rowsToRanges(rows));
  }

  // Public API

  $.extend(this, {
    // Events
    onScroll: new Event(),
    onSort: new Event(),
    onHeaderMouseEnter: new Event(),
    onHeaderMouseLeave: new Event(),
    onHeaderContextMenu: new Event(),
    onHeaderClick: new Event(),
    onHeaderCellRendered: new Event(),
    onBeforeHeaderCellDestroy: new Event(),
    onMouseEnter: new Event(),
    onMouseLeave: new Event(),
    onClick: new Event(),
    onDblClick: new Event(),
    onContextMenu: new Event(),
    onKeyDown: new Event(),
    onAddNewRow: new Event(),
    onValidationError: new Event(),
    onViewportChanged: new Event(),
    onColumnsReordered: new Event(),
    onColumnsResized: new Event(),
    onCellChange: new Event(),
    onBeforeDestroy: new Event(),
    onActiveRowChanged: new Event(),
    onActiveRowPositionChanged: new Event(),
    onSelectedRowsChanged: new Event(),
    onCellCssStylesChanged: new Event(),

    // Methods
    registerPlugin,
    unregisterPlugin,
    getColumns,
    setColumns,
    getColumnIndex,
    setSortColumn,
    setSortColumns,
    getSortColumns,
    autosizeColumns,
    getOptions,
    setOptions,
    getData,
    getDataLength,
    getDataItem,
    setData,
    getSelectedRows,
    setSelectedRows,
    getContainerNode,

    render,
    renderRows,
    invalidate,
    invalidateRow,
    invalidateRows,
    invalidateAllRows,
    updateCell,
    updateRow,
    getInactiveRows,
    removeRowFromCache,
    getViewport: getVisibleRange,
    getRenderedRange,
    resizeCanvas,
    updateCanvasWidth,
    updateCanvasHeight,
    updateRowCount,
    scrollRowIntoView,
    scrollRowToTop,
    scrollCellIntoView,
    getCanvasNode,
    focus: setFocus,

    getCellFromPoint,
    getCellFromEvent,
    getActiveRow,
    setActiveRow,
    getActiveRowNode,
    getActiveRowPosition,
    resetActiveRow,
    getRowNode,
    getRowNodeById,
    getCellNode,
    getCellNodeBox,
    canRowBeActive,
    navigatePrev,
    navigateNext,
    navigateUp,
    navigateDown,
    navigatePageUp,
    navigatePageDown,
    gotoCell,
    getGridPosition,

    destroy,
  });

  init();
}

export default SlickGrid;
