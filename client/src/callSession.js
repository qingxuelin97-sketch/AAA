export const CALL_PHASE = Object.freeze({
  DIALING: 'dialing',
  LIVE: 'live',
  LISTENING: 'listening',
  TRANSCRIBING: 'transcribing',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  ENDED: 'ended',
});

// Generation tokens make every late ASR/model/TTS callback harmless. A new
// turn aborts the previous network work; ending aborts everything permanently.
export class CallSession {
  constructor() {
    this.generation = 1;
    this.ended = false;
    this.controllers = new Set();
  }

  token() {
    return { generation: this.generation };
  }

  isActive(token) {
    return !this.ended && token?.generation === this.generation;
  }

  abortTasks() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  beginTurn() {
    if (this.ended) return null;
    this.abortTasks();
    this.generation += 1;
    return this.token();
  }

  task(token = this.token()) {
    const controller = new AbortController();
    if (!this.isActive(token)) controller.abort();
    else this.controllers.add(controller);
    return {
      signal: controller.signal,
      done: () => this.controllers.delete(controller),
      abort: () => { controller.abort(); this.controllers.delete(controller); },
    };
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.generation += 1;
    this.abortTasks();
  }
}
