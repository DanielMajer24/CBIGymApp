// One queue per open workout. Debounce, blur, retry and completion all use it.
// Revisions and drafts survive refresh; only the exact acknowledged values clear.
export class WorkoutSaver {
  constructor(log, { storage, save, status }) {
    this.log = log;
    this.storage = storage;
    this.save = save;
    this.status = status;
    this.key = 'cbi-drafts-' + log.id;
    this.versionKey = 'cbi-draft-version-' + log.id;
    this.queue = Promise.resolve();
    const pending = Object.keys(this.drafts()).length > 0;
    this.revision = pending ? this.storage.getItem(this.versionKey) : log.updated_at;
    // Older app drafts have no base revision: require review, never guess.
    this.conflict = pending && !this.revision;
  }
  drafts() { return JSON.parse(this.storage.getItem(this.key) || '{}'); }
  put(record) {
    const drafts = this.drafts();
    if (!Object.keys(drafts).length) {
      this.revision = this.log.updated_at;
      this.storage.setItem(this.versionKey, this.revision);
    }
    drafts[record.workout_exercise_id + ':' + record.set_number] = record;
    this.storage.setItem(this.key, JSON.stringify(drafts));
  }
  flush({ complete = false, rpe = null, notes = null } = {}) {
    const run = async () => {
      if (this.conflict) {
        this.status('Review saved results before retrying. Your edits are kept.', 'error');
        throw Object.assign(new Error('Review saved results before retrying.'), {code:'40001'});
      }
      const batch = this.drafts(), records = Object.values(batch);
      if (!records.length && !complete) return this.log;
      this.status('Saving…', 'saving');
      try {
        // Keep the revision tied to this editor. Another tab updating storage
        // must not accidentally authorise a stale editor to overwrite its save.
        const log = { ...this.log, updated_at: this.revision };
        const saved = await this.save(log, records, complete, rpe, notes);
        const remaining = this.drafts();
        for (const [key, record] of Object.entries(batch)) {
          if (JSON.stringify(remaining[key]) === JSON.stringify(record)) delete remaining[key];
        }
        this.storage.setItem(this.key, JSON.stringify(remaining));
        this.storage.setItem(this.versionKey, saved.updated_at);
        this.revision = saved.updated_at;
        this.log = saved;
        this.status(Object.keys(remaining).length ? 'Changes pending…' : 'Saved ✓', Object.keys(remaining).length ? 'saving' : 'saved');
        return saved;
      } catch (error) {
        this.conflict = error.code === '40001';
        this.status(this.conflict ? 'Changed on another device — review saved results' : 'Not saved — changes kept on this device. Retry.', 'error');
        throw error;
      }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
}
