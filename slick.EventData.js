class EventData {
  constructor() {
    this.isPropagationStopped = false;
    this.isImmediatePropagationStopped = false;
  }

  stopPropagation() {
    this.isPropagationStopped = true;
  }

  isPropagationStopped() {
    return this.isPropagationStopped;
  }

  stopImmediatePropagation() {
    this.isImmediatePropagationStopped = true;
  }

  isImmediatePropagationStopped() {
    return this.isImmediatePropagationStopped;
  }
}

export default EventData;
