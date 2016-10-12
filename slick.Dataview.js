(function ($) {
  function DataView(options) {
    const self = this;

    const defaults = {
      groupItemMetadataProvider: null,
      inlineFilters: false,
    };

    // private
    // property holding a unique row id
    let idProperty = 'id';
    // data by index
    let items = [];
    // data by row
    let rows = [];
    // indexes by id
    let idxById = {};
    // rows by id; lazy-calculated
    let rowsById = null;
    // filter function
    const filter = null;
    // updated item ids
    let updated = null;
    // suspends the recalculation
    let suspend = false;
    let sortAsc = true;
    let fastSortField;
    let sortComparer;
    let filteredItems = [];

    let totalRows = 0;

    // events
    const onRowCountChanged = new Slick.Event();
    const onRowsChanged = new Slick.Event();

    options = $.extend(true, {}, defaults, options);


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
          throw 'Each data element must implement a unique \'id\' property';
        }
        idxById[id] = i;
      }
    }

    function ensureIdUniqueness() {
      let id;
      for (let i = 0, l = items.length; i < l; i++) {
        id = items[i][idProperty];
        if (id === undefined || idxById[id] !== i) {
          throw 'Each data element must implement a unique \'id\' property';
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
      items = filteredItems = data;
      idxById = {};
      updateIdxById();
      ensureIdUniqueness();
      refresh();
    }

    function sort(comparer, ascending) {
      sortAsc = ascending;
      sortComparer = comparer;
      fastSortField = null;
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
      const rows = [];
      ensureRowsByIdCache();
      for (let i = 0, l = idArray.length; i < l; i++) {
        const row = rowsById[idArray[i]];
        if (row != null) {
          rows[rows.length] = row;
        }
      }
      return rows;
    }

    function mapRowsToIds(rowArray) {
      const ids = [];
      for (let i = 0, l = rowArray.length; i < l; i++) {
        if (rowArray[i] < rows.length) {
          ids[ids.length] = rows[rowArray[i]][idProperty];
        }
      }
      return ids;
    }

    function updateItem(id, item) {
      if (idxById[id] === undefined || id !== item[idProperty]) {
        throw 'Invalid or non-matching id';
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
      const idx = idxById[id];
      if (idx === undefined) {
        throw 'Invalid id';
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
      const item = rows[i];

      return item;
    }

    function getRowDiffs(rows, newRows) {
      let item, r, diff = [];
      let from = 0, to = newRows.length;

      for (let i = from, rl = rows.length; i < to; i++) {
        if (i >= rl) {
          diff[diff.length] = i;
        } else {
          item = newRows[i];
          r = rows[i];
        }
      }
      return diff;
    }

    function recalc(_items) {
      rowsById = null;

      totalRows = _items.length;

      const newRows = _items.concat();
      const diff = getRowDiffs(rows, newRows);

      rows = newRows;

      return diff;
    }

    function refresh() {
      if (suspend) {
        return;
      }

      const countBefore = rows.length;

      // pass as direct refs to avoid closure perf hit
      const diff = recalc(items, filter);

      updated = null;

      if (countBefore !== rows.length) {
        onRowCountChanged.notify({ previous: countBefore, current: rows.length }, null, self);
      }

      if (diff.length > 0) {
        onRowsChanged.notify({ rows: diff }, null, self);
      }
    }

    function syncGridSelection(grid, preserveHidden, preserveHiddenOnSelectionChange) {
      const self = this;
      let inHandler;
      let selectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
      const onSelectedRowIdsChanged = new Slick.Event();

      function setSelectedRowIds(rowIds) {
        if (selectedRowIds.join(',') === rowIds.join(',')) {
          return;
        }

        selectedRowIds = rowIds;

        onSelectedRowIdsChanged.notify({
          grid,
          ids: selectedRowIds,
        }, new Slick.EventData(), self);
      }

      function update() {
        if (selectedRowIds.length > 0) {
          inHandler = true;
          const selectedRows = self.mapIdsToRows(selectedRowIds);
          if (!preserveHidden) {
            setSelectedRowIds(self.mapRowsToIds(selectedRows));
          }
          grid.setSelectedRows(selectedRows);
          inHandler = false;
        }
      }

      grid.onSelectedRowsChanged.subscribe(() => {
        if (inHandler) { return; }
        const newSelectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
        if (!preserveHiddenOnSelectionChange || !grid.getOptions().multiSelect) {
          setSelectedRowIds(newSelectedRowIds);
        } else {
          // keep the ones that are hidden
          const existing = $.grep(selectedRowIds, (id) => { return self.getRowById(id) === undefined; });
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

  $.extend(true, window, {
    Slick: {
      Data: {
        DataView,
      },
    },
  });
}(jQuery));
