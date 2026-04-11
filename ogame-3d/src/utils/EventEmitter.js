/**
 * Simple EventEmitter implementation
 */

export class EventEmitter {
  constructor() {
    this.events = {};
  }
  
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    
    // Return unsubscribe function
    return () => this.off(event, listener);
  }
  
  off(event, listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
  }
  
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => {
      try {
        listener(data);
      } catch (e) {
        console.error('Event listener error:', e);
      }
    });
  }
  
  once(event, listener) {
    const onceListener = (data) => {
      this.off(event, onceListener);
      listener(data);
    };
    this.on(event, onceListener);
  }
}
