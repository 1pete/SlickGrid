class EventData {
  constructor() {
    this._isPropagationStopped = false;
    this._isImmediatePropagationStopped = false;
  }

  stopPropagation() {
    this._isPropagationStopped = true;
  }

  isPropagationStopped() {
    return this._isPropagationStopped;
  }

  stopImmediatePropagation() {
    this._isImmediatePropagationStopped = true;
  }

  isImmediatePropagationStopped() {
    return this._isImmediatePropagationStopped;
  }
}

export default EventData;
