// A Playwright reporter for the UI review pictures (playwright.ui-review.config.js): at the end of the run it says where the pictures
// went and how many this run wrote, and lists the notes that the spec made (a page that scrolls sideways, a button that cannot be
// tapped, a console error of the app), so that the person (or the agent) who ran it knows which folder to open and where to look first.
// It runs once, in the main process, so a worker that Playwright restarts after a failure does not print it twice. It reads the
// folder and writes nothing.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { outDir } from './settings.mjs'

export default class UiReviewReporter {
  constructor() {
    this.notes = []
  }

  onBegin() {
    this.startedAt = Date.now()
    this.dir = outDir()
  }

  onTestEnd(test) {
    for (const annotation of test.annotations) {
      if (annotation.type === 'note') this.notes.push(annotation.description)
    }
  }

  onEnd(result) {
    let fresh = []
    try {
      fresh = readdirSync(this.dir).filter((name) => name.endsWith('.png') && statSync(path.join(this.dir, name)).mtimeMs >= this.startedAt)
    } catch {
      /* no folder: no test got as far as the first picture */
    }
    const notes = [...new Set(this.notes)]
    if (notes.length) {
      console.log(`\nNotes (${notes.length}), each a place to look first:`)
      for (const text of notes) console.log(`  - ${text}`)
    }
    console.log(`\nUI review: ${fresh.length} picture${fresh.length === 1 ? '' : 's'} written to ${this.dir} (status: ${result.status}).`)
    console.log('They are not baselines and are never committed. Open each one that the change reaches (step 3 of the ui-review skill).')
  }
}
