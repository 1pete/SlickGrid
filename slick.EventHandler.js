class EventHandler {
  constructor() {
    this.handlers = [];
  }

  subscribe(event, handler) {
    this.handlers.push({ event, handler });
    event.subscribe(handler);

    return this;
  }

  unsubscribe(event, handler) {
    let i = this.handlers.length;
    while (i--) {
      if (this.handlers[i].event === event &&
          this.handlers[i].handler === handler) {
        this.handlers.splice(i, 1);
        event.unsubscribe(handler);
        return this;
      }
    }

    return this;
  }

  unsubscribeAll() {
    let i = this.handlers.length;
    while (i--) {
      this.handlers[i].event.unsubscribe(this.handlers[i].handler);
    }
    this.handlers = [];

    return this;
  }
}

export default EventHandler;
