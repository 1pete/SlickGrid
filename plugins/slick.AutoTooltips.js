import $ from 'jquery';

function AutoTooltips(options) {
  let _grid;
  let _defaults = {
    enableForCells: true,
    enableForHeaderCells: false,
    maxToolTipLength: null,
  };

  function init(grid) {
    options = $.extend(true, {}, _defaults, options);
    _grid = grid;
    if (options.enableForCells) _grid.onMouseEnter.subscribe(handleMouseEnter);
    if (options.enableForHeaderCells) _grid.onHeaderMouseEnter.subscribe(handleHeaderMouseEnter);
  }

  function destroy() {
    if (options.enableForCells) _grid.onMouseEnter.unsubscribe(handleMouseEnter);
    if (options.enableForHeaderCells) _grid.onHeaderMouseEnter.unsubscribe(handleHeaderMouseEnter);
  }

  function handleMouseEnter(e) {
    let cell = _grid.getCellFromEvent(e);
    if (cell) {
      let column = _grid.getColumns()[cell.cell] || {};
      if (column.autoTooltip === false) {
        return;
      }
      let $node = $(_grid.getCellNode(cell.row, cell.cell));
      let text;
      if ($node[0].offsetWidth < $node[0].scrollWidth) {
        text = $.trim($node.text());
        if (options.maxToolTipLength && text.length > options.maxToolTipLength) {
          text = `${text.substr(0, options.maxToolTipLength - 3)}...`;
        }
      } else {
        text = '';
      }
      $node.attr('title', text);
    }
  }

  function handleHeaderMouseEnter(e, args) {
    let column = args.column;
    let $node = $(e.currentTarget).find('.slick-column-name');
    if (column && !column.toolTip) {
      $node.attr('title', ($node[0].offsetWidth < $node[0].scrollWidth) ? column.name : '');
    }
  }

  // Public API
  $.extend(this, { init, destroy });
}

export default AutoTooltips;
