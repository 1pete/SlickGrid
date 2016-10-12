class Range {
  constructor(fromRow, fromCell, toRow, toCell) {
    if (toRow === undefined && toCell === undefined) {
      toRow = fromRow;
      toCell = fromCell;
    }

    this.fromRow = Math.min(fromRow, toRow);
    this.fromCell = Math.min(fromCell, toCell);
    this.toRow = Math.max(fromRow, toRow);
    this.toCell = Math.max(fromCell, toCell);
  }

  isSingleRow() {
    return this.fromRow === this.toRow;
  }

  isSingleCell() {
    return this.fromRow === this.toRow && this.fromCell === this.toCell;
  }

  contains(row, cell) {
    return row >= this.fromRow && row <= this.toRow && cell >= this.fromCell && cell <= this.toCell;
  }

  toString() {
    if (this.isSingleCell()) {
      return `(${this.fromRow}:${this.fromCell})`;
    }

    return `(${this.fromRow}:${this.fromCell} - ${this.toRow}:${this.toCell})`;
  }
}

export default Range;
