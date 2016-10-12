import $ from 'jquery';

import Event from './slick.Event';
import EventData from './slick.EventData';

function DataView() {
  let _this = this;

  let idProperty = 'id';

  let items = [];
  let rows = [];
  let idxById = {};

  let rowsById = null;
  let filter = null;

  let updated = null;

  // suspends the recalculation
  let suspend = false;
  let sortAsc = true;
  let sortComparer;

  // events
  let onRowCountChanged = new Event();
  let onRowsChanged = new Event();

  function beginUpdate() {
    suspend = true;
  }

  function endUpdate() {
    suspend = false;
    refresh();
  }

  function updateIdxById(startingIndex) {
    startingIndex = startingIndex || 0;
    let id;
    for (let i = startingIndex, l = items.length; i < l; i++) {
      id = items[i][idProperty];
      if (id === undefined) {
        throw new Error('Each data element must implement a unique "id" property');
      }

      idxById[id] = i;
    }
  }

  function ensureIdUniqueness() {
    let id;
    for (let i = 0, l = items.length; i < l; i++) {
      id = items[i][idProperty];
      if (id === undefined || idxById[id] !== i) {
        throw new Error('Each data element must implement a unique "id" property');
      }
    }
  }

  function getItems() {
    return items;
  }

  function setItems(data, objectIdProperty) {
    if (objectIdProperty !== undefined) {
      idProperty = objectIdProperty;
    }

    items = data;
    idxById = {};
    updateIdxById();
    ensureIdUniqueness();
    refresh();
  }

  function sort(comparer, ascending) {
    sortAsc = ascending;
    sortComparer = comparer;
    items.sort(comparer);
    if (ascending === false) {
      items.reverse();
    }

    idxById = {};
    updateIdxById();
    refresh();
  }

  function reSort() {
    if (sortComparer) {
      sort(sortComparer, sortAsc);
    }
  }

  function getItemByIdx(i) {
    return items[i];
  }

  function getIdxById(id) {
    return idxById[id];
  }

  function ensureRowsByIdCache() {
    if (!rowsById) {
      rowsById = {};
      for (let i = 0, l = rows.length; i < l; i++) {
        rowsById[rows[i][idProperty]] = i;
      }
    }
  }

  function getRowById(id) {
    ensureRowsByIdCache();
    return rowsById[id];
  }

  function getItemById(id) {
    return items[idxById[id]];
  }

  function mapIdsToRows(idArray) {
    let rows = [];
    ensureRowsByIdCache();
    for (let i = 0, l = idArray.length; i < l; i++) {
      let row = rowsById[idArray[i]];
      if (row != null) {
        rows[rows.length] = row;
      }
    }

    return rows;
  }

  function mapRowsToIds(rowArray) {
    let ids = [];
    for (let i = 0, l = rowArray.length; i < l; i++) {
      if (rowArray[i] < rows.length) {
        ids[ids.length] = rows[rowArray[i]][idProperty];
      }
    }

    return ids;
  }

  function updateItem(id, item) {
    if (idxById[id] === undefined || id !== item[idProperty]) {
      throw new Error('Invalid or non-matching id');
    }

    items[idxById[id]] = item;
    if (!updated) {
      updated = {};
    }

    updated[id] = true;
    refresh();
  }

  function insertItem(insertBefore, item) {
    items.splice(insertBefore, 0, item);
    updateIdxById(insertBefore);
    refresh();
  }

  function addItem(item) {
    items.push(item);
    updateIdxById(items.length - 1);
    refresh();
  }

  function deleteItem(id) {
    let idx = idxById[id];
    if (idx === undefined) {
      throw new Error('Invalid id');
    }

    delete idxById[id];
    items.splice(idx, 1);
    updateIdxById(idx);
    refresh();
  }

  function getLength() {
    return rows.length;
  }

  function getItem(i) {
    let item = rows[i];

    return item;
  }

  function getRowDiffs(rows, newRows) {
    let diff = [];
    let from = 0;
    let to = newRows.length;

    for (let i = from, rl = rows.length; i < to; i++) {
      if (i >= rl) {
        diff[diff.length] = i;
      }
    }

    return diff;
  }

  function recalc(_items) {
    rowsById = null;

    let newRows = _items.concat();
    let diff = getRowDiffs(rows, newRows);

    rows = newRows;

    return diff;
  }

  function refresh() {
    if (suspend) {
      return;
    }

    let countBefore = rows.length;

    // pass as direct refs to avoid closure perf hit
    let diff = recalc(items, filter);

    updated = null;

    if (countBefore !== rows.length) {
      onRowCountChanged.notify({ previous: countBefore, current: rows.length }, null, _this);
    }

    if (diff.length > 0) {
      onRowsChanged.notify({ rows: diff }, null, _this);
    }
  }

  function syncGridSelection(grid, preserveHidden, preserveHiddenOnSelectionChange) {
    let _this = this;
    let inHandler;
    let selectedRowIds = _this.mapRowsToIds(grid.getSelectedRows());
    let onSelectedRowIdsChanged = new Event();

    function setSelectedRowIds(rowIds) {
      if (selectedRowIds.join(',') === rowIds.join(',')) {
        return;
      }

      selectedRowIds = rowIds;

      onSelectedRowIdsChanged.notify({
        grid,
        ids: selectedRowIds,
      }, new EventData(), _this);
    }

    function update() {
      if (selectedRowIds.length > 0) {
        inHandler = true;
        let selectedRows = _this.mapIdsToRows(selectedRowIds);
        if (!preserveHidden) {
          setSelectedRowIds(_this.mapRowsToIds(selectedRows));
        }

        grid.setSelectedRows(selectedRows);
        inHandler = false;
      }
    }

    grid.onSelectedRowsChanged.subscribe(() => {
      if (inHandler) { return; }

      let newSelectedRowIds = _this.mapRowsToIds(grid.getSelectedRows());
      if (!preserveHiddenOnSelectionChange || !grid.getOptions().multiSelect) {
        setSelectedRowIds(newSelectedRowIds);
      } else {
        // keep the ones that are hidden
        let existing = $.grep(selectedRowIds, id => _this.getRowById(id) === undefined);

        // add the newly selected ones
        setSelectedRowIds(existing.concat(newSelectedRowIds));
      }
    });

    this.onRowsChanged.subscribe(update);

    this.onRowCountChanged.subscribe(update);

    return onSelectedRowIdsChanged;
  }

  $.extend(this, {
    name: 'DataView',

    // methods
    beginUpdate,
    endUpdate,
    getItems,
    setItems,
    sort,
    reSort,
    getIdxById,
    updateIdxById,
    getRowById,
    getItemById,
    getItemByIdx,
    mapRowsToIds,
    mapIdsToRows,
    refresh,
    updateItem,
    insertItem,
    addItem,
    deleteItem,
    syncGridSelection,

    // data provider methods
    getLength,
    getItem,

    // events
    onRowCountChanged,
    onRowsChanged,
  });
}

export default DataView;
