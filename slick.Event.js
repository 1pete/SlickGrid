import EventData from './slick.EventData';

class Event {
  constructor() {
    this.handlers = [];
  }

  subscribe(fn) {
    this.handlers.push(fn);
  }

  unsubscribe(fn) {
    const handlers = this.handlers;
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i] === fn) {
        handlers.splice(i, 1);
      }
    }
  }

  notify(args, e, scope) {
    e = e || new EventData();
    scope = scope || this;

    let returnValue;
    for (let i = 0; i < this.handlers.length && !(e.isPropagationStopped() || e.isImmediatePropagationStopped()); i++) {
      returnValue = this.handlers[i].call(scope, e, args);
    }

    return returnValue;
  }
}

export default Event;
