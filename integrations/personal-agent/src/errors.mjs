export class AudioLimitError extends Error {
  constructor(limit) {
    super('Audio too large')
    this.limit = limit
  }
}
